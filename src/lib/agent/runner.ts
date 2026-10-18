// The Domino agent team: Detective → Pharmacist → Scribe.
//
// Each agent is an LLM tool-calling loop over its own tool subset (least privilege).
// Agents hand off through signed Handoff nodes in FalkorDB (shared state); the next
// agent reads the handoff back from the graph and verifies the signature before acting.
// With no LLM key, the same tools run in a deterministic graph planner, so the product
// still works end to end and every run is still stored and auditable.

import { randomUUID } from 'node:crypto';
import { graphName, run, type Tracer } from '../db';
import { Q } from '../cypher';
import { analyzePatient, loadPatient } from '../engine/analyze';
import type { Analysis } from '../engine/types';
import { dayToLabel, daysBetweenLabel, TODAY_DAY } from '../../data/time';
import { EFFECT } from '../../data/knowledge';
import { callTool, toolsFor, type ToolContext } from './tools';
import { PROMPTS } from './prompts';
import { getProvider, modelPause, pauseModel } from './providers';
import { AbortedError, ProviderError, type ChatMessage, type Provider, type ToolDecl } from './providers/types';
import { mcpCall, mcpTeamCall, mcpTeamTools, mcpTools } from './mcp-client';
import { HISTORY_TURNS, openConversation, remember, type Source, type StoredMessage } from '../memory/conversations';
import { currentClinic, currentUser, USERS } from '../tenant';
import { PATTERNS } from '../../data/knowledge';
import { asData, checkClinicalWording, cleanText, truncateForModel } from './guard';
import { signPayload, verifyPayload } from './sign';
import type { AgentEvent, AgentRole } from './events';
import { BusyError, holder, withLease } from '../lock';
import { ensureEmbeddings } from '../semantic';
import { matchMedications } from '../cds';
import { NOT_CHECKED, nameWords, toQuery } from '../checkup';
import { PRESCRIBERS } from '../../data/personas';

export interface ReviewOptions {
  patientId: string;
  trigger?: 'manual' | 'new_prescription' | 'sweep' | 'mcp';
  mode?: 'auto' | 'planner';
  emit?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  /** Milliseconds to pause between planner steps so a person can follow the stream. */
  pace?: number;
  /** Inject a provider (tests). */
  provider?: Provider;
}

export interface ReviewResult {
  runId: string;
  summary: string;
  findings: number;
  tasks: number;
  notes: number;
  mode: 'llm' | 'planner';
  model: string;
  ms: number;
}

const MAX_CALLS_PER_TURN = 4;

/** Per run (or per question): which models actually answered, and whether the model failed and the planner took over. */
interface ModelState {
  failed: boolean;
  used: Set<string>;
}
const MODEL_STATE = new WeakMap<ToolContext, ModelState>();
const modelState = (ctx: ToolContext): ModelState => {
  let st = MODEL_STATE.get(ctx);
  if (!st) MODEL_STATE.set(ctx, (st = { failed: false, used: new Set() }));
  return st;
};
/** Ask the model for this step? Not after it failed earlier in the run, and not while it is paused for everyone. */
const modelLive = (ctx: ToolContext, provider: Provider | null): provider is Provider => !!provider && !modelState(ctx).failed && !modelPause();
/** What actually did the work, for the run record and the conversation: the models that answered, and the planner if it took over. */
function workedBy(ctx: ToolContext, provider: Provider | null, label: string): { mode: 'llm' | 'planner'; model: string } {
  const st = modelState(ctx);
  if (!provider || !st.used.size) return { mode: 'planner', model: st.failed ? `Graph planner (${label} failed)` : label };
  return { mode: 'llm', model: `${provider.id}:${[...st.used].join(', ')}${st.failed ? ' + graph planner' : ''}` };
}

/**
 * Run a step with the model; if the model itself fails (quota, outage, too slow), say so and let the graph planner do
 * the same step on the same tools, so a review or an answer never dies with the model. The rest of the run then uses the
 * planner too. Tool errors are not model errors (they go back to the model as results), and a cancelled request is
 * neither retried nor handed to the planner.
 */
async function modelOrPlanner<T>(
  ctx: ToolContext,
  emit: (e: AgentEvent) => void,
  what: string,
  signal: AbortSignal | undefined,
  llm: () => Promise<T>,
  planner: () => Promise<T>,
): Promise<T> {
  try {
    return await llm();
  } catch (err) {
    if (signal?.aborted || err instanceof AbortedError || !(err instanceof ProviderError)) throw err;
    modelState(ctx).failed = true;
    const why = err.status === 429 ? 'over its quota' : err.status === 408 ? 'too slow to answer' : 'unavailable';
    // Skip the model for everyone for a minute, unless this was one bad request (a 400 that is not about the key).
    if (!(err.status === 400 && !/api key/i.test(err.message))) pauseModel(err.message);
    emit({ type: 'warning', text: `The language model was ${why}, so the graph planner finished ${what} with the same tools.` });
    return planner();
  }
}

/** True while any instance holds the review lease for this patient (checked before a write that would start one). */
export async function isBusy(patientId: string) {
  return !!(await holder(`review:${patientId}`));
}

export { BusyError };

const PACE = new WeakMap<ToolContext, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeContext(runId: string | null, patientId: string, emit: (e: AgentEvent) => void, tracer: Tracer): ToolContext {
  return {
    runId,
    patientId,
    role: 'detective',
    tracer,
    cache: {},
    step: null,
    counters: { findings: 0, tasks: 0, notes: 0 },
    emit,
    artifacts: { findings: [], findingKeys: [], tasks: [], notes: [] },
  };
}

/** Contexts whose tool calls go through Domino's MCP server instead of in-process. */
const MCP_CTX = new WeakSet<ToolContext>();
/** Clinic-wide contexts: MCP tools without a fixed patient. */
const MCP_TEAM = new WeakSet<ToolContext>();

async function step(ctx: ToolContext, role: AgentRole, name: string, args: Record<string, unknown> = {}) {
  const pace = PACE.get(ctx);
  if (pace) await sleep(pace);
  ctx.role = role;
  const id = randomUUID().slice(0, 8);
  const viaMcp = MCP_CTX.has(ctx) || MCP_TEAM.has(ctx);
  ctx.emit({ type: 'tool', agent: role, id, name, args, via: viaMcp ? 'mcp' : undefined });
  const r = MCP_TEAM.has(ctx)
    ? { ...(await mcpTeamCall(name, args)), data: undefined }
    : viaMcp
      ? { ...(await mcpCall(ctx.patientId, name, args)), data: undefined }
      : await callTool(ctx, name, args);
  ctx.emit({ type: 'result', agent: role, id, name, ok: r.ok, summary: r.summary, ms: r.ms, queries: r.queries });
  return r;
}

interface Toolset {
  tools: ToolDecl[];
  invoke: (
    name: string,
    args: unknown,
  ) => Promise<{ ok: boolean; summary: string; ms: number; queries?: { id: string; title: string; ms: number; rows: number }[] }>;
  via?: 'mcp';
}

/** Time an agent may spend with the model before the planner takes over (route limits: 300 s for a review, 120 s for a question). */
const AGENT_BUDGET_MS = { review: 80_000, ask: 70_000 };

async function llmAgent(
  provider: Provider,
  role: AgentRole,
  ctx: ToolContext,
  userMessage: string,
  signal?: AbortSignal,
  maxSteps = 8,
  toolset?: Toolset,
  history: ChatMessage[] = [],
  budgetMs = AGENT_BUDGET_MS.review,
): Promise<string> {
  // The agent's own time budget, on top of the caller's cancel: running out is a model failure (the planner takes
  // over); a cancel is not.
  const budget = new AbortController();
  let overBudget = false;
  const timer = setTimeout(() => {
    overBudget = true;
    budget.abort();
  }, budgetMs);
  const onCancel = () => budget.abort();
  if (signal?.aborted) budget.abort();
  signal?.addEventListener('abort', onCancel);
  const stop = () => {
    if (!budget.signal.aborted) return;
    if (overBudget) throw new ProviderError('The model took too long for this step.', 408);
    throw new AbortedError();
  };
  try {
    return await agentLoop(provider, role, ctx, userMessage, budget.signal, stop, maxSteps, toolset, history);
  } catch (err) {
    if (err instanceof AbortedError && overBudget) throw new ProviderError('The model took too long for this step.', 408);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
}

async function agentLoop(
  provider: Provider,
  role: AgentRole,
  ctx: ToolContext,
  userMessage: string,
  signal: AbortSignal,
  stop: () => void,
  maxSteps: number,
  toolset: Toolset | undefined,
  history: ChatMessage[],
): Promise<string> {
  ctx.role = role;
  const tools = toolset?.tools ?? toolsFor(role).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const messages: ChatMessage[] = [...history, { role: 'user', content: userMessage }];
  for (let i = 0; i < maxSteps; i++) {
    stop();
    const res = await provider.chat(PROMPTS[role], messages, tools, signal);
    modelState(ctx).used.add(res.model);
    // Cancelled (or out of time) while the model was answering: do not run the tools it asked for.
    stop();
    messages.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls, raw: res.raw });
    if (!res.toolCalls.length) return res.text;
    if (res.text) ctx.emit({ type: 'thought', agent: role, text: cleanText(res.text, 800) });
    // Every tool call must get a result, or the provider rejects the next turn. Run at most four per turn
    // (OWASP LLM10, unbounded consumption) and answer the rest as skipped so the model can ask again.
    for (const [n, call] of res.toolCalls.entries()) {
      if (n >= MAX_CALLS_PER_TURN) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: `Skipped: at most ${MAX_CALLS_PER_TURN} tool calls run per turn. Call it again next turn if you still need it.`,
        });
        continue;
      }
      const id = call.id.slice(0, 12);
      ctx.role = role;
      ctx.emit({ type: 'tool', agent: role, id, name: call.name, args: call.args, via: toolset?.via });
      const r = toolset ? await toolset.invoke(call.name, call.args) : await callTool(ctx, call.name, call.args);
      ctx.emit({ type: 'result', agent: role, id, name: call.name, ok: r.ok, summary: r.summary, ms: r.ms, queries: r.queries ?? [] });
      messages.push({ role: 'tool', toolCallId: call.id, toolName: call.name, content: truncateForModel(r.summary) });
    }
  }
  messages.push({ role: 'user', content: 'Tool budget used. Write your final message now, without calling tools.' });
  stop();
  const res = await provider.chat(PROMPTS[role], messages, tools, signal);
  modelState(ctx).used.add(res.model);
  return res.text || 'Finished.';
}

async function handoff(ctx: ToolContext, runId: string, from: AgentRole, to: AgentRole, text: string, focus: string[]) {
  const id = `h-${randomUUID()}`;
  // A handoff is stored and shown like everything else an agent writes, so it passes the same wording guard.
  let body = cleanText(text, 3000);
  if (!checkClinicalWording(body).ok) {
    ctx.emit({ type: 'warning', text: `The ${from}'s handoff told someone to change a medicine, which Domino never does. It was held back; the ${to} works from the recorded findings.` });
    body = `Handoff held back by the wording guard (it instructed a medication change). The findings recorded in this run stand; the ${to} reads them from the graph.`;
  }
  const payload = { id, run: runId, from, to, text: body, focus };
  const sig = signPayload(payload);
  await run(
    Q.handoff,
    { run: runId, id, from, to, payload: JSON.stringify(payload), sig, at: Date.now(), focus: focus.map((k) => `${ctx.patientId}:${k}`) },
    ctx.tracer,
  );
  return id;
}

async function receive(ctx: ToolContext, runId: string, id: string, to: AgentRole): Promise<{ text: string; focus: string[] }> {
  const rows = await run<{ from: string; to: string; payload: string; sig: string }>(Q.readHandoff, { run: runId, id }, ctx.tracer);
  const row = rows[0];
  let payload: { id: string; run: string; from: AgentRole; to: AgentRole; text: string; focus: string[] } | null = null;
  try {
    payload = row ? JSON.parse(row.payload) : null;
  } catch {
    payload = null;
  }
  const verified = !!payload && payload.to === to && payload.run === runId && verifyPayload(payload, row?.sig);
  ctx.emit({ type: 'handoff', from: (payload?.from ?? 'detective') as AgentRole, to, id, verified, text: payload?.text ?? '' });
  if (!verified || !payload) throw new Error('Handoff failed its signature check. The run was stopped.');
  return { text: payload.text, focus: payload.focus };
}

// ─── Deterministic graph planner (used when no LLM key is configured) ──────────

function detectiveHandoffText(a: Analysis): string {
  if (!a.trees.length)
    return `No likely cascades for ${a.patient.name}. ${a.combos.length ? `Dangerous combination: ${a.combos.map((c) => c.title).join(', ')}.` : ''}`.trim();
  const t = a.trees[0];
  const parts = [
    `${a.summary.likely} likely and ${a.summary.possible} possible cascade links for ${a.patient.name}.`,
    `Strongest root: ${t.rootName}, feeding ${t.downstream.length} downstream drug(s) (${t.chains.map((c) => c.links.map((l) => l.key).join(' then ')).join('; ')}).`,
  ];
  if (a.trees.length > 1)
    parts.push(
      `Other roots: ${a.trees
        .slice(1)
        .map((x) => x.rootName)
        .join(', ')}.`,
    );
  if (a.loops.length) parts.push(`Feedback loop: ${a.loops.map((l) => l.steps.map((s) => s.fromName).join(' ↔ ')).join('; ')}.`);
  if (a.combos.length) parts.push(`Dangerous combination: ${a.combos.map((c) => `${c.title} (${c.drugs.join(' + ')})`).join('; ')}.`);
  return parts.join(' ');
}

async function plannerDetective(ctx: ToolContext, name: string): Promise<{ text: string; a: Analysis }> {
  ctx.emit({ type: 'thought', agent: 'detective', text: `Loading ${name}'s record and what the care team decided before.` });
  await step(ctx, 'detective', 'get_patient_context');
  await step(ctx, 'detective', 'find_cascades');
  const mem = await step(ctx, 'detective', 'recall_memory');
  const md = mem.data as { notes?: number; reports?: { note: string; effectName: string; causedBy: string[]; treatedWith: string[] }[] } | undefined;
  const notes = Number(md?.notes ?? 0);
  const reports = md?.reports ?? [];
  // What the team wrote, read against the graph: each symptom a note reports, which of the patient's drugs can cause it,
  // and whether one already treats it.
  for (const r of reports.slice(0, 3)) {
    const eff = r.effectName.toLowerCase();
    ctx.emit({
      type: 'thought',
      agent: 'detective',
      text: !r.causedBy.length
        ? `The team note “${r.note}” reports ${eff}, which none of ${name}'s medicines is known to cause.`
        : r.treatedWith.length
          ? `The team note “${r.note}” reports ${eff}: ${r.causedBy.join(' or ')} can cause it and ${r.treatedWith.join(', ')} already treats it. The team's own words back up that link.`
          : `The team note “${r.note}” reports ${eff}: ${r.causedBy.join(' or ')} can cause it, and nothing on the list treats it yet. Worth asking before anything is added for it.`,
    });
  }
  if (notes && !reports.length)
    ctx.emit({
      type: 'thought',
      agent: 'detective',
      text: `Read the ${notes} team note${notes === 1 ? '' : 's'} about ${name} or these medicines: none reports a symptom about ${name}.`,
    });
  const a0 = ctx.cache.analysis ?? (await analyzePatient(ctx.patientId));
  const unchecked = a0.patient.headline?.match(NOT_CHECKED)?.[0];
  if (unchecked) ctx.emit({ type: 'thought', agent: 'detective', text: `${unchecked} Whatever this review finds, it says nothing about those.` });
  await step(ctx, 'detective', 'check_harms');
  const keys = a0.links.filter((l) => l.tier === 'likely' || l.tier === 'possible').map((l) => l.key);
  if (keys.length) {
    ctx.emit({ type: 'thought', agent: 'detective', text: `${keys.length} link(s) are worth a human look. Recording them as findings.` });
    await step(ctx, 'detective', 'record_findings', { links: keys.slice(0, 12) });
  } else {
    ctx.emit({ type: 'thought', agent: 'detective', text: 'Nothing rises above the threshold. Every candidate link was ruled out or explained.' });
  }
  return { text: detectiveHandoffText(a0), a: a0 };
}

async function plannerPharmacist(ctx: ToolContext, a: Analysis) {
  const lines: string[] = [];
  if (a.trees.length) {
    // A graph algorithm, not a lookup: which drugs in these cascades do many possible cascades pass through?
    ctx.emit({ type: 'thought', agent: 'pharmacist', text: 'Running betweenness centrality over the cascade graph to see whether any drug in these chains is a chokepoint.' });
    const ch = await step(ctx, 'pharmacist', 'find_chokepoints');
    const inChains = ((ch.data as { inChains?: string[] } | undefined)?.inChains ?? []).map((id) => ctx.cache.hubs?.find((h) => h.id === id)).filter((h) => !!h);
    if (inChains.length)
      lines.push(
        `Chokepoints: ${inChains.map((h) => `${h!.name} (betweenness ${h!.score})`).join(', ')} ${inChains.length === 1 ? 'sits' : 'sit'} where many possible cascades meet, so the reviews that include ${inChains.length === 1 ? 'it' : 'them'} come first.`,
      );
  }
  for (const t of a.trees.slice(0, 2)) {
    const first = t.chains[0]?.links[0];
    if (!first) continue;
    ctx.emit({ type: 'thought', agent: 'pharmacist', text: `Checking the evidence for ${t.rootName} → ${first.effectPlain.toLowerCase()} → ${first.toName}.` });
    await step(ctx, 'pharmacist', 'explain_link', { from: first.from, to: first.to });
    const alt = await step(ctx, 'pharmacist', 'find_safer_alternatives', { drug: t.root, effect: first.effect });
    await step(ctx, 'pharmacist', 'simulate_untangle', { drug: t.root });
    await step(ctx, 'pharmacist', 'population_signal', { from: first.from, to: first.to });
    const u = t.untangle;
    const pat = first.patterns[0];
    const options = (alt.data as { options?: string[] } | undefined)?.options ?? [];
    lines.push(
      `${t.rootName}: ${pat ? pat.question : `Could ${first.effectPlain.toLowerCase()} be from ${t.rootName}?`} Evidence: ${pat ? pat.title + ` (${pat.evidence})` : 'graph-inferred'}, ${first.toName} started ${daysBetweenLabel(first.gap)} after ${t.rootName}. ` +
        `If reviewed, ${u.unnecessary.length ? u.unnecessary.map((x) => x.name).join(', ') + ' might not be needed' : 'no downstream drug changes'} (medicines ${u.pillsBefore} → ${u.pillsAfter}, anticholinergic burden ${u.acbBefore} → ${u.acbAfter}${u.combosResolved.length ? `, resolves ${u.combosResolved.join(', ')}` : ''}). ` +
        (options.length ? `Options to consider: ${options.slice(0, 3).join(', ')}, or a dose review.` : 'Consider a dose review.'),
    );
  }
  return lines.join('\n');
}

function sbar(a: Analysis): string {
  const t = a.trees[0];
  const p = a.patient;
  if (!t) {
    return `S: Medication review for ${p.name} (${p.age}).\nB: ${p.meds.length} medicines; ${p.conditions.map((c) => c.name.toLowerCase()).join(', ')}.\nA: No likely prescribing cascades found by Domino.${a.combos.length ? ` Combination to note: ${a.combos.map((c) => c.title).join(', ')}.` : ''}\nR: No cascade review needed at this time.`;
  }
  const first = t.chains[0].links[0];
  const pat = first.patterns[0];
  return [
    `S: Possible prescribing cascade for ${p.name} (${p.age}): ${t.chains[0].links.map((l) => l.headline).join('; ')}.`,
    `B: ${t.rootName} started ${dayToLabel(first.fromStart)}; ${first.toName} followed ${daysBetweenLabel(first.gap)} later${first.toIndication ? `, charted for ${EFFECT[first.toIndication]?.name.toLowerCase() ?? first.toIndication}` : ''}. ${p.meds.length} medicines in total; anticholinergic burden ${a.acb.total}.${p.headline?.match(NOT_CHECKED) ? ` ${p.headline.match(NOT_CHECKED)![0]}` : ''}`,
    `A: ${pat ? `Matches a documented cascade (${pat.title}).` : 'Graph-inferred link.'} If ${t.rootName} were reviewed, ${t.untangle.unnecessary.map((x) => x.name).join(', ') || 'no other drug'} might no longer be needed.${a.combos.length ? ` Also: ${a.combos.map((c) => `${c.title} (${c.drugs.join(' + ')})`).join('; ')}.` : ''}`,
    `R: ${pat ? pat.question : `Could ${first.effectPlain.toLowerCase()} be a side effect of ${t.rootName}?`} Please review at the next visit; if ${t.rootName} is changed, check whether ${first.effectPlain.toLowerCase()} settles at follow-up.${taperLine(t.untangle)}`,
  ].join('\n');
}

/** Deprescribing safety line for the SBAR: which medicines need a gradual taper if changed. */
function taperLine(u: Analysis['trees'][number]['untangle']): string {
  const names = [...(u.rootTaper ? [u.removedName] : []), ...u.unnecessary.filter((x) => x.taper).map((x) => x.name)];
  return names.length ? ` Safety: ${names.join(', ')} should be tapered, not stopped suddenly, if changed.` : '';
}

function patientNote(a: Analysis): string {
  const t = a.trees[0];
  const first = a.patient.name.split(' ')[0];
  if (!t)
    return `Dear ${first}, your care team reviewed your medicines and did not find any that seem to be treating the side effects of another. Please keep taking your medicines as prescribed, and bring any questions to your next appointment.`;
  return `Dear ${first}, your care team is reviewing your medicines. Sometimes a side effect of one medicine (like ${t.chains[0].links[0].effectPlain.toLowerCase()}) gets treated with another medicine. We want to check whether that may have happened with ${t.rootName}. Please do not stop or change any medicine on your own. Your pharmacist or doctor will talk with you about it, and bring this note to your next visit.`;
}

async function plannerScribe(ctx: ToolContext, a: Analysis) {
  for (const t of a.trees.slice(0, 3)) {
    const first = t.chains[0].links[0];
    const pat = first.patterns[0];
    await step(ctx, 'scribe', 'propose_task', {
      title: `Review ${t.rootName}: could it be causing ${first.effectPlain.toLowerCase()}?`.slice(0, 118),
      body: `${pat ? pat.question : `${first.toName} started ${daysBetweenLabel(first.gap)} after ${t.rootName}.`} Chain: ${t.chains.map((c) => c.drugs.length).reduce((m, n) => Math.max(m, n), 0)} drugs. If reviewed, ${t.untangle.unnecessary.map((u) => u.name).join(', ') || 'no other drug'} might not be needed (medicines ${t.untangle.pillsBefore} → ${t.untangle.pillsAfter}).`.slice(
        0,
        880,
      ),
      role: 'pharmacist',
      due_in_days: t.tier === 'likely' ? 7 : 21,
      link: first.key,
    });
  }
  for (const c of a.combos.slice(0, 2)) {
    await step(ctx, 'scribe', 'propose_task', {
      title: `Check ${c.title.toLowerCase()} risk: ${c.drugs.join(' + ')}`.slice(0, 118),
      body: `${c.why} ${c.id === 'triple_whammy' ? 'Consider checking kidney function and whether all three are still needed.' : 'Consider whether every drug in the combination is still needed.'}`,
      role: 'prescriber',
      due_in_days: 7,
    });
  }
  if (a.acb.total >= 3 && !a.trees.some((t) => t.untangle.acbAfter < t.untangle.acbBefore)) {
    await step(ctx, 'scribe', 'propose_task', {
      title: `Review anticholinergic burden (score ${a.acb.total})`,
      body: `Anticholinergic burden of 3 or more is linked to confusion and falls. Contributors: ${a.acb.drugs.map((d) => `${d.name} (${d.acb})`).join(', ')}.`,
      role: 'pharmacist',
      due_in_days: 21,
    });
  }
  if (a.trees.length || a.combos.length) {
    // Each kind of note once per run (the model may have drafted one before it failed).
    if (!ctx.artifacts.notes.some((n) => n.kind === 'prescriber')) await step(ctx, 'scribe', 'draft_note', { kind: 'prescriber', text: sbar(a) });
    if (!ctx.artifacts.notes.some((n) => n.kind === 'patient')) await step(ctx, 'scribe', 'draft_note', { kind: 'patient', text: patientNote(a) });
  }
}

async function diffSinceLastReview(patientId: string, runId: string, a: Analysis): Promise<{ text: string; previous: string } | null> {
  const rows = await run<{ run: string; at: number; findings: { key: string; tier: string; score: number; chain: string }[] }>(Q.previousRunFindings, {
    pid: patientId,
    run: runId,
  });
  const prev = rows[0];
  if (!prev?.run) return null;
  const before = new Map(prev.findings.filter((f) => f && f.key).map((f) => [f.key.split(':').slice(1).join(':'), f]));
  const now = new Map(a.links.filter((l) => l.tier === 'likely' || l.tier === 'possible').map((l) => [l.key, l]));
  const added = [...now.values()].filter((l) => !before.has(l.key));
  const gone = [...before.entries()].filter(([k]) => !now.has(k));
  const moved = [...now.values()].filter((l) => before.has(l.key) && before.get(l.key)!.tier !== l.tier);
  const when = new Date(prev.at).toISOString().slice(0, 10);
  if (!added.length && !gone.length && !moved.length) return { text: `Since the last review (${when}): no change in the cascade links.`, previous: prev.run };
  const parts: string[] = [];
  if (added.length) parts.push(`new: ${added.map((l) => `${l.fromName} → ${l.toName}`).join(', ')}`);
  if (gone.length) {
    const meds = new Set(a.patient.meds.map((m) => m.id));
    parts.push(
      `no longer flagged: ${gone
        .map(([k, f]) => {
          const [from, to] = k.split('>');
          const why =
            !meds.has(to) || !meds.has(from)
              ? 'a drug was stopped'
              : a.decisions.some((d) => d.from === from && d.to === to && d.verified)
                ? 'the care team decided'
                : 'rescored';
          return `${f.chain} (${why})`;
        })
        .join(', ')}`,
    );
  }
  if (moved.length) parts.push(`changed tier: ${moved.map((l) => `${l.fromName} → ${l.toName} ${before.get(l.key)!.tier} → ${l.tier}`).join(', ')}`);
  return { text: `Since the last review (${when}): ${parts.join('; ')}.`, previous: prev.run };
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────

/** One review per patient at a time, across every app instance: the lease lives in the graph. */
export async function runReview(opts: ReviewOptions): Promise<ReviewResult> {
  return withLease(`review:${opts.patientId}`, () => runReviewLocked(opts));
}

async function runReviewLocked(opts: ReviewOptions): Promise<ReviewResult> {
  const { patientId } = opts;
  const t0 = Date.now();
  const runId = `r-${randomUUID()}`;
  const { provider, label } = opts.provider
    ? { provider: opts.provider, label: `${opts.provider.id}:${opts.provider.model}` }
    : opts.mode === 'planner'
      ? { provider: null, label: 'Graph planner (no LLM)' }
      : getProvider();
  const mode: 'llm' | 'planner' = provider ? 'llm' : 'planner';

  // Persist every event as a Step, in order, without blocking the stream. A tool call and its result
  // become one Step, linked to the catalog queries it ran; what the tool writes is stamped with the
  // step index and linked back to it after the run (provenance).
  let stepIndex = 0;
  let persist = Promise.resolve();
  let ctxRef: ToolContext | null = null;
  const pending = new Map<string, { i: number; args: unknown }>();
  const save = (row: Record<string, unknown>) => {
    persist = persist
      .then(() => run(Q.addStep, { run: runId, args: null, ok: true, queries: [], tool: null, ms: 0, ...row, at: Date.now() }).then(() => undefined))
      .catch(() => undefined);
  };
  const emit = (e: AgentEvent) => {
    opts.emit?.(e);
    if (e.type === 'run' || e.type === 'done') return;
    if (e.type === 'tool') {
      const i = stepIndex++;
      pending.set(e.id, { i, args: e.args });
      if (ctxRef) ctxRef.step = i;
      return;
    }
    if (e.type === 'result') {
      const call = pending.get(e.id);
      pending.delete(e.id);
      save({
        i: call?.i ?? stepIndex++,
        agent: e.agent,
        kind: 'tool',
        tool: e.name,
        args: cleanText(JSON.stringify(call?.args ?? {}), 600),
        ok: e.ok,
        text: cleanText(e.summary, 1500),
        ms: e.ms,
        queries: [...new Set(e.queries.map((q) => q.id))],
      });
      return;
    }
    const agent = 'agent' in e ? e.agent : e.type === 'handoff' ? e.from : 'system';
    const text = 'text' in e ? String(e.text) : 'title' in e ? String(e.title) : 'label' in e ? String(e.label) : 'message' in e ? e.message : '';
    save({ i: stepIndex++, agent, kind: e.type, text: cleanText(text, 1500) });
  };
  const tracer: Tracer = () => {};
  const ctx = makeContext(runId, patientId, emit, tracer);
  ctxRef = ctx;
  if (!provider && opts.pace) PACE.set(ctx, Math.min(opts.pace, 1500));

  let changes: { text: string; previous: string } | null = null;
  try {
    const p = await run<{ name: string }>(Q.patient, { pid: patientId });
    if (!p.length) throw new Error(`No patient with id ${patientId}`);
    const patientName = String(p[0].name);
    await run(Q.createRun, { pid: patientId, id: runId, at: Date.now(), mode, model: label, trigger: opts.trigger ?? 'manual' });
    opts.emit?.({ type: 'run', runId, mode, model: label, patientId, trigger: opts.trigger ?? 'manual' });

    // 1. Detective
    emit({ type: 'agent', agent: 'detective', status: 'start' });
    let detText: string;
    let a: Analysis;
    if (modelLive(ctx, provider)) {
      detText = await modelOrPlanner(
        ctx,
        emit,
        'the Detective’s review',
        opts.signal,
        () =>
          llmAgent(
            provider,
            'detective',
            ctx,
            `Review the medications of the patient in this run (${patientName}). Find prescribing cascades, record the ones that matter, and write your handoff.`,
            opts.signal,
          ),
        async () => (await plannerDetective(ctx, patientName)).text,
      );
      a = ctx.cache.analysis ?? (await analyzePatient(patientId));
      ctx.cache.analysis = a;
      if (ctx.counters.findings === 0) {
        const keys = a.links.filter((l) => l.tier === 'likely' || l.tier === 'possible').map((l) => l.key);
        if (keys.length) {
          emit({ type: 'thought', agent: 'detective', text: 'Safety net: recording the likely and possible links the model did not record.' });
          await step(ctx, 'detective', 'record_findings', { links: keys.slice(0, 12) });
        }
      }
    } else {
      const r = await plannerDetective(ctx, patientName);
      detText = r.text;
      a = r.a;
    }
    for (const w of a.memoryWarnings) emit({ type: 'warning', text: w });
    // Keeping knowledge current: say what changed since the last review of this patient.
    changes = await diffSinceLastReview(patientId, runId, a);
    if (changes) emit({ type: 'thought', agent: 'detective', text: changes.text });
    emit({ type: 'agent', agent: 'detective', status: 'done', text: cleanText(detText, 1200) });

    const focus = a.trees.flatMap((t) => t.chains.map((c) => c.links[0].key)).slice(0, 6);
    let pharmText = '';
    if (a.trees.length) {
      const h1 = await handoff(ctx, runId, 'detective', 'pharmacist', detText, focus);
      const got1 = await receive(ctx, runId, h1, 'pharmacist');

      // 2. Pharmacist
      emit({ type: 'agent', agent: 'pharmacist', status: 'start' });
      pharmText = modelLive(ctx, provider)
        ? await modelOrPlanner(
            ctx,
            emit,
            'the Pharmacist’s check',
            opts.signal,
            () => llmAgent(provider, 'pharmacist', ctx, `Handoff from the Detective (signature verified):\n${asData('handoff', got1)}`, opts.signal),
            () => plannerPharmacist(ctx, a),
          )
        : await plannerPharmacist(ctx, a);
      emit({ type: 'agent', agent: 'pharmacist', status: 'done', text: cleanText(pharmText, 1500) });
    }

    if (a.trees.length || a.combos.length || a.acb.total >= 3) {
      const h2 = await handoff(ctx, runId, a.trees.length ? 'pharmacist' : 'detective', 'scribe', pharmText || detText, focus);
      const got2 = await receive(ctx, runId, h2, 'scribe');

      // 3. Scribe
      emit({ type: 'agent', agent: 'scribe', status: 'start' });
      let scribeText = '';
      if (modelLive(ctx, provider)) {
        scribeText = await modelOrPlanner(
          ctx,
          emit,
          'the Scribe’s tasks',
          opts.signal,
          () => llmAgent(provider, 'scribe', ctx, `Handoff (signature verified):\n${asData('handoff', got2)}`, opts.signal),
          async () => {
            await plannerScribe(ctx, a);
            return `Proposed ${ctx.counters.tasks} task(s) and drafted ${ctx.counters.notes} note(s) for human review.`;
          },
        );
        if (ctx.counters.tasks === 0 && !ctx.counters.alreadyOpen) {
          emit({ type: 'thought', agent: 'scribe', text: 'Safety net: the model proposed no tasks, so the planner proposes the standard review tasks.' });
          await plannerScribe(ctx, a);
        }
      } else {
        await plannerScribe(ctx, a);
        scribeText = `Proposed ${ctx.counters.tasks} task(s)${ctx.counters.alreadyOpen ? ` (${ctx.counters.alreadyOpen} already waiting in the inbox, not duplicated)` : ''} and drafted ${ctx.counters.notes} note(s) for human review.`;
      }
      emit({ type: 'agent', agent: 'scribe', status: 'done', text: cleanText(scribeText, 800) });
    }

    const t = a.trees[0];
    const summary = t
      ? `${a.summary.likely} likely cascade link(s). Root ${t.rootName}: if reviewed, ${t.untangle.unnecessary.length} downstream medicine(s) might not be needed.`
      : `No likely cascades.${a.combos.length ? ` ${a.combos.map((c) => c.title).join(', ')} flagged.` : ''}`;
    await persist;
    // Provenance: connect each tool-call step to what it wrote.
    await run(Q.linkProduced, { run: runId });
    if (changes) await run(Q.recordChanges, { run: runId, changes: changes.text, previous: changes.previous });
    // What actually did the work: the models that answered, and the planner if it took over.
    const worked = workedBy(ctx, provider, label);
    await run(Q.finishRun, {
      id: runId,
      mode: worked.mode,
      model: worked.model,
      summary,
      likely: a.summary.likely,
      possible: a.summary.possible,
      acb: a.acb.total,
      top: a.summary.topScore,
      topLink: a.summary.topLink,
      topLinkScore: a.summary.topLinkScore,
      at: Date.now(),
    });
    const result: ReviewResult = {
      runId,
      summary,
      findings: ctx.counters.findings,
      tasks: ctx.counters.tasks,
      notes: ctx.counters.notes,
      mode: worked.mode,
      model: worked.model,
      ms: Date.now() - t0,
    };
    opts.emit?.({ type: 'done', runId, summary, findings: result.findings, tasks: result.tasks, notes: result.notes, ms: result.ms });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The review failed.';
    opts.emit?.({ type: 'error', message: cleanText(message, 300) });
    await persist;
    throw err;
  }
}

// ─── Ask Domino (read-only, remembered per person) ─────────────────────────────

export interface AskOptions {
  /** Continue an earlier conversation (it must belong to the person in the session). */
  conversationId?: string | null;
}

/** Collects the tool calls behind an answer, so the answer can cite them. */
function sourceTap(emit: (e: AgentEvent) => void) {
  const sources: Source[] = [];
  const pending = new Map<string, Source>();
  const tap = (e: AgentEvent) => {
    if (e.type === 'tool') pending.set(e.id, { tool: e.name, queries: [], summary: '', via: e.via });
    if (e.type === 'result') {
      const s = pending.get(e.id);
      if (s) {
        s.queries = [...new Set(e.queries.map((q) => q.id))];
        s.summary = cleanText(e.summary.split('\n')[0], 220);
        if (e.ok) sources.push(s);
        pending.delete(e.id);
      }
    }
    emit(e);
  };
  return { tap, sources };
}

const toChat = (history: StoredMessage[]): ChatMessage[] => history.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.text }));

export async function askDomino(
  patientId: string,
  question: string,
  emit: (e: AgentEvent) => void,
  signal?: AbortSignal,
  injected?: Provider,
  opts: AskOptions = {},
): Promise<string> {
  const q = cleanText(question, 500);
  const user = await currentUser();
  const conv = await openConversation(patientId, user, opts.conversationId, q);
  emit({ type: 'conversation', id: conv.id, resumed: conv.resumed, turns: conv.history.length });
  const { tap, sources } = sourceTap(emit);
  const ctx = makeContext(null, patientId, tap, () => {});
  ctx.role = 'domino';
  const { provider, label } = injected ? { provider: injected, label: `${injected.id}:${injected.model}` } : getProvider();
  emit({ type: 'run', runId: null, mode: provider ? 'llm' : 'planner', model: `${label} · tools via MCP`, patientId, trigger: 'ask' });
  MCP_CTX.add(ctx);
  let answer: string;
  if (modelLive(ctx, provider)) {
    const tools = await mcpTools();
    answer = await modelOrPlanner(
      ctx,
      tap,
      'this answer',
      signal,
      () =>
        llmAgent(
          provider,
          'domino',
          ctx,
          `Clinician question about the patient in this session:\n${q}`,
          signal,
          6,
          { tools, invoke: (name, args) => mcpCall(patientId, name, args), via: 'mcp' },
          toChat(conv.history),
          AGENT_BUDGET_MS.ask,
        ),
      () => plannerAnswer(ctx, q, conv.history),
    );
  } else {
    answer = await plannerAnswer(ctx, q, conv.history);
  }
  answer = cleanText(answer, 2500);
  if (!checkClinicalWording(answer).ok) {
    // A model answer that tells someone to change a medicine is not shown or stored: the graph planner answers instead.
    tap({ type: 'warning', text: 'The model’s answer told someone to change a medicine, which Domino never does. This is the graph planner’s answer instead.' });
    answer = cleanText(await plannerAnswer(ctx, q, conv.history), 2500);
  }
  // Whoever wrote the answer, a medicine the question names that the graph does not know is said out loud.
  const who = await loadPatient(patientId, ctx.tracer).catch(() => null);
  answer = cleanText(withUnknownNamed(answer, await unknownMedicines(q, { tracer: ctx.tracer, names: who ? [who.name, ...who.meds.map((m) => m.prescriber)] : [] })), 2600);
  emit({ type: 'answer', text: answer, sources, conversationId: conv.id });
  await remember(conv.id, user.id, conv.history.length, q, answer, sources, workedBy(ctx, provider, label).model);
  return answer;
}

/** Finds the medicine a follow-up question refers to ("what could replace it?") in earlier turns. */
function fromHistory<M extends { id: string; name: string }>(history: StoredMessage[], meds: M[]): M | undefined {
  for (const m of [...history].reverse().sort((a, b) => Number(b.role === 'user') - Number(a.role === 'user'))) {
    const t = m.text.toLowerCase();
    const hit = meds.find((x) => t.includes(x.name.toLowerCase().split(/[\s-]/)[0]));
    if (hit) return hit;
  }
  return undefined;
}

// Words that may name a medicine, for questions about one Domino does not know. Three kinds of word qualify: one shaped
// like a generic name (a common ending such as -pril or -statin), a capitalised word inside a sentence (a brand:
// "Is Entresto safe with her amlodipine?"), and a word after "taking", "started", "add" and the like. Each is then
// looked up in the graph's full-text indexes: a known drug, a symptom or a person's name is not an unknown medicine.
const DRUG_SUFFIX =
  /^[a-z]{3,}(?:pril|sartan|olol|dipine|statin|prazole|tidine|azepam|zolam|oxetine|triptyline|pramine|floxacin|mycin|cillin|cycline|conazole|setron|gliptin|gliflozin|glutide|parin|xaban|gatran|semide|thiazide|profen|coxib|codone|morphone|zosin|terol|sonide|lukast|dronate|tinib|mab|vir|caine|barbital|adone|yzine|ridone|apine|azine)$/;
const NOT_DRUGS = new Set(['medicine', 'routine', 'online', 'machine', 'engine', 'vaccine', 'magazine', 'cuisine']);
const MED_CUE = /\b(?:take|takes|taking|took|start|starts|started|starting|add|adds|added|adding|prescribe|prescribed|prescribing|try|tries|trying|tried)\s+([a-z][a-z-]{4,})\b/gi;
const NOT_NAMES = new Set(
  (
    'domino falkordb riverside lakeview doctor nurse pharmacist prescriber clinic hospital monday tuesday wednesday thursday friday saturday sunday ' +
    'january february march april june july august september october november december parkinson parkinsons alzheimer alzheimers beers ' +
    'thinkcascades medicare medicaid english could would should what which when where does will have please thanks also okay ' +
    'medicine medication medications pills tablets something anything another them those these their there dose doses more less'
  ).split(' '),
);

/** Words in the question that may name a medicine and that the graph does not know. */
async function unknownMedicines(q: string, opts: { tracer?: Tracer; names?: string[] } = {}): Promise<string[]> {
  // People are not medicines: the care team, every prescriber and every patient in this clinic's graph.
  const people = /[A-Z][a-z]/.test(q.replace(/^\s*\S+/, ''))
    ? (await run<{ name: string }>(Q.patientNames, {}, opts.tracer).catch(() => [])).map((r) => r.name)
    : [];
  const names = new Set(
    [...(opts.names ?? []), ...people, ...USERS.map((u) => u.name), ...Object.values(PRESCRIBERS)]
      .flatMap((n) => n.toLowerCase().split(/[^a-z]+/))
      .filter((w) => w.length >= 3),
  );
  const cands = new Map<string, string>();
  const add = (w: string) => {
    const k = w.toLowerCase();
    if (k.length >= 4 && !NOT_DRUGS.has(k) && !NOT_NAMES.has(k) && !names.has(k) && !cands.has(k)) cands.set(k, w);
  };
  for (const w of q.match(/[A-Za-z][A-Za-z-]+/g) ?? []) if (w.length >= 6 && DRUG_SUFFIX.test(w.toLowerCase())) add(w.toLowerCase());
  // Capitalised inside a sentence, not an acronym, not after a title (Dr Patel).
  for (const m of q.matchAll(/(?<![.!?]\s*|^\s*|\b(?:Dr|Dr\.|Doctor|Nurse|Mr|Mrs|Ms|Miss)\s+)\b([A-Z][a-z][A-Za-z-]{2,})\b/g)) add(m[1]);
  for (const m of q.matchAll(MED_CUE)) add(m[1]);
  const out: string[] = [];
  for (const [k, w] of [...cands].slice(0, 4)) {
    if ((await matchMedications([w], opts.tracer)).length) continue;
    // A symptom or diagnosis the graph knows ("Parkinsonism", "dizziness") is not a medicine.
    const effects = await run<{ name: string; plain: string | null }>(Q.findEffects, { q: toQuery(nameWords(w)) }, opts.tracer).catch(() => []);
    if (effects.some((e) => `${e.name} ${e.plain ?? ''}`.toLowerCase().includes(k))) continue;
    out.push(w);
  }
  return out;
}

/** Prefix an answer with the medicines it names that the graph does not know, unless the answer already says so. */
function withUnknownNamed(body: string, unknown: string[]): string {
  const missed = unknown.filter((w) => !body.toLowerCase().includes(w.toLowerCase()));
  return missed.length
    ? `“${missed.join('”, “')}” ${missed.length === 1 ? 'is not a medicine' : 'are not medicines'} in Domino’s knowledge graph, so ${missed.length === 1 ? 'it was' : 'they were'} not checked (not in the graph is not the same as safe). ${body}`
    : body;
}

/** The planner's answer. A medicine the question names that the graph does not know is said out loud, never skipped. */
async function plannerAnswer(ctx: ToolContext, q: string, history: StoredMessage[] = []): Promise<string> {
  const p = (ctx.cache.analysis ?? (await analyzePatient(ctx.patientId))).patient;
  const unknown = await unknownMedicines(q, { tracer: ctx.tracer, names: [p.name, ...p.meds.map((m) => m.prescriber)] });
  return withUnknownNamed(await plannerAnswerFor(ctx, q, history, unknown), unknown);
}

async function plannerAnswerFor(ctx: ToolContext, q: string, history: StoredMessage[], unknown: string[]): Promise<string> {
  const s = q.toLowerCase();
  const a = await analyzePatient(ctx.patientId);
  ctx.cache.analysis = a;
  let mentioned = a.patient.meds.find((m) => s.includes(m.name.toLowerCase().split(/[\s-]/)[0]) || s.includes(m.id));
  let remembered = '';
  if (!mentioned && history.length && /\b(it|that|this|them|those|its|the drug|the medicine|the pill|same)\b/.test(s)) {
    mentioned = fromHistory(history, a.patient.meds);
    if (mentioned) remembered = ` (Following up on ${mentioned.name} from earlier in this conversation.)`;
  }
  if (!mentioned) {
    // A medicine named by brand or alias is matched through the graph's full-text index; one that is not on her
    // list (or not in the graph at all) is resolved against the graph, never guessed at.
    const named = await matchMedications([q], ctx.tracer);
    const onList = named.map((n) => a.patient.meds.find((m) => m.id === n.id)).find((m) => !!m);
    if (onList) mentioned = onList;
    else if (named.length || unknown.length) return (await step(ctx, 'domino', 'resolve_drug', { name: named[0]?.name ?? unknown[0] })).summary;
  }
  if (/\b(fall|falls|dizz|fracture)\b/.test(s)) {
    await step(ctx, 'domino', 'check_harms');
    const falls = a.harms.find((h) => h.harm === 'falls');
    return falls
      ? `${falls.drugs.length} of ${a.patient.name}'s medicines lead toward falls in the graph: ${falls.drugs.map((d) => `${d.name} (via ${d.via.join(', ').toLowerCase()})`).join('; ')}.`
      : 'None of the current medicines lead toward falls in the graph.';
  }
  if (/\b(anticholinergic|acb|confus|memory|beers)\b/.test(s)) {
    await step(ctx, 'domino', 'check_harms');
    return `Anticholinergic burden is ${a.acb.total}${a.acb.total >= 3 ? ', which is high' : ''}: ${a.acb.drugs.map((d) => `${d.name} ${d.acb}`).join(', ') || 'no contributors'}. Beers 2023 flags: ${a.beers.map((b) => b.name).join(', ') || 'none'}.`;
  }
  if (/\b(team|decided|decision|said|note|history|before|last time|earlier)\b/.test(s) && !mentioned) {
    const r = await step(ctx, 'domino', 'recall_memory');
    return r.summary.split('\n').slice(0, 6).join(' ');
  }
  if (mentioned && /\b(instead|alternative|alternatives|switch|replace|other option|options)\b/.test(s)) {
    // For a downstream drug, the better question is about the drug whose side effect it treats.
    const into = a.links.find((l) => l.to === mentioned!.id && (l.tier === 'likely' || l.tier === 'possible'));
    const out = a.links.find((l) => l.from === mentioned!.id && (l.tier === 'likely' || l.tier === 'possible'));
    const link = into ?? out;
    if (link) {
      const r = await step(ctx, 'domino', 'find_safer_alternatives', { drug: link.from, effect: link.effect });
      const lead =
        link === into
          ? `${mentioned.name} may be treating ${into.effectPlain.toLowerCase()} from ${into.fromName}, so the options that matter are for ${into.fromName}. `
          : '';
      return `${lead}${r.summary}${remembered}`;
    }
  }
  if (mentioned) {
    await step(ctx, 'domino', 'find_cascades');
    const into = a.links.filter((l) => l.to === mentioned!.id && l.tier !== 'excluded');
    const out = a.links.filter((l) => l.from === mentioned!.id && (l.tier === 'likely' || l.tier === 'possible'));
    const parts = [];
    if (into.length)
      parts.push(
        `${mentioned.name} may be treating ${into.map((l) => `${l.effectPlain.toLowerCase()} from ${l.fromName} (${l.tier}, ${l.score.toFixed(2)})`).join('; ')}.`,
      );
    if (out.length) parts.push(`${mentioned.name} may have led to ${out.map((l) => `${l.toName} via ${l.effectPlain.toLowerCase()} (${l.tier})`).join('; ')}.`);
    if (mentioned.indication)
      parts.push(
        `It is charted for ${EFFECT[mentioned.indication]?.name.toLowerCase() ?? mentioned.indication}, started ${dayToLabel(mentioned.start)} by ${mentioned.prescriber}.`,
      );
    return (parts.join(' ') || `${mentioned.name} is not part of any cascade link for this patient.`) + remembered;
  }
  await step(ctx, 'domino', 'find_cascades');
  const t = a.trees[0];
  return t
    ? `The strongest cascade starts with ${t.rootName}: ${t.chains[0].links.map((l) => l.headline).join(', then ')}. If ${t.rootName} were reviewed, ${t.untangle.unnecessary.map((u) => u.name).join(', ') || 'no other medicine'} might not be needed. (Planner mode: add an LLM key for free-form answers.)`
    : `No likely cascades for ${a.patient.name}. (Planner mode: add an LLM key for free-form answers.)`;
}

// ─── The care-team brain (clinic-wide, read-only) ──────────────────────────────

export async function askTeam(
  question: string,
  emit: (e: AgentEvent) => void,
  signal?: AbortSignal,
  injected?: Provider,
  opts: AskOptions = {},
): Promise<string> {
  const q = cleanText(question, 500);
  const [user, clinic] = await Promise.all([currentUser(), currentClinic()]);
  const conv = await openConversation(clinic.id, user, opts.conversationId, q);
  emit({ type: 'conversation', id: conv.id, resumed: conv.resumed, turns: conv.history.length });
  const { tap, sources } = sourceTap(emit);
  const ctx = makeContext(null, clinic.id, tap, () => {});
  ctx.role = 'brain';
  const { provider, label } = injected ? { provider: injected, label: `${injected.id}:${injected.model}` } : getProvider();
  emit({ type: 'run', runId: null, mode: provider ? 'llm' : 'planner', model: `${label} · tools via MCP`, patientId: clinic.id, trigger: 'ask' });
  MCP_TEAM.add(ctx);
  let answer: string;
  // New notes and decisions become findable by meaning before the brain searches (bounded; never fatal).
  await ensureEmbeddings({ limit: 64, graphKey: await graphName() }).catch(() => undefined);
  if (modelLive(ctx, provider)) {
    const tools = await mcpTeamTools();
    answer = await modelOrPlanner(
      ctx,
      tap,
      'this answer',
      signal,
      () =>
        llmAgent(
          provider,
          'brain',
          ctx,
          `Question from ${user.name} (${user.title}) at ${clinic.name}:\n${q}`,
          signal,
          6,
          { tools, invoke: (name, args) => mcpTeamCall(name, args), via: 'mcp' },
          toChat(conv.history),
          AGENT_BUDGET_MS.ask,
        ),
      () => plannerTeamAnswer(ctx, q, conv.history),
    );
  } else {
    answer = await plannerTeamAnswer(ctx, q, conv.history);
  }
  answer = cleanText(answer, 2500);
  if (!checkClinicalWording(answer).ok) {
    tap({ type: 'warning', text: 'The model’s answer told someone to change a medicine, which Domino never does. This is the graph planner’s answer instead.' });
    answer = cleanText(await plannerTeamAnswer(ctx, q, conv.history), 2500);
  }
  emit({ type: 'answer', text: answer, sources, conversationId: conv.id });
  await remember(conv.id, user.id, conv.history.length, q, answer, sources, workedBy(ctx, provider, label).model);
  return answer;
}

function patternIn(text: string): string | null {
  const s = text.toLowerCase();
  const words = (t: string) =>
    t
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4);
  let best: { id: string; n: number } | null = null;
  for (const p of PATTERNS) {
    const n = words(`${p.title} ${p.id.replace(/_/g, ' ')}`).filter((w) => s.includes(w)).length;
    if (n > 0 && (!best || n > best.n)) best = { id: p.id, n };
  }
  return best?.id ?? null;
}

async function plannerTeamAnswer(ctx: ToolContext, q: string, history: StoredMessage[]): Promise<string> {
  const s = q.toLowerCase();
  const follow =
    !patternIn(q) && history.length
      ? patternIn(
          history
            .filter((m) => m.role === 'user')
            .map((m) => m.text)
            .join(' '),
        )
      : null;
  if (/\b(who|whom)\b.*\b(know|knows|handled|handle|expert|ask|decided|talk)\b|\bwho knows\b/.test(s)) {
    const pattern = patternIn(q) ?? follow;
    const r = await step(ctx, 'brain', 'who_knows', pattern ? { pattern } : {});
    const title = pattern ? PATTERNS.find((p) => p.id === pattern)?.title : null;
    const lines = r.summary.split('\n').map((l) => (title ? l.replace(`${title} `, '').replace(/: \((\d+)\)$/, ': $1 decision(s)') : l));
    return `${title ? `People in this clinic who have decided on “${title}” before:` : 'Who has decided on which kinds of cascade:'}\n${lines.join('\n')}${follow && !patternIn(q) ? '\n(Following up on the cascade from earlier in this conversation.)' : ''}`;
  }
  if (/\b(prescriber|prescribers|walk-in|walk in|handoff|handoffs|cross|specialist|who prescribed|fragment)/.test(s)) {
    const r = await step(ctx, 'brain', 'care_team_flows');
    return r.summary.split('\n').slice(0, 6).join(' ');
  }
  if (/\b(learn|learned|learnt|procedure|procedures|route|routing|playbook|why .* go to)\b/.test(s)) {
    const r = await step(ctx, 'brain', 'learned_procedures');
    return `What the agents learned from this clinic's decisions:\n${r.summary}`;
  }
  const r = await step(ctx, 'brain', 'search_team_memory', { query: q.slice(0, 200) });
  return r.summary.startsWith('Nothing')
    ? `${r.summary} (Planner mode searches the team's memory by keyword; add an LLM key for free-form answers.)`
    : `Here is what the team has on record:\n${r.summary}`;
}

export { TODAY_DAY };
