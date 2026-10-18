import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, HttpError } from '@/lib/api';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';

export const dynamic = 'force-dynamic';

export interface ActivityEvent {
  type: 'task' | 'decision' | 'done' | 'note' | 'procedure' | 'verdict' | 'run' | 'cds' | 'cds_outcome';
  /** The node the event is about; with type and at it identifies the event, so clients can poll overlapping windows. */
  id: string;
  at: number;
  who: string;
  verb: string;
  title: string | null;
  pid: string | null;
  patient: string | null;
  detail: string | null;
}

// The clinic's shared activity since a moment: every open screen polls this, so what one person does
// (or what the agents do) shows up on everyone else's screen. Read-only; scoped to the session's clinic graph.
export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const raw = req.nextUrl.searchParams.get('since') ?? '0';
  if (!/^\d{1,15}$/.test(raw)) throw new HttpError(400, 'Invalid since.');
  const events = await run<ActivityEvent>(Q.activity, { since: Number(raw) });
  return NextResponse.json({ events, now: Date.now() });
});
