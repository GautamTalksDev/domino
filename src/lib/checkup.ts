// Check-up: a person pastes a medication list in plain words ("Norvasc 10 mg since March 2025, Lasix,
// water pill, Ditropan"). FalkorDB's full-text index (with fuzzy matching for typos) maps each line to a
// Drug node; the list becomes a temporary patient in the clinic's graph, and the same agents review it.
// The temporary patient expires on its own and never shows up in lists, the population or the inbox.

import { randomBytes } from 'node:crypto';
import { run, type Tracer } from './db';
import { Q } from './cypher';
import { DRUG, EFFECT } from '../data/knowledge';
import { EPOCH_UTC, TODAY_DAY } from '../data/time';
import { cleanText } from './agent/guard';

export const SANDBOX_TTL_MS = 2 * 60 * 60_000;
export const SANDBOX_CAP = 200;

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const dayOf = (y: number, m: number, d = 15) => Math.round((Date.UTC(y, m, d) - EPOCH_UTC) / 86_400_000);

/** Reads a start date from free text: "2025-03", "03/2025", "March 2025", "since 2024", "6 months ago", "last year". */
export function parseStart(text: string): { day: number; text: string } | null {
  const s = text.toLowerCase();
  let m = /(20\d\d)-(\d{1,2})(?:-(\d{1,2}))?/.exec(s);
  if (m) return { day: dayOf(+m[1], Math.min(11, Math.max(0, +m[2] - 1)), m[3] ? +m[3] : 15), text: m[0] };
  m = /\b(\d{1,2})\/(20\d\d)\b/.exec(s);
  if (m) return { day: dayOf(+m[2], Math.min(11, Math.max(0, +m[1] - 1))), text: m[0] };
  m =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(20\d\d)\b/.exec(
      s,
    );
  if (m) return { day: dayOf(+m[2], MONTHS[m[1]] ?? 0), text: m[0] };
  m = /\b(\d{1,3})\s*(day|week|month|year)s?\s+ago\b/.exec(s);
  if (m) {
    const n = +m[1];
    const per = m[2] === 'day' ? 1 : m[2] === 'week' ? 7 : m[2] === 'month' ? 30.4 : 365;
    return { day: Math.round(TODAY_DAY - n * per), text: m[0] };
  }
  if (/\blast month\b/.test(s)) return { day: TODAY_DAY - 30, text: 'last month' };
  if (/\blast year\b/.test(s)) return { day: TODAY_DAY - 365, text: 'last year' };
  m = /\b(?:since|from|in|started)\s+(20\d\d)\b/.exec(s) ?? /\b(20\d\d)\b/.exec(s);
  if (m) return { day: dayOf(+m[1], 6), text: m[0] };
  return null;
}

/** Strips doses, frequencies and dates, leaving the words that might be a drug name. */
export function nameWords(line: string): string[] {
  // Only plain lower-case words reach the search index: no RediSearch operators (-, |, %, *, quotes) from user text.
  return (
    line
      .toLowerCase()
      .replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|units?|iu|meq|%)\b/g, ' ')
      .replace(/[^a-z\s]/g, ' ')
      .match(/[a-z]{3,}/g) ?? []
  ).filter((w) => !STOP.has(w) && !MONTHS[w.replace(/\.$/, '')]);
}

const STOP = new Set([
  'since',
  'from',
  'started',
  'start',
  'daily',
  'twice',
  'once',
  'three',
  'times',
  'day',
  'days',
  'week',
  'weeks',
  'month',
  'months',
  'year',
  'years',
  'ago',
  'last',
  'tablet',
  'tablets',
  'tab',
  'tabs',
  'capsule',
  'capsules',
  'cap',
  'pill',
  'pills',
  'morning',
  'night',
  'bedtime',
  'evening',
  'take',
  'takes',
  'taking',
  'and',
  'the',
  'for',
  'with',
  'her',
  'his',
  'mom',
  'mum',
  'dad',
  'she',
  'he',
  'they',
  'also',
  'about',
  'every',
  'each',
  'needed',
  'prn',
  'dose',
  'doses',
  'extended',
  'release',
  'low',
  'high',
]);

export function toQuery(words: string[]): string | null {
  const w = [...new Set(words)].slice(0, 5);
  if (!w.length) return null;
  // Exact, prefix and (for longer words) fuzzy match, OR-ed: one typo in "amlodpine" still finds amlodipine.
  // Two edits for long words, so a swapped pair of letters ("aricpet") still finds its drug.
  return w.map((t) => (t.length >= 7 ? `${t}|${t}*|%%${t}%%` : t.length >= 5 ? `${t}|${t}*|%${t}%` : `${t}|${t}*`)).join('|');
}

export interface ParsedLine {
  line: string;
  match: { id: string; name: string; clsName: string; score: number } | null;
  alternatives: { id: string; name: string; clsName: string; score: number }[];
  start: number | null;
  startText: string | null;
}

export interface ParsedCondition {
  text: string;
  match: { id: string; name: string; plain: string; kind: string } | null;
}

export async function parseList(text: string, conditionsText: string, tracer?: Tracer): Promise<{ meds: ParsedLine[]; conditions: ParsedCondition[] }> {
  const lines = text
    .split(/\n|;|,(?![^(]*\))/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3)
    .slice(0, 20);
  const meds: ParsedLine[] = [];
  for (const line of lines) {
    const q = toQuery(nameWords(line));
    const rows = q ? await run<{ id: string; name: string; clsName: string; score: number }>(Q.findDrugs, { q }, tracer) : [];
    const date = parseStart(line);
    meds.push({ line, match: rows[0] ?? null, alternatives: rows.slice(1, 4), start: date?.day ?? null, startText: date?.text ?? null });
  }
  const conditions: ParsedCondition[] = [];
  for (const c of conditionsText
    .split(/\n|;|,/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3)
    .slice(0, 12)) {
    const q = toQuery(nameWords(c));
    const rows = q ? await run<{ id: string; name: string; plain: string; kind: string }>(Q.findEffects, { q }, tracer) : [];
    conditions.push({ text: c, match: rows[0] ?? null });
  }
  return { meds, conditions };
}

export interface CheckupInput {
  meds: { drug: string; start: number | null }[];
  conditions: string[];
  age: number;
  sex: 'F' | 'M';
  /** Lines of the list Domino could not match: kept on the check-up and said wherever it is read. */
  unchecked?: string[];
}

/** The sentence a check-up carries for medicines Domino could not check. */
export const NOT_CHECKED = /Not in Domino’s graph, so not checked: [^]*$/;

/**
 * Builds the temporary patient. Missing start dates are filled from the order of the list (the first line
 * started first), and flagged as assumed so the agents and the page can say so.
 */
export async function createCheckup(
  input: CheckupInput,
  tracer?: Tracer,
  opts: { minMeds?: number; name?: string; headline?: string; ehrKey?: string } = {},
): Promise<{ pid: string; assumedDates: boolean; expiresAt: number }> {
  const now = Date.now();
  await run(Q.purgeSandbox, { now }, tracer);
  const meds = input.meds.filter((m, i, arr) => DRUG[m.drug] && arr.findIndex((x) => x.drug === m.drug) === i).slice(0, 20);
  const min = opts.minMeds ?? 2;
  if (meds.length < min) throw new Error(min === 1 ? 'Add at least one medicine that Domino recognises.' : 'Add at least two medicines that Domino recognises.');
  // Fill missing dates: keep known ones, place unknown ones in list order, 45 days apart, before today.
  let assumed = false;
  const n = meds.length;
  const placed = meds.map((m, i) => {
    if (m.start != null) return { ...m, start: Math.min(TODAY_DAY, Math.max(-3650, m.start)), assumed: false };
    assumed = true;
    return { ...m, start: TODAY_DAY - 20 - (n - 1 - i) * 45, assumed: true };
  });
  const earliest = Math.min(...placed.map((m) => m.start));
  const conditions = [...new Set(input.conditions.filter((c) => EFFECT[c]))].map((id) => ({
    id,
    // A chronic condition was there before the medicines; a symptom someone noticed is recent.
    since: EFFECT[id]!.kind === 'condition' ? earliest - 60 : TODAY_DAY - 14,
  }));
  // Not being in the graph is not the same as safe: what Domino could not match stays on the record, named.
  const notChecked = [...new Set((input.unchecked ?? []).map((x) => cleanText(x, 60).replace(/[[\]()*_`#<>|]/g, '').trim()).filter(Boolean))].slice(0, 8);
  const pid = `p-ck-${randomBytes(5).toString('hex')}`;
  const expiresAt = now + SANDBOX_TTL_MS;
  const created = await run<{ id: string }>(
    Q.createSandbox,
    {
      now,
      cap: SANDBOX_CAP,
      pid,
      name: opts.name ?? 'Check-up',
      age: Math.min(105, Math.max(40, Math.round(input.age))),
      sex: input.sex,
      expiresAt,
      headline: `${opts.headline ?? (assumed ? 'A pasted list. Some start dates are assumed from the order of the list.' : 'A pasted list.')}${notChecked.length ? ` Not in Domino’s graph, so not checked: ${notChecked.join(', ')}.` : ''}`,
      meds: placed.map((m) => ({ drug: m.drug, start: m.start, dose: 'as listed', prescriber: 'Not recorded', assumed: m.assumed })),
      conditions,
      ehrKey: opts.ehrKey ?? null,
    },
    tracer,
  );
  if (!created.length) throw new Error('Too many check-ups are open right now. Please try again in a while.');
  return { pid, assumedDates: assumed, expiresAt };
}
