// Semantic memory: text embeddings from Gemini, stored as vectors on the graph's own nodes and searched with FalkorDB's
// vector index. "Who has dealt with water retention from blood pressure pills?" then finds the handover about ankle
// swelling on amlodipine, though the two share no words.
//
// The key stays on the server (GEMINI_API_KEY, the same key the agents use). Without it, or with
// DOMINO_EMBEDDINGS=off, Domino searches by words only (the full-text index) and says so; nothing else changes.
//
// Model: gemini-embedding-2 (GA April 2026), 768 dimensions, normalised by the API. It takes no task type, so queries
// and documents carry the prefixes Google documents for retrieval. gemini-embedding-001 is the fallback (with its task
// types, normalised here), for keys that cannot use the newer model.

import { ProviderError, postJson } from './agent/providers/types';
import { geminiBase } from './agent/providers';

export const EMBED_DIM = 768;
const PRIMARY = 'gemini-embedding-2';
const FALLBACK = 'gemini-embedding-001';
const BATCH = 100;
const MAX_CHARS = 6000;

export function embeddingsEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY && process.env.DOMINO_EMBEDDINGS !== 'off';
}

export function embeddingModel(): string {
  return process.env.EMBEDDING_MODEL || PRIMARY;
}

const g = globalThis as unknown as { __domino_embed_fallback?: number; __domino_embed_pause?: number };

/** A search waits at most this long for an embedding call; then it answers by words. */
const EMBED_TIMEOUT_MS = () => Number(process.env.EMBED_TIMEOUT_MS || 8000);

/** After the embedding API fails (quota, outage, too slow), it is not called for a minute: searches go by words at once. */
export function embeddingsPaused(): boolean {
  return (g.__domino_embed_pause ?? 0) > Date.now();
}

/** The model vectors are made with right now: the configured one, or the fallback while the newer one is refused. */
export function activeEmbeddingModel(): string {
  return (g.__domino_embed_fallback ?? 0) > Date.now() && !process.env.EMBEDDING_MODEL ? FALLBACK : embeddingModel();
}

function normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

/** The text Google's retrieval guidance asks for, per model. */
function shaped(model: string, kind: 'query' | 'document', text: string, title?: string): Record<string, unknown> {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (model.startsWith('gemini-embedding-2'))
    return {
      model: `models/${model}`,
      content: { parts: [{ text: kind === 'query' ? `task: search result | query: ${t}` : `title: ${title?.trim() || 'none'} | text: ${t}` }] },
      outputDimensionality: EMBED_DIM,
    };
  return {
    model: `models/${model}`,
    content: { parts: [{ text: t }] },
    taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
    ...(kind === 'document' && title ? { title: title.slice(0, 200) } : {}),
    outputDimensionality: EMBED_DIM,
  };
}

async function batch(model: string, items: { text: string; title?: string }[], kind: 'query' | 'document', signal?: AbortSignal): Promise<number[][]> {
  const json = (await postJson(
    `${geminiBase()}/models/${encodeURIComponent(model)}:batchEmbedContents`,
    { 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    { requests: items.map((i) => shaped(model, kind, i.text, i.title)) },
    signal,
    EMBED_TIMEOUT_MS(),
  )) as { embeddings?: { values?: number[] }[] };
  const out = (json.embeddings ?? []).map((e) => e.values ?? []);
  if (out.length !== items.length || out.some((v) => v.length !== EMBED_DIM))
    throw new ProviderError(`Embedding response had ${out.length} vectors of ${out[0]?.length ?? 0} dimensions; expected ${items.length} of ${EMBED_DIM}.`, 502);
  // gemini-embedding-2 normalises truncated vectors itself; the older model does not.
  return model.startsWith('gemini-embedding-2') ? out : out.map(normalise);
}

/**
 * Embeddings for texts, in order, with the model that made them (vectors from different models are never compared),
 * or null when semantic search is off. If the key cannot use the newer model (unknown, not allowed), the whole call
 * is redone with gemini-embedding-001 for the next hour; other errors (quota, outage) throw a ProviderError for the
 * caller to degrade on.
 */
export async function embed(
  items: { text: string; title?: string }[],
  kind: 'query' | 'document',
  signal?: AbortSignal,
): Promise<{ vectors: number[][]; model: string } | null> {
  if (!embeddingsEnabled()) return null;
  if (embeddingsPaused()) throw new ProviderError('Embeddings are paused for a minute after an error.', 503);
  const run = async (model: string) => {
    const vectors: number[][] = [];
    for (let i = 0; i < items.length; i += BATCH) vectors.push(...(await batch(model, items.slice(i, i + BATCH), kind, signal)));
    return { vectors, model };
  };
  const model = activeEmbeddingModel();
  const pauseOn = (err: unknown) => {
    const status = (err as ProviderError).status ?? 0;
    if (err instanceof ProviderError && (status === 408 || status === 429 || status >= 500)) g.__domino_embed_pause = Date.now() + 60_000;
    return err;
  };
  try {
    return await run(model);
  } catch (err) {
    const status = (err as ProviderError).status;
    if (model === FALLBACK || process.env.EMBEDDING_MODEL || ![403, 404, 400].includes(status ?? 0)) throw pauseOn(err);
    g.__domino_embed_fallback = Date.now() + 60 * 60_000;
    try {
      return await run(FALLBACK);
    } catch (e2) {
      throw pauseOn(e2);
    }
  }
}
