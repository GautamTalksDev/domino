// Agent tools. Every tool is a thin, validated wrapper over the Cypher catalog.
// A run is bound to one patient: tools never take a patient id from the model, so an
// agent cannot read or write another patient's record (least privilege, OWASP ASI02/ASI03).

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { graphName, run, type Tracer } from '../db';
import { Q } from '../cypher';
import { analyzePatient, loadPatient } from '../engine/analyze';
import { pssa, type PssaSignal } from '../engine/population';
import type { Analysis, Link } from '../engine/types';
import { CLASS, DRUG, EFFECT, PATTERNS } from '../../data/knowledge';
import { REF } from '../../data/references';
import { dayToLabel, daysBetweenLabel, TODAY_DAY } from '../../data/time';
import { checkClinicalWording, cleanText } from './guard';
import { knowledge, matchCombos } from '../engine/knowledge';
import { affirmedEffects } from '../docs';
import { NOT_CHECKED } from '../checkup';
import { checkPrescription } from '../engine/gatekeeper';
import { matchMedications } from '../cds';
import { proposeTask } from './actions';
import { lookup } from '../../data/knowledge';
import type { AgentEvent, AgentRole } from './events';

export interface ToolContext {
  runId: string | null;
  patientId: string;
  role: AgentRole;
  tracer: Tracer;
  cache: { analysis?: Analysis; hubs?: { id: string; name: string; score: number }[] };
  /** Index of the Step for the tool call in progress, stamped on what it writes (provenance). */
  step: number | null;
  /** alreadyOpen: proposals that matched a task already in the inbox (not duplicated). */
  counters: { findings: number; tasks: number; notes: number; alreadyOpen?: number };
  emit: (e: AgentEvent) => void;
  artifacts: { findings: string[]; findingKeys: string[]; tasks: { id: string; title: string }[]; notes: { id: string; kind: string }[] };
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  roles: AgentRole[];
  write: boolean;
  parameters: JsonSchema;
  schema: z.ZodTypeAny;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<{ summary: string; data?: unknown }>;
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export const LIMITS = { findings: 12, tasks: 6, notes: 2 };

const drugId = z.string().regex(/^[a-z0-9_]{2,40}$/, 'drug ids are lower-case words like "amlodipine"');
const effectId = z.string().regex(/^[a-z0-9_]{2,40}$/);
const linkKey = z.string().regex(/^[a-z0-9_]{2,40}>[a-z0-9_]{2,40}$/, 'link keys look like "amlodipine>furosemide"');

const keys0 = (links: string[]) => [...new Set(links)];

async function analysis(ctx: ToolContext): Promise<Analysis> {
  if (!ctx.cache.analysis) ctx.cache.analysis = await analyzePatient(ctx.patientId, { tracer: ctx.tracer });
  return ctx.cache.analysis;
}

function requireMed(a: Analysis, id: string) {
  const m = a.patient.meds.find((x) => x.id === id);
  if (!m) throw new ToolError(`"${id}" is not on this patient's medication list. Current drugs: ${a.patient.meds.map((x) => x.id).join(', ')}.`);
  return m;
}

function linkLine(l: Link): string {
  const pat = l.patterns[0];
  return `${l.key} [${l.tier}, score ${l.score.toFixed(2)}]: ${l.fromName} → ${l.effectPlain.toLowerCase()} → ${l.toName}; ${l.toName} started ${l.gap >= 0 ? `${daysBetweenLabel(l.gap)} after` : `${daysBetweenLabel(l.gap)} before`} ${l.fromName}${pat ? `; documented: ${pat.title} (${pat.evidence})` : '; graph-inferred'}${l.decision ? `; care team said "${l.decision.verdict}"` : ''}`;
}

// Population signals are expensive and change only with a sweep: cached for 5 minutes, per clinic graph.
const pssaCache = new Map<string, { at: number; rows: PssaSignal[] }>();
async function pssaCached(tracer: Tracer): Promise<PssaSignal[]> {
  const key = await graphName();
  const hit = pssaCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.rows;
  const rows = await pssa({ tracer });
  pssaCache.set(key, { at: Date.now(), rows });
  return rows;
}

/** Deprescribing safety: which of the medicines a review would touch need a gradual taper. */
function tapers(u: Analysis['trees'][number]['untangle']): string {
  const list = [...(u.rootTaper ? [`${u.removedName}: ${u.rootTaper}`] : []), ...u.unnecessary.filter((x) => x.taper).map((x) => `${x.name}: ${x.taper}`)];
  return list.length ? ` Deprescribing safety: ${list.join(' ')}` : '';
}

/** How many of the highest-betweenness drugs count as chokepoints (about the top eighth of the 116). */
const HUB_DRUGS = 15;

// Betweenness is a property of the knowledge graph (drugs and effects joined by CAUSES and TREATED_BY): the same for
// every patient, changing only when the knowledge does. So it is computed once per graph per process (and again by
// find_chokepoints whenever an agent asks), and every review uses it to set priority.
const HUB_TTL_MS = 10 * 60_000;
const gh = globalThis as unknown as { __domino_hubs?: Map<string, { at: number; hubs: { id: string; name: string; score: number }[] }> };
const hubCache: Map<string, { at: number; hubs: { id: string; name: string; score: number }[] }> = (gh.__domino_hubs ??= new Map());

const toHubs = (rows: { label: string; id: string; name: string; score: number }[]) =>
  rows
    .filter((r) => r.label === 'Drug' && Number(r.score) > 0)
    .slice(0, HUB_DRUGS)
    .map((r) => ({ id: r.id, name: r.name, score: Math.round(Number(r.score)) }));

/** The drug chokepoints of the cascade knowledge graph (FalkorDB betweenness centrality). */
type Hub = { id: string; name: string; score: number };
async function hubs(ctx: ToolContext): Promise<Hub[]> {
  if (ctx.cache.hubs) return ctx.cache.hubs;
  const key = await graphName();
  const hit = hubCache.get(key);
  if (hit && Date.now() - hit.at < HUB_TTL_MS) return (ctx.cache.hubs = hit.hubs);
  const fresh = toHubs(await run<{ label: string; id: string; name: string; score: number }>(Q.chokepoints, {}, ctx.tracer));
  hubCache.set(key, { at: Date.now(), hubs: fresh });
  return (ctx.cache.hubs = fresh);
}

/** The graph's drug chokepoints, for checking what a model says about them against what the algorithm returned. */
export const drugChokepoints = (ctx: ToolContext) => hubs(ctx);

export const TOOLS: ToolSpec[] = [
  {
    name: 'get_patient_context',
    description:
      'Load the patient under review: age, diagnoses with dates, and every medication with start date, dose, prescriber and the indication charted on the prescription.',
    roles: ['detective', 'domino'],
    write: false,
    parameters: { type: 'object', properties: {} },
    schema: z.object({}).strict(),
    async run(ctx) {
      const p = ctx.cache.analysis?.patient ?? (await loadPatient(ctx.patientId, ctx.tracer));
      const conds = p.conditions.map((c) => `${c.name} (since ${dayToLabel(c.since)})`).join('; ') || 'none recorded';
      const meds = p.meds
        .map(
          (m) =>
            `${m.id}: ${m.name} ${m.dose}, started ${dayToLabel(m.start)} by ${m.prescriber}${m.indication ? `, charted for ${EFFECT[m.indication]?.name ?? m.indication}` : ', no indication charted'}`,
        )
        .join('\n');
      const notChecked = p.headline?.match(NOT_CHECKED)?.[0];
      return {
        summary: `${p.name}, ${p.age}${p.sex}. The synthetic record runs to ${dayToLabel(TODAY_DAY)}, which is "today" for every timing below.\nDiagnoses: ${conds}\nMedications (${p.meds.length}):\n${meds}${notChecked ? `\n${notChecked} Say so in any answer about this list: not in the graph is not the same as safe.` : ''}`,
        data: { name: p.name, meds: p.meds.length },
      };
    },
  },
  {
    name: 'recall_memory',
    description:
      'Recall what the care team decided about this patient in earlier sessions (verified, signed decisions), earlier review runs, team notes (handovers, protocols, chats) that concern this patient, and learned procedures. Respect these decisions: do not re-raise a link the team marked intentional or not a cascade.',
    roles: ['detective', 'pharmacist', 'domino'],
    write: false,
    parameters: { type: 'object', properties: {} },
    schema: z.object({}).strict(),
    async run(ctx) {
      const a = await analysis(ctx);
      const rows = await run<{ runs: { at: number; mode: string; summary: string | null; likely: number | null }[] }>(
        Q.memory,
        { pid: ctx.patientId },
        ctx.tracer,
      );
      const fb = await run<{ pattern: string; verdict: string; n: number }>(Q.patternFeedback, {}, ctx.tracer);
      const procs = await run<{ procedure: { key: string; version: number; role: string; minTier: string; reason: string }; pattern: string | null }>(
        Q.procedures,
        {},
        ctx.tracer,
      );
      const decisions = a.decisions.map(
        (d) => `${d.from}>${d.to}: ${d.verdict} by ${d.by} on ${dayToLabel(d.day)}: "${cleanText(d.reason, 240)}"${d.verified ? '' : ' (UNVERIFIED, ignored)'}`,
      );
      const runs = (rows[0]?.runs ?? [])
        .filter((r) => r && r.at)
        .map((r) => `${new Date(r.at).toISOString().slice(0, 10)} (${r.mode}): ${cleanText(r.summary ?? '', 200)}`);
      const feedback = fb.map((f) => `${f.pattern}: ${f.n}× ${f.verdict}`);
      // Team notes people wrote (handovers, protocols, chats) that concern this patient. Untrusted human text, so it
      // never reaches a model as text: Domino reads each note itself (the same negation-aware reading as when a note is
      // saved) for the symptoms it reports, and the graph says which of this patient's drugs can cause them and
      // whether one already treats them. The model gets the title and those graph facts.
      const docs = await run<{ kind: string; title: string; text: string | null; by: string; at: number; direct: boolean; effects: string[] }>(
        Q.patientDocs,
        { pid: ctx.patientId },
        ctx.tracer,
      );
      const reports: { note: string; effect: string; effectName: string; causedBy: string[]; treatedWith: string[] }[] = [];
      const notes: string[] = [];
      for (const d of docs) {
        let line = `${d.kind} by ${d.by}, ${new Date(d.at).toISOString().slice(0, 10)}${d.direct ? ' (names this patient)' : ''}: "${cleanText(d.title, 120)}"`;
        const said = d.direct && d.effects?.length ? affirmedEffects(`${d.title}. ${d.text ?? ''}`, d.effects) : [];
        if (said.length) {
          const rows = await run<{ effect: string; effectName: string; drugName: string; treatedWith: { name: string }[] }>(
            Q.noteCulprits,
            { pid: ctx.patientId, effects: said },
            ctx.tracer,
          );
          for (const e of said) {
            const mine = rows.filter((r) => r.effect === e);
            const r = {
              note: cleanText(d.title, 120),
              effect: e,
              effectName: mine[0]?.effectName ?? EFFECT[e]?.name ?? e,
              causedBy: [...new Set(mine.map((x) => x.drugName))],
              treatedWith: [...new Set(mine.flatMap((x) => (x.treatedWith ?? []).map((t) => t.name)))],
            };
            reports.push(r);
            line += ` Reports ${r.effectName.toLowerCase()}${r.causedBy.length ? `, which ${r.causedBy.join(' or ')} on this list can cause${r.treatedWith.length ? `; ${r.treatedWith.join(', ')} already treats it` : '; nothing on the list treats it yet'}` : ', which none of this patient’s drugs is known to cause'}.`;
          }
        }
        notes.push(line);
      }
      return {
        summary: [
          `Decisions on record: ${decisions.length ? '\n- ' + decisions.join('\n- ') : 'none'}`,
          `Earlier reviews: ${runs.length ? '\n- ' + runs.join('\n- ') : 'none'}`,
          `Clinician feedback across all patients: ${feedback.length ? feedback.join('; ') : 'none yet'}`,
          `Team notes about this patient or these medicines: ${notes.length ? '\n- ' + notes.join('\n- ') : 'none'}`,
          `Learned procedures (procedural memory): ${procs.length ? '\n- ' + procs.map((p) => `${p.pattern ?? 'default'} v${p.procedure.version}: tasks to the ${p.procedure.role}, minimum tier ${p.procedure.minTier}. ${cleanText(p.procedure.reason, 240)}`).join('\n- ') : 'default only'}`,
          a.memoryWarnings.length ? `Warnings: ${a.memoryWarnings.join(' ')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        data: { decisions: a.decisions.length, runs: runs.length, notes: notes.length, reports },
      };
    },
  },
  {
    name: 'find_cascades',
    description:
      'Walk the medication graph for this patient: every link where one of their drugs causes an effect another of their drugs treats, scored for timing, other reasons and documented evidence; multi-hop chains grouped by root drug; and feedback loops.',
    roles: ['detective', 'domino'],
    write: false,
    parameters: { type: 'object', properties: {} },
    schema: z.object({}).strict(),
    async run(ctx) {
      const a = await analysis(ctx);
      const shown = a.links.filter((l) => l.tier !== 'excluded').slice(0, 14);
      const trees = a.trees.map(
        (t) =>
          `Root ${t.root} (${t.tier}, ${t.score.toFixed(2)}): ${t.chains.map((c) => c.drugs.join(' → ')).join(' | ')}; if reviewed, possibly unneeded: ${t.untangle.unnecessary.map((u) => u.id).join(', ') || 'none'}`,
      );
      const loops = a.loops.map((l) => l.steps.map((s) => `${s.fromName} → ${s.effectName.toLowerCase()}`).join(' → ') + ' → (back)');
      const excluded = a.links.filter((l) => l.tier === 'excluded').length;
      return {
        summary: [
          `Links (${a.summary.likely} likely, ${a.summary.possible} possible, ${a.summary.intentional} intentional, ${excluded} ruled out by start order):`,
          ...shown.map((l) => '- ' + linkLine(l)),
          `Cascade trees:${trees.length ? '\n- ' + trees.join('\n- ') : ' none'}`,
          `Feedback loops:${loops.length ? '\n- ' + loops.join('\n- ') : ' none'}`,
        ].join('\n'),
        data: { likely: a.summary.likely, possible: a.summary.possible, trees: a.trees.length },
      };
    },
  },
  {
    name: 'check_harms',
    description:
      'Check combined harm for this patient: side-effect pile-ups, drugs that lead to falls, fractures or kidney injury, dangerous named combinations (triple whammy, bleeding stack, sedation stack), anticholinergic burden and AGS Beers 2023 flags.',
    roles: ['detective', 'pharmacist', 'domino'],
    write: false,
    parameters: { type: 'object', properties: {} },
    schema: z.object({}).strict(),
    async run(ctx) {
      const a = await analysis(ctx);
      return {
        summary: [
          `Dangerous combinations: ${a.combos.length ? a.combos.map((c) => `${c.title} (${c.drugs.join(' + ')}): ${c.why}`).join(' | ') : 'none'}`,
          `Harm paths: ${a.harms.map((h) => `${h.harmName}: ${h.drugs.map((d) => d.name).join(', ')}`).join(' | ') || 'none'}`,
          `Pile-ups: ${
            a.pileups
              .slice(0, 6)
              .map((p) => `${p.name} from ${p.drugs.map((d) => d.name).join(' + ')}`)
              .join(' | ') || 'none'
          }`,
          `Anticholinergic burden: ${a.acb.total}${a.acb.total >= 3 ? ' (3 or more is linked to cognitive decline and falls)' : ''} from ${a.acb.drugs.map((d) => `${d.name} ${d.acb}`).join(', ') || 'no drugs'}`,
          `Beers 2023 flags: ${a.beers.map((b) => `${b.name}: ${b.note}`).join(' | ') || 'none'}`,
        ].join('\n'),
        data: { combos: a.combos.length, acb: a.acb.total },
      };
    },
  },
  {
    name: 'explain_link',
    description:
      'Explain one cascade link with its evidence: every scoring factor, the documented pattern and references, real-world signal strength, and the question a pharmacist should ask.',
    roles: ['pharmacist', 'domino'],
    write: false,
    parameters: {
      type: 'object',
      properties: { from: { type: 'string', description: 'drug id of the first drug' }, to: { type: 'string', description: 'drug id of the second drug' } },
      required: ['from', 'to'],
    },
    schema: z.object({ from: drugId, to: drugId }).strict(),
    async run(ctx, args) {
      const a = await analysis(ctx);
      const l = a.links.find((x) => x.from === args.from && x.to === args.to);
      if (!l) throw new ToolError(`No graph link from ${args.from} to ${args.to} for this patient. Known links: ${a.links.map((x) => x.key).join(', ')}`);
      const pat = l.patterns[0];
      return {
        summary: [
          linkLine(l),
          ...l.factors.map((f) => `- ${f.name} ×${f.value}: ${f.note}`),
          pat
            ? `Pattern: ${pat.title}. Evidence: ${pat.refs.map((r) => REF[r]?.short ?? r).join('; ')}.`
            : 'No documented pattern; inferred from the knowledge graph.',
          pat?.realWorld
            ? `Real-world signal: adjusted sequence ratio ${pat.realWorld.asr} (95% CI ${pat.realWorld.lo}–${pat.realWorld.hi}), prevalence ${pat.realWorld.prevalence}% (${pat.realWorld.note}).`
            : '',
          pat?.realWorldNegative ? `Real-world note: ${pat.realWorldNegative}` : '',
          pat?.intentional ? `Often intentional: ${pat.intentional}` : '',
          pat ? `Question for the pharmacist: ${pat.question}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        data: { key: l.key, tier: l.tier, score: l.score },
      };
    },
  },
  {
    name: 'find_safer_alternatives',
    description:
      'For a root drug and the effect it causes, find drugs that treat the same diagnosis, do not cause that effect, and check them against the patient’s diagnoses, current drugs (pile-ups) and class conflicts. Returns options for a pharmacist to consider, not a prescription.',
    roles: ['pharmacist', 'domino'],
    write: false,
    parameters: {
      type: 'object',
      properties: {
        drug: { type: 'string', description: 'drug id of the root drug' },
        effect: { type: 'string', description: 'effect id it causes, e.g. peripheral_edema' },
      },
      required: ['drug', 'effect'],
    },
    schema: z.object({ drug: drugId, effect: effectId }).strict(),
    async run(ctx, args) {
      const a = await analysis(ctx);
      requireMed(a, String(args.drug));
      const rows = await run<{
        id: string;
        name: string;
        clsName: string;
        line: string;
        forCondition: string;
        acb: number;
        beers: string | null;
        conflicts: string[];
        worsens: string[];
        adds: string[];
      }>(Q.alternatives, { pid: ctx.patientId, drug: args.drug, effect: args.effect }, ctx.tracer);
      // An option is left out, not just ranked lower, when it would duplicate a class the patient already takes
      // (enalapril on top of lisinopril), clash with one (AVOID_WITH), or join a dangerous combination with what
      // she keeps taking (spironolactone with lisinopril and potassium). The graph knows all three, so say why.
      const k = await knowledge(ctx.tracer);
      const others = a.patient.meds.filter((m) => m.id !== String(args.drug));
      const left: string[] = [];
      const safe = rows.filter((r) => {
        const cls = k.drugs.get(r.id)?.cls;
        const same = cls ? others.find((m) => m.cls === cls) : undefined;
        if (same) return left.push(`${r.name} (same class as ${same.name}, already taken)`), false;
        if (r.conflicts.length) return left.push(`${r.name} (${r.conflicts[0]})`), false;
        const joins = cls ? matchCombos([...others, { cls }], k.combos).filter((c) => c.groups.some((g) => g.includes(cls))) : [];
        if (joins.length) return left.push(`${r.name} (would join ${joins.map((c) => c.title).join(', ')})`), false;
        return true;
      });
      const why = left.length ? `\nLeft out: ${left.join('; ')}.` : '';
      const scored = safe
        .map((r) => ({
          ...r,
          penalty: r.conflicts.length * 3 + r.worsens.length * 2 + r.adds.length + (r.beers ? 2 : 0) + Number(r.acb || 0) + (r.line === 'first' ? 0 : 1),
        }))
        .sort((x, y) => x.penalty - y.penalty)
        .slice(0, 6);
      return {
        summary: scored.length
          ? `Options that treat the same diagnosis without causing ${EFFECT[String(args.effect)]?.name ?? args.effect}:\n` +
            scored
              .map(
                (r) =>
                  `- ${r.name} (${r.clsName}, ${r.line}-line for ${r.forCondition})${r.conflicts.length ? `; CONFLICT: ${r.conflicts.join(' ')}` : ''}${r.worsens.length ? `; may worsen ${r.worsens.join(', ')}` : ''}${r.adds.length ? `; adds to existing ${r.adds.join(', ')}` : ''}${r.beers ? `; Beers: ${r.beers}` : ''}`,
              )
              .join('\n') +
            '\nAlso consider: a lower dose of the current drug, if its effect is dose-related.' +
            why
          : `No alternative in the graph treats the same diagnosis without that effect or a clash with her other medicines. Consider dose review instead.${why}`,
        data: { options: scored.map((r) => r.id) },
      };
    },
  },
  {
    name: 'simulate_untangle',
    description:
      'What-if: if this root drug were reviewed and changed, which downstream drugs might no longer be needed, and how pill count, anticholinergic burden, fall-risk drugs and dangerous combinations would change.',
    roles: ['pharmacist', 'domino'],
    write: false,
    parameters: { type: 'object', properties: { drug: { type: 'string', description: 'drug id of the root drug' } }, required: ['drug'] },
    schema: z.object({ drug: drugId }).strict(),
    async run(ctx, args) {
      const a = await analysis(ctx);
      requireMed(a, String(args.drug));
      const tree = a.trees.find((t) => t.root === args.drug);
      if (!tree) throw new ToolError(`${args.drug} is not the root of a cascade for this patient. Roots: ${a.trees.map((t) => t.root).join(', ') || 'none'}.`);
      const u = tree.untangle;
      return {
        summary: `If ${u.removedName} were reviewed: ${u.unnecessary.length ? u.unnecessary.map((x) => `${x.name}${x.planned ? ' (planned companion)' : ''}`).join(', ') + ' might no longer be needed' : 'no downstream drug becomes unneeded'}. Medicines ${u.pillsBefore} → ${u.pillsAfter}; anticholinergic burden ${u.acbBefore} → ${u.acbAfter}; fall-risk drugs ${u.fallDrugsBefore} → ${u.fallDrugsAfter}${u.combosResolved.length ? `; resolves ${u.combosResolved.join(', ')}` : ''}.${u.alsoContributing.length ? ` Also contributing: ${u.alsoContributing.map((c) => `${c.fromName} → ${c.effect}`).join(', ')} (review together).` : ''}${tapers(u)}`,
        data: u,
      };
    },
  },
  {
    name: 'population_signal',
    description:
      'Check the population: across all patients, does the second drug’s class start after the first drug’s class more often than before it (prescription sequence symmetry analysis, adjusted for prescribing trends)? Also returns the published real-world signal if one exists.',
    roles: ['pharmacist', 'domino'],
    write: false,
    parameters: {
      type: 'object',
      properties: { from: { type: 'string', description: 'drug id of the first drug' }, to: { type: 'string', description: 'drug id of the second drug' } },
      required: ['from', 'to'],
    },
    schema: z.object({ from: drugId, to: drugId }).strict(),
    async run(ctx, args) {
      const fa = DRUG[String(args.from)];
      const fb = DRUG[String(args.to)];
      if (!fa || !fb) throw new ToolError('Unknown drug id.');
      const rows = await pssaCached(ctx.tracer);
      const s = rows.find((r) => r.a === fa.cls && r.b === fb.cls);
      const pat = PATTERNS.find((p) => p.index.includes(fa.cls) && p.marker.includes(fb.cls));
      const lines = [
        s
          ? `Synthetic cohort: ${CLASS[fb.cls]?.name ?? fb.cls} started after ${CLASS[fa.cls]?.name ?? fa.cls} ${s.fwd} times and before it ${s.rev} times within a year. Adjusted sequence ratio ${s.asr} (95% CI ${s.lo}–${s.hi})${s.signal ? ', a signal' : ', not a clear signal'}.${s.via.length ? ` Mechanism in graph: via ${s.via.join(', ')}.` : ' No mechanism path in the graph.'}`
          : `Too few patients in the synthetic cohort start both ${CLASS[fa.cls]?.name ?? fa.cls} and ${CLASS[fb.cls]?.name ?? fb.cls} to measure a sequence signal.`,
        pat?.realWorld ? `Published: ${pat.title}: aSR ${pat.realWorld.asr} (${pat.realWorld.lo}–${pat.realWorld.hi}), ${pat.realWorld.note}.` : '',
        pat?.realWorldNegative ? `Published: ${pat.realWorldNegative}` : '',
      ];
      return { summary: lines.filter(Boolean).join('\n'), data: s ?? null };
    },
  },
  {
    name: 'find_chokepoints',
    description:
      'Graph algorithm: run FalkorDB betweenness centrality over the whole cascade graph (drugs and effects joined by CAUSES and TREATED_BY) and report which of this patient’s drugs and diagnoses are chokepoints, nodes that many possible cascades pass through.',
    roles: ['pharmacist', 'domino'],
    write: false,
    parameters: { type: 'object', properties: {} },
    schema: z.object({}).strict(),
    async run(ctx) {
      const a = await analysis(ctx);
      const rows = await run<{ label: string; id: string; name: string; score: number }>(Q.chokepoints, {}, ctx.tracer);
      ctx.cache.hubs = toHubs(rows);
      hubCache.set(await graphName(), { at: Date.now(), hubs: ctx.cache.hubs });
      const mine = new Set([...a.patient.meds.map((m) => m.id), ...a.patient.conditions.map((c) => c.id)]);
      const hits = rows.filter((r) => mine.has(r.id));
      const inChains = a.trees.flatMap((t) => [t.root, ...t.downstream]).filter((id) => ctx.cache.hubs!.some((h) => h.id === id));
      return {
        summary:
          // Drugs and symptoms listed apart: a symptom (hypertension) is where cascades converge, a drug is what a
          // review can change, and only drug chokepoints set task priority.
          `Drug chokepoints in the graph (betweenness centrality, the top ${ctx.cache.hubs.length}): ${ctx.cache.hubs
            .map((r) => `${r.name} (${r.score})`)
            .join(', ')}.\n` +
          `Symptoms where many cascades converge: ${rows
            .filter((r) => r.label !== 'Drug')
            .slice(0, 4)
            .map((r) => `${r.name} (${Math.round(r.score)})`)
            .join(', ')}.\n` +
          (hits.length
            ? `On this patient's record: ${hits.map((r) => `${r.name} (${r.label === 'Drug' ? 'drug' : 'diagnosis'}, betweenness ${Math.round(r.score)})`).join(', ')}. A change here can affect many routes at once.`
            : 'None of this patient’s drugs or diagnoses are among the top chokepoints.') +
          (inChains.length
            ? `\nIn this patient's cascades: ${[...new Set(inChains)].map((id) => ctx.cache.hubs!.find((h) => h.id === id)!.name).join(', ')} ${inChains.length === 1 ? 'is a drug chokepoint' : 'are drug chokepoints'}, so review tasks for those cascades are prioritised (due in half the usual time).`
            : ''),
        data: { hits: hits.map((h) => h.id), inChains: [...new Set(inChains)] },
      };
    },
  },
  {
    name: 'trace_route',
    description:
      'Graph algorithm: allShortestPaths over CAUSES and TREATED_BY between two drugs in the whole knowledge graph. Answers "how could drug A lead to drug B?", even through drugs this patient does not take.',
    roles: ['pharmacist', 'domino'],
    write: false,
    parameters: {
      type: 'object',
      properties: { from: { type: 'string', description: 'drug id where the route starts' }, to: { type: 'string', description: 'drug id where it ends' } },
      required: ['from', 'to'],
    },
    schema: z.object({ from: drugId, to: drugId }).strict(),
    async run(ctx, args) {
      // Names resolved against the graph first: "no route" must never stand in for "not in the graph".
      const k = await knowledge(ctx.tracer);
      if (!k.drugs.has(String(args.from)) || !k.drugs.has(String(args.to))) throw new ToolError('Unknown drug id: not in the knowledge graph. Resolve it with resolve_drug first.');
      const rows = await run<{ nodes: { id: string; name: string; label: string }[] }>(Q.shortest, { from: args.from, to: args.to }, ctx.tracer);
      if (!rows.length) return { summary: `No cascade route from ${args.from} to ${args.to} within 10 steps.`, data: { routes: 0 } };
      return {
        summary:
          `${rows.length} shortest route(s), ${Math.floor((rows[0].nodes.length - 1) / 2)} step(s):\n` +
          rows
            .slice(0, 5)
            .map((r) => '- ' + r.nodes.map((n) => n.name).join(' → '))
            .join('\n'),
        data: { routes: rows.length },
      };
    },
  },
  {
    name: 'resolve_drug',
    description:
      'Resolve a medicine the question names (generic, brand or plain alias) against the knowledge graph, and say whether this patient takes it. If they do not, it runs the prescriber check to say what adding it would mean. Call it for any medicine that is not in get_patient_context before reasoning about it. If it is not in the graph, say that Domino cannot check it and stop: never guess.',
    roles: ['pharmacist', 'domino'],
    write: false,
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'the medicine name as written in the question' } },
      required: ['name'],
    },
    schema: z.object({ name: z.string().min(2).max(80) }).strict(),
    async run(ctx, args) {
      const name = cleanText(String(args.name), 80).replace(/["“”]/g, '');
      const k = await knowledge(ctx.tracer);
      const matches = await matchMedications([name], ctx.tracer);
      if (!matches.length)
        return {
          summary: `“${name}” is not a medicine in Domino’s knowledge graph (${k.drugs.size} medicines), so Domino has no data on it and cannot check it. Not being in the graph does not mean it is safe.`,
          data: { found: false, name },
        };
      const a = await analysis(ctx);
      const lines: string[] = [];
      for (const m of matches.slice(0, 2)) {
        const mine = a.patient.meds.find((x) => x.id === m.id);
        if (mine) {
          lines.push(`${m.name} is on ${a.patient.name}’s list, started ${dayToLabel(mine.start)}${mine.prescriber ? ` by ${mine.prescriber}` : ''}.`);
          continue;
        }
        const check = await checkPrescription(ctx.patientId, m.id, ctx.tracer);
        lines.push(`${m.name} is not on ${a.patient.name}’s list. If it were prescribed, the prescriber check says (${check.verdict.replace(/_/g, ' ')}): ${check.headline}`);
      }
      return {
        summary: lines.join('\n'),
        data: { found: true, matches: matches.slice(0, 2).map((m) => ({ id: m.id, name: m.name, onList: a.patient.meds.some((x) => x.id === m.id) })) },
      };
    },
  },
  {
    name: 'record_findings',
    description:
      'ACTION: record cascade links as Findings in the graph for the care team. Only record likely or possible links that are not intentional. Use link keys from find_cascades, e.g. "amlodipine>furosemide".',
    roles: ['detective'],
    write: true,
    parameters: {
      type: 'object',
      properties: { links: { type: 'array', items: { type: 'string' }, description: 'link keys, e.g. ["amlodipine>furosemide"]' } },
      required: ['links'],
    },
    schema: z.object({ links: z.array(linkKey).min(1).max(LIMITS.findings) }).strict(),
    async run(ctx, args) {
      if (!ctx.runId) throw new ToolError('Findings can only be recorded during a review run.');
      const a = await analysis(ctx);
      // A link is recorded once per run, even if the model and then the planner (after a model failure) both record it.
      const already = keys0(args.links as string[]).filter((k) => ctx.artifacts.findingKeys.includes(k));
      const keys = keys0(args.links as string[]).filter((k) => !ctx.artifacts.findingKeys.includes(k));
      if (!keys.length) return { summary: `Already recorded in this run: ${already.join(', ')}.`, data: { recorded: 0 } };
      const chosen = keys.map((k) => a.links.find((l) => l.key === k)).filter((l): l is Link => !!l && (l.tier === 'likely' || l.tier === 'possible'));
      const rejected = keys.filter((k) => !chosen.some((l) => l.key === k));
      if (ctx.counters.findings + chosen.length > LIMITS.findings) throw new ToolError(`Limit of ${LIMITS.findings} findings per run reached.`);
      if (!chosen.length)
        throw new ToolError(
          `None of those keys are likely or possible links. Valid keys: ${
            a.links
              .filter((l) => l.tier === 'likely' || l.tier === 'possible')
              .map((l) => l.key)
              .join(', ') || 'none'
          }`,
        );
      const at = Date.now();
      if (ctx.counters.findings === 0) await run(Q.closeFindings, { pid: ctx.patientId }, ctx.tracer);
      const findings = chosen.map((l) => ({
        id: `f-${randomUUID()}`,
        key: `${ctx.patientId}:${l.key}`,
        from: l.from,
        to: l.to,
        effect: l.effect,
        label: l.patterns[0]?.title ?? `${l.fromName} → ${l.effectPlain.toLowerCase()} → ${l.toName}`,
        chain: `${l.fromName} → ${l.toName}`,
        score: l.score,
        tier: l.tier,
        pattern: l.patterns[0]?.id ?? null,
        evidence: l.patterns[0]?.evidence ?? 'graph',
        factors: l.factors.map((f) => `${f.name} ×${f.value}: ${f.note}`).join('\n'),
        decision: l.decision?.verified ? l.decision.id : null,
      }));
      await run(Q.recordFindings, { pid: ctx.patientId, run: ctx.runId, at, findings, step: ctx.step }, ctx.tracer);
      ctx.counters.findings += findings.length;
      ctx.artifacts.findingKeys.push(...chosen.map((l) => l.key));
      for (const f of findings) {
        ctx.artifacts.findings.push(f.chain);
        ctx.emit({ type: 'finding', agent: ctx.role, id: f.id, label: f.chain, tier: f.tier, score: f.score });
      }
      return {
        summary: `Recorded ${findings.length} finding(s): ${chosen.map((l) => l.key).join(', ')}.${rejected.length ? ` Skipped (not likely/possible): ${rejected.join(', ')}.` : ''}`,
        data: { recorded: findings.length },
      };
    },
  },
  {
    name: 'propose_task',
    description:
      'ACTION: propose a task for a human on the care team (it stays "proposed" until a clinician approves it). Phrase it as a review question, never an instruction to change a medicine.',
    roles: ['scribe'],
    write: true,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'short title, under 100 characters' },
        body: { type: 'string', description: 'what to check and why, with the evidence, under 700 characters' },
        role: { type: 'string', enum: ['pharmacist', 'prescriber', 'nurse'] },
        due_in_days: { type: 'integer', description: '1 to 60' },
        link: { type: 'string', description: 'optional link key this task is about' },
      },
      required: ['title', 'body', 'role', 'due_in_days'],
    },
    schema: z
      .object({
        title: z.string().min(4).max(120),
        body: z.string().min(10).max(900),
        role: z.enum(['pharmacist', 'prescriber', 'nurse']),
        due_in_days: z.number().int().min(1).max(60),
        link: linkKey.optional(),
      })
      .strict(),
    async run(ctx, args) {
      if (!ctx.runId) throw new ToolError('Tasks can only be proposed during a review run.');
      if (ctx.counters.tasks >= LIMITS.tasks) throw new ToolError(`Limit of ${LIMITS.tasks} tasks per run reached.`);
      const title = cleanText(args.title, 120);
      const body = cleanText(args.body, 900);
      const guard = checkClinicalWording(`${title} ${body}`);
      if (!guard.ok) throw new ToolError(guard.reason!);
      const a = await analysis(ctx);
      const link = args.link ? a.links.find((l) => l.key === args.link) : undefined;
      if (args.link && !link) throw new ToolError(`No link ${args.link} for this patient.`);
      const by = link ? a.patient.meds.find((m) => m.id === link.from)?.prescriber : undefined;
      const owner = by && by !== 'Not recorded' ? by : null;
      // A graph algorithm decides priority: if a drug in this cascade is one of the graph's chokepoints (betweenness
      // centrality), reviewing it can untangle many routes, so the task is due sooner and says why.
      const tree = link ? a.trees.find((t) => t.chains.some((c) => c.links.some((l) => l.key === link.key))) : undefined;
      const chain = tree ? [tree.root, ...tree.downstream] : link ? [link.from, link.to] : [];
      const hub = chain.length ? ((await hubs(ctx)).find((h) => chain.includes(h.id)) ?? null) : null;
      const full = hub
        ? `${body} Prioritised: ${hub.name} in this cascade is a chokepoint of the cascade graph (FalkorDB betweenness ${hub.score}), so its review can untangle many routes.`.slice(0, 1100)
        : body;
      const res = await proposeTask({
        pid: ctx.patientId,
        runId: ctx.runId,
        title,
        body: full,
        hub: hub ? { name: hub.name, score: hub.score } : null,
        role: args.role as 'pharmacist' | 'prescriber' | 'nurse',
        dueInDays: link ? undefined : Number(args.due_in_days),
        link: link?.key ?? null,
        pattern: link?.patterns[0]?.id ?? null,
        tier: link && (link.tier === 'likely' || link.tier === 'possible') ? link.tier : null,
        owner,
        step: ctx.step,
        tracer: ctx.tracer,
      });
      if (!res.proposed) {
        if (res.existing) ctx.counters.alreadyOpen = (ctx.counters.alreadyOpen ?? 0) + 1;
        return { summary: res.reason, data: { skipped: true, existing: res.existing?.id ?? null } };
      }
      ctx.counters.tasks++;
      ctx.artifacts.tasks.push({ id: res.id, title });
      ctx.emit({
        type: 'task',
        agent: ctx.role,
        id: res.id,
        title,
        role: res.role,
        owner: res.owner ?? undefined,
        memory: res.routedByMemory ? `v${res.procedure.version}: ${res.procedure.reason}` : undefined,
      });
      const memo = res.procedure.key !== 'default' ? ` Procedural memory v${res.procedure.version} applied: ${res.procedure.reason}` : '';
      return {
        summary: `Proposed task ${res.id} for the ${res.role}${res.owner ? ` (root drug prescribed by ${res.owner})` : ''}: "${title}". It is waiting for human approval.${memo}${hub ? ` Prioritised by the graph: ${hub.name} is a cascade chokepoint (betweenness ${hub.score}).` : ''}`,
        data: { id: res.id, role: res.role },
      };
    },
  },
  {
    name: 'draft_note',
    description:
      'ACTION: save a drafted note. kind "prescriber": a short SBAR-style note for the prescriber. kind "patient": a plain-language note for the patient or family (reading age about 12, no jargon). Notes stay drafts for a human to edit and send.',
    roles: ['scribe'],
    write: true,
    parameters: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['prescriber', 'patient'] }, text: { type: 'string', description: 'the note, under 2500 characters' } },
      required: ['kind', 'text'],
    },
    schema: z.object({ kind: z.enum(['prescriber', 'patient']), text: z.string().min(40).max(3000) }).strict(),
    async run(ctx, args) {
      if (!ctx.runId) throw new ToolError('Notes can only be drafted during a review run.');
      if (ctx.counters.notes >= LIMITS.notes) throw new ToolError(`Limit of ${LIMITS.notes} notes per run reached.`);
      const text = cleanText(args.text, 3000);
      const guard = checkClinicalWording(text);
      if (!guard.ok) throw new ToolError(guard.reason!);
      const id = `n-${randomUUID()}`;
      await run(Q.saveNote, { pid: ctx.patientId, run: ctx.runId, id, kind: args.kind, text, at: Date.now(), step: ctx.step }, ctx.tracer);
      ctx.counters.notes++;
      ctx.artifacts.notes.push({ id, kind: String(args.kind) });
      ctx.emit({ type: 'note', agent: ctx.role, id, kind: String(args.kind), text });
      return { summary: `Saved ${args.kind} note ${id} as a draft.`, data: { id } };
    },
  },
];

export const TOOL = lookup(TOOLS.map((t) => ({ ...t, id: t.name })));

export function toolsFor(role: AgentRole): ToolSpec[] {
  return TOOLS.filter((t) => t.roles.includes(role));
}

export async function callTool(
  ctx: ToolContext,
  name: string,
  rawArgs: unknown,
): Promise<{ ok: boolean; summary: string; data?: unknown; ms: number; queries: { id: string; title: string; ms: number; rows: number }[] }> {
  const t0 = performance.now();
  const queries: { id: string; title: string; ms: number; rows: number }[] = [];
  const tool = TOOL[name];
  const outer = ctx.tracer;
  const local: ToolContext = {
    ...ctx,
    tracer: (t) => {
      queries.push({ id: t.id, title: t.title, ms: t.ms, rows: t.rows });
      outer(t);
    },
  };
  try {
    if (!tool || !tool.roles.includes(ctx.role)) throw new ToolError(`Tool "${name}" is not available to the ${ctx.role} agent.`);
    const parsed = tool.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) throw new ToolError(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')}`);
    const res = await tool.run(local, parsed.data as Record<string, unknown>);
    return { ok: true, summary: res.summary, data: res.data, ms: Math.round(performance.now() - t0), queries };
  } catch (err) {
    const msg = err instanceof ToolError ? err.message : 'The tool failed unexpectedly. Try a different approach.';
    if (!(err instanceof ToolError)) console.error(`[domino] tool ${name} failed:`, err instanceof Error ? err.message : err);
    return { ok: false, summary: `ERROR: ${msg}`, ms: Math.round(performance.now() - t0), queries };
  }
}
