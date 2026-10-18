// The care-team brain: who prescribes what, where cascades cross from one prescriber to another,
// who on the team has handled each kind of cascade, what the agents have learned, and one search
// over everything the team wrote down. All of it is Cypher over the clinic's graph.

import { graphName, run, type Tracer } from './db';
import { Q } from './cypher';
import { DRUG, EFFECT, PATTERN } from '../data/knowledge';
import { currentUser } from './tenant';
import { embeddingsEnabled } from './embeddings';
import { ensureEmbeddings, searchByMeaning } from './semantic';
import { linkEntities } from './docs';
import { ProviderError } from './agent/providers/types';

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'what',
  'who',
  'why',
  'how',
  'did',
  'does',
  'was',
  'were',
  'are',
  'is',
  'about',
  'from',
  'that',
  'this',
  'have',
  'has',
  'any',
  'our',
  'we',
  'you',
  'they',
  'their',
  'there',
  'which',
  'when',
  'into',
  'than',
  'then',
  'them',
  'been',
  'can',
  'could',
  'should',
  'would',
  'tell',
  'show',
  'find',
  'all',
  'know',
]);

/**
 * Turns free text into a safe RediSearch query: lower-case word tokens only (no operators reach the
 * index), each matched as a prefix, and fuzzily when long enough to absorb a typo.
 */
export function toSearchQuery(text: string): string | null {
  const tokens = [...new Set((text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter((t) => !STOP.has(t)))].slice(0, 8);
  if (!tokens.length) return null;
  return tokens.map((t) => (t.length >= 5 ? `%${t}%|${t}*` : `${t}*`)).join('|');
}

export interface MemoryHit {
  kind: 'task' | 'note' | 'decision' | 'finding' | 'message' | 'doc';
  id: string;
  title: string | null;
  text: string | null;
  status: string | null;
  by: string | null;
  /** Null for a conversation about the whole clinic. */
  patientId: string | null;
  patientName: string;
  at: number | null;
  score: number;
  /** How it was found: by its words (full-text index), by its meaning (vector index), or both. */
  match?: 'words' | 'meaning' | 'both';
  /** Connected in the graph to a patient, drug or symptom the question names. */
  linked?: boolean;
}

export interface MemorySearch {
  hits: MemoryHit[];
  /** "hybrid": words, meaning and graph; "words": the full-text index only. */
  mode: 'hybrid' | 'words';
  /** Why search by meaning is off or degraded, in words for the person. */
  note: string | null;
}

/** Below this cosine similarity a vector neighbour is noise, not a match. */
const MIN_MEANING = 0.45;
/** Reciprocal-rank fusion constant: how much rank 1 outweighs rank 10. */
const RRF_K = 20;

const keyOf = (r: MemoryHit) => (r.kind === 'finding' ? `${r.patientId}|${r.title}` : `${r.kind}:${r.id}`);

/**
 * One search over everything the team wrote down, three ways at once:
 *  - words: FalkorDB's full-text index (typos included);
 *  - meaning: Gemini embeddings in FalkorDB's vector index, so "water retention on blood pressure pills" finds the
 *    handover about ankle swelling on amlodipine;
 *  - the graph: the question's patients, drugs and symptoms are linked to the graph, and memories connected to them
 *    rank higher.
 * The two rankings are fused by reciprocal rank. Without a key, or if the embedding model fails, it is words and graph
 * only, and `note` says so.
 */
export async function searchMemoryDetailed(text: string, tracer?: Tracer, opts: { backfill?: boolean } = {}): Promise<MemorySearch> {
  const user = await currentUser();
  const q = toSearchQuery(text);
  let mode: MemorySearch['mode'] = 'words';
  let note: string | null = embeddingsEnabled() ? null : 'Searching by words. Add GEMINI_API_KEY to search by meaning too.';
  const [words, meaning, entities] = await Promise.all([
    q ? run<MemoryHit>(Q.searchMemory, { q, user: user.id }, tracer) : Promise.resolve([] as MemoryHit[]),
    (async () => {
      if (!embeddingsEnabled()) return [] as MemoryHit[];
      // Embed what is new first (bounded; a failure here still lets the question itself be embedded and searched).
      if (opts.backfill !== false) await ensureEmbeddings({ limit: 64, graphKey: await graphName(), tracer }).catch(() => undefined);
      try {
        const hits = await searchByMeaning(text, user.id, { tracer });
        mode = 'hybrid';
        return hits.filter((h) => h.score >= MIN_MEANING) as MemoryHit[];
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        note = `Searching by words only: the embedding model is ${err.status === 429 ? 'over its quota' : err.status === 408 ? 'too slow' : 'unavailable'} right now.`;
        return [] as MemoryHit[];
      }
    })(),
    linkEntities(text, tracer).catch(() => ({ drugs: [] as string[], effects: [] as string[], patients: [] as string[] })),
  ]);

  // The graph: names of what the question links to, and the patients it names.
  const names = [...entities.drugs.map((d) => DRUG[d]?.name), ...entities.effects.flatMap((e) => [EFFECT[e]?.name, EFFECT[e]?.plain])]
    .filter((x): x is string => !!x && x.length >= 4)
    .map((x) => x.toLowerCase());
  const linkedTo = (h: MemoryHit) =>
    (!!h.patientId && entities.patients.includes(h.patientId)) || names.some((n) => `${h.title ?? ''} ${h.text ?? ''}`.toLowerCase().includes(n));

  const fused = new Map<string, MemoryHit & { rrf: number }>();
  const add = (list: MemoryHit[], how: 'words' | 'meaning') => {
    const seen = new Set<string>();
    [...list]
      .sort((a, b) => b.score - a.score || (b.at ?? 0) - (a.at ?? 0))
      .forEach((h) => {
        const k = keyOf(h);
        if (seen.has(k)) return;
        seen.add(k);
        const rank = seen.size;
        const prev = fused.get(k);
        if (prev) {
          prev.rrf += 1 / (RRF_K + rank);
          prev.match = prev.match === how ? how : 'both';
        } else fused.set(k, { ...h, match: how, rrf: 1 / (RRF_K + rank) });
      });
  };
  add(words, 'words');
  add(meaning, 'meaning');
  const perKind = new Map<string, number>();
  const hits = [...fused.values()]
    .map((h) => {
      const linked = linkedTo(h);
      // A memory about the patient, drug or symptom the question names counts as much as a top-three rank.
      return { ...h, linked, rrf: h.rrf + (linked ? 1 / (RRF_K + 3) : 0) };
    })
    .sort((a, b) => b.rrf - a.rrf || (b.at ?? 0) - (a.at ?? 0))
    .filter((r) => {
      // At most 8 per kind, so dozens of matching findings never crowd out the one note or decision.
      const n = (perKind.get(r.kind) ?? 0) + 1;
      perKind.set(r.kind, n);
      return n <= 8;
    })
    .slice(0, 30)
    .map(({ rrf, ...h }) => ({ ...h, score: Math.round(rrf * 1000) / 1000 }));
  return { hits, mode, note };
}

/** For read-only callers (the MCP tool): search, but never write (no embedding backfill). */
export async function searchMemory(text: string, tracer?: Tracer): Promise<MemoryHit[]> {
  return (await searchMemoryDetailed(text, tracer, { backfill: false })).hits;
}

export interface Flow {
  fromBy: string;
  toBy: string;
  links: number;
  likely: number;
  avgScore: number;
}

export interface PrescriberRow {
  name: string;
  specialty: string;
  kind: 'family' | 'walk_in' | 'specialist';
  patients: number;
  prescriptions: number;
  started: number;
  added: number;
}

export async function careTeam(tracer?: Tracer) {
  const [flows, prescribers] = await Promise.all([
    run<Flow>(Q.careTeamFlows, {}, tracer),
    run<Omit<PrescriberRow, 'started' | 'added'>>(Q.prescribers, {}, tracer),
  ]);
  const started = new Map<string, number>();
  const added = new Map<string, number>();
  for (const f of flows) {
    started.set(f.fromBy, (started.get(f.fromBy) ?? 0) + f.links);
    added.set(f.toBy, (added.get(f.toBy) ?? 0) + f.links);
  }
  const total = flows.reduce((s, f) => s + f.links, 0);
  const crossing = flows.filter((f) => f.fromBy !== f.toBy).reduce((s, f) => s + f.links, 0);
  const kindOf = new Map(prescribers.map((p) => [p.name, p.kind]));
  const byKind = (k: string) => flows.filter((f) => kindOf.get(f.toBy) === k).reduce((s, f) => s + f.links, 0);
  return {
    flows,
    prescribers: prescribers.map((p) => ({ ...p, started: started.get(p.name) ?? 0, added: added.get(p.name) ?? 0 })) as PrescriberRow[],
    totals: {
      links: total,
      crossing,
      crossingShare: total ? crossing / total : 0,
      addedByWalkIn: byKind('walk_in'),
      addedBySpecialist: byKind('specialist'),
      addedByFamily: byKind('family'),
    },
  };
}

export interface Expert {
  person: string;
  total: number;
  patterns: { id: string; title: string; n: number; kinds: string[] }[];
}

export async function whoKnows(pattern?: string | null, tracer?: Tracer): Promise<Expert[]> {
  const rows = await run<{ person: string; pattern: string; n: number; kind: string }>(Q.whoKnows, {}, tracer);
  const map = new Map<string, Expert>();
  for (const r of rows) {
    if (pattern && r.pattern !== pattern) continue;
    const e = map.get(r.person) ?? { person: r.person, total: 0, patterns: [] };
    e.total += r.n;
    const p = e.patterns.find((x) => x.id === r.pattern);
    if (p) {
      p.n += r.n;
      if (!p.kinds.includes(r.kind)) p.kinds.push(r.kind);
    } else e.patterns.push({ id: r.pattern, title: PATTERN[r.pattern]?.title ?? r.pattern, n: r.n, kinds: [r.kind] });
    map.set(r.person, e);
  }
  return [...map.values()].map((e) => ({ ...e, patterns: e.patterns.sort((a, b) => b.n - a.n) })).sort((a, b) => b.total - a.total);
}

export interface ProcedureRow {
  procedure: {
    id: string;
    key: string;
    version: number;
    role: string;
    dueLikely: number;
    duePossible: number;
    minTier: string;
    reason: string;
    at: number;
    acted: number;
    dismissed: number;
  };
  pattern: string | null;
  learnedFrom: number;
}

export async function learnedProcedures(tracer?: Tracer): Promise<ProcedureRow[]> {
  return run<ProcedureRow>(Q.procedures, {}, tracer);
}
