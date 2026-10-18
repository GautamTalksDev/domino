import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guard, handle, HttpError, readJson } from '@/lib/api';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { cleanText } from '@/lib/agent/guard';
import { taskPayload, verifyPayload } from '@/lib/agent/sign';
import { learnProcedure } from '@/lib/memory/procedures';
import { currentUser } from '@/lib/tenant';
import { canMoveTask } from '@/lib/taskFlow';
import { scheduleFollowUp } from '@/lib/followup';

export const dynamic = 'force-dynamic';

const Body = z
  .object({
    status: z.enum(['approved', 'done', 'dismissed']),
    /** Optional: why it was dismissed or what was done. Becomes part of what procedural memory learns from. */
    note: z.string().max(300).optional(),
  })
  .strict();


// A person decides on a task. The decision is an outcome: procedural memory re-learns how to act
// on this kind of cascade, and says so if the agents will now act differently.
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req, { write: 'demo' });
  const id = (await ctx.params).id;
  if (!/^t-[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, 'Invalid task id.');
  const { status, note } = await readJson(req, Body);
  const found = await run<{
    id: string;
    title: string;
    body: string;
    role: string;
    run: string;
    sig: string;
    patientId: string;
    pattern: string | null;
    status: string;
    finding: string | null;
    sandbox: boolean | null;
  }>(Q.task, { id });
  if (!found.length) throw new HttpError(404, 'Task not found.');
  const t = found[0];
  if (t.sandbox) throw new HttpError(400, 'Check-up tasks are not part of the care team’s inbox.');
  if (!canMoveTask(t.status, status)) throw new HttpError(409, `This task is already ${t.status}; it cannot be marked ${status}.`);
  // A task whose signature fails was not written by Domino's agents: it can only be dismissed, and it never teaches procedural memory.
  const verified = verifyPayload(taskPayload(t), t.sig);
  if (!verified && status !== 'dismissed') throw new HttpError(409, 'This task failed its signature check. It can only be dismissed.');
  const user = await currentUser();
  const rows = await run<{ id: string; status: string; pattern: string | null }>(Q.setTask, {
    id,
    from: [t.status],
    status,
    by: user.name,
    byId: user.id,
    at: Date.now(),
    note: note ? cleanText(note, 300) : null,
    counted: verified,
  });
  if (!rows.length) throw new HttpError(409, 'Someone else decided this task a moment ago. Reload to see their decision.');
  const learned = t.pattern && verified ? await learnProcedure(t.pattern) : null;
  // Completing a review closes one loop and opens the next: the agents schedule their own follow-up.
  const followUp = status === 'done' && verified ? await scheduleFollowUp({ ...t, finding: t.finding }, user.name).catch(() => null) : null;
  return NextResponse.json({
    ...rows[0],
    decidedBy: user.name,
    followUp,
    learned: learned?.changed ? { reason: learned.reason, version: learned.procedure.version, role: learned.procedure.role } : null,
  });
});
