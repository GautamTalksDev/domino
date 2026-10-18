import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { guard, handle, parsePatientId, readJson, sse } from '@/lib/api';
import { BusyError, isBusy, runReview } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({ mode: z.enum(['auto', 'planner']).default('auto') }).strict();

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req, { write: 'demo', bucket: 'agent' });
  const pid = parsePatientId((await ctx.params).id);
  const { mode } = await readJson(req, Body);
  // Someone else's review of this patient holds the lease: a plain 409 before any stream, so the page can wait for it.
  if (await isBusy(pid)) throw new BusyError();
  return sse(async (send, signal) => {
    await runReview({ patientId: pid, mode, emit: send, signal, trigger: 'manual', pace: Number(process.env.DOMINO_PLANNER_PACE_MS ?? 320) });
  }, req);
});
