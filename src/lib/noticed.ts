// "Domino noticed": a person writes a handover, a chat message or minutes; when it names exactly one patient and
// reports a symptom (not its absence), the Detective reads it against that patient's slice of the graph straight away.
//
//   - a cascade in progress: one of the patient's own drugs causes the symptom AND another of their drugs is already
//     treating it (the note corroborates a link the record already shows);
//   - a prevention window: one of their drugs causes the symptom and nothing treats it yet, so this is the moment
//     before a second prescription is written.
//
// The strongest signal becomes a signed review task (the same write path, procedural memory and dedupe as every other
// task), linked back to the note with FROM_NOTE so its provenance is the person who wrote it. If that question is
// already open, the note CORROBORATES the existing task instead of claiming it.

import { run, type Tracer } from './db';
import { Q } from './cypher';
import { analyzePatient } from './engine/analyze';
import { proposeTask } from './agent/actions';
import { checkClinicalWording } from './agent/guard';
import { affirmedEffects } from './docs';
import { PATTERN } from '../data/knowledge';
import { daysBetweenLabel } from '../data/time';

export interface NoteSignal {
  pid: string;
  patient: string;
  drug: string;
  drugName: string;
  effect: string;
  effectName: string;
  effectPlain: string;
  freq: string;
  kind: 'in_progress' | 'prevention';
  /** The documented cascade this matches, if any. */
  pattern: { id: string; title: string } | null;
  /** In progress: the patient's drug(s) already treating the symptom. */
  treatedWith: { id: string; name: string; start: number }[];
  /** In progress: the link as the review engine scores it. */
  link: { key: string; tier: string; score: number } | null;
  headline: string;
  task: { id: string; title: string; role: string; status: 'proposed' | 'existing' | 'skipped'; reason?: string } | null;
}

interface CulpritRow {
  pid: string;
  patient: string;
  drug: string;
  drugName: string;
  drugStart: number;
  owner: string | null;
  effect: string;
  effectName: string;
  effectPlain: string;
  freq: string;
  weight: number;
  pattern: string | null;
  treatedWith: { id: string; name: string; start: number }[];
}

const FREQ: Record<string, string> = { very_common: 'very commonly', common: 'commonly', uncommon: 'sometimes', rare: 'rarely' };

/**
 * Why the Detective will not act on a note that does name a symptom, in words for the person who wrote it; null when it
 * will read it (or the note names no symptom, which needs no explanation).
 */
export function noteHold(doc: { title: string; text?: string }, links: { patients: string[]; effects: string[] }): string | null {
  if (!links.effects.length) return null;
  if (links.patients.length > 1)
    return 'It names more than one patient (or a name two patients share), so the Detective can’t tell whose symptom it is. One note per patient gets it checked.';
  if (links.patients.length === 1 && doc.text != null && !affirmedEffects(`${doc.title}. ${doc.text}`, links.effects).length)
    return 'Every symptom it mentions is ruled out (“no cough”, “swelling resolved”), so there is nothing to check.';
  return null;
}

/**
 * Read a saved note against the graph and propose at most one review task. To be sure who and what a note is about,
 * the Detective acts only when the note names exactly one patient (a name two patients share counts as two) and
 * reports a symptom rather than its absence ("no ankle swelling today" is not a report of swelling).
 */
export async function noticeFromNote(
  doc: { id: string; title: string; kind: string; by: string; text?: string },
  links: { patients: string[]; effects: string[] },
  tracer?: Tracer,
): Promise<NoteSignal[]> {
  if (links.patients.length !== 1 || !links.effects.length || noteHold(doc, links)) return [];
  const effects = doc.text != null ? affirmedEffects(`${doc.title}. ${doc.text}`, links.effects) : links.effects;
  if (!effects.length) return [];
  const out: NoteSignal[] = [];
  for (const pid of links.patients) {
    const rows = await run<CulpritRow>(Q.noteCulprits, { pid, effects }, tracer);
    if (!rows.length) continue;
    // The review engine is the judge of an "in progress" cascade; without it, only prevention windows can be raised.
    const analysis = await analyzePatient(pid, { tracer }).catch(() => null);
    const signals: (NoteSignal & { rank: number; owner: string | null })[] = [];
    for (const r of rows) {
      const known = r.treatedWith.filter((t) => t.start != null);
      const later = known.filter((t) => t.start >= r.drugStart);
      // Already treated by something started before this drug (or with no start date on record): neither a new cascade
      // nor a prevention window, so the note is not a signal about this drug.
      if (!later.length && r.treatedWith.length) continue;
      const kind = later.length ? 'in_progress' : 'prevention';
      const pat = r.pattern ? PATTERN[r.pattern] : undefined;
      // In progress: the engine must rate the pair itself (by its key, whatever effect it scored strongest) likely or
      // possible; a pair a clinician set aside, or one the engine rates unlikely, is not raised again from a note.
      // Only links the engine still rates likely or possible are candidates: a pair a clinician set aside keeps its score,
      // and must not hide another treater of the same symptom that is still a live cascade.
      const scored =
        kind === 'in_progress'
          ? analysis?.links.find((l) => (l.tier === 'likely' || l.tier === 'possible') && later.some((t) => l.key === `${r.drug}>${t.id}`))
          : undefined;
      if (kind === 'in_progress' && !scored) continue;
      const via = scored ? later.filter((t) => scored.key === `${r.drug}>${t.id}`) : later;
      const treated = via.map((t) => t.name).join(' and ');
      const headline =
        kind === 'in_progress'
          ? `${r.drugName} ${FREQ[r.freq] ?? 'sometimes'} causes ${r.effectPlain.toLowerCase()}, and ${treated} ${via.length > 1 ? 'were' : 'was'} started for it ${daysBetweenLabel(Math.max(...via.map((t) => t.start)) - r.drugStart)} later: a cascade in progress.`
          : `${r.drugName} ${FREQ[r.freq] ?? 'sometimes'} causes ${r.effectPlain.toLowerCase()}, and nothing is treating it yet: the moment to ask before a second prescription is written.`;
      signals.push({
        pid: r.pid,
        patient: r.patient,
        drug: r.drug,
        drugName: r.drugName,
        effect: r.effect,
        effectName: r.effectName,
        effectPlain: r.effectPlain,
        freq: r.freq,
        kind,
        pattern: pat ? { id: pat.id, title: pat.title } : null,
        treatedWith: via.map((t) => ({ id: t.id, name: t.name, start: t.start })),
        link: scored ? { key: scored.key, tier: scored.tier, score: scored.score } : null,
        headline,
        task: null,
        owner: r.owner,
        // Documented cascades first, then links the engine already rates, then how often the drug causes it.
        rank: (pat ? 2 : 0) + (scored ? scored.score : 0) + r.weight,
      });
    }
    if (!signals.length) continue;
    signals.sort((a, b) => b.rank - a.rank);
    const best = signals[0];
    best.task = await act(best, doc, tracer);
    for (const { rank, owner, ...signal } of signals.slice(0, 3)) {
      void rank;
      void owner;
      out.push(signal);
    }
  }
  return out;
}

async function act(s: NoteSignal & { owner: string | null }, doc: { id: string; title: string; kind: string; by: string }, tracer?: Tracer): Promise<NoteSignal['task']> {
  const symptom = s.effectPlain.toLowerCase();
  const source = `${doc.by}’s ${doc.kind} “${doc.title}” reports ${symptom} for ${s.patient}.`;
  const title =
    s.kind === 'in_progress' ? `Could ${symptom} be from ${s.drugName}?`.slice(0, 118) : `Before treating ${symptom}: could it be from ${s.drugName}?`.slice(0, 118);
  const body = [
    source,
    s.headline,
    s.pattern ? `This matches a documented prescribing cascade (${s.pattern.title}).` : '',
    (s.pattern && PATTERN[s.pattern.id]?.question) || `Could the ${symptom} be a side effect of ${s.drugName} rather than a new problem?`,
  ]
    .filter(Boolean)
    .join(' ');
  if (!checkClinicalWording(body).ok) return { id: '', title, role: '', status: 'skipped', reason: 'The wording guard held this back.' };
  const tier = s.kind === 'in_progress' ? (s.link?.tier === 'likely' ? 'likely' : 'possible') : s.pattern ? 'likely' : 'possible';
  const res = await proposeTask({
    pid: s.pid,
    runId: null,
    title,
    body,
    role: 'pharmacist',
    link: s.link?.key ?? null,
    pattern: s.pattern?.id ?? null,
    tier,
    owner: s.owner,
    at: Date.now(),
    tracer,
  });
  // FROM_NOTE when the note raised the task; CORROBORATES when the question was already open (it stays the agents' task).
  if (res.proposed) await run(Q.linkTaskToNote, { task: res.id, doc: doc.id }, tracer);
  else if (res.existing) await run(Q.noteCorroborates, { task: res.existing.id, doc: doc.id }, tracer);
  if (res.proposed) return { id: res.id, title, role: res.role, status: 'proposed' };
  if (res.existing) return { id: res.existing.id, title, role: res.existing.role, status: 'existing', reason: res.reason };
  return { id: '', title, role: '', status: 'skipped', reason: res.reason };
}
