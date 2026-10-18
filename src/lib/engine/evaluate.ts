// Evaluation against the synthetic cohort's ground truth, with an ablation that shows
// how much each graph signal (time order, onset window, other reasons, documented
// patterns) adds. Ground truth comes from the seeded generator and never enters the graph.

import { run } from '../db';
import { Q } from '../cypher';
import { generateCohort } from '../../data/generator';
import { currentClinic } from '../tenant';
import { loadPatient, scoreLink, THRESHOLDS, type ScoreOptions } from './analyze';
import { knowledge } from './knowledge';
import type { Link } from './types';
import { replayCohort, type PreventionResult } from './replay';

export interface VariantResult {
  id: string;
  label: string;
  description: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  deliberateFlagged: number;
}

export interface EvalResult {
  at: number;
  patients: number;
  truthCascades: number;
  truthDeliberate: number;
  candidateLinks: number;
  threshold: number;
  variants: VariantResult[];
  byPattern: { pattern: string; truth: number; found: number }[];
  /** The prescriber check replayed at the point of prescribing, against the same ground truth. */
  prevention: PreventionResult;
  ms: number;
}

const VARIANTS: { id: string; label: string; description: string; opts: ScoreOptions | 'graph' }[] = [
  { id: 'graph', label: 'Graph links only', description: 'Any CAUSES → TREATED_BY link between two of the patient’s drugs.', opts: 'graph' },
  {
    id: 'order',
    label: '+ time order',
    description: 'The second drug must start after the first.',
    opts: { useWindow: false, useReasons: false, usePatterns: false, useMemory: false },
  },
  {
    id: 'window',
    label: '+ onset window',
    description: 'Score by how common the effect is and whether the gap fits its usual onset.',
    opts: { useReasons: false, usePatterns: false, useMemory: false },
  },
  {
    id: 'reasons',
    label: '+ other reasons',
    description: 'Down-weight when the second drug has its own diagnosis, or the effect was already diagnosed.',
    opts: { usePatterns: false, useMemory: false },
  },
  { id: 'full', label: 'Domino (full)', description: 'Adds documented patterns and routes deliberate pairs (gastroprotection, potassium) aside.', opts: {} },
];

function metrics(tp: number, fp: number, fn: number) {
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision: round(precision), recall: round(recall), f1: round(f1) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function evaluate(onProgress?: (done: number, total: number) => void): Promise<EvalResult> {
  const t0 = Date.now();
  const clinic = await currentClinic();
  const cohort = generateCohort(clinic.cohortSize, clinic.cohortSeed, clinic.idPrefix);
  const truthPos = new Set<string>();
  const truthDel = new Set<string>();
  const truthPattern = new Map<string, string>();
  for (const t of cohort.truth) {
    const k = `${t.patientId}|${t.from}|${t.to}`;
    if (t.intentional) truthDel.add(k);
    else truthPos.add(k);
  }

  const counts = Object.fromEntries(VARIANTS.map((v) => [v.id, { tp: 0, fp: 0, deliberateFlagged: 0, hits: new Set<string>() }]));
  let candidateLinks = 0;
  let done = 0;
  const perPattern = new Map<string, { truth: number; found: number }>();

  const k = await knowledge();
  await pool(cohort.patients, 8, async (p) => {
    const patient = await loadPatient(p.id);
    const [raw, reasonRows] = await Promise.all([
      run<Record<string, unknown>>(Q.links, { pid: p.id }),
      run<{ drug: string; reasons: { id: string; name: string; since: number }[] }>(Q.reasons, { pid: p.id }),
    ]);
    const reasons = new Map(reasonRows.map((r) => [r.drug, r.reasons.filter((x) => x && x.id)]));
    const effectNames = new Map<string, string>();
    for (const c of patient.conditions) effectNames.set(c.id, c.name.toLowerCase());
    candidateLinks += raw.length;

    for (const v of VARIANTS) {
      const scored: Link[] = raw.map((r) =>
        scoreLink(
          {
            from: String(r.from),
            fromName: String(r.fromName),
            to: String(r.to),
            toName: String(r.toName),
            effect: String(r.effect),
            effectName: String(r.effectName),
            effectPlain: String(r.effectPlain),
            freq: String(r.freq),
            weight: Number(r.weight),
            onsetMin: Number(r.onsetMin),
            onsetMax: Number(r.onsetMax),
            line: String(r.line),
            fromStart: Number(r.fromStart),
            toStart: Number(r.toStart),
            toIndication: (r.toIndication as string) ?? null,
            patterns: (r.patterns as string[]) ?? [],
          },
          { conditions: patient.conditions, reasons, decisions: [], effectNames, patterns: k.patterns },
          v.opts === 'graph' ? { useTiming: false, useReasons: false, usePatterns: false, useMemory: false } : v.opts,
        ),
      );
      const predicted = new Set<string>();
      for (const l of scored) {
        const positive = v.opts === 'graph' ? true : (l.tier === 'likely' || l.tier === 'possible') && l.score >= THRESHOLDS.possible;
        if (positive) predicted.add(`${p.id}|${l.from}|${l.to}`);
      }
      const c = counts[v.id];
      for (const k of predicted) {
        if (truthPos.has(k)) {
          c.tp++;
          c.hits.add(k);
        } else {
          c.fp++;
          if (truthDel.has(k)) c.deliberateFlagged++;
        }
      }
      if (v.id === 'full') {
        for (const l of scored) {
          const k = `${p.id}|${l.from}|${l.to}`;
          if (truthPos.has(k) && l.patterns[0]) truthPattern.set(k, l.patterns[0].title);
        }
      }
    }
    onProgress?.(++done, cohort.patients.length * 2);
  });

  for (const k of truthPos) {
    const pat = truthPattern.get(k) ?? 'Graph-inferred (no documented pattern)';
    if (!perPattern.has(pat)) perPattern.set(pat, { truth: 0, found: 0 });
    const e = perPattern.get(pat)!;
    e.truth++;
    if (counts.full.hits.has(k)) e.found++;
  }

  const variants: VariantResult[] = VARIANTS.map((v) => {
    const c = counts[v.id];
    const fn = truthPos.size - c.tp;
    return { id: v.id, label: v.label, description: v.description, tp: c.tp, fp: c.fp, fn, deliberateFlagged: c.deliberateFlagged, ...metrics(c.tp, c.fp, fn) };
  });

  const prevention = await replayCohort((d) => onProgress?.(cohort.patients.length + d, cohort.patients.length * 2));
  return {
    at: Date.now(),
    patients: cohort.patients.length,
    truthCascades: truthPos.size,
    truthDeliberate: truthDel.size,
    candidateLinks,
    threshold: THRESHOLDS.possible,
    variants,
    byPattern: [...perPattern.entries()].map(([pattern, v]) => ({ pattern, ...v })).sort((a, b) => b.truth - a.truth),
    prevention,
    ms: Date.now() - t0,
  };
}
