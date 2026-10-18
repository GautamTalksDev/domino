// "Ask Domino" selects its tools through MCP: it connects to Domino's own MCP server over an
// in-memory transport, discovers the tools with tools/list and calls them with tools/call.
// The patient id is injected here, never chosen by the model.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ToolDecl } from './providers/types';
import type { JsonSchema } from './tools';

let clientPromise: Promise<Client> | null = null;

async function client(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createMcpServer } = await import('../mcp');
      const server = createMcpServer({ allowWrites: false });
      const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      const c = new Client({ name: 'domino-ask', version: '1.0.0' });
      await c.connect(clientSide);
      return c;
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

// A single-patient question sees one patient: no listing of others, and no clinic-wide search that returns other
// patients' notes, tasks and decisions. The care-team brain (mcpTeamTools) is where clinic-wide questions go.
const HIDDEN = new Set(['list_patients', 'search_team_memory', 'run_review']);

function normalise(schema: unknown): JsonSchema {
  const s = (schema ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
  const properties = { ...(s.properties ?? {}) };
  delete properties.patient_id;
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !k.startsWith('$') && k !== 'additionalProperties')
        .map(([k, x]) => [k, clean(x)]),
    );
  };
  return { type: 'object', properties: clean(properties) as Record<string, unknown>, required: (s.required ?? []).filter((r) => r !== 'patient_id') };
}

/** Tools for a single-patient question: patient_id is removed from every schema and injected by Domino. */
export async function mcpTools(): Promise<ToolDecl[]> {
  const c = await client();
  const { tools } = await c.listTools();
  return tools.filter((t) => !HIDDEN.has(t.name)).map((t) => ({ name: t.name, description: t.description ?? t.name, parameters: normalise(t.inputSchema) }));
}

/** Tools for a clinic-wide question: everything read-only, with patient_id left for the model to fill (same clinic graph only). */
export async function mcpTeamTools(): Promise<ToolDecl[]> {
  const c = await client();
  const { tools } = await c.listTools();
  return tools.map((t) => {
    const s = (t.inputSchema ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
    const keep = normalise(t.inputSchema);
    if (s.properties?.patient_id) {
      keep.properties = {
        patient_id: { type: 'string', description: 'patient id, e.g. "p-beatrice" (use list_patients or search_team_memory to find one)' },
        ...keep.properties,
      };
      keep.required = ['patient_id', ...(keep.required ?? [])];
    }
    return { name: t.name, description: t.description ?? t.name, parameters: keep };
  });
}

export interface McpResult {
  ok: boolean;
  summary: string;
  ms: number;
  queries: { id: string; title: string; ms: number; rows: number }[];
}

async function call(name: string, args: Record<string, unknown>): Promise<McpResult> {
  const t0 = performance.now();
  const c = await client();
  try {
    const res = await c.callTool({ name, arguments: args });
    const text = ((res.content as { type: string; text?: string }[]) ?? []).map((x) => x.text ?? '').join('\n');
    const ids = ((res._meta as Record<string, unknown> | undefined)?.['domino/queries'] as string[] | undefined) ?? [];
    return {
      ok: !res.isError,
      summary: res.isError ? `ERROR: ${text}` : text,
      ms: Math.round(performance.now() - t0),
      queries: ids.map((id) => ({ id, title: id, ms: 0, rows: 0 })),
    };
  } catch (err) {
    return {
      ok: false,
      summary: `ERROR: ${err instanceof Error ? err.message.slice(0, 300) : 'tool call failed'}`,
      ms: Math.round(performance.now() - t0),
      queries: [],
    };
  }
}

export async function mcpCall(patientId: string, name: string, args: unknown): Promise<McpResult> {
  if (HIDDEN.has(name)) return { ok: false, summary: `ERROR: ${name} is not available for a single-patient question.`, ms: 0, queries: [] };
  return call(name, { ...((args as Record<string, unknown>) ?? {}), patient_id: patientId });
}

/** Clinic-wide call: the model chooses the patient, but the graph is still the session's clinic. */
export async function mcpTeamCall(name: string, args: unknown): Promise<McpResult> {
  const a = (args as Record<string, unknown>) ?? {};
  if ('patient_id' in a && !/^p-?[a-z0-9-]{2,40}$/.test(String(a.patient_id))) return { ok: false, summary: 'ERROR: invalid patient id.', ms: 0, queries: [] };
  return call(name, a);
}
