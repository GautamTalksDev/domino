// Exercises the three LLM adapters end to end against local mock servers that follow each
// provider's documented request and response shapes, driving a real agent run on FalkorDB.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dbAvailable } from './setup-db';
import { runReview } from '../src/lib/agent/runner';
import { getProvider } from '../src/lib/agent/providers';
import { adminQuery, closeDb } from '../src/lib/db';

type Handler = (body: Record<string, unknown>, url: string, headers: Record<string, string | string[] | undefined>) => unknown;

function mock(handler: Handler): Promise<{ server: Server; base: string; seen: Record<string, unknown>[] }> {
  const seen: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const body = JSON.parse(data || '{}');
      seen.push({ url: req.url, body, headers: req.headers });
      res.setHeader('content-type', 'application/json');
      const out = handler(body, req.url ?? '', req.headers) as { __status?: number };
      if (out && out.__status) res.statusCode = out.__status;
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen })));
}

const systemOf = (b: Record<string, unknown>): string =>
  typeof b.system === 'string'
    ? b.system
    : ((b.systemInstruction as { parts: { text: string }[] } | undefined)?.parts?.[0]?.text ??
      ((b.messages as { role: string; content: string }[])?.[0]?.content || ''));
const role = (sys: string) =>
  sys.includes('You are the Detective')
    ? 'detective'
    : sys.includes('Pharmacist agent')
      ? 'pharmacist'
      : sys.includes('You are the Scribe')
        ? 'scribe'
        : 'domino';

// One tool call per agent on its first turn, then a final answer.
const PLAN: Record<string, { name: string; args: Record<string, unknown> }> = {
  detective: { name: 'find_cascades', args: {} },
  pharmacist: { name: 'simulate_untangle', args: { drug: 'lorazepam' } },
  scribe: {
    name: 'propose_task',
    args: {
      title: 'Could the agitation be from lorazepam?',
      body: 'Risperidone started 3 weeks after lorazepam. Review the chain together.',
      role: 'pharmacist',
      due_in_days: 7,
    },
  },
};

let ok = false;
const env = { ...process.env };
// Each adapter test starts with Rosa's inbox empty, so its one planned task is new (not a duplicate of the last test's).
beforeEach(async () => {
  if (ok) await adminQuery(`MATCH (t:Task)-[:FOR]->(:Patient {id: 'p-rosa'}) DETACH DELETE t`);
});

beforeAll(async () => {
  ok = await dbAvailable();
});
afterAll(async () => {
  process.env = env;
  await closeDb();
});

describe.runIf(await dbAvailable())('LLM provider adapters', () => {
  it('OpenAI-compatible chat completions', async () => {
    expect(ok).toBe(true);
    const { server, base, seen } = await mock((b) => {
      const msgs = b.messages as { role: string }[];
      const r = role(systemOf(b));
      const hasTool = msgs.some((m) => m.role === 'tool');
      if (!hasTool && PLAN[r])
        return {
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: `c-${r}`, type: 'function', function: { name: PLAN[r].name, arguments: JSON.stringify(PLAN[r].args) } }],
              },
            },
          ],
        };
      return { choices: [{ message: { content: `${r} finished.` } }] };
    });
    process.env = { ...env, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `${base}/v1`, LLM_MODEL: 'mock' };
    try {
      expect(getProvider().label).toBe('openai:mock');
      const res = await runReview({ patientId: 'p-rosa' });
      expect(res.mode).toBe('llm');
      expect(res.tasks).toBe(1);
      const first = seen[0] as { url: string; body: { tools: { type: string }[] }; headers: Record<string, string> };
      expect(first.url).toBe('/v1/chat/completions');
      expect(first.headers.authorization).toBe('Bearer test-key');
      expect(first.body.tools[0].type).toBe('function');
      // the tool result is sent back as a role:"tool" message with the call id
      const second = seen.find((s) => (s.body as { messages: { role: string }[] }).messages.some((m) => m.role === 'tool')) as {
        body: { messages: { role: string; tool_call_id?: string }[] };
      };
      expect(second.body.messages.find((m) => m.role === 'tool')?.tool_call_id).toBe('c-detective');
    } finally {
      server.close();
    }
  });

  it('Anthropic messages API', async () => {
    expect(ok).toBe(true);
    const { server, base, seen } = await mock((b) => {
      const msgs = b.messages as { role: string; content: unknown }[];
      const r = role(systemOf(b));
      const hasResult = msgs.some((m) => Array.isArray(m.content) && (m.content as { type: string }[]).some((c) => c.type === 'tool_result'));
      if (!hasResult && PLAN[r])
        return {
          content: [
            { type: 'text', text: 'Looking.' },
            { type: 'tool_use', id: `tu-${r}`, name: PLAN[r].name, input: PLAN[r].args },
          ],
          stop_reason: 'tool_use',
        };
      return { content: [{ type: 'text', text: `${r} finished.` }], stop_reason: 'end_turn' };
    });
    process.env = { ...env, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `${base}/v1`, LLM_MODEL: 'mock' };
    try {
      const res = await runReview({ patientId: 'p-rosa' });
      expect(res.tasks).toBe(1);
      const first = seen[0] as { url: string; body: { tools: { input_schema: unknown }[]; system: string }; headers: Record<string, string> };
      expect(first.url).toBe('/v1/messages');
      expect(first.headers['x-api-key']).toBe('test-key');
      expect(first.headers['anthropic-version']).toBe('2023-06-01');
      expect(first.body.tools[0].input_schema).toBeTruthy();
      const withResult = seen.find((s) => JSON.stringify(s.body).includes('tool_result')) as {
        body: { messages: { role: string; content: { type: string; tool_use_id?: string }[] }[] };
      };
      const last = withResult.body.messages[withResult.body.messages.length - 1];
      expect(last.role).toBe('user');
      expect(last.content[0].tool_use_id).toBe('tu-detective');
      // the assistant turn is replayed verbatim, including its tool_use block
      expect(JSON.stringify(withResult.body.messages)).toContain('"type":"tool_use"');
    } finally {
      server.close();
    }
  });

  it('Gemini generateContent with model fallback', async () => {
    expect(ok).toBe(true);
    let calls = 0;
    const { server, base, seen } = await mock((b, url) => {
      calls++;
      if (url.includes('gemini-first')) return { __status: 429, error: { message: 'quota exhausted' } };
      const contents = b.contents as { role: string; parts: Record<string, unknown>[] }[];
      const r = role(systemOf(b));
      const hasResp = contents.some((c) => c.parts.some((p) => p.functionResponse));
      if (!hasResp && PLAN[r])
        return {
          candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: PLAN[r].name, args: PLAN[r].args }, thoughtSignature: 'sig-123' }] } }],
        };
      return { candidates: [{ content: { role: 'model', parts: [{ text: `${r} finished.` }] } }] };
    });
    // The primary model answers 429 (quota): every call must fall through to the next model.
    process.env = { ...env, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: `${base}/v1beta`, LLM_MODEL: 'gemini-first' };
    try {
      const res = await runReview({ patientId: 'p-rosa' });
      expect(res.tasks).toBe(1);
      expect(calls).toBeGreaterThan(3);
      expect((seen[0] as { url: string }).url).toBe('/v1beta/models/gemini-first:generateContent');
      const first = seen[1] as {
        url: string;
        body: { tools: { functionDeclarations: { name: string; parameters?: { type: string } }[] }[] };
        headers: Record<string, string>;
      };
      expect(first.url).toBe('/v1beta/models/gemini-3.6-flash:generateContent');
      expect(first.headers['x-goog-api-key']).toBe('test-key');
      const decl = first.body.tools[0].functionDeclarations;
      expect(decl.find((d) => d.name === 'get_patient_context')?.parameters).toBeUndefined();
      const withResp = seen.find((s) => JSON.stringify(s.body).includes('functionResponse')) as {
        body: { contents: { role: string; parts: Record<string, unknown>[] }[] };
      };
      // the model turn (with its thought signature) is replayed verbatim before the function response
      expect(JSON.stringify(withResp.body.contents)).toContain('sig-123');
      const last = withResp.body.contents[withResp.body.contents.length - 1];
      expect(last.role).toBe('user');
      expect(last.parts[0].functionResponse).toBeTruthy();
    } finally {
      server.close();
    }
  });
});
