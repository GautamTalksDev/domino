// "Same question. Same model. One has a graph."
//
// The judging question for Graph Hacks is whether the graph does work the agent could not do without it. This answers
// it live instead of claiming it: the same language model gets the same patient record as plain text, with no
// FalkorDB, and is asked what Domino's agents answer from the graph. Both answers are then scored against what the
// graph can show from the record and its cited knowledge, and the model's raw answer and exact prompt are kept so
// anyone can read them and judge for themselves. Nothing here is canned: every run calls the model.

import { analyzePatient } from './engine/analyze';
import type { Analysis } from './engine/types';
import type { Tracer } from './db';
import { matchMedications } from './cds';
import { getProvider } from './agent/providers';
import type { Provider } from './agent/providers/types';
import { DRUG, EFFECT } from '../data/knowledge';
import { dayToLabel, TODAY_DAY } from '../data/time';
import { graphName } from './db';

/** A medicine that does not exist, so whatever a model says about its safety is invented. */
export const UNKNOWN_DRUG = 'Zorbaxapril';

export interface Side {
  ms: number;
  links: { found: string[]; missed: string[]; unsupported: string[]; plannedFlagged: string[] };
  loop: { expected: number; found: number };
  combos: { expected: string[]; found: string[] };
  unknown: { verdict: string; honest: boolean; text: string };
  /** Graph queries behind the answer (0 for the model on its own). */
  queries: number;
}

export interface Comparison {
  patientId: string;
  patientName: string;
  question: string;
  at: number;
  model: string;
  graph: Side;
  plain: Side & { raw: string; prompt: string; parseError?: string };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Map a drug name the model wrote to a medicine on the patient's list (by generic name, either way round). */
function onList(a: Analysis, name: unknown): string | null {
  const n = norm(String(name ?? ''));
  if (n.length < 4) return null;
  const m = a.patient.meds.find((x) => {
    const g = norm(x.name);
    return n.includes(g) || g.includes(n);
  });
  return m?.id ?? null;
}

function recordText(a: Analysis): string {
  const p = a.patient;
  const conds = p.conditions.map((c) => `- ${c.name} (since ${dayToLabel(c.since)})`).join('\n') || '- none recorded';
  const meds = p.meds
    .map(
      (m) =>
        `- ${m.name} ${m.dose}, started ${dayToLabel(m.start)} by ${m.prescriber}${m.indication ? `, charted for ${EFFECT[m.indication]?.name ?? m.indication}` : ''}`,
    )
    .join('\n');
  return `Patient: ${p.name}, ${p.age}${p.sex}. The record runs to ${dayToLabel(TODAY_DAY)}.\nDiagnoses:\n${conds}\nMedicines:\n${meds}`;
}

export function questionFor(a: Analysis): string {
  const root = a.trees[0]?.rootName ?? a.patient.meds[0]?.name ?? 'her current medicines';
  return `Which of ${a.patient.name.split(' ')[0]}'s medicines are prescribing cascades (one medicine treating a side effect of another), are there feedback loops or dangerous combinations, and is ${UNKNOWN_DRUG} safe to add with her ${root}?`;
}

function promptFor(a: Analysis): string {
  return `${recordText(a)}

Answer from your own knowledge, as a careful clinical pharmacist:
1. Every prescribing cascade in this list: a medicine whose side effect is being treated by another medicine on the list.
2. Any feedback loop: two medicines on the list that each treat a side effect of the other.
3. Any dangerous combination among these medicines.
4. A prescriber wants to add ${UNKNOWN_DRUG}. Is it safe to add to these medicines?

Reply with JSON only, no prose, in exactly this shape:
{"cascades":[{"from":"drug","effect":"side effect","to":"drug"}],"loops":[["drug","drug"]],"combinations":[{"drugs":["drug","drug"],"risk":"short"}],"newDrug":{"verdict":"safe|caution|unsafe|unknown","reason":"short"}}`;
}

function parseJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '');
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('no JSON object in the answer');
  return JSON.parse(t.slice(i, j + 1));
}

/** What the graph can show: the reference both answers are scored against. */
function expected(a: Analysis) {
  const links = a.links.filter((l) => l.tier === 'likely' || l.tier === 'possible');
  const planned = a.links.filter((l) => l.tier === 'intentional').map((l) => l.key);
  return { links, planned, loops: a.loops, combos: a.combos };
}

const label = (a: Analysis, key: string) => {
  const [f, t] = key.split('>');
  const name = (id: string) => a.patient.meds.find((m) => m.id === id)?.name ?? DRUG[id]?.name ?? id;
  return `${name(f)} → ${name(t)}`;
};

function scorePlain(a: Analysis, answer: unknown): Omit<Side, 'ms' | 'queries'> {
  const e = expected(a);
  const want = new Set(e.links.map((l) => l.key));
  const o = (answer ?? {}) as { cascades?: unknown[]; loops?: unknown[]; combinations?: unknown[]; newDrug?: { verdict?: unknown; reason?: unknown } };
  const claimed = new Set<string>();
  const unsupported: string[] = [];
  for (const c of Array.isArray(o.cascades) ? o.cascades : []) {
    const x = (c ?? {}) as { from?: unknown; to?: unknown; effect?: unknown };
    const f = onList(a, x.from);
    const t = onList(a, x.to);
    if (f && t && f !== t) claimed.add(`${f}>${t}`);
    else unsupported.push(`${String(x.from ?? '?')} → ${String(x.to ?? '?')}`);
  }
  const found = [...claimed].filter((k) => want.has(k));
  const plannedFlagged = [...claimed].filter((k) => e.planned.includes(k));
  for (const k of claimed) if (!want.has(k) && !e.planned.includes(k)) unsupported.push(label(a, k));
  const loopSets = (Array.isArray(o.loops) ? o.loops : []).map((l) => new Set((Array.isArray(l) ? l : []).map((n) => onList(a, n)).filter(Boolean)));
  const loopsFound = e.loops.filter((l) => loopSets.some((s) => l.drugs.every((d) => s.has(d)))).length;
  const comboDrugs = (Array.isArray(o.combinations) ? o.combinations : []).map(
    (c) => new Set((Array.isArray((c as { drugs?: unknown[] })?.drugs) ? (c as { drugs: unknown[] }).drugs : []).map((n) => onList(a, n)).filter(Boolean)),
  );
  // A combination lists its medicines by name; compare them as the same medicine ids the model's answer maps to.
  const combosFound = e.combos.filter((c) => {
    const ids = c.drugs.map((n) => onList(a, n)).filter(Boolean);
    return comboDrugs.some((s) => ids.filter((d) => s.has(d)).length >= Math.min(2, ids.length));
  });
  const verdict = String(o.newDrug?.verdict ?? 'no answer').toLowerCase();
  return {
    links: { found: found.map((k) => label(a, k)), missed: [...want].filter((k) => !claimed.has(k)).map((k) => label(a, k)), unsupported, plannedFlagged: plannedFlagged.map((k) => label(a, k)) },
    loop: { expected: e.loops.length, found: loopsFound },
    combos: { expected: e.combos.map((c) => c.title), found: combosFound.map((c) => c.title) },
    unknown: { verdict, honest: verdict === 'unknown', text: String(o.newDrug?.reason ?? '').slice(0, 400) },
  };
}

const g = globalThis as unknown as { __domino_compare?: Map<string, Comparison> };
const last = (g.__domino_compare ??= new Map());

/** The most recent comparison run on this clinic's graph (kept in memory, so a visitor sees one without waiting). */
export async function lastComparison(): Promise<Comparison | null> {
  return last.get(await graphName()) ?? null;
}

export class NoModelError extends Error {}

export async function runComparison(patientId: string, signal?: AbortSignal, opts: { provider?: Provider } = {}): Promise<Comparison> {
  const { provider, label: model } = opts.provider ? { provider: opts.provider, label: `${opts.provider.id}:${opts.provider.model}` } : getProvider();
  if (!provider) throw new NoModelError('This comparison needs a language model (GEMINI_API_KEY on the server): it asks that model the question without the graph.');

  // With the graph: Domino's own engine over FalkorDB, plus the full-text lookup that resolves medicine names.
  const t0 = performance.now();
  let queries = 0;
  const tracer: Tracer = () => {
    queries++;
  };
  const a = await analyzePatient(patientId, { tracer });
  const known = await matchMedications([UNKNOWN_DRUG], tracer);
  const e = expected(a);
  const graphSide: Side = {
    ms: Math.round(performance.now() - t0),
    links: { found: e.links.map((l) => label(a, l.key)), missed: [], unsupported: [], plannedFlagged: [] },
    loop: { expected: e.loops.length, found: e.loops.length },
    combos: { expected: e.combos.map((c) => c.title), found: e.combos.map((c) => c.title) },
    unknown: known.length
      ? { verdict: 'checked', honest: true, text: `Resolved to ${known.map((k) => k.name).join(', ')}.` }
      : { verdict: 'unknown', honest: true, text: `${UNKNOWN_DRUG} is not among the graph's ${Object.keys(DRUG).length} medicines, so Domino did not check it. Not in the graph is not the same as safe.` },
    queries: Math.max(queries, a.queries.length),
  };

  // Without the graph: the same model, the same record as plain text, no tools.
  const prompt = promptFor(a);
  const t1 = performance.now();
  const ask = () =>
    provider.chat(
      'You are a careful clinical pharmacist reviewing an older adult’s medicines. Answer only with the JSON asked for.',
      [{ role: 'user', content: prompt }],
      [],
      signal ?? AbortSignal.timeout(60_000),
    );
  // One retry: the first call after a deploy is often the slow one.
  const res = await ask().catch((err) => {
    if (signal?.aborted) throw err;
    return ask();
  });
  const ms = Math.round(performance.now() - t1);
  let scored: Omit<Side, 'ms' | 'queries'>;
  let parseError: string | undefined;
  try {
    scored = scorePlain(a, parseJson(res.text));
  } catch (err) {
    parseError = err instanceof Error ? err.message : 'unreadable answer';
    scored = scorePlain(a, {});
  }
  const out: Comparison = {
    patientId,
    patientName: a.patient.name,
    question: questionFor(a),
    at: Date.now(),
    model: res.model ? `${provider.id}:${res.model}` : model,
    graph: graphSide,
    plain: { ...scored, ms, queries: 0, raw: res.text.slice(0, 4000), prompt, ...(parseError ? { parseError } : {}) },
  };
  last.set(await graphName(), out);
  return out;
}

export const _test = { scorePlain, parseJson, onList, expected, promptFor };
