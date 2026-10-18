import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbAvailable } from './setup-db';
import { runReview, askDomino } from '../src/lib/agent/runner';
import { adminQuery, closeDb, run } from '../src/lib/db';
import { Q } from '../src/lib/cypher';
import type { Provider, ChatMessage, ToolDecl } from '../src/lib/agent/providers/types';
import type { AgentEvent } from '../src/lib/agent/events';
import { createMcpServer } from '../src/lib/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

let ok = false;
beforeAll(async () => {
  ok = await dbAvailable();
});
afterAll(async () => closeDb());

async function askWith(ask: typeof askDomino, provider: Provider, pid: string, q: string, events: AgentEvent[]): Promise<string> {
  return ask(pid, q, (e) => events.push(e), undefined, provider);
}

/** A scripted model: replays a fixed plan of tool calls per agent, then answers. */
function scriptedProvider(plans: Record<string, { name: string; args: unknown }[][]>): Provider {
  const turn: Record<string, number> = {};
  return {
    id: 'openai',
    model: 'scripted',
    async chat(system: string, _messages: ChatMessage[], tools: ToolDecl[]) {
      const role = system.includes('You are the Detective')
        ? 'detective'
        : system.includes('Pharmacist agent')
          ? 'pharmacist'
          : system.includes('You are the Scribe')
            ? 'scribe'
            : 'domino';
      const i = (turn[role] = (turn[role] ?? -1) + 1);
      const plan = plans[role]?.[i];
      if (!plan || !tools.length) return { text: `${role} done.`, toolCalls: [], model: 'scripted' };
      return { text: '', toolCalls: plan.map((c, k) => ({ id: `${role}-${i}-${k}`, name: c.name, args: c.args })), model: 'scripted' };
    },
  };
}

describe.runIf(await dbAvailable())('agent team', () => {
  it('planner mode: detective → pharmacist → scribe with verified handoffs', async () => {
    expect(ok, 'FalkorDB must be reachable and seeded').toBe(true);
    const events: AgentEvent[] = [];
    const res = await runReview({ patientId: 'p-henry', mode: 'planner', emit: (e) => events.push(e) });
    expect(res.mode).toBe('planner');
    expect(res.findings).toBeGreaterThan(0);
    // The review's tasks are in the inbox exactly once, however many reviews ran before this one.
    const open = await run<{ title: string; finding: string | null }>(Q.openTasksFor, { pid: 'p-henry' });
    expect(open.length).toBeGreaterThan(0);
    expect(new Set(open.map((t) => t.finding ?? t.title)).size).toBe(open.length);
    const handoffs = events.filter((e) => e.type === 'handoff');
    expect(handoffs.length).toBe(2);
    expect(handoffs.every((h) => h.type === 'handoff' && h.verified)).toBe(true);
    const steps = await run(Q.runSteps, { run: res.runId });
    expect(steps.length).toBeGreaterThan(10);
  });

  it('a graph algorithm sets priority: a cascade through a chokepoint drug is reviewed sooner', async () => {
    expect(ok, 'FalkorDB must be reachable and seeded').toBe(true);
    // Start clean, so the review proposes its task now rather than finding one already open.
    await adminQuery(`MATCH (t:Task)-[:FOR]->(:Patient {id: 'p-walter'}) DETACH DELETE t`);
    const events: AgentEvent[] = [];
    await runReview({ patientId: 'p-walter', mode: 'planner', emit: (e) => events.push(e) });
    const ch = events.find((e) => e.type === 'result' && e.name === 'find_chokepoints');
    expect(ch && ch.type === 'result' && ch.queries.map((q) => q.id)).toContain('chokepoints');
    const rows = (await adminQuery(
      `MATCH (t:Task)-[:FOR]->(:Patient {id: 'p-walter'}) WHERE t.status = 'proposed' AND t.body CONTAINS 'chokepoint' RETURN t.body AS body, t.due AS due, t.created AS created`,
    )) as { data?: { body: string; due: number }[] };
    expect(rows.data?.length, 'a task prioritised by betweenness centrality').toBeGreaterThan(0);
    expect(rows.data![0].body).toMatch(/Meclizine in this cascade is a chokepoint/);
  });

  it('LLM mode: tool loop, least privilege and the wording guardrail', async () => {
    expect(ok, 'FalkorDB must be reachable and seeded').toBe(true);
    const provider = scriptedProvider({
      detective: [
        [{ name: 'find_cascades', args: {} }],
        [{ name: 'draft_note', args: { kind: 'patient', text: 'x'.repeat(50) } }],
        [{ name: 'record_findings', args: { links: ['tamsulosin>meclizine'] } }],
      ],
      pharmacist: [[{ name: 'simulate_untangle', args: { drug: 'tamsulosin' } }]],
      scribe: [
        [
          {
            name: 'propose_task',
            args: { title: 'Stop taking meclizine now', body: 'Please discontinue meclizine today.', role: 'prescriber', due_in_days: 3 },
          },
        ],
        [
          {
            name: 'propose_task',
            args: {
              title: 'Could the dizziness be from tamsulosin?',
              body: 'Meclizine started 24 days after tamsulosin. Review together.',
              role: 'pharmacist',
              due_in_days: 7,
            },
          },
        ],
      ],
    });
    const events: AgentEvent[] = [];
    const res = await runReview({ patientId: 'p-walter', provider, emit: (e) => events.push(e) });
    const results = events.filter((e): e is Extract<AgentEvent, { type: 'result' }> => e.type === 'result');
    // the detective is not allowed to draft notes
    expect(results.find((r) => r.name === 'draft_note')?.summary).toMatch(/not available to the detective/);
    // the scribe's directive wording is rejected, the question is accepted
    const tasks = results.filter((r) => r.name === 'propose_task');
    expect(tasks[0].ok).toBe(false);
    expect(tasks[0].summary).toMatch(/guardrail/);
    expect(tasks[1].ok).toBe(true);
    expect(res.tasks).toBe(1);
    expect(res.mode).toBe('llm');
  });

  it('ask is read-only and answers from the graph', async () => {
    expect(ok, 'FalkorDB must be reachable and seeded').toBe(true);
    const events: AgentEvent[] = [];
    const answer = await askDomino('p-walter', 'What raises his fall risk?', (e) => events.push(e));
    expect(answer).toMatch(/fall/i);
    expect(events.some((e) => e.type === 'result' && ['record_findings', 'propose_task', 'draft_note'].includes(e.name))).toBe(false);
  });

  it('resolves a medicine the question names against the graph, and never guesses at one it does not know', async () => {
    expect(ok, 'FalkorDB must be reachable and seeded').toBe(true);
    const events: AgentEvent[] = [];
    // Not on Walter's list, but in the graph: the prescriber check says what adding it would mean.
    const off = await askDomino('p-walter', 'Could metoprolol be behind his dizziness?', (e) => events.push(e));
    expect(off).toMatch(/Metoprolol is not on Walter/);
    expect(off).toMatch(/prescriber check says/);
    const tool = events.find((e) => e.type === 'tool' && e.name === 'resolve_drug');
    expect(tool && tool.type === 'tool' && tool.via).toBe('mcp');
    // A brand name for one of his own medicines is his medicine, not an unknown one.
    const own = await askDomino('p-walter', 'Is Flomax part of a cascade?', () => {});
    expect(own).toMatch(/Tamsulosin/);
    expect(own).not.toMatch(/not a medicine in Domino/);
    // Not in the graph at all: said plainly, not guessed.
    // Named next to one of his own medicines, it is still said out loud rather than skipped.
    const mixed = await askDomino('p-walter', 'Is zorbaxapril safe with his tamsulosin?', () => {});
    expect(mixed).toMatch(/“zorbaxapril” is not a medicine in Domino’s knowledge graph/);
    expect(mixed).toMatch(/Tamsulosin/);
    // A brand name the graph doesn't know is caught too, not only names with a generic-name ending.
    const brand = await askDomino('p-walter', 'Is Entresto safe with his tamsulosin?', () => {});
    expect(brand).toMatch(/^“Entresto” is not a medicine in Domino’s knowledge graph/);
    expect(brand).toMatch(/Tamsulosin/);
    // People and symptoms are not medicines: no false alarm about a doctor's name or a diagnosis.
    const people = await askDomino('p-walter', 'Did Dr Patel or Okafor start the Flomax? Is his Parkinson risk up?', () => {});
    expect(people).not.toMatch(/is not a medicine/);
    const cue = await askDomino('p-walter', 'His daughter says he started qelvorin last week. Could that explain the dizziness?', () => {});
    expect(cue).toMatch(/“qelvorin” is not a medicine/);
    const unknown2 = await askDomino('p-walter', 'Could zorbaxapril cause his falls?', () => {});
    expect(unknown2).toMatch(/not a medicine in Domino’s knowledge graph/);
    expect(unknown2).toMatch(/does not mean it is safe/);
  });

  it('holds back a model answer or handoff that tells someone to change a medicine', async () => {
    expect(ok, 'FalkorDB must be reachable and seeded').toBe(true);
    const bossy: Provider = {
      id: 'openai',
      model: 'scripted',
      async chat(system) {
        if (system.includes('You are the Detective')) return { text: 'Stop taking meclizine. Tamsulosin is the root.', toolCalls: [], model: 'scripted' };
        return { text: 'Stop meclizine and switch to an alpha blocker with less dizziness.', toolCalls: [], model: 'scripted' };
      },
    };
    // A model answer that ignores a medicine the graph does not know still gets it named.
    const quiet: Provider = { id: 'openai', model: 'scripted', chat: async () => ({ text: 'His falls come from tamsulosin and meclizine.', toolCalls: [], model: 'scripted' }) };
    expect(await askWith(askDomino, quiet, 'p-walter', 'Could zorbaxapril add to his falls?', [])).toMatch(/^“zorbaxapril” is not a medicine in Domino’s knowledge graph/);
    const events: AgentEvent[] = [];
    const answer = await askWith(askDomino, bossy, 'p-walter', 'What raises his fall risk?', events);
    expect(answer).not.toMatch(/Stop meclizine/);
    expect(answer).toMatch(/fall/i);
    expect(events.some((e) => e.type === 'warning' && /never does/.test(e.text))).toBe(true);
    const review: AgentEvent[] = [];
    await runReview({ patientId: 'p-walter', provider: bossy, emit: (e) => review.push(e) });
    const h = review.find((e) => e.type === 'handoff');
    expect(h && h.type === 'handoff' && h.text).toMatch(/held back by the wording guard/);
    expect(h && h.type === 'handoff' && h.verified).toBe(true);
  });

  it('Ask selects its tools through MCP and cannot reach other patients', async () => {
    expect(ok, 'FalkorDB must be reachable and seeded').toBe(true);
    const seenTools: string[][] = [];
    const provider: Provider = {
      id: 'openai',
      model: 'scripted',
      async chat(_system, messages, tools) {
        seenTools.push(tools.map((t) => t.name));
        const hasResult = messages.some((m) => m.role === 'tool');
        if (!hasResult) return { text: '', toolCalls: [{ id: 'a1', name: 'find_cascades', args: { patient_id: 'p-beatrice' } }], model: 'scripted' };
        return { text: 'Lorazepam started the chain.', toolCalls: [], model: 'scripted' };
      },
    };
    const { askDomino: ask } = await import('../src/lib/agent/runner');
    const events: AgentEvent[] = [];
    const answer = await askWith(ask, provider, 'p-rosa', 'What started this?', events);
    expect(answer).toMatch(/Lorazepam/);
    expect(seenTools[0]).toContain('find_cascades');
    expect(seenTools[0]).not.toContain('list_patients');
    // Nor a clinic-wide search that would return other patients' notes and tasks.
    expect(seenTools[0]).not.toContain('search_team_memory');
    const tool = events.find((e) => e.type === 'tool');
    expect(tool && tool.type === 'tool' && tool.via).toBe('mcp');
    // the model asked for Beatrice, but the patient id is injected by Domino: the result is Rosa's
    const result = events.find((e) => e.type === 'result');
    expect(result && result.type === 'result' && result.summary).toMatch(/Lorazepam/);
  });

  it('answers every tool call, even past the per-turn cap', async () => {
    expect(ok, 'FalkorDB must be reachable and seeded').toBe(true);
    let second: ChatMessage[] = [];
    const provider: Provider = {
      id: 'openai',
      model: 'scripted',
      async chat(_system, messages) {
        if (!messages.some((m) => m.role === 'tool')) {
          return { text: '', toolCalls: Array.from({ length: 6 }, (_, k) => ({ id: `c${k}`, name: 'find_cascades', args: {} })), model: 'scripted' };
        }
        second = [...messages];
        return { text: 'Done.', toolCalls: [], model: 'scripted' };
      },
    };
    const events: AgentEvent[] = [];
    await askWith(askDomino, provider, 'p-walter', 'What started this?', events);
    const results = second.filter((m) => m.role === 'tool');
    expect(results.map((m) => (m as { toolCallId: string }).toolCallId)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
    expect(results.filter((m) => String(m.content).startsWith('Skipped')).length).toBe(2);
    expect(events.filter((e) => e.type === 'tool').length).toBe(4);
  });

  it('exposes the tools over MCP', async () => {
    expect(ok, 'FalkorDB must be reachable and seeded').toBe(true);
    const server = createMcpServer({ allowWrites: false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('find_cascades');
    expect(names).not.toContain('run_review');
    const r = await client.callTool({ name: 'find_cascades', arguments: { patient_id: 'p-rosa' } });
    expect((r.content as { text: string }[])[0].text).toMatch(/Lorazepam/);
    await client.close();
  });
});
