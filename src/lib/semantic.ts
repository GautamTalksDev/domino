// Keeping the clinic's memory embedded, and searching it by meaning. The vectors live on the graph's own nodes
// (labelled Memory) under one FalkorDB vector index, so a hit is a node the rest of the graph already connects to its
// patient, drugs and people: semantic search and graph traversal are one system, not two.

import { run, type Tracer } from './db';
import { Q } from './cypher';
import { activeEmbeddingModel, embed, embeddingsEnabled } from './embeddings';

const g = globalThis as unknown as { __domino_memory_index?: Set<string> };
const indexed = (g.__domino_memory_index ??= new Set());

/** Create the vector index once per graph per process (the database refuses a second one, which is fine). */
async function ensureIndex(graphKey: string, tracer?: Tracer) {
  if (indexed.has(graphKey)) return;
  try {
    await run(Q.createMemoryIndex, {}, tracer);
  } catch (err) {
    if (!/already indexed/i.test(String((err as Error)?.message))) throw err;
  }
  indexed.add(graphKey);
}

/**
 * Embed what the team wrote that has no vector from the current model yet, up to `limit` items (one or two API
 * calls). Called before a search, so new notes become findable by meaning on the next question, and by `npm run embed`
 * for a whole graph. Returns how many were embedded, and whether more are waiting.
 */
export async function ensureEmbeddings(opts: { limit?: number; graphKey?: string; tracer?: Tracer; signal?: AbortSignal } = {}): Promise<{ embedded: number; more: boolean }> {
  if (!embeddingsEnabled()) return { embedded: 0, more: false };
  const limit = opts.limit ?? 64;
  await ensureIndex(opts.graphKey ?? 'default', opts.tracer);
  const rows = await run<{ nid: number; id: string; title: string | null; text: string | null }>(Q.memoryToEmbed, { model: activeEmbeddingModel(), limit: limit + 1 }, opts.tracer);
  const todo = rows.slice(0, limit);
  if (!todo.length) return { embedded: 0, more: false };
  const res = await embed(
    todo.map((r) => ({ text: (r.text ?? '').trim() || (r.title ?? '').trim() || '(empty)', title: r.title ?? undefined })),
    'document',
    opts.signal,
  );
  if (!res) return { embedded: 0, more: false };
  // Recorded with the model that actually made them, which a fallback may have changed.
  await run(Q.setEmbeddings, { rows: todo.map((r, i) => ({ nid: r.nid, id: r.id, v: res.vectors[i] })), model: res.model }, opts.tracer);
  return { embedded: todo.length, more: rows.length > limit };
}

export interface MeaningHit {
  kind: 'task' | 'note' | 'decision' | 'doc' | 'message';
  id: string;
  title: string | null;
  text: string | null;
  status: string | null;
  by: string | null;
  patientId: string | null;
  patientName: string;
  at: number | null;
  /** Cosine similarity, 0 to 1. */
  score: number;
}

/** The nearest memories to a question, by meaning. Only the asking person's own conversation messages are included. */
export async function searchByMeaning(text: string, user: string, opts: { k?: number; tracer?: Tracer; signal?: AbortSignal } = {}): Promise<MeaningHit[]> {
  const res = await embed([{ text }], 'query', opts.signal);
  if (!res?.vectors[0]) return [];
  // Only vectors from the same model as the question's are compared.
  // Ask the index for many neighbours: other people's messages, check-up patients and other models are filtered after
  // the nearest-neighbour step, and must not crowd out the person's own results.
  const limit = opts.k ?? 24;
  return run<MeaningHit>(Q.searchMeaning, { k: Math.max(150, limit * 6), limit, v: res.vectors[0], model: res.model, user }, opts.tracer);
}
