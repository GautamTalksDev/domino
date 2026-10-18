import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle } from '@/lib/api';
import { careTeam, learnedProcedures, whoKnows } from '@/lib/careteam';

export const dynamic = 'force-dynamic';

// The care-team brain at a glance: prescriber handoffs, who knows what, what the agents learned.
export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const [team, experts, procedures] = await Promise.all([careTeam(), whoKnows(), learnedProcedures()]);
  return NextResponse.json({ ...team, experts, procedures });
});
