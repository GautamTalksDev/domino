// Gemini, end to end, against a local stand-in that follows the documented REST shapes (generateContent with function
// calls and thought signatures, batchEmbedContents). Nothing leaves the machine; the real key is the only difference.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dbAvailable } from './setup-db';
import { adminQuery, closeDb } from '../src/lib/db';
import { runReview, askTeam } from '../src/lib/agent/runner';
import { clearGeminiCooldown, getProvider, geminiGenerationConfig, modelPause, pauseModel } from '../src/lib/agent/providers';
import { saveDoc } from '../src/lib/docs';
import { searchMemoryDetailed } from '../src/lib/careteam';
import { EMBED_DIM } from '../src/lib/embeddings';
import { ensureEmbeddings } from '../src/lib/semantic';
import type { AgentEvent } from '../src/lib/agent/events';

type Seen = { url: string; body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> };
type Handler = (body: Record<string, unknown>, url: string) => unknown;

function serve(handler: Handler): Promise<{ server: Server; base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const body = JSON.parse(data || '{}');
      seen.push({ url: req.url ?? '', body, headers: req.headers });
      Promise.resolve(handler(body, req.url ?? '') as { __status?: number }).then((out) => {
        if (res.writableEnded || res.destroyed) return;
        res.setHeader('content-type', 'application/json');
        if (out?.__status) res.statusCode = out.__status;
        res.end(JSON.stringify(out));
      });
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta`, seen })));
}

// A stand-in embedding model: words that mean the same thing share a dimension (as a real model's space would put them
// close), every other word gets a hashed dimension. Enough to tell a meaning match from a word match.
const CONCEPTS: string[][] = [
  ['swelling', 'swollen', 'edema', 'oedema', 'retention', 'puffy', 'fluid', 'ankles', 'ankle'],
  ['amlodipine', 'norvasc', 'pressure', 'antihypertensive', 'channel', 'blocker'],
  ['cough', 'coughing', 'tickle', 'tickly'],
  ['dizzy', 'dizziness', 'lightheaded', 'vertigo', 'unsteady'],
];
function vector(text: string): number[] {
  const v = new Array(EMBED_DIM).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    const c = CONCEPTS.findIndex((group) => group.includes(w));
    if (c >= 0) v[c] += 3;
    else {
      let h = 7;
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 9973;
      v[16 + (h % (EMBED_DIM - 16))] += 1;
    }
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
const embedReply = (body: Record<string, unknown>) => ({
  embeddings: (body.requests as { content: { parts: { text: string }[] } }[]).map((r) => ({
    // Strip the retrieval prefixes before "understanding" the text.
    values: vector(r.content.parts[0].text.replace(/^(task: search result \| query: |title: [^|]* \| text: )/, '')),
  })),
});

const systemOf = (b: Record<string, unknown>) => (b.systemInstruction as { parts: { text: string }[] } | undefined)?.parts?.[0]?.text ?? '';
const PLAN: Record<string, { name: string; args: Record<string, unknown> }> = {
  detective: { name: 'find_cascades', args: {} },
  pharmacist: { name: 'simulate_untangle', args: { drug: 'lorazepam' } },
  scribe: {
    name: 'propose_task',
    args: { title: 'Could the agitation be from lorazepam?', body: 'Risperidone started weeks after lorazepam. Review the chain.', role: 'pharmacist', due_in_days: 7 },
  },
};
const roleOf = (sys: string) =>
  sys.includes('You are the Detective') ? 'detective' : sys.includes('Pharmacist agent') ? 'pharmacist' : sys.includes('You are the Scribe') ? 'scribe' : 'other';

/** A model that calls one tool per agent, then answers; it echoes a thought signature the next turn must replay. */
function modelReply(body: Record<string, unknown>) {
  const contents = body.contents as { role: string; parts: Record<string, unknown>[] }[];
  const r = roleOf(systemOf(body));
  const answered = contents.some((c) => c.parts.some((p) => p.functionResponse));
  if (!answered && PLAN[r]) return { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: PLAN[r].name, args: PLAN[r].args }, thoughtSignature: `sig-${r}` }] } }] };
  return { candidates: [{ content: { role: 'model', parts: [{ text: `${r} finished.` }] } }] };
}

const env = { ...process.env };
const resetGlobals = () => {
  pauseModel('', 0);
  clearGeminiCooldown();
  (globalThis as { __domino_embed_fallback?: number; __domino_embed_pause?: number }).__domino_embed_fallback = 0;
  (globalThis as { __domino_embed_pause?: number }).__domino_embed_pause = 0;
};
beforeEach(resetGlobals);
afterEach(() => {
  process.env = { ...env };
  resetGlobals();
});
afterAll(async () => closeDb());

describe('Gemini settings for current models', () => {
  it('uses Gemini 3.8 Flash by default, with a low thinking level and no sampling parameters', () => {
    process.env = { ...env, GEMINI_API_KEY: 'k', LLM_PROVIDER: 'gemini', LLM_MODEL: '' };
    expect(getProvider().label).toBe('gemini:gemini-3.8-flash');
    expect(geminiGenerationConfig('gemini-3.8-flash')).toEqual({ maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' } });
    expect(geminiGenerationConfig('gemini-2.5-flash')).toMatchObject({ temperature: 0.2 });
    process.env.GEMINI_THINKING = 'high';
    expect(geminiGenerationConfig('gemini-3.6-flash')).toMatchObject({ thinkingConfig: { thinkingLevel: 'high' } });
  });
});

describe.runIf(await dbAvailable())('Gemini end to end (local stand-in)', () => {
  beforeEach(async () => {
    await adminQuery(`MATCH (t:Task)-[:FOR]->(:Patient {id: 'p-rosa'}) DETACH DELETE t`);
  });

  it('runs a review: falls past a model this key cannot use, sends current settings, replays thought signatures', async () => {
    const { server, base, seen } = await serve((b, url) => {
      if (url.includes('gemini-3.8-flash')) return { __status: 403, error: { message: 'Permission denied for this model' } };
      return modelReply(b);
    });
    process.env = { ...env, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_MODEL: '' };
    try {
      const events: AgentEvent[] = [];
      const res = await runReview({ patientId: 'p-rosa', emit: (e) => events.push(e) });
      expect(res.mode).toBe('llm');
      expect(res.tasks).toBe(1);
      expect(events.some((e) => e.type === 'warning')).toBe(false);
      const calls = seen.filter((s) => s.url.includes(':generateContent'));
      expect(calls[0].url).toBe('/v1beta/models/gemini-3.8-flash:generateContent');
      const ok = calls.find((s) => s.url.includes('gemini-3.6-flash'))!;
      expect(ok.headers['x-goog-api-key']).toBe('test-key');
      expect(ok.body.generationConfig).toEqual({ maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' } });
      const decls = (ok.body.tools as { functionDeclarations: { parameters?: { type: string } }[] }[])[0].functionDeclarations;
      expect(decls.filter((d) => d.parameters).every((d) => d.parameters!.type === 'OBJECT')).toBe(true);
      // After the first 403, the model is skipped rather than asked again on every turn.
      expect(calls.filter((s) => s.url.includes('gemini-3.8-flash'))).toHaveLength(1);
      const replay = calls.find((s) => JSON.stringify(s.body).includes('functionResponse'))!;
      expect(JSON.stringify(replay.body.contents)).toMatch(/sig-(detective|pharmacist|scribe)/);
    } finally {
      server.close();
    }
  });

  it('finishes the review with the graph planner when every model is over quota, and says so', async () => {
    const { server, base, seen } = await serve(() => ({ __status: 429, error: { message: 'Resource has been exhausted (e.g. check quota).' } }));
    process.env = { ...env, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_MODEL: '' };
    try {
      const events: AgentEvent[] = [];
      const res = await runReview({ patientId: 'p-rosa', emit: (e) => events.push(e) });
      expect(res.tasks).toBeGreaterThan(0);
      expect(res.findings).toBeGreaterThan(0);
      const warning = events.find((e): e is Extract<AgentEvent, { type: 'warning' }> => e.type === 'warning');
      expect(warning?.text).toMatch(/over its quota.*graph planner/);
      // One failed call (each model once), then the planner does the rest of the run: no more calls to a failing model.
      expect(seen.filter((x) => x.url.includes(':generateContent'))).toHaveLength(4);
      // The run says what did the work.
      expect(res.mode).toBe('planner');
      const r = (await adminQuery(`MATCH (r:Run {id: $id}) RETURN r.mode AS mode, r.model AS model`, { id: res.runId })) as { data?: { mode: string; model: string }[] };
      expect(r.data?.[0]).toMatchObject({ mode: 'planner' });
      expect(r.data?.[0].model).toMatch(/Graph planner/);
      // For the next minute, Domino doesn't wait on a model that is failing.
      expect(modelPause()).not.toBeNull();
      expect(getProvider().label).toMatch(/Graph planner/);
    } finally {
      server.close();
    }
  });

  it('answers a care-team question through the model, citing the tools it used over MCP', async () => {
    const { server, base } = await serve((b) => {
      const contents = b.contents as { role: string; parts: Record<string, unknown>[] }[];
      const answered = contents.some((c) => c.parts.some((p) => p.functionResponse));
      if (!answered) return { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'learned_procedures', args: {} } }] } }] };
      return { candidates: [{ content: { role: 'model', parts: [{ text: 'Swelling tasks go to prescribers here, per the learned procedure.' }] } }] };
    });
    process.env = { ...env, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_MODEL: '', DOMINO_EMBEDDINGS: 'off' };
    try {
      const events: AgentEvent[] = [];
      const answer = await askTeam('Who handles swelling tasks?', (e) => events.push(e));
      expect(answer).toMatch(/learned procedure/);
      const a = events.find((e): e is Extract<AgentEvent, { type: 'answer' }> => e.type === 'answer');
      expect(a?.sources?.map((s) => s.tool)).toContain('learned_procedures');
    } finally {
      server.close();
    }
  });

  it('searches the team’s memory by meaning: a handover with none of the question’s words', async () => {
    const { server, base, seen } = await serve((b, url) => (url.includes(':batchEmbedContents') ? embedReply(b) : modelReply(b)));
    process.env = { ...env, GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_PROVIDER: 'planner' };
    const doc = await saveDoc({ kind: 'handover', title: 'Legs puffy', text: 'Her legs look puffy since the Norvasc dose went up; shoes no longer fit.' });
    try {
      // Even with a backlog from other tests, the newest note is embedded first.
      const res = await searchMemoryDetailed('water retention from blood pressure pills');
      expect(res.mode).toBe('hybrid');
      const hit = res.hits.find((h) => h.id === doc.id);
      expect(hit?.match).toBe('meaning');
      // Documents and the query are shaped the way Google documents retrieval for gemini-embedding-2.
      const calls = seen.filter((s) => s.url.includes(':batchEmbedContents'));
      expect(calls[0].url).toBe('/v1beta/models/gemini-embedding-2:batchEmbedContents');
      const reqs = calls.flatMap((c) => c.body.requests as { content: { parts: { text: string }[] }; outputDimensionality: number }[]);
      expect(reqs.every((r) => r.outputDimensionality === 768)).toBe(true);
      expect(reqs.some((r) => r.content.parts[0].text.startsWith('title: Legs puffy | text: '))).toBe(true);
      expect(reqs.some((r) => r.content.parts[0].text === 'task: search result | query: water retention from blood pressure pills')).toBe(true);
      // The vector lives on the note itself, under the Memory label, with the model that made it.
      const n = (await adminQuery(`MATCH (d:Doc:Memory {id: $id}) RETURN d.embedModel AS m`, { id: doc.id })) as { data?: { m: string }[] };
      expect(n.data?.[0]?.m).toBe('gemini-embedding-2');
      // Once the backlog is embedded, a search embeds nothing but the question.
      while ((await ensureEmbeddings({ limit: 100 })).more);
      const before = seen.length;
      await searchMemoryDetailed('water retention from blood pressure pills');
      const again = seen.slice(before).flatMap((c) => (c.body.requests as unknown[]) ?? []);
      expect(again).toHaveLength(1);
    } finally {
      server.close();
      await adminQuery(`MATCH (d:Doc {id: $id}) DETACH DELETE d`, { id: doc.id });
    }
  });

  it('falls back to gemini-embedding-001 for a key that cannot use the newer model, and re-embeds rather than mixing models', async () => {
    const { server, base, seen } = await serve((b, url) => {
      if (url.includes('gemini-embedding-2')) return { __status: 404, error: { message: 'models/gemini-embedding-2 is not found' } };
      // The older model returns unnormalised vectors; Domino must normalise them.
      const r = embedReply(b);
      return { embeddings: r.embeddings.map((e) => ({ values: e.values.map((x) => x * 3) })) };
    });
    process.env = { ...env, GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_PROVIDER: 'planner' };
    const doc = await saveDoc({ kind: 'chat', title: 'Dizzy', text: 'Walter Brooks lightheaded on standing.' });
    try {
      const res = await searchMemoryDetailed('vertigo when he gets up');
      expect(res.mode).toBe('hybrid');
      const old = seen.filter((s) => s.url.includes('gemini-embedding-001'));
      expect(old.length).toBeGreaterThan(0);
      const req = (old[0].body.requests as { taskType: string }[])[0];
      expect(['RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY']).toContain(req.taskType);
      const stored = (await adminQuery(`MATCH (d:Doc {id: $id}) RETURN d.embedModel AS m`, { id: doc.id })) as { data?: { m: string }[] };
      expect(stored.data?.[0]?.m).toBe('gemini-embedding-001');
      expect(res.hits.find((h) => h.id === doc.id)).toBeTruthy();
    } finally {
      server.close();
      await adminQuery(`MATCH (d:Doc {id: $id}) DETACH DELETE d`, { id: doc.id });
    }
  });

  it('searches by words when the embedding model is over quota, and says why', async () => {
    const { server, base } = await serve(() => ({ __status: 429, error: { message: 'quota' } }));
    process.env = { ...env, GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_PROVIDER: 'planner', EMBEDDING_MODEL: 'gemini-embedding-2' };
    try {
      const res = await searchMemoryDetailed('swelling amlodipine');
      expect(res.mode).toBe('words');
      expect(res.note).toMatch(/quota/);
      expect(res.hits.length).toBeGreaterThan(0);
      expect(res.hits.every((h) => h.match === 'words')).toBe(true);
    } finally {
      server.close();
    }
  });

  it('records each finding once when the model fails halfway and the planner takes over', async () => {
    let n = 0;
    const { server, base } = await serve((b) => {
      n++;
      // The model records Rosa's links first, then the provider goes over quota for good.
      if (n === 1) return { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'record_findings', args: { links: ['lorazepam>risperidone'] } } }] } }] };
      void b;
      return { __status: 429, error: { message: 'quota' } };
    });
    process.env = { ...env, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_MODEL: '' };
    try {
      const res = await runReview({ patientId: 'p-rosa' });
      const rows = (await adminQuery(`MATCH (f:Finding)-[:FOR]->(:Patient {id: 'p-rosa'}) WHERE f.status = 'open' RETURN f.key AS k`)) as { data?: { k: string }[] };
      const keys = rows.data?.map((r) => r.k) ?? [];
      expect(new Set(keys).size).toBe(keys.length);
      expect(res.findings).toBe(keys.length);
      expect(res.model).toMatch(/\+ graph planner/);
    } finally {
      server.close();
    }
  });

  it('stops when the person cancels: no fallback model, no tools run, no pause for everyone', async () => {
    const { server, base, seen } = await serve(
      (b) => new Promise((resolve) => setTimeout(() => resolve(modelReply(b)), 400)) as unknown as Record<string, unknown>,
    );
    process.env = { ...env, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_MODEL: '' };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    try {
      const events: AgentEvent[] = [];
      await expect(runReview({ patientId: 'p-rosa', emit: (e) => events.push(e), signal: ac.signal })).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 500));
      expect(seen.filter((x) => x.url.includes(':generateContent'))).toHaveLength(1);
      expect(events.some((e) => e.type === 'tool')).toBe(false);
      expect(modelPause()).toBeNull();
    } finally {
      server.close();
    }
  });

  it('keeps someone else’s conversations out of the meaning search, without crowding out the asker’s own results', async () => {
    const { server, base } = await serve((b, url) => (url.includes(':batchEmbedContents') ? embedReply(b) : modelReply(b)));
    process.env = { ...env, GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_PROVIDER: 'planner' };
    // Thirty messages from another person, all about swelling, plus one team note of ours.
    await adminQuery(
      `MATCH (c:Clinic) WITH c LIMIT 1
       CREATE (cv:Conversation {id: 'cv-crowd', user: 'someone-else', userName: 'Someone', title: 'Swelling'})-[:ABOUT]->(c)
       WITH cv UNWIND range(1, 30) AS i
       CREATE (cv)-[:HAS]->(:Message {id: 'm-crowd-' + toString(i), role: 'user', text: 'ankle swelling edema puffy legs ' + toString(i), at: i})`,
    );
    const doc = await saveDoc({ kind: 'handover', title: 'Puffy ankles', text: 'Ankles puffy, fluid in the legs.' });
    try {
      while ((await ensureEmbeddings({ limit: 100 })).more);
      const res = await searchMemoryDetailed('swelling');
      expect(res.hits.some((h) => h.kind === 'message' && h.by === 'Someone')).toBe(false);
      expect(res.hits.find((h) => h.id === doc.id)?.match).toMatch(/meaning|both/);
    } finally {
      server.close();
      await adminQuery(`MATCH (cv:Conversation {id: 'cv-crowd'}) OPTIONAL MATCH (cv)-[:HAS]->(m) DETACH DELETE m, cv`);
      await adminQuery(`MATCH (d:Doc {id: $id}) DETACH DELETE d`, { id: doc.id });
    }
  });

  it('never sends a check-up conversation for embedding, and re-embeds a task when its decision note changes', async () => {
    const { server, base } = await serve((b, url) => (url.includes(':batchEmbedContents') ? embedReply(b) : modelReply(b)));
    process.env = { ...env, GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_PROVIDER: 'planner' };
    await adminQuery(
      `CREATE (p:Patient {id: 'p-ck-embedtest', name: 'Check-up', sandbox: true, expiresAt: 9999999999999})
       CREATE (cv:Conversation {id: 'cv-ck', user: 'u', title: 'x'})-[:ABOUT]->(p)
       CREATE (cv)-[:HAS]->(:Message {id: 'm-ck', role: 'user', text: 'private check-up question', at: 1})`,
    );
    try {
      while ((await ensureEmbeddings({ limit: 100 })).more);
      const m = (await adminQuery(`MATCH (m:Message {id: 'm-ck'}) RETURN m.embedding IS NULL AS none`)) as { data?: { none: boolean }[] };
      expect(m.data?.[0]?.none).toBe(true);
      const [t] = ((await adminQuery(`MATCH (t:Task:Memory) RETURN t.id AS id LIMIT 1`)) as { data?: { id: string }[] }).data ?? [];
      expect(t).toBeTruthy();
      const { run: runQ } = await import('../src/lib/db');
      const { Q } = await import('../src/lib/cypher');
      const st = ((await adminQuery(`MATCH (t:Task {id: $id}) RETURN t.status AS s`, { id: t.id })) as { data?: { s: string }[] }).data?.[0]?.s ?? 'proposed';
      await runQ(Q.setTask, { id: t.id, from: [st], status: st, counted: false, note: 'Swelling settled after a dose change.', by: 'Test', byId: 'test', at: Date.now() });
      const after = (await adminQuery(`MATCH (t:Task {id: $id}) RETURN t.embedding IS NULL AS none`, { id: t.id })) as { data?: { none: boolean }[] };
      expect(after.data?.[0]?.none).toBe(true);
    } finally {
      server.close();
      await adminQuery(`MATCH (p:Patient {id: 'p-ck-embedtest'}) OPTIONAL MATCH (p)<-[:ABOUT]-(cv)-[:HAS]->(m) DETACH DELETE m, cv, p`);
    }
  });

  it('switching the embedding model re-embeds memories instead of comparing vectors across models', async () => {
    const { server, base, seen } = await serve((b, url) => (url.includes(':batchEmbedContents') ? embedReply(b) : modelReply(b)));
    try {
      process.env = { ...env, GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_PROVIDER: 'planner', EMBEDDING_MODEL: 'gemini-embedding-001' };
      while ((await ensureEmbeddings({ limit: 100 })).more);
      process.env.EMBEDDING_MODEL = 'gemini-embedding-2';
      const before = seen.length;
      const r = await ensureEmbeddings({ limit: 100 });
      expect(r.embedded).toBeGreaterThan(0);
      expect(seen.slice(before).every((x) => x.url.includes('gemini-embedding-2'))).toBe(true);
    } finally {
      server.close();
    }
  });

  it('a hanging embedding service costs one short wait, then searches go by words at once', async () => {
    const { server, base } = await serve(() => new Promise(() => undefined) as unknown as Record<string, unknown>);
    process.env = { ...env, GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: base, LLM_PROVIDER: 'planner', EMBED_TIMEOUT_MS: '300', EMBEDDING_MODEL: 'gemini-embedding-2' };
    try {
      const t0 = Date.now();
      const first = await searchMemoryDetailed('swelling amlodipine');
      expect(first.mode).toBe('words');
      expect(first.note).toMatch(/too slow|unavailable/);
      const t1 = Date.now();
      const second = await searchMemoryDetailed('swelling amlodipine');
      expect(second.mode).toBe('words');
      expect(Date.now() - t1).toBeLessThan(t1 - t0);
      expect(second.hits.length).toBeGreaterThan(0);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('without a key, searches by words and the graph, and says how to turn meaning on', async () => {
    process.env = { ...env, GEMINI_API_KEY: '' };
    const res = await searchMemoryDetailed('swelling amlodipine');
    expect(res.mode).toBe('words');
    expect(res.note).toMatch(/GEMINI_API_KEY/);
    // The graph: hits about amlodipine are marked as linked to what the question names.
    expect(res.hits.some((h) => h.linked)).toBe(true);
  });
});
