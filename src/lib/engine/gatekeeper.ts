// Prescriber check: before a new drug is added, ask the graph whether it would start or
// extend a cascade, pile onto an existing side effect, or complete a dangerous combination.

import { run, type Tracer } from '../db';
import { Q } from '../cypher';
import { loadPatient, scoreLink } from './analyze';
import { knowledge, matchCombos } from './knowledge';
import { decisionPayload, verifyPayload } from '../agent/sign';
import type { DecisionRecord, Med, PatientCore } from './types';
import { daysBetweenLabel, TODAY_DAY } from '../../data/time';

export interface CheckResult {
  drug: { id: string; name: string; cls: string; acb: number; beers: string | null };
  verdict: 'stop_and_check' | 'caution' | 'clear';
  headline: string;
  treatsSideEffectOf: {
    from: string;
    fromName: string;
    effect: string;
    effectName: string;
    freq: string;
    since: string;
    pattern?: string;
    /** The documented pattern's id in the graph. */
    patternId?: string;
    question?: string;
    diagnosed: boolean;
    deliberate?: string;
    /** The same score the review engine would give this link if the drug were written today. */
    score: number;
    tier: string;
    factors: string[];
  }[];
  /** Why the verdict is what it is: a documented cascade, a dangerous combination, a class conflict. */
  reasons: ('cascade' | 'combo' | 'conflict' | 'possible_cascade' | 'pileup' | 'burden' | 'beers' | 'deliberate')[];
  couldCause: { id: string; name: string; freq: string; diagnosed: boolean; treatedBy: string[]; alsoCausedBy: string[] }[];
  conflicts: { drug: string; cls: string; why: string }[];
  combosCompleted: string[];
  acbBefore: number;
  acbAfter: number;
  alreadyTaking: boolean;
  queries: { id: string; title: string; ms: number; rows: number }[];
}

const lowerFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);

export interface CheckOptions {
  /** Replay mode: only prescriptions started before this day count (the record as it stood then). */
  asOf?: number;
  /** Replay mode: drugs that, in the counterfactual, were never prescribed. */
  exclude?: string[];
  /** Replay mode: the patient, already loaded. */
  patient?: PatientCore;
  /** The indication the prescriber is writing it for, if given. */
  indication?: string | null;
}

const LIVE = 1e9;

/**
 * A documented (non-deliberate) pattern stops when the engine scores the link likely, or possible when the
 * effect is not already charted as a diagnosis. Shared with the replay, so its question matches the verdict.
 */
export function isDocumentedStop(x: Pick<CheckResult['treatsSideEffectOf'][number], 'pattern' | 'tier' | 'diagnosed'>): boolean {
  return !!x.pattern && (x.tier === 'likely' || (x.tier === 'possible' && !x.diagnosed));
}

export async function checkPrescription(pid: string, drugId: string, tracer?: Tracer, opts: CheckOptions = {}): Promise<CheckResult> {
  const asOf = opts.asOf ?? LIVE;
  const exclude = opts.exclude ?? [];
  const queries: CheckResult['queries'] = [];
  const t: Tracer = (x) => {
    queries.push({ id: x.id, title: x.title, ms: x.ms, rows: x.rows });
    tracer?.(x);
  };
  // The drug's card (class, burden, Beers note) and the combination rules come from the graph, like everything else.
  const k = await knowledge(t);
  const def = k.drugs.get(drugId);
  if (!def) throw new Error('Unknown drug');
  const loaded = opts.patient ?? (await loadPatient(pid, t));
  const replay = asOf !== LIVE || exclude.length > 0;
  const patient: PatientCore = replay
    ? {
        ...loaded,
        meds: loaded.meds.filter((m) => m.start < asOf && !exclude.includes(m.id) && m.id !== drugId),
        conditions: loaded.conditions.filter((c) => c.since <= asOf),
      }
    : loaded;
  const today = replay ? asOf : TODAY_DAY;
  const [back, fwd, conflicts, otherReasons, memory] = await Promise.all([
    run<{
      from: string;
      fromName: string;
      effect: string;
      effectName: string;
      effectPlain: string;
      freq: string;
      weight: number;
      onsetMin: number;
      onsetMax: number;
      line: string;
      fromStart: number;
      diagnosed: boolean;
      patterns: string[];
    }>(Q.gatekeeper, { pid, drug: drugId, asOf, exclude }, t),
    run<{ id: string; name: string; kind: string; freq: string; diagnosed: boolean; treatedBy: string[]; alsoCausedBy: string[] }>(
      Q.gatekeeperForward,
      { pid, drug: drugId, asOf, exclude },
      t,
    ),
    run<{ drug: string; cls: string; why: string }>(Q.gatekeeperConflicts, { pid, drug: drugId, asOf, exclude }, t),
    run<{ id: string; name: string; since: number }>(Q.gatekeeperReasons, { pid, drug: drugId, asOf }, t),
    // The care team's signed decisions count here too (live checks only; a replay is the record as it was).
    replay
      ? Promise.resolve([] as { decisions: (DecisionRecord & { sig?: string })[] }[])
      : run<{ decisions: (DecisionRecord & { sig?: string })[] }>(Q.memory, { pid }, t),
  ]);
  const decisions: DecisionRecord[] = ((memory[0]?.decisions ?? []) as (DecisionRecord & { sig?: string })[])
    .filter((d) => d && d.id && d.to === drugId)
    .map((d) => ({ ...d, verified: verifyPayload(decisionPayload({ ...d, patientId: pid }), d.sig) }))
    .filter((d) => d.verified);
  const acbBefore = patient.meds.reduce((s, m) => s + (m.acb || 0), 0);
  const acbAfter = acbBefore + (def.acb ?? 0);
  const newMed: Med = {
    id: def.id,
    name: def.name,
    cls: def.cls,
    clsName: '',
    acb: def.acb ?? 0,
    beers: def.beers ?? null,
    start: today,
    dose: '',
    prescriber: '',
    indication: null,
  };
  const before = new Set(matchCombos(patient.meds, k.combos).map((c) => c.id));
  const combosCompleted = matchCombos([...patient.meds, newMed], k.combos)
    .filter((c) => !before.has(c.id))
    .map((c) => c.title);

  // Score each "this new drug treats a side effect of drug A" link with the same engine the review uses:
  // frequency, timing against the onset window (A's start to today), other reasons on record, evidence.
  const effectNames = new Map<string, string>(patient.conditions.map((c) => [c.id, c.name.toLowerCase()]));
  const reasons = new Map([[drugId, otherReasons.filter((r) => r && r.id)]]);
  const treatsSideEffectOf = back
    .map((b) => {
      const link = scoreLink(
        {
          from: b.from,
          fromName: b.fromName,
          to: drugId,
          toName: def.name,
          effect: b.effect,
          effectName: b.effectName,
          effectPlain: b.effectPlain,
          freq: b.freq,
          weight: Number(b.weight),
          onsetMin: Number(b.onsetMin),
          onsetMax: Number(b.onsetMax),
          line: b.line,
          fromStart: Number(b.fromStart),
          toStart: today,
          toIndication: opts.indication ?? null,
          patterns: b.patterns ?? [],
        },
        { conditions: patient.conditions, reasons, decisions, effectNames, patterns: k.patterns },
      );
      const pats = (b.patterns ?? []).map((id) => k.patterns.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
      // A "usually deliberate" pattern (stomach protection with an NSAID, potassium with a loop diuretic)
      // is good care, not a cascade: it is reported as a planned companion and never raises a stop.
      const pat = pats.find((p) => !p.intentional);
      const deliberate = !pat ? pats.find((p) => p.intentional) : undefined;
      return {
        from: b.from,
        fromName: b.fromName,
        effect: b.effect,
        effectName: b.effectName,
        freq: b.freq,
        since: daysBetweenLabel(today - Number(b.fromStart)),
        pattern: pat?.title,
        patternId: pat?.id,
        question: pat?.question,
        diagnosed: !!b.diagnosed,
        deliberate: deliberate?.intentional,
        score: link.score,
        tier: link.tier,
        factors: link.factors.map((f) => f.note),
      };
    })
    .sort((x, y) => Number(!!y.pattern) - Number(!!x.pattern) || y.score - x.score);

  const couldCause = fwd
    .filter((f) => f.diagnosed || f.treatedBy.length || f.alsoCausedBy.length)
    .map((f) => ({ id: f.id, name: f.name, freq: f.freq, diagnosed: !!f.diagnosed, treatedBy: f.treatedBy, alsoCausedBy: f.alsoCausedBy }));

  // The verdict follows the review engine's tiers, so the check and the review never disagree:
  //  - a documented (non-deliberate) pattern stops when the engine scores the link likely or possible;
  //  - a graph-inferred link stops when it scores likely, and is a caution when it scores possible;
  //  - an unlikely link (wrong timing, the effect was diagnosed before the first drug, another reason
  //    on record) is listed with its factors but raises nothing.
  // A diagnosis of the effect charted after the first drug started is not "its own reason": that is
  // the side effect being recorded as a new problem, which is the cascade itself. The engine's history
  // factor already handles a diagnosis that came first.
  // One refinement: a documented link that only scores "possible" while the effect is charted as a diagnosis
  // is ambiguous (a real new problem looks the same on paper), so it is a caution rather than a stop.
  const documented = treatsSideEffectOf.filter(isDocumentedStop);
  const strong = treatsSideEffectOf.filter((x) => !x.pattern && !x.deliberate && x.tier === 'likely');
  const possible = treatsSideEffectOf.filter((x) => !documented.includes(x) && !x.deliberate && x.tier === 'possible');
  const why: CheckResult['reasons'] = [];
  if (documented.length || strong.length) why.push('cascade');
  if (combosCompleted.length) why.push('combo');
  if (conflicts.length) why.push('conflict');
  if (possible.length) why.push('possible_cascade');
  if (couldCause.some((c) => c.treatedBy.length)) why.push('pileup');
  const burdenCrossed = acbBefore < 3 && acbAfter >= 3 && (def.acb ?? 0) > 0;
  if (burdenCrossed) why.push('burden');
  if (def.beers) why.push('beers');
  if (treatsSideEffectOf.some((x) => x.deliberate && !x.diagnosed)) why.push('deliberate');
  const verdict: CheckResult['verdict'] =
    documented.length || strong.length || combosCompleted.length || conflicts.length
      ? 'stop_and_check'
      : possible.length || burdenCrossed || def.beers
        ? 'caution'
        : 'clear';

  const lead = documented[0] ?? strong[0];
  const headline = lead
    ? lead.pattern
      ? `${def.name} treats ${lowerFirst(lead.effectName)}, a known side effect of ${lead.fromName} (started ${lead.since} ago). This matches a documented prescribing cascade (${lead.tier}, score ${lead.score.toFixed(2)}).`
      : `${def.name} treats ${lowerFirst(lead.effectName)}, a common side effect of ${lead.fromName} started ${lead.since} ago. This looks like a prescribing cascade (score ${lead.score.toFixed(2)}).`
    : combosCompleted.length
      ? `Adding ${def.name} completes a dangerous combination: ${combosCompleted.join(', ')}.`
      : conflicts.length
        ? `${def.name} conflicts with ${conflicts[0].drug}: ${conflicts[0].why}`
        : possible.length
          ? possible[0].pattern
            ? `${def.name} could be treating ${lowerFirst(possible[0].effectName)}, a known side effect of ${possible[0].fromName} (a documented cascade, scored possible ${possible[0].score.toFixed(2)}). It is also charted as a diagnosis, so check whether it began after ${possible[0].fromName}.`
            : `${def.name} could be treating a side effect of ${possible[0].fromName} (possible, score ${possible[0].score.toFixed(2)}).`
          : burdenCrossed
            ? `${def.name} raises anticholinergic burden to ${acbAfter}.`
            : def.beers
              ? `${def.name} is on the AGS Beers list: ${def.beers}`
              : treatsSideEffectOf.some((x) => x.deliberate)
                ? `${def.name} looks like a planned companion to ${treatsSideEffectOf.find((x) => x.deliberate)!.fromName} (usually deliberate), not a cascade.`
                : couldCause.some((c) => c.treatedBy.length)
                  ? `No cascade found. Note: ${def.name} can cause ${lowerFirst(couldCause.find((c) => c.treatedBy.length)!.name)}, which another drug is already treating.`
                  : `No cascade, pile-up or combination found for ${def.name}.`;

  return {
    drug: { id: def.id, name: def.name, cls: def.cls, acb: def.acb ?? 0, beers: def.beers ?? null },
    verdict,
    reasons: why,
    headline,
    treatsSideEffectOf,
    couldCause,
    conflicts,
    combosCompleted,
    acbBefore,
    acbAfter,
    alreadyTaking: loaded.meds.some((m) => m.id === drugId) && !replay,
    queries,
  };
}
