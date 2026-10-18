// What Domino knows about medicines, read from the graph: the documented cascade patterns, the dangerous-combination
// rules and the drug cards (class, anticholinergic burden, Beers note, taper caution). The seed writes this knowledge
// into FalkorDB once (from src/data/knowledge.ts, with its citations); from then on the engine reads it from the graph,
// so the graph is the single source of truth a reviewer can query, cite and change.
//
// It changes only when the graph is reseeded, so each process keeps it for a few minutes per graph instead of
// re-reading it for every one of the 600 patients in a sweep. Reseeding forgets it at once.

import { graphName, run, type Tracer } from '../db';
import { Q } from '../cypher';
import type { Med, PatternInfo } from './types';

export interface ComboRule {
  id: string;
  title: string;
  why: string;
  /** The harm, by name ("Acute kidney injury"). */
  harm: string;
  refs: string[];
  /** One drug class from every group completes the combination. */
  groups: string[][];
}

export interface DrugCard {
  id: string;
  name: string;
  cls: string;
  clsName: string;
  acb: number;
  beers: string | null;
  taper: string | null;
}

export interface Knowledge {
  patterns: Map<string, PatternInfo>;
  combos: ComboRule[];
  drugs: Map<string, DrugCard>;
  tapers: Map<string, string>;
}

const TTL_MS = 10 * 60_000;
const g = globalThis as unknown as { __domino_knowledge?: Map<string, { at: number; k: Promise<Knowledge> }> };
const cache = (g.__domino_knowledge ??= new Map());

async function load(tracer?: Tracer): Promise<Knowledge> {
  const [pats, combos, drugs] = await Promise.all([
    run<{
      id: string;
      title: string;
      evidence: PatternInfo['evidence'];
      refs: string[];
      intentional: string | null;
      question: string;
      asr: number | null;
      lo: number | null;
      hi: number | null;
      prevalence: number | null;
      note: string | null;
      negative: string | null;
    }>(Q.knowledgePatterns, {}, tracer),
    run<{ id: string; title: string; why: string; refs: string[]; harm: string | null; groups: string[][] }>(Q.knowledgeCombos, {}, tracer),
    run<{ id: string; name: string; cls: string; clsName: string; acb: number | null; beers: string | null; taper: string | null }>(Q.knowledgeDrugs, {}, tracer),
  ]);
  const patterns = new Map<string, PatternInfo>(
    pats.map((p) => [
      p.id,
      {
        id: p.id,
        title: p.title,
        evidence: p.evidence,
        refs: p.refs ?? [],
        ...(p.intentional ? { intentional: p.intentional } : {}),
        question: p.question,
        ...(p.asr != null ? { realWorld: { asr: Number(p.asr), lo: Number(p.lo), hi: Number(p.hi), prevalence: Number(p.prevalence), note: p.note ?? '' } } : {}),
        ...(p.negative ? { realWorldNegative: p.negative } : {}),
      },
    ]),
  );
  const cards = new Map<string, DrugCard>(
    drugs.map((d) => [d.id, { id: d.id, name: d.name, cls: d.cls, clsName: d.clsName, acb: Number(d.acb ?? 0), beers: d.beers ?? null, taper: d.taper ?? null }]),
  );
  const tapers = new Map<string, string>();
  for (const d of cards.values()) if (d.taper) tapers.set(d.cls, d.taper);
  return {
    patterns,
    combos: combos.map((c) => ({ id: c.id, title: c.title, why: c.why, harm: c.harm ?? '', refs: c.refs ?? [], groups: c.groups ?? [] })),
    drugs: cards,
    tapers,
  };
}

/** The knowledge in the current clinic's graph. */
export async function knowledge(tracer?: Tracer): Promise<Knowledge> {
  const key = await graphName();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.k;
  const k = load(tracer);
  cache.set(key, { at: Date.now(), k });
  k.catch(() => cache.delete(key));
  return k;
}

/** After a reseed: the next read comes from the new graph (the knowledge, and the chokepoints computed from it). */
export function forgetKnowledge() {
  cache.clear();
  (globalThis as unknown as { __domino_hubs?: Map<string, unknown> }).__domino_hubs?.clear();
}

/** The dangerous combinations a list of medicines completes (what-if lists: a new prescription, an untangle, EHR orders). */
export function matchCombos(meds: Pick<Med, 'cls'>[], rules: ComboRule[]): ComboRule[] {
  const classes = new Set(meds.map((m) => m.cls));
  return rules.filter((c) => c.groups.length > 0 && c.groups.every((grp) => grp.some((cls) => classes.has(cls))));
}
