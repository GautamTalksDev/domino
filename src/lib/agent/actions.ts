// The one write path for review tasks, shared by the Scribe agent, the population sweep and the seed.
// It applies procedural memory (who the task goes to, how soon, whether a "possible" link gets a task),
// addresses the task to the prescriber who owns the root drug, signs it, and links it in the graph to
// the finding it is about and the procedure it followed.

import { randomUUID } from 'node:crypto';
import { run, type Tracer } from '../db';
import { Q } from '../cypher';
import { TODAY_DAY } from '../../data/time';
import { procedureFor, type Procedure } from '../memory/procedures';
import { signPayload, taskPayload } from './sign';

export interface TaskInput {
  pid: string;
  runId: string | null;
  title: string;
  body: string;
  /** The role the caller suggests; a learned (pattern-specific) procedure overrides it. */
  role?: 'pharmacist' | 'prescriber' | 'nurse';
  dueInDays?: number;
  /** Link key "from>to" the task is about. */
  link?: string | null;
  pattern?: string | null;
  tier?: 'likely' | 'possible' | null;
  /** Prescriber who wrote the root drug. */
  owner?: string | null;
  /** A drug in this cascade is a chokepoint (betweenness centrality): the review is due in half the usual time. */
  hub?: { name: string; score: number } | null;
  step?: number | null;
  status?: 'proposed';
  at?: number;
  tracer?: Tracer;
}

export type TaskOutcome =
  | { proposed: true; id: string; role: string; due: number; procedure: Procedure; routedByMemory: boolean; owner: string | null }
  | { proposed: false; reason: string; procedure: Procedure; existing?: { id: string; status: string; role: string } };

export async function proposeTask(input: TaskInput): Promise<TaskOutcome> {
  const procedure = await procedureFor(input.pattern ?? null, input.tracer);
  const learned = procedure.key !== 'default';
  if (input.tier === 'possible' && procedure.minTier === 'likely') {
    return {
      proposed: false,
      procedure,
      reason: `Procedural memory (v${procedure.version}): ${procedure.reason} No task for this possible link; it stays a finding.`,
    };
  }
  const role = learned ? procedure.role : (input.role ?? procedure.role);
  const usual = input.dueInDays ?? (input.tier === 'possible' ? procedure.duePossible : procedure.dueLikely);
  const due = TODAY_DAY + (input.hub ? Math.max(2, Math.ceil(usual / 2)) : usual);
  const id = `t-${randomUUID()}`;
  const sig = signPayload(
    taskPayload({ id, patientId: input.pid, title: input.title, body: input.body, role, run: input.runId, pattern: input.pattern ?? null }),
  );
  const created = await run<{ id: string }>(
    Q.proposeTask,
    {
      pid: input.pid,
      run: input.runId,
      id,
      title: input.title,
      body: input.body,
      role,
      due,
      at: input.at ?? Date.now(),
      finding: input.link ?? null,
      findingKey: input.link ? `${input.pid}:${input.link}` : null,
      pattern: input.pattern ?? null,
      owner: input.owner ?? null,
      procedure: procedure.id,
      step: input.step ?? null,
      sig,
    },
    input.tracer,
  );
  if (!created.length) {
    const existing = (
      await run<{ id: string; status: string; role: string }>(Q.openTask, { pid: input.pid, title: input.title, finding: input.link ?? null }, input.tracer)
    )[0];
    return {
      proposed: false,
      procedure,
      existing,
      reason: `This question is already in the inbox${existing ? ` (${existing.status}, for the ${existing.role})` : ''}; no duplicate task was created.`,
    };
  }
  return { proposed: true, id, role, due, procedure, routedByMemory: learned && role !== (input.role ?? 'pharmacist'), owner: input.owner ?? null };
}
