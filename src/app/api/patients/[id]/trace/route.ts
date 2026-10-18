import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, HttpError, parsePatientId } from '@/lib/api';
import { traceFinding } from '@/lib/provenance';

export const dynamic = 'force-dynamic';

// Provenance for one link: the path from the agent's steps and the evidence to the finding and what it led to.
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req);
  const pid = parsePatientId((await ctx.params).id);
  const link = req.nextUrl.searchParams.get('link') ?? '';
  if (!/^[a-z0-9_]{2,40}>[a-z0-9_]{2,40}$/.test(link)) throw new HttpError(400, 'Invalid link.');
  return NextResponse.json({ trace: await traceFinding(pid, link) });
});
