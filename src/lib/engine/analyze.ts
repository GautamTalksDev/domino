// The cascade engine. FalkorDB does the graph work (finding links, multi-hop paths,
// loops, pile-ups, combinations, alternative reasons); this module scores and explains it.

import { run, type Tracer } from '../db';
import { Q } from '../cypher';
import { knowledge, matchCombos, type Knowledge } from './knowledge';
import { daysBetweenLabel } from '../../data/time';
import { decisionPayload, verifyPayload } from '../agent/sign';
import type {
  Analysis,
  CascadeTree,
  Chain,
  ComboHit,
  Condition,
  DecisionRecord,
  Factor,
  HarmPath,
  Link,
  Loop,
  Med,
  PatientCore,
  PatternInfo,
  Pileup,
  Tier,
  UntangleResult,
} from './types';

export const THRESHOLDS = { likely: 0.5, possible: 0.25 };
export const HARMS = ['falls', 'fracture', 'kidney_injury'];

const EVIDENCE_FACTOR: Record<PatternInfo['evidence'], number> = { consensus: 1.2, study: 1.15, label: 1.0 };
const EVIDENCE_RANK: Record<PatternInfo['evidence'], number> = { consensus: 3, study: 2, label: 1 };

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export function tierFor(score: number): Tier {
  if (score >= THRESHOLDS.likely) return 'likely';
  if (score >= THRESHOLDS.possible) return 'possible';
  return 'unlikely';
}

const isActive = (t: Tier) => t === 'likely' || t === 'possible';
const inChain = (t: Tier) => t === 'likely' || t === 'possible' || t === 'intentional';

export async function loadPatient(pid: string, tracer?: Tracer): Promise<PatientCore> {
  const rows = await run<Record<string, unknown>>(Q.patient, { pid }, tracer);
  if (!rows.length) throw new NotFoundError(`No patient with id ${pid}`);
  const r = rows[0];
  // An expired check-up is gone, even before the next purge deletes it.
  if (r.sandbox && Number(r.expiresAt) < Date.now()) throw new NotFoundError(`No patient with id ${pid}`);
  const conditions = ((r.conditions as Condition[]) ?? []).filter((c) => c && c.id);
  const meds = ((r.meds as Med[]) ?? [])
    .filter((m) => m && m.id)
    .map((m) => ({ ...m, acb: Number(m.acb ?? 0), indication: m.indication ?? null, beers: m.beers ?? null }))
    .sort((a, b) => a.start - b.start);
  return {
    id: String(r.id),
    name: String(r.name),
    age: Number(r.age),
    sex: r.sex as 'F' | 'M',
    persona: !!r.persona,
    headline: (r.headline as string) ?? null,
    story: (r.story as string) ?? null,
    sandbox: r.sandbox ? { expiresAt: Number(r.expiresAt) } : null,
    conditions,
    meds,
  };
}

export interface RawLink {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  effect: string;
  effectName: string;
  effectPlain: string;
  freq: string;
  weight: number;
  onsetMin: number;
  onsetMax: number;
  line: string;
  fromStart: number;
  toStart: number;
  toIndication: string | null;
  patterns: string[];
}

export interface ScoreOptions {
  useTiming?: boolean;
  useWindow?: boolean;
  useReasons?: boolean;
  usePatterns?: boolean;
  useMemory?: boolean;
}

export function scoreLink(
  raw: RawLink,
  ctx: {
    conditions: Condition[];
    reasons: Map<string, { id: string; name: string; since: number }[]>;
    decisions: DecisionRecord[];
    effectNames: Map<string, string>;
    /** Documented patterns, read from the graph (see knowledge.ts). */
    patterns: Map<string, PatternInfo>;
  },
  opts: ScoreOptions = {},
): Link {
  const o = { useTiming: true, useWindow: true, useReasons: true, usePatterns: true, useMemory: true, ...opts };
  const factors: Factor[] = [];
  const gap = raw.toStart - raw.fromStart;
  const patterns = raw.patterns.map((id) => ctx.patterns.get(id)).filter((p): p is PatternInfo => !!p);
  patterns.sort((a, b) => EVIDENCE_RANK[b.evidence] - EVIDENCE_RANK[a.evidence]);
  const best = patterns[0];
  let tier: Tier | null = null;

  factors.push({
    name: 'cause',
    value: raw.weight,
    note: `${raw.effectName} is ${raw.freq.replace('_', ' ')} with ${raw.fromName}.`,
  });

  // Timing
  let timing = 1;
  if (o.useTiming) {
    if (gap < 0) {
      tier = 'excluded';
      timing = 0;
      factors.push({
        name: 'timing',
        value: 0,
        note: `${raw.toName} started ${daysBetweenLabel(gap)} before ${raw.fromName}, so it cannot be a reaction to it.`,
      });
    } else if (gap === 0) {
      timing = 0.3;
      factors.push({ name: 'timing', value: timing, note: `Both started the same day, which suggests they were planned together.` });
    } else if (!o.useWindow) {
      timing = 1;
      factors.push({ name: 'timing', value: timing, note: `${raw.toName} started ${daysBetweenLabel(gap)} after ${raw.fromName}.` });
    } else if (gap >= raw.onsetMin && gap <= raw.onsetMax) {
      timing = 1;
      factors.push({
        name: 'timing',
        value: timing,
        note: `${raw.toName} started ${daysBetweenLabel(gap)} after ${raw.fromName}, inside the usual window for ${raw.effectName.toLowerCase()} (${raw.onsetMin} to ${raw.onsetMax} days).`,
      });
    } else if (gap < raw.onsetMin) {
      timing = 0.55;
      factors.push({ name: 'timing', value: timing, note: `${raw.toName} started sooner than ${raw.effectName.toLowerCase()} usually appears.` });
    } else if (gap <= raw.onsetMax * 2) {
      timing = 0.6;
      factors.push({ name: 'timing', value: timing, note: `${raw.toName} started ${daysBetweenLabel(gap)} later, a little past the usual window.` });
    } else {
      timing = 0.35;
      factors.push({
        name: 'timing',
        value: timing,
        note: `${raw.toName} started ${daysBetweenLabel(gap)} later, long after ${raw.effectName.toLowerCase()} usually appears.`,
      });
    }
  }

  // Other reasons for the second drug
  let indication = 1;
  let history = 1;
  if (o.useReasons) {
    const has = (id: string) => ctx.conditions.find((c) => c.id === id);
    const others = (ctx.reasons.get(raw.to) ?? []).filter((r) => r.id !== raw.effect && r.since <= raw.toStart + 30);
    const pre = has(raw.effect);
    const preexisting = !!pre && pre.since < raw.fromStart;
    if (preexisting) {
      history = 0.25;
      factors.push({ name: 'history', value: history, note: `${raw.effectName} was diagnosed before ${raw.fromName} started.` });
    }
    if (raw.toIndication && raw.toIndication === raw.effect && preexisting) {
      factors.push({ name: 'indication', value: 1, note: `${raw.toName} is charted for ${raw.effectName.toLowerCase()}, which was already diagnosed.` });
    } else if (raw.toIndication && raw.toIndication === raw.effect) {
      indication = 1.25;
      factors.push({ name: 'indication', value: indication, note: `${raw.toName} was charted for ${raw.effectName.toLowerCase()}.` });
    } else if (raw.toIndication && has(raw.toIndication)) {
      indication = 0.3;
      factors.push({
        name: 'indication',
        value: indication,
        note: `${raw.toName} is charted for ${ctx.effectNames.get(raw.toIndication) ?? raw.toIndication}, a diagnosis on record.`,
      });
    } else if (raw.toIndication) {
      indication = 0.5;
      factors.push({
        name: 'indication',
        value: indication,
        note: `${raw.toName} is charted for ${ctx.effectNames.get(raw.toIndication) ?? raw.toIndication}.`,
      });
    } else if (others.length) {
      indication = 0.5;
      factors.push({
        name: 'indication',
        value: indication,
        note: `${raw.toName} could be for ${others.map((r) => r.name.toLowerCase()).join(' or ')}, on record.`,
      });
    } else {
      factors.push({ name: 'indication', value: 1, note: `No other reason for ${raw.toName} on record.` });
    }
  }

  // Documented pattern
  let pattern = 1;
  if (o.usePatterns) {
    if (best) {
      pattern = EVIDENCE_FACTOR[best.evidence];
      const label = best.evidence === 'consensus' ? 'expert consensus (ThinkCascades)' : best.evidence === 'study' ? 'a published study' : 'product labelling';
      factors.push({ name: 'pattern', value: pattern, note: `Matches a documented cascade backed by ${label}.` });
      if (best.intentional && tier !== 'excluded') tier = 'intentional';
    } else {
      pattern = 0.85;
      factors.push({ name: 'pattern', value: pattern, note: 'Not a documented pattern: inferred from the graph alone.' });
    }
  }

  // Memory: what the care team decided before
  let memory = 1;
  let confirmed = false;
  let decision: DecisionRecord | undefined;
  if (o.useMemory) {
    // The latest verified decision on this link wins: a clinician can change their mind, and the newest word stands.
    decision = ctx.decisions
      .filter((d) => d.from === raw.from && d.to === raw.to && d.verified)
      .sort((x, y) => (Number(y.at) || 0) - (Number(x.at) || 0) || (y.day ?? 0) - (x.day ?? 0))[0];
    if (decision) {
      if (decision.verdict === 'confirmed') {
        memory = 1.3;
        // A clinician's confirmation outranks a "usually deliberate" pattern: the link is scored as a cascade again.
        if (tier === 'intentional') tier = null;
        confirmed = true;
        factors.push({ name: 'memory', value: memory, note: `Confirmed as a cascade by ${decision.by}.` });
      } else if (decision.verdict === 'intentional') {
        if (tier !== 'excluded') tier = 'intentional';
        factors.push({ name: 'memory', value: 1, note: `Marked intentional by ${decision.by}: “${decision.reason}”` });
      } else {
        if (tier !== 'excluded') tier = 'dismissed';
        factors.push({ name: 'memory', value: 1, note: `Marked not a cascade by ${decision.by}: “${decision.reason}”` });
      }
    }
  }

  const score = Math.min(0.99, Math.round(raw.weight * timing * indication * history * pattern * memory * 1000) / 1000);
  // A confirmed link is never shown below "possible": the care team has said it is a cascade.
  const scored = tierFor(score);
  const finalTier: Tier = tier ?? (confirmed && scored === 'unlikely' ? 'possible' : scored);

  return {
    key: `${raw.from}>${raw.to}`,
    from: raw.from,
    fromName: raw.fromName,
    to: raw.to,
    toName: raw.toName,
    effect: raw.effect,
    effectName: raw.effectName,
    effectPlain: raw.effectPlain,
    freq: raw.freq,
    weight: raw.weight,
    onsetMin: raw.onsetMin,
    onsetMax: raw.onsetMax,
    fromStart: raw.fromStart,
    toStart: raw.toStart,
    gap,
    toIndication: raw.toIndication,
    patterns,
    factors,
    score: finalTier === 'excluded' ? 0 : score,
    tier: finalTier,
    headline: `${raw.fromName} → ${raw.effectPlain.toLowerCase()} → ${raw.toName}`,
    decision,
  };
}

/** Keep the strongest link per drug pair (a pair can connect through several effects). */
function bestPerPair(links: Link[]): Map<string, Link> {
  const rank: Record<Tier, number> = { likely: 5, possible: 4, intentional: 3, dismissed: 2, unlikely: 1, excluded: 0 };
  const best = new Map<string, Link>();
  for (const l of links) {
    const cur = best.get(l.key);
    if (!cur || rank[l.tier] > rank[cur.tier] || (rank[l.tier] === rank[cur.tier] && l.score > cur.score)) best.set(l.key, l);
  }
  return best;
}

function chainScore(links: Link[]): number {
  const active = links.filter((l) => isActive(l.tier));
  if (!active.length) return 0;
  const gm = Math.exp(active.reduce((s, l) => s + Math.log(Math.max(l.score, 0.01)), 0) / active.length);
  return Math.round(gm * Math.pow(0.97, links.length - 1) * 1000) / 1000;
}

function buildChains(paths: string[][][], pairBest: Map<string, Link>): Chain[] {
  const seen = new Map<string, Chain>();
  for (const hops of paths) {
    let seq: Link[] = [];
    for (let i = 0; i + 1 < hops.length; i += 2) {
      const [a] = hops[i];
      const [, , b] = hops[i + 1];
      // Use the strongest explanation for each drug pair, so a chain never shows a weaker link than the evidence panel.
      const link = pairBest.get(`${a}>${b}`);
      if (!link || !inChain(link.tier)) break;
      const drugs = new Set([seq[0]?.from, ...seq.map((l) => l.to)].filter(Boolean));
      if (drugs.has(link.to)) break;
      seq.push(link);
    }
    // A chain starts at its first active link: a deliberate pair (stomach protection, say) is not where a cascade begins.
    // Deliberate links later in the chain are kept, because they show what else would go if the root were reviewed.
    const firstActive = seq.findIndex((l) => isActive(l.tier));
    if (firstActive < 0) continue;
    seq = seq.slice(firstActive);
    const drugs = [seq[0].from, ...seq.map((l) => l.to)];
    const id = drugs.join('>');
    if (!seen.has(id)) {
      const score = chainScore(seq);
      seen.set(id, { id, root: seq[0].from, drugs, links: seq, score, tier: tierFor(score) });
    }
  }
  const chains = [...seen.values()];
  // Drop a chain only when a longer chain from the same root contains it. A sub-chain with a different root is kept,
  // because its root may be the real start of a cascade that a weaker link happens to feed.
  return chains
    .filter((c) => !chains.some((o) => o !== c && o.root === c.root && o.drugs.length > c.drugs.length && `>${o.id}>`.startsWith(`>${c.id}>`)))
    .sort((a, b) => b.score - a.score || b.drugs.length - a.drugs.length);
}

function buildLoops(paths: string[][][], linkByTriple: Map<string, Link>, names: Map<string, string>): Loop[] {
  const out = new Map<string, Loop>();
  for (const hops of paths) {
    const steps: Loop['steps'] = [];
    let ok = true;
    for (let i = 0; i + 1 < hops.length; i += 2) {
      const [a, , e] = hops[i];
      const [, , b] = hops[i + 1];
      const link = linkByTriple.get(`${a}|${e}|${b}`);
      if (!link || link.weight < 0.7 || link.tier === 'dismissed') {
        ok = false;
        break;
      }
      steps.push({ from: a, fromName: names.get(a) ?? a, effect: e, effectName: link.effectName, to: b, toName: names.get(b) ?? b });
    }
    if (!ok || steps.length < 2) continue;
    const drugs = steps.map((s) => s.from);
    const id = [...drugs].sort().join('+');
    if (!out.has(id)) out.set(id, { id, drugs, steps });
  }
  return [...out.values()];
}

export function untangle(
  removed: string,
  meds: Med[],
  links: Link[],
  independent: Set<string>,
  fallDrugs: Set<string>,
  k: Pick<Knowledge, 'combos' | 'tapers'>,
  treeLinks: Link[] = [],
): UntangleResult {
  // A drug stays justified if it has its own diagnosis, has no cascade link into it,
  // or is reached by a strong (likely or intentional) link from a justified drug.
  // Links inside the tree being untangled always count, so the simulation matches the tree.
  const treeKeys = new Set(treeLinks.map((l) => l.key));
  const strong = links.filter((l) => l.tier === 'likely' || l.tier === 'intentional' || treeKeys.has(l.key));
  const incoming = new Map<string, Link[]>();
  for (const l of strong) {
    if (!incoming.has(l.to)) incoming.set(l.to, []);
    incoming.get(l.to)!.push(l);
  }
  const justified = new Set<string>();
  for (const m of meds) {
    if (m.id === removed) continue;
    if (!incoming.has(m.id) || independent.has(m.id)) justified.add(m.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of meds) {
      if (m.id === removed || justified.has(m.id)) continue;
      if ((incoming.get(m.id) ?? []).some((l) => justified.has(l.from))) {
        justified.add(m.id);
        changed = true;
      }
    }
  }
  const unnecessary = meds
    .filter((m) => m.id !== removed && !justified.has(m.id))
    .map((m) => {
      const via = (incoming.get(m.id) ?? []).sort((a, b) => b.score - a.score)[0];
      return {
        id: m.id,
        name: m.name,
        via: via ? `${via.fromName} → ${via.effectPlain.toLowerCase()}` : '',
        planned: via?.tier === 'intentional',
        taper: k.tapers.get(m.cls) ?? null,
      };
    });
  const unneeded = new Set(unnecessary.map((u) => u.id));
  const alsoContributing = links
    .filter((l) => l.tier === 'possible' && unneeded.has(l.to) && justified.has(l.from))
    .map((l) => ({ from: l.from, fromName: l.fromName, to: l.to, toName: l.toName, effect: l.effectPlain.toLowerCase(), score: l.score }));
  const gone = new Set([removed, ...unneeded]);
  const remaining = meds.filter((m) => !gone.has(m.id));
  const acb = (list: Med[]) => list.reduce((s, m) => s + (m.acb || 0), 0);
  const combosBefore = matchCombos(meds, k.combos);
  const combosAfter = new Set(matchCombos(remaining, k.combos).map((c) => c.id));
  const root = meds.find((m) => m.id === removed);
  return {
    removed,
    removedName: root?.name ?? removed,
    rootTaper: root ? (k.tapers.get(root.cls) ?? null) : null,
    unnecessary,
    pillsBefore: meds.length,
    pillsAfter: remaining.length,
    acbBefore: acb(meds),
    acbAfter: acb(remaining),
    fallDrugsBefore: meds.filter((m) => fallDrugs.has(m.id)).length,
    fallDrugsAfter: remaining.filter((m) => fallDrugs.has(m.id)).length,
    combosResolved: combosBefore.filter((c) => !combosAfter.has(c.id)).map((c) => c.title),
    alsoContributing,
  };
}

export async function analyzePatient(pid: string, opts: { tracer?: Tracer; score?: ScoreOptions } = {}): Promise<Analysis> {
  const t0 = performance.now();
  const queries: Analysis['queries'] = [];
  const tracer: Tracer = (t) => {
    queries.push({ id: t.id, title: t.title, ms: t.ms, rows: t.rows });
    opts.tracer?.(t);
  };

  const [patient, k] = await Promise.all([loadPatient(pid, tracer), knowledge(tracer)]);
  const [rawLinks, pathRows, loopRows, reasonRows, pileRows, harmRows, comboRows, burdenRows, memRows] = await Promise.all([
    run<RawLink & Record<string, unknown>>(Q.links, { pid }, tracer),
    run<{ hops: string[][] }>(Q.paths, { pid }, tracer),
    run<{ hops: string[][] }>(Q.loops, { pid }, tracer),
    run<{ drug: string; reasons: { id: string; name: string; since: number }[] }>(Q.reasons, { pid }, tracer),
    run<Pileup & Record<string, unknown>>(Q.pileups, { pid }, tracer),
    run<{ harm: string; harmName: string; drug: string; drugName: string; via: string[] }>(Q.harms, { pid, harms: HARMS }, tracer),
    run<{ id: string; title: string; why: string; refs: string[]; harm: string; groups: { grp: number; drugs: string[] }[] }>(Q.combos, { pid }, tracer),
    run<{ id: string; name: string; acb: number; beers: string | null }>(Q.burden, { pid }, tracer),
    run<{ decisions: Omit<DecisionRecord, 'verified'>[] & { sig?: string }[]; runs: unknown[] }>(Q.memory, { pid }, tracer),
  ]);

  // Memory, verified
  const memoryWarnings: string[] = [];
  const decisions: DecisionRecord[] = ((memRows[0]?.decisions ?? []) as (DecisionRecord & { sig?: string })[])
    .filter((d) => d && d.id)
    .map((d) => {
      const verified = verifyPayload(decisionPayload({ ...d, patientId: pid }), d.sig);
      if (!verified) memoryWarnings.push(`A decision record (${d.id}) failed its signature check and was ignored.`);
      const { sig: _sig, ...rest } = d;
      return { ...rest, verified };
    });

  const reasons = new Map(reasonRows.map((r) => [r.drug, r.reasons.filter((x) => x && x.id)]));
  const effectNames = new Map<string, string>();
  for (const c of patient.conditions) effectNames.set(c.id, c.name.toLowerCase());
  for (const l of rawLinks) effectNames.set(String(l.effect), String(l.effectName).toLowerCase());

  const allLinks = rawLinks.map((r) =>
    scoreLink(
      { ...r, weight: Number(r.weight), onsetMin: Number(r.onsetMin), onsetMax: Number(r.onsetMax), patterns: (r.patterns ?? []) as string[] },
      { conditions: patient.conditions, reasons, decisions, effectNames, patterns: k.patterns },
      opts.score,
    ),
  );
  const linkByTriple = new Map(allLinks.map((l) => [`${l.from}|${l.effect}|${l.to}`, l]));
  const pairBest = bestPerPair(allLinks);
  const links = [...pairBest.values()].sort((a, b) => b.score - a.score);

  const names = new Map(patient.meds.map((m) => [m.id, m.name]));
  const allChains = buildChains(
    pathRows.map((r) => r.hops),
    pairBest,
  );
  const loops = buildLoops(
    loopRows.map((r) => r.hops),
    linkByTriple,
    names,
  );

  // Harms
  const harmMap = new Map<string, HarmPath>();
  for (const h of harmRows) {
    if (!harmMap.has(h.harm)) harmMap.set(h.harm, { harm: h.harm, harmName: h.harmName, drugs: [] });
    harmMap.get(h.harm)!.drugs.push({ id: h.drug, name: h.drugName, via: h.via });
  }
  const harms = [...harmMap.values()].sort((a, b) => b.drugs.length - a.drugs.length);
  const fallDrugs = new Set(harmMap.get('falls')?.drugs.map((d) => d.id) ?? []);

  const combos: ComboHit[] = comboRows.map((c) => ({
    id: c.id,
    title: c.title,
    why: c.why,
    harm: c.harm,
    refs: c.refs,
    drugs: c.groups.sort((a, b) => a.grp - b.grp).flatMap((g) => g.drugs),
  }));

  // Independent reasons: a diagnosis on record that the drug treats, and that is either not a side effect
  // of another of the patient's drugs, or was already on record before the drug that could have caused it.
  const independent = new Set<string>();
  for (const m of patient.meds) {
    const r = reasons.get(m.id) ?? [];
    const incoming = allLinks.filter((l) => l.to === m.id && inChain(l.tier));
    const isIndependent = r.some((x) => {
      const causes = incoming.filter((l) => l.effect === x.id);
      if (!causes.length) return true;
      return causes.every((l) => x.since < l.fromStart);
    });
    if (isIndependent) independent.add(m.id);
  }

  // Trees: one per root drug. A root is a drug with an active outgoing link and no likely link into it.
  const activeLinks = links.filter((l) => inChain(l.tier));
  const likelyIncoming = new Set(links.filter((l) => l.tier === 'likely').map((l) => l.to));
  const roots = [...new Set(links.filter((l) => isActive(l.tier)).map((l) => l.from))].filter(
    (r) => !likelyIncoming.has(r) && allChains.some((c) => c.root === r),
  );
  // Sub-chains are kept only when they start at a root; the rest are already shown inside a longer chain.
  const chains = allChains.filter(
    (c) => roots.includes(c.root) || !allChains.some((o) => o.drugs.length > c.drugs.length && `>${o.id}>`.includes(`>${c.id}>`)),
  );
  const built: CascadeTree[] = roots.map((root) => {
    const rootChains = chains.filter((c) => c.root === root);
    const downstream = [...new Set(rootChains.flatMap((c) => c.drugs.slice(1)))];
    const score = Math.max(...rootChains.map((c) => c.score));
    return {
      root,
      rootName: names.get(root) ?? k.drugs.get(root)?.name ?? root,
      chains: rootChains,
      downstream,
      score,
      tier: tierFor(score),
      untangle: untangle(
        root,
        patient.meds,
        activeLinks,
        independent,
        fallDrugs,
        k,
        rootChains.flatMap((c) => c.links),
      ),
      contributors: [],
    };
  });
  // A root whose first links are all only "possible", and that feeds a stronger tree, is shown as a contributor.
  const trees: CascadeTree[] = [];
  const ordered = built.sort((a, b) => b.untangle.unnecessary.length - a.untangle.unnecessary.length || b.score - a.score);
  for (const t of ordered) {
    const first = links.filter((l) => l.from === t.root && isActive(l.tier));
    const host = trees.find((h) => first.every((l) => h.downstream.includes(l.to) || h.root === l.to));
    if (host && !first.some((l) => l.tier === 'likely')) {
      for (const l of first)
        host.contributors.push({ root: t.root, rootName: t.rootName, to: l.to, toName: l.toName, effect: l.effectPlain.toLowerCase(), score: l.score });
      continue;
    }
    trees.push(t);
  }

  const acbDrugs = burdenRows.filter((b) => Number(b.acb) > 0).map((b) => ({ id: b.id, name: b.name, acb: Number(b.acb) }));
  const beers = burdenRows.filter((b) => b.beers).map((b) => ({ id: b.id, name: b.name, note: String(b.beers) }));

  const likely = links.filter((l) => l.tier === 'likely').length;
  const possible = links.filter((l) => l.tier === 'possible').length;

  return {
    patient,
    links,
    chains,
    trees,
    loops,
    pileups: pileRows.map((p) => ({ id: p.id, name: p.name, plain: p.plain, kind: p.kind, drugs: p.drugs })),
    harms,
    combos,
    acb: { total: acbDrugs.reduce((s, d) => s + d.acb, 0), drugs: acbDrugs },
    beers,
    decisions,
    memoryWarnings,
    summary: {
      likely,
      possible,
      intentional: links.filter((l) => l.tier === 'intentional').length,
      topScore: links.filter((l) => isActive(l.tier)).reduce((m, l) => Math.max(m, l.score), 0),
      ...mainLink(trees, links),
      avoidable: trees.reduce((m, t) => Math.max(m, t.untangle.unnecessary.length), 0),
      medCount: patient.meds.length,
    },
    queries,
    ms: Math.round(performance.now() - t0),
  };
}

/** Where the main cascade starts: the first link of the tree that would untangle the most, else the strongest active link. */
function mainLink(trees: CascadeTree[], links: Link[]): { topLink: string | null; topLinkScore: number | null } {
  const first = trees[0]?.chains[0]?.links[0] ?? links.filter((l) => isActive(l.tier)).sort((x, y) => y.score - x.score)[0];
  return first ? { topLink: `${first.fromName} → ${first.toName}`, topLinkScore: first.score } : { topLink: null, topLinkScore: null };
}
