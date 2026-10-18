// Team notes: protocols, handovers, chat messages and meeting minutes that people write. Each one becomes a Doc node
// linked (MENTIONS) to the drugs, symptoms and patients it names, so the care-team brain can find it, the patient's
// memory shows it, and the agents read it as context. Candidates come from FalkorDB's full-text index (generic
// names, brands and plain words); a candidate is linked only if one of its names appears in the text as a whole phrase.

import { randomUUID } from 'node:crypto';
import { run, type Tracer } from './db';
import { Q } from './cypher';
import { DRUG, EFFECT } from '../data/knowledge';
import { BRANDS, EFFECT_SYNONYMS } from '../data/brands';
import { cleanText } from './agent/guard';
import { currentUser } from './tenant';

export const DOC_KINDS = ['protocol', 'handover', 'chat', 'minutes'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export interface DocRow {
  id: string;
  kind: DocKind;
  title: string;
  text: string;
  by: string;
  at: number;
  drugs: { id: string; name: string }[];
  effects: { id: string; name: string }[];
  patients: { id: string; name: string }[];
  /** Review tasks this note raised (FROM_NOTE) or backs up (CORROBORATES: the task was already open). */
  tasks?: { id: string; title: string; status: string; role: string; how?: 'raised' | 'corroborates' }[];
}

/** Phrases too generic to link on their own in free text. */
const GENERIC = new Set([
  'sugar',
  'worry',
  'nerves',
  'tired',
  'sleepy',
  'fall',
  'spinning',
  'shaking',
  'urgency',
  'leaking',
  'retention',
  'faint',
  'bp',
  'asa',
  'peg',
]);

const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

function phrasesFor(kind: 'drug' | 'effect', id: string): string[] {
  if (kind === 'drug') {
    const d = DRUG[id];
    return d ? [d.name, id.replace(/_/g, ' '), ...(BRANDS[id] ?? [])] : [];
  }
  const e = EFFECT[id];
  return e ? [e.name, e.plain, id.replace(/_/g, ' '), ...(EFFECT_SYNONYMS[id] ?? [])] : [];
}

const mentions = (text: string, phrase: string) => {
  const p = norm(phrase);
  return p.trim().length >= 3 && !GENERIC.has(p.trim()) && text.includes(p);
};

/** Words worth asking the full-text index about: plain lower-case tokens only, so no search operator reaches it. */
function tokens(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? [])].slice(0, 120);
}

// Negation, NegEx-style, kept deliberately small, for how people write handovers and chats:
//  - A clause ends at sentence punctuation, a contrast ("no fever but a cough") or "and" starting a new statement
//    ("has no appetite and is dizzy").
//  - A cue negates a symptom after it in the same comma segment, within six words, unless the scope ends first
//    ("could not sleep for coughing"): "no", "denies", "without", "nil", "not", "never"…
//  - A cue that opens a list reaches every short noun item of it ("denies chest pain, nausea, dizziness"); an item that
//    says something itself ("no UTI, still confused") or an adjective ("no BM for days, constipated") is not in the list.
//  - After a symptom, "denied", "resolved", "gone", "settled", "none", "nil", "ruled out" mark it absent or over, unless
//    "not"/"never" comes within two words before ("not completely resolved"); a trailing "no"/"nil" only at the end.
//  - "No change in", "no better", "no reduction in", "can't stop" mean it is still there.
const NEG_CUES = new Set(['no', 'not', 'denies', 'denied', 'deny', 'denying', 'without', 'never', 'none', 'nor', 'neither', 'negative', 'free', 'absent', 'absence', 'nil']);
const OVER_CUES = new Set(['denied', 'resolved', 'gone', 'settled', 'none', 'absent', 'free', 'cleared', 'negative']);
const OVER_AT_END = new Set(['no', 'nil', 'stopped']);
const SCOPE_END = new Set(['for', 'because', 'due', 'from', 'since', 'after', 'with', 'as', 'but', 'which', 'that', 'so', 'then']);
// Words that make a comma item a statement of its own ("nausea all day", "drowsy this morning"), not a list item.
const AFFIRM = new Set([
  'still', 'now', 'again', 'is', 'was', 'has', 'had', 'feels', 'felt', 'gets', 'got', 'seems', 'looks', 'very', 'more', 'worse', 'today', 'new', 'some',
  'all', 'day', 'night', 'overnight', 'morning', 'evening', 'since', 'yesterday', 'tonight', 'constant', 'constantly', 'better', 'this', 'every', 'at',
]);
/** "no problems with", "no issues with", "no complaints of": the cue reaches past the preposition. */
const CUE_NOUNS = new Set(['problem', 'problems', 'issue', 'issues', 'trouble', 'complaint', 'complaints', 'concerns', 'episodes', 'signs', 'evidence', 'history']);
const STILL_THERE =
  /\b(no|not|without)( \w+){0,2} (change|improvement|better|relief|difference|resolution|reduction|decrease|improved|resolved|settled|gone|helped|only)\b|\b(can|could|cannot) not stop\b|\bunable to stop\b|\bno less\b/;
const NEG_WINDOW = 6;
/** Cues that open a list of absent findings ("no fever, chills"); "not" and "never" negate a verb, not a list. */
const LIST_CUES = new Set(['no', 'denies', 'denied', 'deny', 'without', 'negative', 'nil', 'free', 'absent']);

/** Clauses of a note, lower-cased, with "doesn't" read as "does not". */
function clauses(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\b(ca|wo)n[’']?t\b/g, (_, w: string) => (w === 'ca' ? 'can not' : 'will not'))
    .replace(/n[’']t\b/g, ' not')
    .replace(/\b(has|had|is|was|does|did|do|could|would|should|have|are|were)nt\b/g, '$1 not')
    .replace(/\bcannot\b/g, 'can not')
    .split(
      /[.;!?\n•]+|\b(?:but|however|although|though|except|yet|whereas)\b|\band (?=(?:is|was|has|had|feels|felt|gets|got|seems|looks|reports|complains|now|still|also|then|she|he|they)\b)/,
    );
}

/** A clause, normalised like norm() but keeping commas as their own tokens (they bound a negation's reach). */
const normClause = (s: string) =>
  ` ${s
    .replace(/[^a-z0-9,]+/g, ' ')
    .replace(/\s*,\s*/g, ' , ')
    .replace(/\s+/g, ' ')
    .trim()} `;

const wordsOf = (s: string) => s.trim().split(' ').filter((w) => w && w !== ',');
/** A short noun item in a list ("chills", "or cough", "shortness of breath"): a cue that opens the list still reaches it. */
const isListItem = (seg: string) => {
  const w = wordsOf(seg).filter((x) => x !== 'or' && x !== 'and' && x !== 'nor');
  return w.length >= 1 && w.length <= 4 && !w.some((x) => AFFIRM.has(x) || NEG_CUES.has(x));
};
/** "dizzy", "confused", "drowsy", "forgetful": a state, which a list of negated nouns does not reach. */
const ADJECTIVES = new Set([
  'dizzy', 'drowsy', 'sleepy', 'foggy', 'shaky', 'wobbly', 'unsteady', 'itchy', 'weak', 'tired', 'lightheaded', 'giddy', 'breathless', 'swollen',
  'nauseous', 'nauseated', 'anxious', 'restless', 'forgetful', 'confused', 'constipated', 'agitated', 'depressed', 'bloated', 'puffy', 'jittery',
]);
const isAdjective = (phrase: string) => {
  const w = phrase.trim().split(' ').pop() ?? '';
  return ADJECTIVES.has(w) || (/(ed|ous|ful|less)$/.test(w) && !['bleed', 'need', 'speed', 'breed'].includes(w));
};

/** Words before the mention, back to the nearest scope end, at most six. */
function scopeBefore(words: string[]): string[] {
  const out: string[] = [];
  for (let i = words.length - 1; i >= 0 && out.length < NEG_WINDOW; i--) {
    // "negative for", "free from", "no problems with": part of the cue, not the end of its reach.
    const cueOf = ['negative', 'free'].includes(words[i - 1]) || CUE_NOUNS.has(words[i - 1]);
    if (SCOPE_END.has(words[i]) && !(cueOf && ['for', 'from', 'with', 'of'].includes(words[i]))) break;
    out.unshift(words[i]);
  }
  return out;
}

/** Is the mention of `phrase` at [start, end) of this normalised clause negated? */
function negated(c: string, start: number, end: number, phrase: string): boolean {
  // After: "dizziness denied", "cough has now resolved", "confusion ruled out", "swelling: nil". A following
  // "which/that …" belongs to it too ("dizzy, which has now settled").
  const rest = c.slice(end).split(',');
  let afterText = rest[0];
  if (rest.length > 1 && /^\s*(which|that)\b/.test(rest[1])) afterText += ' ' + rest[1];
  const after = wordsOf(afterText);
  const near = after.slice(0, 5);
  const notBefore = (j: number) => ['not', 'never'].includes(near[j - 1]) || ['not', 'never'].includes(near[j - 2]);
  const j = near.findIndex((w, i) => OVER_CUES.has(w) && !(w === 'gone' && ['up', 'down', 'worse', 'back'].includes(near[i + 1])));
  if (j >= 0 && !notBefore(j)) return true;
  if (/\bruled out\b/.test(near.join(' ')) && !/\bnot (been )?ruled out\b/.test(near.join(' '))) return true;
  if (after.length >= 1 && after.length <= 2 && OVER_AT_END.has(after[after.length - 1]) && !notBefore(after.length - 1)) return true;

  // Before, in the mention's own comma segment.
  const segs = c.slice(0, start).split(',');
  const own = scopeBefore(wordsOf(segs[segs.length - 1]));
  const ownText = own.join(' ');
  if (STILL_THERE.test(ownText)) return false;
  const cueAt = own.findIndex((w) => NEG_CUES.has(w));
  if (cueAt >= 0) {
    // "can not stop coughing", "never stops coughing": a negated stop is the symptom going on; so is a double negative
    // ("can not stand up without feeling dizzy").
    if (/\b(not|never) (stop|stops|stopped)\b/.test(ownText) || /\b(not|never)\b.*\bwithout\b/.test(ownText)) return false;
    // "not sleeping and confused": "not" negates a verb; "and" starts the next finding. ("no nausea and vomiting" keeps it.)
    const verbCue = own.slice(cueAt).every((w) => !LIST_CUES.has(w));
    if (verbCue && own.slice(cueAt + 1).includes('and')) return false;
    return true;
  }
  // Before, through a list: only for a noun item, only while every segment back to the cue is a short noun item, and
  // only if the cue opens the list's first segment ("denies chest pain, nausea, dizziness").
  if (isAdjective(phrase) || segs.length < 2) return false;
  const ownSeg = segs[segs.length - 1] + ' ' + phrase + ' ' + rest[0];
  if (!isListItem(ownSeg)) return false;
  for (let k = segs.length - 2, items = 0; k >= 0 && items < 10; k--, items++) {
    const w = wordsOf(segs[k]);
    // The list opens with a cue in its first words: "denies headache, …", "Rosa denies headache, …", "pt has no fever, …".
    const at = w.slice(0, 4).findIndex((x) => LIST_CUES.has(x));
    if (at >= 0 && w.length - at <= 4) return !STILL_THERE.test(w.join(' '));
    if (!isListItem(segs[k])) return false;
  }
  return false;
}

/**
 * The effects a note actually reports. "No ankle swelling today", "denies dizziness", "hasn\u2019t been coughing" and
 * "swelling resolved" name a symptom but report its absence, so an effect counts only if at least one mention of it
 * is not negated (see negated()).
 */
export function affirmedEffects(text: string, effects: string[]): string[] {
  const cs = clauses(text).map(normClause);
  return effects.filter((id) =>
    phrasesFor('effect', id).some((phrase) => {
      const p = norm(phrase);
      if (p.trim().length < 3 || GENERIC.has(p.trim())) return false;
      return cs.some((c) => {
        for (let i = c.indexOf(p); i >= 0; i = c.indexOf(p, i + 1)) if (!negated(c, i, i + p.length, p)) return true;
        return false;
      });
    }),
  );
}

async function matchEntities(text: string, tracer?: Tracer) {
  const t = norm(text);
  const words = tokens(text);
  const q = words.length ? words.join('|') : null;
  const [drugHits, effectHits, patients] = await Promise.all([
    q ? run<{ id: string }>(Q.findDrugsAny, { q }, tracer) : Promise.resolve([]),
    q ? run<{ id: string }>(Q.findEffectsAny, { q }, tracer) : Promise.resolve([]),
    run<{ id: string; name: string }>(Q.patientNames, {}, tracer),
  ]);
  const drugs = [...new Set(drugHits.map((h) => h.id))].filter((id) => phrasesFor('drug', id).some((p) => mentions(t, p)));
  const effects = [...new Set(effectHits.map((h) => h.id))].filter((id) => phrasesFor('effect', id).some((p) => mentions(t, p)));
  const pats = patients.filter((p) => mentions(t, p.name));
  return { drugs, effects, patients: pats };
}

export async function linkEntities(text: string, tracer?: Tracer) {
  const m = await matchEntities(text, tracer);
  return { drugs: m.drugs, effects: m.effects, patients: m.patients.map((p) => p.id) };
}

/** What a note would be linked to, with display names, without storing anything (the live preview in the form). */
export async function previewLinks(text: string) {
  const m = await matchEntities(cleanText(text, 4200));
  return {
    drugs: m.drugs.map((id) => ({ id, name: DRUG[id]?.name ?? id })),
    effects: m.effects.map((id) => ({ id, name: EFFECT[id]?.name ?? id })),
    patients: m.patients.map((p) => ({ id: p.id, name: p.name })),
  };
}

export async function saveDoc(input: { kind: DocKind; title: string; text: string; at?: number; by?: { id: string; name: string } }, tracer?: Tracer) {
  const title = cleanText(input.title, 120);
  const text = cleanText(input.text, 4000);
  const user = input.by ?? (await currentUser());
  const links = await linkEntities(`${title}. ${text}`, tracer);
  const id = `doc-${randomUUID()}`;
  await run(Q.saveDoc, { id, kind: input.kind, title, text, by: user.name, byId: user.id, at: input.at ?? Date.now(), ...links }, tracer);
  return { id, ...links };
}

export async function listDocs(tracer?: Tracer): Promise<DocRow[]> {
  return run<DocRow>(Q.docs, {}, tracer);
}

export async function patientDocs(pid: string, tracer?: Tracer): Promise<DocRow[]> {
  return run<DocRow>(Q.patientDocs, { pid }, tracer);
}
