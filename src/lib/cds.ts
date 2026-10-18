// CDS Hooks 2.0: Domino as a decision support service an EHR calls at the moment of prescribing.
//
// An EHR that speaks CDS Hooks (the HL7 standard behind order-entry alerts) discovers Domino's services at
// GET /cds-services, then POSTs a hook request when a prescriber selects or signs a medication order. The request
// carries the draft MedicationRequest(s) and, through prefetch, the patient's active medicines and conditions.
// Domino answers with CDS cards: the same graph check as the prescriber check (src/lib/engine/gatekeeper.ts), as a
// summary, a markdown detail, a suggestion to hold the draft order, and override reasons that mirror Domino's signed
// decisions (intentional / not a cascade). Every card is stored in the clinic's graph as a CdsCard linked to the
// patient, the drug being ordered and the drug whose side effect it would treat, so the care team sees order-entry
// checks live, and the EHR's feedback (accepted, or overridden and why) becomes memory too.
//
//   - A patient Domino already holds (context.patientId is a Domino id in this clinic's graph) is checked against
//     their stored record.
//   - Anyone else is checked from the prefetch alone: the medicines and conditions become a temporary check-up
//     patient (capped, expiring in two hours, never listed), exactly like a pasted list on /checkup. No name is kept.
//
// Medicines are matched by name (the coding's display or the concept's text) through FalkorDB's full-text index, and
// only accepted when the generic name, a brand name or a known alias appears in that text: Domino has no RxNorm
// mapping yet, and a wrong match would be worse than no card.

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { run, type Tracer } from './db';
import { Q } from './cypher';
import { DRUG, EFFECT } from '../data/knowledge';
import { BRANDS } from '../data/brands';
import { checkPrescription, isDocumentedStop, type CheckResult } from './engine/gatekeeper';
import { createCheckup, nameWords, toQuery } from './checkup';
import { loadPatient } from './engine/analyze';
import { knowledge, matchCombos, type ComboRule, type DrugCard } from './engine/knowledge';
import type { Med } from './engine/types';
import { EPOCH_UTC, TODAY_DAY } from '../data/time';
import { cleanText } from './agent/guard';

export const CDS_HOOKS = ['order-select', 'order-sign'] as const;
export type CdsHook = (typeof CDS_HOOKS)[number];

export const CDS_SERVICE_IDS: Record<string, CdsHook> = {
  'domino-order-select': 'order-select',
  'domino-order-sign': 'order-sign',
};

const PREFETCH = {
  patient: 'Patient/{{context.patientId}}',
  medications: 'MedicationRequest?patient={{context.patientId}}&status=active',
  conditions: 'Condition?patient={{context.patientId}}&clinical-status=active',
};

/** The discovery document (GET /cds-services). */
export function discovery() {
  const describe = (hook: CdsHook) =>
    hook === 'order-select'
      ? 'As a medicine is chosen: would it treat a side effect of something the patient already takes (a prescribing cascade), complete a dangerous combination, or tip anticholinergic burden? Answers from a FalkorDB graph of drugs, side effects and the patient’s own timeline.'
      : 'Before an order is signed: the same prescribing-cascade check, with a suggestion to hold the order and review the original medicine, and override reasons that become the care team’s memory.';
  return {
    services: Object.entries(CDS_SERVICE_IDS).map(([id, hook]) => ({
      hook,
      id,
      title: hook === 'order-select' ? 'Domino: prescribing cascade check (order select)' : 'Domino: prescribing cascade check (order sign)',
      description: describe(hook),
      prefetch: PREFETCH,
      usageRequirements:
        'Send active MedicationRequests (with authoredOn) and active Conditions as prefetch for patients Domino does not hold. Medicines are matched by name; synthetic and test data only.',
    })),
  };
}

// --- Request validation -------------------------------------------------------------------------------------------
// EHRs send far more than Domino reads, so objects pass unknown fields through; everything Domino does read is
// bounded, and resources are read defensively (any field may be missing or of the wrong type).

const Resource = z.record(z.string(), z.unknown());
const Bundle = z
  .object({
    resourceType: z.literal('Bundle'),
    entry: z
      .array(z.object({ resource: Resource.optional() }).passthrough())
      .max(200)
      .optional(),
  })
  .passthrough();

export const CdsRequest = z
  .object({
    hook: z.enum(CDS_HOOKS),
    hookInstance: z.string().min(1).max(100),
    fhirServer: z.string().max(500).optional(),
    context: z
      .object({
        userId: z.string().max(200).optional(),
        patientId: z.string().min(1).max(100),
        encounterId: z.string().max(200).optional(),
        selections: z.array(z.string().max(200)).max(50).optional(),
        draftOrders: Bundle,
      })
      .passthrough(),
    prefetch: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type CdsRequestBody = z.infer<typeof CdsRequest>;

export const CdsFeedback = z
  .object({
    feedback: z
      .array(
        z
          .object({
            card: z.string().uuid(),
            outcome: z.enum(['accepted', 'overridden']),
            acceptedSuggestions: z
              .array(z.object({ id: z.string().max(100) }).passthrough())
              .max(10)
              .optional(),
            overrideReason: z
              .object({
                reason: z.object({ code: z.string().max(60).optional(), system: z.string().max(300).optional(), display: z.string().max(200).optional() }).passthrough().optional(),
                userComment: z.string().max(1000).optional(),
              })
              .passthrough()
              .optional(),
            outcomeTimestamp: z.string().max(40),
          })
          .passthrough(),
      )
      .min(1)
      .max(20),
  })
  .passthrough();

// --- Reading FHIR resources -----------------------------------------------------------------------------------------

const str = (x: unknown, max = 300) => (typeof x === 'string' ? x.slice(0, max) : undefined);
const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined);
const arr = (x: unknown) => (Array.isArray(x) ? x.slice(0, 20) : []);

/** Every human-readable name a medication resource carries: concept text, coding displays, a reference display. */
export function medicationNames(r: Record<string, unknown>): string[] {
  const concepts = [obj(r.medicationCodeableConcept), obj(obj(r.medication)?.concept), obj(r.medication)].filter(Boolean) as Record<string, unknown>[];
  const names = concepts.flatMap((c) => [str(c.text), ...arr(c.coding).map((x) => str(obj(x)?.display))]);
  names.push(str(obj(r.medicationReference)?.display), str(obj(obj(r.medication)?.reference)?.display));
  return [...new Set(names.filter((n): n is string => !!n && n.trim().length >= 3))].slice(0, 6);
}

const normWords = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

/** Salts and minerals that are also drugs in the graph: "atorvastatin calcium" is not calcium. They count only leading the name. */
const SALT_WORDS = new Set(['calcium', 'potassium', 'sodium', 'magnesium', 'iron', 'zinc']);

/**
 * The medicines named in coded EHR data, as Drug nodes (several for a combination product such as
 * "lisinopril 20 MG / hydrochlorothiazide 12.5 MG"). FalkorDB's full-text index proposes candidates; a candidate is
 * accepted only if its generic name (or id) appears whole in the text, or else a brand or alias does, and a salt word
 * only when it leads the name ("Calcium carbonate", not "rosuvastatin calcium"). No card is better than a card about
 * the wrong drug.
 */
export async function matchMedications(names: string[], tracer?: Tracer): Promise<{ id: string; name: string }[]> {
  for (const text of names) {
    const q = toQuery(nameWords(text));
    if (!q) continue;
    const rows = await run<{ id: string; name: string }>(Q.findDrugs, { q }, tracer);
    const t = normWords(text);
    const has = (w: string) => w.trim().length >= 4 && t.includes(normWords(w));
    // A combination drug in the graph (carbidopa-levodopa) written the RxNorm way, one ingredient per component:
    // "carbidopa 25 MG / levodopa 100 MG Oral Tablet".
    const parts = text.split('/').map((x) => normWords(x).trim());
    const combo = (w: string) => {
      const tokens = normWords(w).trim().split(' ');
      return tokens.length >= 2 && tokens.length === parts.length && tokens.every((tok, i) => tok.length >= 4 && parts[i].startsWith(`${tok} `));
    };
    const generic = rows.filter((r) => DRUG[r.id] && [r.name, r.id.replace(/_/g, ' ')].some((w) => has(w) || combo(w)));
    const alias = rows.filter(
      (r) =>
        DRUG[r.id] &&
        !generic.includes(r) &&
        (BRANDS[r.id] ?? []).some((w) => has(w) && (!SALT_WORDS.has(w.toLowerCase()) || t.trimStart().startsWith(`${w.toLowerCase()} `))),
    );
    // A brand or alias only adds a drug when no generic name already named one in the same words.
    const hits = generic.length ? [...generic, ...alias.filter((r) => !SALT_WORDS.has((BRANDS[r.id] ?? [])[0]?.toLowerCase() ?? ''))] : alias;
    const out = [...new Map(hits.map((r) => [r.id, { id: r.id, name: DRUG[r.id]!.name }])).values()];
    if (out.length) return out.slice(0, 4);
  }
  return [];
}

async function matchCondition(text: string, tracer?: Tracer): Promise<string | null> {
  const q = toQuery(nameWords(text));
  if (!q) return null;
  const rows = await run<{ id: string; name: string; plain: string }>(Q.findEffects, { q }, tracer);
  const t = normWords(text);
  const hit = rows.find((r) => [r.name, r.plain, r.id.replace(/_/g, ' ')].some((w) => w && t.includes(normWords(w))));
  return hit && EFFECT[hit.id] ? hit.id : null;
}

const resources = (bundle: unknown, type: string[]): Record<string, unknown>[] =>
  arr(obj(bundle)?.entry)
    .map((e) => obj(obj(e)?.resource))
    .filter((r): r is Record<string, unknown> => !!r && type.includes(String(r.resourceType)));

/** An ISO date (YYYY-MM or YYYY-MM-DD, any year) as a day number; null when absent or not a date. */
export function isoDay(when: string | undefined): number | null {
  const m = when ? /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(when) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 15];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Math.round((Date.UTC(y, mo - 1, d) - EPOCH_UTC) / 86_400_000);
}

/**
 * Domino's records live in a synthetic calendar whose "today" is TODAY_DAY; an EHR sends real dates. Shifting them by
 * the gap between the real date and Domino's today keeps "started 20 days ago" true (and never in the future).
 */
function toDominoDay(day: number | null): number | null {
  if (day == null) return null;
  const realToday = Math.floor((Date.now() - EPOCH_UTC) / 86_400_000);
  return Math.min(TODAY_DAY, day + (TODAY_DAY - realToday));
}

function startOf(r: Record<string, unknown>): number | null {
  return toDominoDay(isoDay(
    str(r.authoredOn, 40) ??
      str(r.effectiveDateTime, 40) ??
      str(obj(r.effectivePeriod)?.start, 40) ??
      str(obj(obj(r.dispenseRequest)?.validityPeriod)?.start, 40) ??
      str(r.dateAsserted, 40),
    ),
  );
}

// --- Cards ----------------------------------------------------------------------------------------------------------

export interface CdsCard {
  uuid: string;
  summary: string;
  detail: string;
  indicator: 'info' | 'warning' | 'critical';
  source: { label: string; url: string; topic: { system: string; code: string; display: string } };
  suggestions?: { label: string; uuid: string; isRecommended?: boolean; actions: { type: 'delete'; description: string; resourceId: string }[] }[];
  selectionBehavior?: 'at-most-one';
  overrideReasons?: { code: string; system: string; display: string }[];
  links?: { label: string; url: string; type: 'absolute' }[];
}

/** Unanswered cards kept in the graph, overall and per patient: any EHR can call the service, so its memory is bounded. */
export const CDS_KEEP = 2000;
export const CDS_KEEP_PER_PATIENT = 50;

export const OVERRIDE_REASONS = [
  { code: 'intentional', display: 'Intentional: treating this side effect is the plan' },
  { code: 'not-a-cascade', display: 'Not a cascade: something else explains the symptom' },
  { code: 'will-review', display: 'Going ahead for now; will review the original medicine' },
] as const;

/** CDS Hooks wants a summary under 140 characters. */
const SUMMARY_MAX = 139;
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const lc = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** The link a card is about: a documented cascade first, then a likely or possible graph-inferred one. */
function leadOf(res: CheckResult) {
  return res.treatsSideEffectOf.find(isDocumentedStop) ?? res.treatsSideEffectOf.find((x) => !x.deliberate && (x.tier === 'likely' || x.tier === 'possible'));
}

interface CardContext {
  base: string;
  pid: string;
  patientName: string | null;
  known: boolean;
  /** Outside patient: some start dates were missing and were placed in list order. */
  assumedDates?: boolean;
  /** Outside patient: medicines on the shared list that are not in Domino's graph, so nothing was checked against them. */
  unrecognised?: string[];
}

const sourceOf = (base: string, topic: { code: string; display: string }) => ({
  label: 'Domino · prescribing cascade check',
  url: `${base}/how`,
  topic: { system: `${base}/fhir/CodeSystem/issue`, ...topic },
});
const overrides = (base: string) => OVERRIDE_REASONS.map((r) => ({ ...r, system: `${base}/fhir/CodeSystem/override-reason` }));
const linkTo = (ctx: CardContext) =>
  ctx.known
    ? { label: `Open ${ctx.patientName ?? 'the patient'} in Domino`, url: `${ctx.base}/patients/${ctx.pid}`, type: 'absolute' as const }
    : { label: 'See the full check in Domino', url: `${ctx.base}/check?patient=${ctx.pid}`, type: 'absolute' as const };
const footer = (n: number, ctx: CardContext) =>
  `Domino raises a question for the prescriber; it does not diagnose. Checked with ${n} FalkorDB queries over ${ctx.known ? 'this patient’s record' : 'the medicines this request shared'}.${ctx.assumedDates ? ' Some start dates were not in the request, so Domino placed them in list order.' : ''}${ctx.unrecognised?.length ? ` Not in Domino’s graph, so not checked against: ${ctx.unrecognised.join(', ')}.` : ''}`;

export function buildCard(res: CheckResult, draft: { id: string | null; drug: string }, ctx: CardContext): CdsCard | null {
  if (res.verdict === 'clear') return null;
  const name = res.drug.name;
  const lead = leadOf(res);
  const indicator: CdsCard['indicator'] = res.combosCompleted.length ? 'critical' : res.verdict === 'stop_and_check' ? 'warning' : 'info';
  const summary = clip(
    lead
      ? `${name} may be treating a side effect of ${lead.fromName}: a possible prescribing cascade`
      : res.combosCompleted.length
        ? `${name} completes a dangerous combination: ${res.combosCompleted[0]}`
        : res.conflicts.length
          ? `${name} conflicts with ${res.conflicts[0].drug}`
          : res.reasons.includes('burden')
            ? `${name} raises anticholinergic burden to ${res.acbAfter}`
            : res.drug.beers
              ? `${name} is on the AGS Beers list for older adults`
              : `Check ${name} before signing`,
    SUMMARY_MAX,
  );
  // The headline already explains the lead link; its suggested question follows; other links and risks are bullets.
  const lines: string[] = [res.headline];
  if (lead?.question) lines.push('', `*${lead.question}*`);
  lines.push('');
  for (const x of res.treatsSideEffectOf.filter((y) => y !== lead && !y.deliberate && (y.tier === 'likely' || y.tier === 'possible')).slice(0, 2)) {
    lines.push(`- Also: **${x.fromName}** (started ${x.since} ago) can cause ${lc(x.effectName)}, which ${name} treats (score ${x.score.toFixed(2)}, ${x.tier}).`);
  }
  for (const c of res.combosCompleted) lines.push(`- Completes a dangerous combination: **${c}**.`);
  for (const c of res.conflicts.slice(0, 2)) lines.push(`- Conflicts with **${c.drug}**: ${c.why}`);
  if (res.acbAfter > res.acbBefore) lines.push(`- Anticholinergic burden ${res.acbBefore} → ${res.acbAfter}.`);
  if (res.drug.beers) lines.push(`- AGS Beers 2023: ${res.drug.beers}`);
  lines.push('', footer(res.queries.length, ctx));
  const topic =
    indicator === 'critical'
      ? { code: 'dangerous-combination', display: 'Dangerous combination' }
      : lead
        ? { code: 'prescribing-cascade', display: 'Possible prescribing cascade' }
        : { code: 'prescribing-caution', display: 'Prescribing caution' };
  const card: CdsCard = {
    uuid: randomUUID(),
    summary,
    detail: clip(lines.join('\n'), 4000),
    indicator,
    source: sourceOf(ctx.base, topic),
    overrideReasons: overrides(ctx.base),
    links: [linkTo(ctx)],
  };
  if (draft.id && indicator !== 'info') {
    card.suggestions = [
      {
        label: lead ? `Hold ${name} and review ${lead.fromName} first` : `Hold ${name}`,
        uuid: randomUUID(),
        isRecommended: true,
        actions: [{ type: 'delete', description: `Remove the draft order for ${name}`, resourceId: `MedicationRequest/${draft.id}` }],
      },
    ];
    card.selectionBehavior = 'at-most-one';
  }
  return card;
}

/** A dangerous combination that only the orders together (or a combination product's ingredients together) complete. */
function comboCard(combo: ComboRule, drafts: { id: string | null; drug: string; name: string }[], ctx: CardContext, oneOrder = false): CdsCard {
  const names = drafts.map((d) => d.name);
  const list = names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and ');
  const card: CdsCard = {
    uuid: randomUUID(),
    summary: clip(
      oneOrder
        ? `${names.join(' / ')} completes a dangerous combination with what the patient takes: ${combo.title}`
        : `Ordered together, ${list} complete a dangerous combination: ${combo.title}`,
      SUMMARY_MAX,
    ),
    detail: clip([`**${combo.title}.** ${combo.why}`, '', `- Harm: ${combo.harm}`, '', footer(0, ctx).replace(' Checked with 0 FalkorDB queries over', ' Checked against')].join('\n'), 4000),
    indicator: 'critical',
    source: sourceOf(ctx.base, { code: 'dangerous-combination', display: 'Dangerous combination' }),
    overrideReasons: overrides(ctx.base),
    links: [linkTo(ctx)],
  };
  const holdable = drafts.filter((d, i) => d.id && drafts.findIndex((x) => x.id === d.id) === i);
  if (holdable.length) {
    card.suggestions = holdable.map((d) => ({
      label: oneOrder ? `Hold ${names.join(" / ")}` : `Hold ${d.name}`,
      uuid: randomUUID(),
      actions: [{ type: 'delete' as const, description: `Remove the draft order for ${d.name}`, resourceId: `MedicationRequest/${d.id}` }],
    }));
    card.selectionBehavior = 'at-most-one';
  }
  return card;
}

/**
 * An order Domino could not match to a medicine in its graph. Said out loud: no card at all would read as "checked,
 * nothing found", and not being in the graph is not the same as being safe.
 */
function notCheckedCard(text: string | null, base: string, known: number): CdsCard {
  const name = text ? cleanText(text, 60).replace(/[[\]()*_`#<>|]/g, '') : '';
  return {
    uuid: randomUUID(),
    summary: clip(name ? `Domino did not check ${name}: it is not a medicine in Domino’s graph` : 'Domino could not read the medicine name in this order, so it did not check it', SUMMARY_MAX),
    detail: [
      `Domino checks orders against the ${known} medicines in its knowledge graph, matched by generic or brand name. ${name ? `“${name}” matched none of them` : 'This order had no medicine name Domino could read'}, so it has **not** been checked for prescribing cascades, dangerous combinations or anticholinergic burden.`,
      '',
      'Not being in the graph does not mean safe. Check this order the usual way.',
    ].join('\n'),
    indicator: 'info',
    source: sourceOf(base, { code: 'not-checked', display: 'Not checked by Domino' }),
  };
}

/**
 * The check ran against only part of the patient's list (or none of it): some medicines the EHR shared are not in
 * Domino's graph. Without this card a clean result would read as "checked against everything".
 */
function partialCard(orders: string[], unrecognised: string[], checked: number, base: string): CdsCard {
  const what = orders.length ? orders.join(', ') : 'this order';
  const listed = unrecognised.join(', ');
  return {
    uuid: randomUUID(),
    summary: clip(
      checked
        ? `Domino checked ${what} against ${checked} of the listed medicines; not in its graph: ${listed}`
        : `Domino could not check ${what}: none of the listed medicines are in its graph`,
      SUMMARY_MAX,
    ),
    detail: [
      checked
        ? `Domino found nothing to flag for ${what} among the ${checked} listed medicine${checked === 1 ? '' : 's'} it knows. It has **not** checked it against ${listed}, which ${unrecognised.length === 1 ? 'is' : 'are'} not in its knowledge graph.`
        : `None of the medicines this request listed (${listed}) are in Domino's knowledge graph, so it had nothing to check ${what} against.`,
      '',
      'Not being in the graph does not mean safe. Check those combinations the usual way.',
    ].join('\n'),
    indicator: 'info',
    source: sourceOf(base, { code: 'partly-checked', display: 'Partly checked by Domino' }),
  };
}

const asMed = (d: DrugCard, start: number): Med => ({
  id: d.id,
  name: d.name,
  cls: d.cls,
  clsName: d.clsName,
  acb: d.acb,
  beers: d.beers,
  start,
  dose: '',
  prescriber: '',
  indication: null,
});

// --- The service --------------------------------------------------------------------------------------------------

export interface CdsResult {
  cards: CdsCard[];
  /** Outside CDS Hooks' own elements (the spec reserves `extension` for this): what Domino did, for its demo page and tests. */
  extension: {
    domino: {
      patient: { id: string; known: boolean; name: string | null };
      orders: { id: string | null; text: string; drug: string | null; verdict: CheckResult['verdict'] | null }[];
      /** Medicines on the shared list Domino could not match (outside patients): nothing was checked against them. */
      unrecognised: string[];
      queries: number;
      /** Whether the cards were remembered (order-sign, with permission to write). */
      stored: boolean;
    };
  };
}

export class CdsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const OK_STATUS = new Set(['active', 'on-hold', 'intended']);

export async function runService(
  serviceId: string,
  body: CdsRequestBody,
  opts: { base: string; canWrite: boolean; client?: string | null; issuer?: string | null },
  tracer?: Tracer,
): Promise<CdsResult> {
  const hook = CDS_SERVICE_IDS[serviceId];
  if (!hook) throw new CdsError(404, 'No such CDS service.');
  if (body.hook !== hook) throw new CdsError(400, `This service answers ${hook}, not ${body.hook}.`);
  let queries = 0;
  const t: Tracer = (x) => {
    queries++;
    tracer?.(x);
  };

  // The orders to check: draft MedicationRequests (only the selected ones for order-select), one entry per ingredient,
  // each drug once.
  const selected = new Set((body.context.selections ?? []).map((s) => s.replace(/^MedicationRequest\//, '')));
  const drafts = resources(body.context.draftOrders, ['MedicationRequest'])
    .filter((r) => hook !== 'order-select' || !selected.size || selected.has(String(r.id ?? '')))
    .slice(0, 10);
  const orders: CdsResult['extension']['domino']['orders'] = [];
  for (const r of drafts) {
    const names = medicationNames(r);
    const id = typeof r.id === 'string' && /^[A-Za-z0-9\-.]{1,64}$/.test(r.id) ? r.id : null;
    const ms = await matchMedications(names, t);
    if (!ms.length) orders.push({ id, text: names[0] ?? '', drug: null, verdict: null });
    for (const m of ms) if (!orders.some((o) => o.drug === m.id)) orders.push({ id, text: names[0] ?? m.name, drug: m.id, verdict: null });
  }
  const toCheck = orders.filter((o) => o.drug).slice(0, 10);
  const k = await knowledge(t);
  const unrecognised: string[] = [];
  let checkedAgainst = 0;
  // Orders Domino could not match get an info card each (once per name, at most three), after any real warning.
  const unchecked = [...new Map(orders.filter((o) => !o.drug).map((o) => [o.text.trim().toLowerCase(), o.text])).values()]
    .slice(0, 3)
    .map((text) => notCheckedCard(text || null, opts.base, k.drugs.size));
  const none = (patient = { id: '', known: false, name: null as string | null }) => ({
    cards: unchecked,
    extension: { domino: { patient, orders, queries, stored: false, unrecognised } },
  });
  if (!toCheck.length) return none();

  // Whose record: a patient this clinic's graph holds, or a temporary one built from the prefetch.
  const pidRaw = body.context.patientId;
  let patient: { id: string; known: boolean; name: string | null } | null = null;
  let assumedDates = false;
  if (/^p-?[a-z0-9-]{2,40}$/.test(pidRaw)) {
    const row = (await run<{ id: string; name: string; sandbox: unknown }>(Q.patient, { pid: pidRaw }, t))[0];
    if (row?.id && !row.sandbox) patient = { id: row.id, known: true, name: row.name };
  }
  if (!patient) {
    // CDS Hooks: a service that needs prefetch the client did not send answers 412. A key sent as null means the EHR
    // has no data for it, which is an answer: nothing to check against.
    if (!body.prefetch || !('medications' in body.prefetch)) throw new CdsError(412, 'Domino needs the medications prefetch for a patient it does not hold.');
    if (!opts.canWrite) throw new CdsError(401, 'Checking a patient Domino does not hold needs the Domino access key (or a trusted EHR token) on this deployment.');
    const draftIds = new Set(drafts.map((r) => String(r.id ?? '')));
    const meds: { drug: string; start: number | null }[] = [];
    for (const r of resources(body.prefetch.medications, ['MedicationRequest', 'MedicationStatement']).slice(0, 40)) {
      if (draftIds.has(String(r.id ?? ''))) continue;
      const status = str(r.status, 40);
      if (status && !OK_STATUS.has(status)) continue;
      const names = medicationNames(r);
      const found = await matchMedications(names, t);
      // Said on every card: a medicine Domino cannot match is one it checked nothing against.
      if (!found.length && names[0] && unrecognised.length < 8) unrecognised.push(cleanText(names[0], 60).replace(/[[\]()*_`#<>|]/g, ''));
      for (const m of found) if (!meds.some((x) => x.drug === m.id)) meds.push({ drug: m.id, start: startOf(r) });
    }
    checkedAgainst = meds.length;
    if (!meds.length)
      return unrecognised.length
        ? { ...none(), cards: [...unchecked, partialCard(toCheck.map((o) => k.drugs.get(o.drug!)?.name ?? o.text), unrecognised, 0, opts.base)] }
        : none();
    const conditions: string[] = [];
    for (const r of resources(body.prefetch.conditions, ['Condition']).slice(0, 12)) {
      const c = obj(r.code);
      const text = [str(c?.text), ...arr(c?.coding).map((x) => str(obj(x)?.display))].find(Boolean);
      const id = text ? await matchCondition(text, t) : null;
      if (id && !conditions.includes(id)) conditions.push(id);
    }
    const p = obj(body.prefetch.patient);
    const born = str(p?.birthDate, 10);
    const age = born && /^\d{4}/.test(born) ? Math.min(105, Math.max(40, new Date().getUTCFullYear() - Number(born.slice(0, 4)))) : 78;
    const sex = p?.gender === 'male' ? 'M' : 'F';
    assumedDates = meds.some((m) => m.start == null);
    // One temporary patient per (EHR patient, medicines, conditions): order-select then order-sign reuse it. The key is a
    // hash; the EHR's own patient id is never stored.
    const ehrKey = createHash('sha256')
      .update(JSON.stringify([pidRaw, [...meds].sort((x, y) => x.drug.localeCompare(y.drug)), [...conditions].sort(), age, sex, [...unrecognised].sort()]))
      .digest('hex')
      .slice(0, 32);
    const found = (await run<{ id: string }>(Q.findEhrSandbox, { key: ehrKey, now: Date.now() }, t))[0];
    if (found) patient = { id: found.id, known: false, name: null };
    else {
      try {
        const made = await createCheckup({ meds, conditions, age, sex, unchecked: unrecognised }, t, {
          minMeds: 1,
          name: 'EHR order check',
          headline: 'Medicines shared by an EHR at order entry (CDS Hooks prefetch). No name was kept.',
          ehrKey,
        });
        patient = { id: made.pid, known: false, name: null };
      } catch (err) {
        if (err instanceof Error && /^Too many/.test(err.message)) throw new CdsError(503, 'Too many temporary patients are open right now; try again shortly.');
        throw err;
      }
    }
  }

  const ctx: CardContext = { base: opts.base, pid: patient.id, patientName: patient.name, known: patient.known, assumedDates, unrecognised };
  const cards: CdsCard[] = [];
  const stored: Record<string, unknown>[] = [];
  const record = (slot: string, card: CdsCard, drug: string, drugName: string, verdict: string, culprit: string | null, pattern: string | null) =>
    stored.push({
      slot,
      uuid: card.uuid,
      service: serviceId,
      hook,
      hookInstance: cleanText(body.hookInstance, 100),
      client: opts.client ? cleanText(opts.client, 80) : null,
      issuer: opts.issuer ?? null,
      drug,
      drugName,
      culprit,
      pattern,
      verdict,
      indicator: card.indicator,
      summary: card.summary,
    });
  const reported = new Set<string>();
  for (const o of toCheck) {
    const res = await checkPrescription(patient.id, o.drug!, t);
    o.verdict = res.verdict;
    res.combosCompleted.forEach((c) => reported.add(c));
    const card = buildCard(res, { id: o.id, drug: o.drug! }, ctx);
    if (!card) continue;
    cards.push(card);
    const lead = leadOf(res);
    record(`drug:${o.drug}`, card, o.drug!, res.drug.name, res.verdict, lead?.from ?? null, lead?.patternId ?? null);
  }

  // Dangerous combinations that no single drug completes, but a combination product does ("lisinopril / HCTZ" with an
  // NSAID on file), or several orders do together. Checked against everything the patient already takes, renewals
  // included; each combination is reported once.
  const keys = toCheck.map((o, i) => o.id ?? `#${i}`);
  const groups = [...new Set(keys)].map((k) => toCheck.filter((_, i) => keys[i] === k));
  if (toCheck.length > 1) {
    const base = (await loadPatient(patient.id, t)).meds;
    const ids = (ms: Med[]) => new Set(matchCombos(ms, k.combos).map((c) => c.id));
    const cardOf = (id: string) => k.drugs.get(id)!;
    const meds = (os: typeof toCheck) => os.map((o) => asMed(cardOf(o.drug!), TODAY_DAY));
    const before = ids(base);
    const perDrug = new Set(toCheck.flatMap((o) => [...ids([...base, ...meds([o])])]));
    const done = new Set<string>();
    const raise = (def: ComboRule, os: typeof toCheck, oneOrder: boolean) => {
      const c = def;
      if (before.has(c.id) || perDrug.has(c.id) || reported.has(c.title) || done.has(c.id)) return;
      // The orders in the combination: every new drug whose class is one of its groups.
      const classes = new Set(def.groups.flat());
      const parts = os
        .filter((o) => classes.has(cardOf(o.drug!).cls) && !base.some((m) => m.id === o.drug))
        .map((o) => ({ id: o.id, drug: o.drug!, name: cardOf(o.drug!).name }));
      if (parts.length < 2) return;
      done.add(c.id);
      const card = comboCard(def, parts, ctx, oneOrder);
      cards.push(card);
      record(`combo:${def.id}`, card, parts[0].drug, parts.map((x) => x.name).join(' + '), 'stop_and_check', null, null);
    };
    for (const g of groups.filter((x) => x.length > 1)) for (const c of matchCombos([...base, ...meds(g)], k.combos)) raise(c, g, true);
    if (groups.length > 1) {
      const alone = new Set(groups.flatMap((g) => [...ids([...base, ...meds(g)])]));
      for (const c of matchCombos([...base, ...meds(toCheck)], k.combos)) if (!alone.has(c.id)) raise(c, toCheck, false);
    }
  }

  // A retried call (same hookInstance) gets the cards it was given the first time, with the same ids.
  const earlier = await run<{ slot: string | null; uuid: string }>(Q.cdsCardsForCall, { pid: patient.id, hookInstance: cleanText(body.hookInstance, 100) }, t);
  for (const e of earlier) {
    const i = e.slot ? stored.findIndex((s) => s.slot === e.slot) : -1;
    if (i >= 0) {
      const card = cards.find((c) => c.uuid === stored[i].uuid);
      if (card) card.uuid = e.uuid;
      stored.splice(i, 1);
    }
  }
  // Only cards shown at signing are remembered: order-select fires on every pick while browsing, and its cards are
  // previews of the same question.
  const remember = hook === 'order-sign' && opts.canWrite;
  if (remember && stored.length) {
    await run(Q.recordCdsCards, { pid: patient.id, cards: stored, at: Date.now() }, t);
    await run(Q.trimCdsCards, { pid: patient.id, keep: CDS_KEEP, perPatient: CDS_KEEP_PER_PATIENT }, t);
  }
  // A clean result for an outside patient whose list had medicines Domino doesn't know is a partial check: say so.
  const partial =
    !cards.length && unrecognised.length
      ? [partialCard(toCheck.map((o) => k.drugs.get(o.drug!)?.name ?? o.text), unrecognised, checkedAgainst, opts.base)]
      : [];
  return { cards: [...cards, ...unchecked, ...partial], extension: { domino: { patient, orders, queries, stored: remember && cards.length > 0, unrecognised } } };
}

/**
 * The EHR's answer to a card. The first outcome per card is kept (later ones, even later in the same request, cannot
 * rewrite it), only for cards issued to the same caller, and the reason shown to the team is Domino's own wording for
 * the code, never the caller's text.
 */
export async function recordFeedback(
  serviceId: string,
  body: z.infer<typeof CdsFeedback>,
  who: { issuer: string | null; anyIssuer: boolean },
  tracer?: Tracer,
): Promise<number> {
  if (!CDS_SERVICE_IDS[serviceId]) throw new CdsError(404, 'No such CDS service.');
  const first = body.feedback.filter((f, i, all) => all.findIndex((x) => x.card === f.card) === i);
  const items = first.map((f) => {
    const code = f.overrideReason?.reason?.code;
    const known = OVERRIDE_REASONS.find((r) => r.code === code);
    return {
      card: f.card,
      outcome: f.outcome,
      accepted: (f.acceptedSuggestions ?? []).length > 0,
      reason: code ? cleanText(code, 60) : null,
      reasonText: known?.display ?? null,
      comment: f.overrideReason?.userComment ? cleanText(f.overrideReason.userComment, 280) : null,
    };
  });
  const rows = await run<{ n: number }>(Q.cdsFeedback, { service: serviceId, items, at: Date.now(), issuer: who.issuer ?? '', anyIssuer: who.anyIssuer }, tracer);
  return Number(rows[0]?.n ?? 0);
}
