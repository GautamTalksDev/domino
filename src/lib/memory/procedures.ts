// Procedural memory: how the agents act, learned from what the care team does with their work.
//
// A Procedure says, for one cascade pattern, who a review task goes to, how soon it is due, and
// whether "possible" links get a task at all. Every decided task (approved, done, dismissed) is an
// outcome. When the outcomes say a different routing works better, Domino writes a new procedure
// version that SUPERSEDES the old one and is linked to the exact tasks it LEARNED_FROM, so a person
// can always see why the agents now act differently (and the rule is plain arithmetic, not a model).

import { randomUUID } from 'node:crypto';
import { run, type Tracer } from '../db';
import { Q } from '../cypher';
import { PATTERN } from '../../data/knowledge';

export type Tier = 'possible' | 'likely';

export interface Procedure {
  id: string | null;
  key: string;
  version: number;
  role: 'pharmacist' | 'prescriber' | 'nurse';
  dueLikely: number;
  duePossible: number;
  minTier: Tier;
  reason: string;
}

export const DEFAULT_PROCEDURE: Procedure = {
  id: null,
  key: 'default',
  version: 1,
  role: 'pharmacist',
  dueLikely: 7,
  duePossible: 21,
  minTier: 'possible',
  reason: 'Starting procedure: review questions go to the clinical pharmacist, due in 7 days for likely links and 21 for possible ones.',
};

/** Smallest number of decided tasks for one role before routing can change. */
const MIN_PER_ROLE = 3;
/** Smallest number of decided tasks for a pattern before its threshold can change. */
const MIN_FOR_THRESHOLD = 5;

export async function procedureFor(pattern: string | null | undefined, tracer?: Tracer): Promise<Procedure> {
  const rows = await run<{ procedure: Procedure }>(Q.procedureFor, { key: pattern ?? 'default' }, tracer);
  return rows[0]?.procedure ? { ...DEFAULT_PROCEDURE, ...rows[0].procedure } : DEFAULT_PROCEDURE;
}

const ROLE_LABEL: Record<string, string> = { pharmacist: 'pharmacists', prescriber: 'prescribers', nurse: 'nurses' };
const rate = (acted: number, n: number) => (acted + 1) / (n + 2); // Laplace-smoothed, so 1 of 1 is not "100%"

export interface LearnResult {
  changed: boolean;
  procedure: Procedure;
  outcomes: { role: string; acted: number; dismissed: number }[];
  reason?: string;
}

/**
 * Re-learns the procedure for one pattern from its decided tasks. Writes a new version only when the
 * evidence says a different routing or threshold works better.
 */
export async function learnProcedure(key: string, tracer?: Tracer, attempt = 0): Promise<LearnResult> {
  const current = await procedureFor(key, tracer);
  const rows = await run<{ id: string; role: string; status: string; note: string | null }>(Q.taskOutcomes, { key }, tracer);
  const byRole = new Map<string, { acted: number; dismissed: number }>();
  for (const r of rows) {
    const s = byRole.get(r.role) ?? { acted: 0, dismissed: 0 };
    if (r.status === 'dismissed') s.dismissed++;
    else s.acted++;
    byRole.set(r.role, s);
  }
  const outcomes = [...byRole.entries()].map(([role, v]) => ({ role, ...v }));
  const next: Procedure = { ...current };
  const reasons: string[] = [];

  // 1. Routing: send the task to the role that acts on it.
  const eligible = outcomes.filter((o) => o.acted + o.dismissed >= MIN_PER_ROLE);
  if (eligible.length) {
    const best = eligible.reduce((a, b) => (rate(b.acted, b.acted + b.dismissed) > rate(a.acted, a.acted + a.dismissed) ? b : a));
    const cur = outcomes.find((o) => o.role === current.role);
    const curRate = cur ? rate(cur.acted, cur.acted + cur.dismissed) : 0.5;
    const bestRate = rate(best.acted, best.acted + best.dismissed);
    if (best.role !== current.role && bestRate - curRate >= 0.25) {
      next.role = best.role as Procedure['role'];
      reasons.push(
        `${cap(ROLE_LABEL[best.role])} acted on ${best.acted} of ${best.acted + best.dismissed} of these tasks` +
          (cur ? `, ${ROLE_LABEL[current.role]} on ${cur.acted} of ${cur.acted + cur.dismissed}` : '') +
          `, so they now go to the ${best.role}.`,
      );
    }
  }

  // 2. Threshold: if the team keeps dismissing these, only likely links get a task.
  const acted = outcomes.reduce((s, o) => s + o.acted, 0);
  const dismissed = outcomes.reduce((s, o) => s + o.dismissed, 0);
  const n = acted + dismissed;
  if (n >= MIN_FOR_THRESHOLD) {
    const r = rate(acted, n);
    if (r < 0.3 && current.minTier === 'possible') {
      next.minTier = 'likely';
      reasons.push(`The team dismissed ${dismissed} of ${n} of these tasks, so only likely links get a task now (possible ones stay as findings).`);
    } else if (r >= 0.6 && current.minTier === 'likely') {
      next.minTier = 'possible';
      reasons.push(`The team acted on ${acted} of ${n} of these tasks, so possible links get a task again.`);
    }
  }

  if (!reasons.length) return { changed: false, procedure: current, outcomes };

  const isPatternSpecific = current.key === key;
  const procedure: Procedure = {
    ...next,
    id: `proc-${randomUUID()}`,
    key,
    version: isPatternSpecific ? current.version + 1 : 1,
    reason: reasons.join(' '),
  };
  const written = await run<{ id: string }>(
    Q.createProcedure,
    {
      base: isPatternSpecific ? current.version : 0,
      id: procedure.id,
      key,
      version: procedure.version,
      role: procedure.role,
      dueLikely: procedure.dueLikely,
      duePossible: procedure.duePossible,
      minTier: procedure.minTier,
      reason: procedure.reason,
      at: Date.now(),
      acted,
      dismissed,
      tasks: rows.map((r) => r.id),
    },
    tracer,
  );
  // Another decision on the same pattern learned first: learn again from the newer state.
  if (!written.length) {
    if (attempt >= 3) return { changed: false, procedure: await procedureFor(key, tracer), outcomes };
    return learnProcedure(key, tracer, attempt + 1);
  }
  return { changed: true, procedure, outcomes, reason: `${PATTERN[key]?.title ?? key}: ${procedure.reason}` };
}

/** Creates the default procedure in a fresh graph. */
export async function seedDefaultProcedure() {
  await run(Q.createProcedure, {
    base: 0,
    id: 'proc-default',
    key: 'default',
    version: 1,
    role: DEFAULT_PROCEDURE.role,
    dueLikely: DEFAULT_PROCEDURE.dueLikely,
    duePossible: DEFAULT_PROCEDURE.duePossible,
    minTier: DEFAULT_PROCEDURE.minTier,
    reason: DEFAULT_PROCEDURE.reason,
    at: Date.now(),
    acted: 0,
    dismissed: 0,
    tasks: [],
  });
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
