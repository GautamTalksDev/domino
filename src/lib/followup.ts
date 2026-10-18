// Closing the loop. When a person marks a review task done ("amlodipine reviewed"), the agents schedule their own
// follow-up about four weeks out: has the symptom that started the cascade settled, and if so, could the medicines
// that were only there because of it be reviewed too (with the taper warnings the untangle already knows)? The
// follow-up is a signed task like any other, and FOLLOWS_UP links it to the task it continues.

import { run, type Tracer } from './db';
import { Q } from './cypher';
import { analyzePatient } from './engine/analyze';
import { proposeTask } from './agent/actions';
import { checkClinicalWording } from './agent/guard';
import { TODAY_DAY } from '../data/time';

export const FOLLOW_UP_DAYS = 28;

export interface FollowUp {
  id: string;
  title: string;
  due: number;
  downstream: string[];
}

export async function scheduleFollowUp(
  task: { id: string; title: string; patientId: string; finding: string | null; role: string },
  doneBy: string,
  tracer?: Tracer,
): Promise<FollowUp | null> {
  if (!task.finding || !/^[a-z0-9_]+>[a-z0-9_]+$/.test(task.finding)) return null;
  const a = await analyzePatient(task.patientId, { tracer });
  // The follow-up is about the task's own link, and only while the engine still rates it a cascade: if a clinician has
  // since signed it as intentional or not a cascade, or the evidence changed, there is nothing to follow up.
  const link = a.links.find((l) => l.key === task.finding);
  if (!link || !(link.tier === 'likely' || link.tier === 'possible')) return null;
  if (link.decision && link.decision.verdict !== 'confirmed') return null;
  // The medicines that may only be there because of this link: those after it on its chains, which the untangle of
  // its tree also finds unnecessary (and that were not planned).
  const tree = a.trees.find((t) => t.chains.some((c) => c.links.some((l) => l.key === link.key)));
  const after = new Set<string>();
  for (const c of tree?.chains ?? []) {
    const i = c.links.findIndex((l) => l.key === link.key);
    if (i >= 0) for (const l of c.links.slice(i)) after.add(l.to);
  }
  const rootName = link.fromName;
  const symptom = link.effectPlain.toLowerCase();
  const downstream = (tree?.untangle.unnecessary ?? []).filter((u) => !u.planned && after.has(u.id));
  const tapers = downstream.filter((u) => u.taper).map((u) => `${u.name}: ${u.taper}`);
  const title = `Follow up: has the ${symptom} settled since the ${rootName} review?`.slice(0, 118);
  const parts = [
    `${doneBy} marked “${task.title}” done. About four weeks on, a check-in from the agents:`,
    `has the ${symptom} settled since the ${rootName} review?`,
    downstream.length
      ? `If it has, ${downstream.map((u) => u.name).join(', ')} ${downstream.length === 1 ? 'was' : 'were'} only there because of it and may no longer be needed; worth asking the prescriber whether to review ${downstream.length === 1 ? 'it' : 'them'}.`
      : `If it has not, could something else on the list be causing it?`,
  ];
  let body = parts.join(' ');
  if (tapers.length) {
    const withTapers = `${body} Taper safety: ${tapers.join(' ')}`;
    if (checkClinicalWording(withTapers).ok) body = withTapers;
  }
  if (!checkClinicalWording(body).ok) return null;
  const res = await proposeTask({
    pid: task.patientId,
    runId: null,
    title,
    body,
    role: (['pharmacist', 'prescriber', 'nurse'].includes(task.role) ? task.role : 'pharmacist') as 'pharmacist' | 'prescriber' | 'nurse',
    dueInDays: FOLLOW_UP_DAYS,
    link: null,
    pattern: null,
    tier: 'likely',
    tracer,
  });
  if (!res.proposed) return null;
  await run(Q.linkFollowUp, { task: res.id, prev: task.id }, tracer);
  return { id: res.id, title, due: TODAY_DAY + FOLLOW_UP_DAYS, downstream: downstream.map((u) => u.name) };
}
