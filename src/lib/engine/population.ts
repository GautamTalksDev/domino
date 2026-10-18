// Population tools: the sweep (run the engine on every patient and write findings back
// into the graph), prescription sequence symmetry analysis (PSSA) and summaries.

import { run, type Tracer } from '../db';
import { Q } from '../cypher';
import { TODAY_DAY, daysBetweenLabel } from '../../data/time';
import { analyzePatient } from './analyze';
import { randomUUID } from 'node:crypto';
import { proposeTask } from '../agent/actions';
import { withLease } from '../lock';
import { PATTERN } from '../../data/knowledge';

export interface SweepResult {
  patients: number;
  withLikely: number;
  findings: number;
  tasks: number;
  ms: number;
}

const SWEEP_TASK_LIMIT = 8;

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx], idx);
      }
    }),
  );
}

/** One sweep per clinic at a time (a person pressing the button and the nightly cron share one lease). */
export async function sweepPopulation(
  onProgress?: (done: number, total: number) => void,
  tracer?: Tracer,
  opts: { proposeTasks?: boolean } = {},
): Promise<SweepResult> {
  return withLease('sweep', () => sweepLocked(onProgress, tracer, opts), 'A population sweep is already running for this clinic.');
}

async function sweepLocked(
  onProgress: ((done: number, total: number) => void) | undefined,
  tracer: Tracer | undefined,
  opts: { proposeTasks?: boolean },
): Promise<SweepResult> {
  const t0 = Date.now();
  const list = await run<{ id: string }>(Q.patientList, {}, tracer);
  const patientRows: Record<string, unknown>[] = [];
  const findingRows: Record<string, unknown>[] = [];
  const candidates: {
    pid: string;
    name: string;
    score: number;
    title: string;
    body: string;
    key: string;
    pattern: string | null;
    tier: 'likely' | 'possible';
    owner: string | null;
  }[] = [];
  let done = 0;
  await pool(list, 8, async (p) => {
    const a = await analyzePatient(p.id);
    const cls = new Map(a.patient.meds.map((m) => [m.id, m.clsName]));
    patientRows.push({
      pid: p.id,
      likely: a.summary.likely,
      possible: a.summary.possible,
      acb: a.acb.total,
      top: a.summary.topScore,
      topLink: a.summary.topLink,
      topLinkScore: a.summary.topLinkScore,
      avoidable: a.summary.avoidable,
      meds: a.summary.medCount,
    });
    // Candidate for the inbox: the strongest likely tree on a non-demo patient.
    const tree = a.trees[0];
    const first = tree?.chains[0]?.links[0];
    if (!a.patient.persona && tree && tree.tier === 'likely' && first) {
      const pat = first.patterns[0] ? PATTERN[first.patterns[0].id] : undefined;
      candidates.push({
        pid: p.id,
        name: a.patient.name,
        score: tree.score + tree.untangle.unnecessary.length / 10 + (pat && pat.evidence !== 'label' ? 0.2 : 0),
        key: first.key,
        pattern: first.patterns[0]?.id ?? null,
        tier: 'likely',
        owner: a.patient.meds.find((m) => m.id === first.from)?.prescriber ?? null,
        title: `Could ${first.effectPlain.toLowerCase()} be from ${tree.rootName}?`.slice(0, 118),
        body: `${first.toName} started ${first.gap < 7 ? 'within a week of' : `${daysBetweenLabel(first.gap)} after`} ${tree.rootName}${first.toIndication === first.effect ? `, charted for ${first.effectPlain.toLowerCase()}` : ''}. ${pat ? `${pat.title} is a documented cascade. ` : ''}${pat?.question ?? ''} If ${tree.rootName} were reviewed, ${tree.untangle.unnecessary.length} downstream medicine${tree.untangle.unnecessary.length === 1 ? '' : 's'} might not be needed (${tree.untangle.pillsBefore} → ${tree.untangle.pillsAfter}).`.slice(
          0,
          880,
        ),
      });
    }
    for (const l of a.links) {
      if (l.tier !== 'likely' && l.tier !== 'possible') continue;
      const best = l.patterns[0];
      findingRows.push({
        id: `f-${p.id}-${l.from}-${l.to}`,
        key: `${p.id}:${l.key}`,
        pid: p.id,
        from: l.from,
        to: l.to,
        effect: l.effect,
        label: best ? best.title : `${cls.get(l.from) ?? l.fromName} → ${l.effectPlain.toLowerCase()} → ${cls.get(l.to) ?? l.toName}`,
        chain: `${l.fromName} → ${l.toName}`,
        score: l.score,
        tier: l.tier,
        pattern: best?.id ?? null,
        evidence: best?.evidence ?? 'graph',
      });
    }
    onProgress?.(++done, list.length);
  });
  const at = Date.now();
  await run(Q.sweepClear, {}, tracer);
  for (let i = 0; i < patientRows.length; i += 300) await run(Q.sweepPatients, { rows: patientRows.slice(i, i + 300), at }, tracer);
  for (let i = 0; i < findingRows.length; i += 300) await run(Q.sweepFindings, { rows: findingRows.slice(i, i + 300), at }, tracer);

  // Act on what the sweep found: put the strongest documented cascades in the pharmacist's inbox.
  let tasks = 0;
  if (opts.proposeTasks) {
    const busy = new Set((await run<{ ids: string[] }>(Q.openTaskPatients, {}, tracer))[0]?.ids ?? []);
    const pick = candidates
      .filter((c) => !busy.has(c.pid))
      .sort((x, y) => y.score - x.score)
      .slice(0, SWEEP_TASK_LIMIT);
    if (pick.length) {
      const runId = `r-${randomUUID()}`;
      await run(Q.sweepRun, { id: runId, at, mode: 'sweep', model: 'population sweep', trigger: 'sweep' }, tracer);
      for (const c of pick) {
        // Same write path as the Scribe: learned procedures decide who gets it and how soon.
        const res = await proposeTask({
          pid: c.pid,
          runId,
          title: c.title,
          body: c.body,
          role: 'pharmacist',
          link: c.key,
          pattern: c.pattern,
          tier: c.tier,
          owner: c.owner,
          at,
          tracer,
        });
        if (res.proposed) tasks++;
      }
    }
  }
  return {
    patients: list.length,
    withLikely: patientRows.filter((r) => Number(r.likely) > 0).length,
    findings: findingRows.length,
    tasks,
    ms: Date.now() - t0,
  };
}

export interface PssaSignal {
  a: string;
  aName: string;
  b: string;
  bName: string;
  fwd: number;
  rev: number;
  sr: number;
  sr0: number;
  asr: number;
  lo: number;
  hi: number;
  via: string[];
  signal: boolean;
}

function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

const odds = (p: number) => (p >= 1 ? 99 : p / (1 - p));

export async function pssa(opts: { window?: number; minPairs?: number; tracer?: Tracer } = {}): Promise<PssaSignal[]> {
  const window = opts.window ?? 365;
  const minPairs = opts.minPairs ?? 8;
  const [pairs, starts] = await Promise.all([
    run<{ a: string; aName: string; b: string; bName: string; fwd: number; rev: number; via: string[] }>(
      Q.pssaPairs,
      { from: 0, window, minPairs },
      opts.tracer,
    ),
    run<{ cls: string; starts: number[] }>(Q.classStarts, { from: 0 }, opts.tracer),
  ]);

  // Prefix sums of marker initiations per day, for the null-effect ratio (Hallas / Tsiropoulos).
  const prefix = new Map<string, Int32Array>();
  const indexDays = new Map<string, number[]>();
  for (const s of starts) {
    const arr = new Int32Array(TODAY_DAY + 2);
    for (const d of s.starts) if (d >= 0 && d <= TODAY_DAY) arr[d + 1]++;
    for (let i = 1; i < arr.length; i++) arr[i] += arr[i - 1];
    prefix.set(s.cls, arr);
    indexDays.set(
      s.cls,
      s.starts.filter((d) => d >= 0 && d <= TODAY_DAY),
    );
  }
  const count = (arr: Int32Array, lo: number, hi: number) => {
    const a = Math.max(0, Math.min(TODAY_DAY + 1, lo));
    const b = Math.max(0, Math.min(TODAY_DAY + 1, hi));
    return b > a ? arr[b] - arr[a] : 0;
  };

  const out: PssaSignal[] = [];
  for (const p of pairs) {
    const fwd = Number(p.fwd);
    const rev = Number(p.rev);
    const markers = prefix.get(p.b);
    const idx = indexDays.get(p.a) ?? [];
    let after = 0;
    let before = 0;
    if (markers) {
      for (const d of idx) {
        after += count(markers, d + 1, d + window + 1); // (d, d+W]
        before += count(markers, d - window, d); // [d-W, d)
      }
    }
    const sr0 = before > 0 && after > 0 ? after / before : 1;
    const sr = (fwd + 0.5) / (rev + 0.5);
    const [plo, phi] = wilson(fwd, fwd + rev);
    const asr = sr / sr0;
    const lo = odds(plo) / sr0;
    const hi = odds(phi) / sr0;
    out.push({
      a: p.a,
      aName: p.aName,
      b: p.b,
      bName: p.bName,
      fwd,
      rev,
      sr: round(sr),
      sr0: round(sr0),
      asr: round(asr),
      lo: round(lo),
      hi: round(Math.min(hi, 99)),
      via: (p.via ?? []).filter(Boolean),
      signal: lo > 1,
    });
  }
  return out.sort((x, y) => Number(y.signal) - Number(x.signal) || y.lo - x.lo);
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function populationSummary(tracer?: Tracer) {
  const [bands, patterns, roots] = await Promise.all([
    run<{ band: string; patients: number; withLikely: number; avgAcb: number | null; avgMeds: number | null }>(Q.populationSummary, {}, tracer),
    run<{ label: string; pattern: string | null; evidence: string; patients: number; avgScore: number }>(Q.findingsByPattern, {}, tracer),
    run<{ id: string; name: string; findings: number }>(Q.rootDrugs, { min: 0.5 }, tracer),
  ]);
  const totals = bands.reduce((s, b) => ({ patients: s.patients + Number(b.patients), withLikely: s.withLikely + Number(b.withLikely) }), {
    patients: 0,
    withLikely: 0,
  });
  return { bands, patterns, roots, totals };
}
