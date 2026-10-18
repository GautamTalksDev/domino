// FalkorDB connection and a small, traced query runner.
//
// Every query Domino runs goes through `run()`, which:
//   - only accepts queries from the catalog in cypher.ts (no string-built Cypher),
//   - always passes user input as parameters,
//   - uses GRAPH.RO_QUERY for read queries, so the database itself refuses writes,
//   - times each call and reports it to an optional tracer (the agent trace and the UI).

import { FalkorDB } from 'falkordb';
import type { CypherQuery } from './cypher';
import { currentScope, graphFor } from './tenant';

type Graph = ReturnType<FalkorDB['selectGraph']>;

export interface QueryTrace {
  id: string;
  title: string;
  cypher: string;
  params: Record<string, unknown>;
  ms: number;
  rows: number;
}

export type Tracer = (t: QueryTrace) => void;

interface DbState {
  client?: FalkorDB;
  connecting?: Promise<FalkorDB>;
  graphs: Map<string, Graph>;
}

const g = globalThis as unknown as { __domino_db?: DbState };
const state: DbState = (g.__domino_db ??= { graphs: new Map() });
state.graphs ??= new Map();

export class DatabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

/** The graph for the current clinic (see tenant.ts). Each clinic is a separate FalkorDB graph. */
export async function graphName(): Promise<string> {
  return graphFor((await currentScope()).clinic);
}

function connectionOptions() {
  const url = process.env.FALKORDB_URL;
  if (url) return { url };
  const host = process.env.FALKORDB_HOST || '127.0.0.1';
  const port = Number(process.env.FALKORDB_PORT || 6379);
  const tls = process.env.FALKORDB_TLS === 'true';
  return {
    socket: tls ? { host, port, tls: true as const, connectTimeout: 8000 } : { host, port, connectTimeout: 8000 },
    username: process.env.FALKORDB_USERNAME || undefined,
    password: process.env.FALKORDB_PASSWORD || undefined,
  };
}

async function getClient(): Promise<FalkorDB> {
  if (state.client) return state.client;
  if (state.connecting) return state.connecting;
  state.connecting = (async () => {
    try {
      const client = await FalkorDB.connect(connectionOptions());
      client.on('error', (err: unknown) => {
        // Log without credentials; the client reconnects on its own.
        console.error('[domino] FalkorDB connection error:', err instanceof Error ? err.message : 'unknown');
      });
      state.client = client;
      return client;
    } catch (err) {
      state.connecting = undefined;
      // The client error names the host and port: it goes to the server log, and to the page only in development.
      const detail = err instanceof Error ? err.message : 'unknown error';
      console.error('[domino] Cannot reach FalkorDB:', detail);
      throw new DatabaseUnavailableError(
        `Cannot reach FalkorDB${process.env.NODE_ENV === 'development' ? ` (${detail})` : ''}. Start it with "npm run db" or set FALKORDB_URL.`,
      );
    }
  })();
  return state.connecting;
}

export async function getGraph(name?: string): Promise<Graph> {
  const client = await getClient();
  const n = name ?? (await graphName());
  let graph = state.graphs.get(n);
  if (!graph) {
    graph = client.selectGraph(n);
    state.graphs.set(n, graph);
  }
  return graph;
}

export async function closeDb() {
  try {
    await state.client?.close();
  } catch {
    /* ignore */
  }
  state.client = undefined;
  state.connecting = undefined;
  state.graphs.clear();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

/** Longest a read query may run (ms) before FalkorDB stops it: one slow traversal never holds a request or a worker. */
export const readTimeoutMs = () => Math.max(100, Number(process.env.DOMINO_QUERY_TIMEOUT_MS || 15_000));

export async function run<T extends object = Row>(q: CypherQuery, params: Record<string, unknown> = {}, tracer?: Tracer): Promise<T[]> {
  const graph = await getGraph();
  const t0 = performance.now();
  const p = Object.keys(params).length ? { params: params as Record<string, never> } : {};
  // FalkorDB applies TIMEOUT to read queries; writes are fixed templates that touch a bounded part of the graph.
  const res = q.mode === 'read' ? await graph.roQuery(q.cypher, { ...p, TIMEOUT: readTimeoutMs() }) : await graph.query(q.cypher, Object.keys(p).length ? p : undefined);
  const ms = Math.round((performance.now() - t0) * 10) / 10;
  const rows = ((res as { data?: T[] }).data ?? []) as T[];
  tracer?.({ id: q.id, title: q.title, cypher: q.cypher, params, ms, rows: rows.length });
  return rows;
}

/** Run a raw admin statement (index creation, graph delete) used only by the seeder. */
export async function adminQuery(cypher: string, params: Record<string, unknown> = {}) {
  const graph = await getGraph();
  const opts = Object.keys(params).length ? { params: params as Record<string, never> } : undefined;
  return graph.query(cypher, opts);
}

export async function deleteGraph() {
  const graph = await getGraph();
  try {
    await graph.delete();
  } catch {
    /* graph did not exist */
  }
}

export async function ping(): Promise<{ ok: boolean; ms?: number; error?: string }> {
  try {
    const t0 = performance.now();
    // GRAPH.LIST works even before any graph exists (an RO_QUERY on a missing graph fails).
    await (await getClient()).list();
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}
