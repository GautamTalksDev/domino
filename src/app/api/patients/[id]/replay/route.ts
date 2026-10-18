import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, parsePatientId } from '@/lib/api';
import { replayPatient } from '@/lib/engine/replay';

export const dynamic = 'force-dynamic';

// "What if Domino had been at the prescriber's desk?": every prescription re-checked as the record stood that day.
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req, { bucket: 'agent' });
  const pid = parsePatientId((await ctx.params).id);
  return NextResponse.json(await replayPatient(pid));
});
