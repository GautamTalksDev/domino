// Counterfactual replay: "what if Domino had been at the prescriber's desk?"
//
// For a patient, every prescription is re-checked with the prescriber check exactly as the record stood
// the day it was written (TAKES.start < that day, diagnoses on record by then). The first time the check
// would have stopped a documented cascade, everything downstream of it is what might never have happened.
//
// For the synthetic cohort, the same replay runs against the generator's ground truth: how many true
// cascades the check would have caught at the first downstream prescription, how many prescriptions that
// would have saved, and how often it would have alerted on prescriptions that were not cascades (alert burden).

import { checkPrescription, isDocumentedStop } from './gatekeeper';
import { analyzePatient, loadPatient } from './analyze';
import { generateCohort, type TruthLink } from '../../data/generator';
import { currentClinic } from '../tenant';
import type { Tracer } from '../db';
import type { PatientCore } from './types';

export interface ReplayEvent {
  drug: string;
  name: string;
  start: number;
  prescriber: string;
  verdict: 'stop_and_check' | 'caution' | 'clear';
  reasons: string[];
  headline: string;
  /** The check would have raised a documented-cascade stop at this prescription. */
  cascadeStop: boolean;
}

export interface Catch {
  drug: string;
  name: string;
  start: number;
  headline: string;
  question: string | null;
  /** This prescription and what followed from it: what might never have been written. */
  avoidable: { id: string; name: string; start: number }[];
}

export interface PatientReplay {
  events: ReplayEvent[];
  catches: Catch[];
  firstCatch: Catch | null;
  /** Every prescription that, in the replay, might never have been written. */
  avoidable: { id: string; name: string; start: number }[];
  ms: number;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function replayPatient(pid: string, tracer?: Tracer): Promise<PatientReplay> {
  const t0 = performance.now();
  const [patient, analysis] = await Promise.all([loadPatient(pid, tracer), analyzePatient(pid, { tracer })]);
  const earliest = Math.min(...patient.meds.map((m) => m.start));
  // Each stop that lands on a drug the engine also sees as a cascade link today is a catch. What follows
  // from it in the cascade chains (and their planned companions) might never have been written, so the
  // rest of the replay is checked without those drugs: a later combination they would have completed
  // does not count against a prescription that, in the replay, sits on a different record.
  const cascadeDrugs = new Set(analysis.links.filter((l) => l.tier === 'likely' || l.tier === 'possible').map((l) => l.to));
  const avoided = new Set<string>();
  const catches: Catch[] = [];
  const events: ReplayEvent[] = [];
  for (const m of patient.meds) {
    if (m.start <= earliest || avoided.has(m.id)) continue;
    const r = await checkPrescription(pid, m.id, tracer, { asOf: m.start, exclude: [...avoided], patient });
    const e: ReplayEvent = {
      drug: m.id,
      name: m.name,
      start: m.start,
      prescriber: m.prescriber,
      verdict: r.verdict,
      reasons: r.reasons,
      headline: r.headline,
      cascadeStop: r.reasons.includes('cascade'),
    };
    events.push(e);
    if (!e.cascadeStop || !cascadeDrugs.has(m.id)) continue;
    const after = new Set<string>([m.id]);
    for (const c of analysis.chains) {
      const i = c.drugs.indexOf(m.id);
      if (i >= 0) for (const d of c.drugs.slice(i + 1)) after.add(d);
    }
    for (const l of analysis.links) if (l.tier === 'intentional' && after.has(l.from)) after.add(l.to);
    const list = patient.meds
      .filter((x) => after.has(x.id) && x.start >= m.start && !avoided.has(x.id))
      .map((x) => ({ id: x.id, name: x.name, start: x.start }));
    for (const x of list) avoided.add(x.id);
    const question = r.treatsSideEffectOf.find(isDocumentedStop)?.question ?? null;
    catches.push({ drug: m.id, name: m.name, start: m.start, headline: r.headline, question, avoidable: list });
  }
  return {
    events,
    catches,
    firstCatch: catches[0] ?? null,
    avoidable: patient.meds.filter((m) => avoided.has(m.id)).map((m) => ({ id: m.id, name: m.name, start: m.start })),
    ms: Math.round(performance.now() - t0),
  };
}

export interface PreventionResult {
  patients: number;
  prescriptionsChecked: number;
  trueCascadeMarkers: number;
  caught: number;
  caughtAnyAlert: number;
  prescriptionsAvoided: number;
  falseCascadeStops: number;
  otherStops: number;
  cautions: number;
  deliberateChecked: number;
  deliberateStopped: number;
  /** Deliberate companions stopped as a cascade (should be 0: they are planned care). */
  deliberateCascadeStops: number;
  stopRatePer100: number;
  cascadeStopPpv: number;
  ms: number;
}

/**
 * Cohort replay against ground truth. Walks each patient's prescriptions in order; a true cascade marker
 * that the check stops is "caught", and it and everything descended from it in the ground truth is
 * removed from the rest of that patient's replay (it would never have been written).
 */
export async function replayCohort(onProgress?: (done: number, total: number) => void): Promise<PreventionResult> {
  const t0 = Date.now();
  const clinic = await currentClinic();
  const cohort = generateCohort(clinic.cohortSize, clinic.cohortSeed, clinic.idPrefix);
  const byPatient = new Map<string, TruthLink[]>();
  for (const t of cohort.truth) {
    if (!byPatient.has(t.patientId)) byPatient.set(t.patientId, []);
    byPatient.get(t.patientId)!.push(t);
  }
  const r = {
    checked: 0,
    markers: 0,
    caught: 0,
    caughtAny: 0,
    avoided: 0,
    falseStops: 0,
    otherStops: 0,
    cautions: 0,
    delib: 0,
    delibStop: 0,
    delibCascade: 0,
    cascadeStops: 0,
  };
  let done = 0;
  await pool(cohort.patients, 8, async (sp) => {
    const truth = byPatient.get(sp.id) ?? [];
    const markers = new Set(truth.filter((t) => !t.intentional).map((t) => t.to));
    const deliberate = new Set(truth.filter((t) => t.intentional).map((t) => t.to));
    const children = new Map<string, string[]>();
    for (const t of truth) children.set(t.from, [...(children.get(t.from) ?? []), t.to]);
    const descend = (d: string, acc = new Set<string>()) => {
      for (const c of children.get(d) ?? []) if (!acc.has(c)) descend(c, acc.add(c));
      return acc;
    };
    let patient: PatientCore;
    try {
      patient = await loadPatient(sp.id);
    } catch {
      return;
    }
    const prevented = new Set<string>();
    const earliest = Math.min(...patient.meds.map((m) => m.start));
    for (const m of patient.meds) {
      if (m.start <= earliest || prevented.has(m.id)) continue;
      const res = await checkPrescription(sp.id, m.id, undefined, { asOf: m.start, exclude: [...prevented], patient });
      r.checked++;
      const cascadeStop = res.reasons.includes('cascade');
      if (cascadeStop) r.cascadeStops++;
      if (res.verdict === 'caution') r.cautions++;
      if (markers.has(m.id)) {
        r.markers++;
        if (res.verdict !== 'clear') r.caughtAny++;
        if (cascadeStop) {
          r.caught++;
          const gone = descend(m.id).add(m.id);
          for (const g of gone) if (!prevented.has(g) && patient.meds.some((x) => x.id === g)) prevented.add(g);
        }
      } else {
        if (cascadeStop) r.falseStops++;
        else if (res.verdict === 'stop_and_check') r.otherStops++;
        if (deliberate.has(m.id)) {
          r.delib++;
          if (res.verdict === 'stop_and_check') r.delibStop++;
          if (cascadeStop) r.delibCascade++;
        }
      }
    }
    r.avoided += prevented.size;
    onProgress?.(++done, cohort.patients.length);
  });
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    patients: cohort.patients.length,
    prescriptionsChecked: r.checked,
    trueCascadeMarkers: r.markers,
    caught: r.caught,
    caughtAnyAlert: r.caughtAny,
    prescriptionsAvoided: r.avoided,
    falseCascadeStops: r.falseStops,
    otherStops: r.otherStops,
    cautions: r.cautions,
    deliberateChecked: r.delib,
    deliberateStopped: r.delibStop,
    deliberateCascadeStops: r.delibCascade,
    stopRatePer100: round(((r.cascadeStops + r.otherStops) / Math.max(1, r.checked)) * 100),
    cascadeStopPpv: round(r.caught / Math.max(1, r.cascadeStops)),
    ms: Date.now() - t0,
  };
}
