import { NextResponse, type NextRequest } from 'next/server';
import { handle, requireCron } from '@/lib/api';
import { ping } from '@/lib/db';
import { resetDemo } from '@/lib/demo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Called every few hours by an outside scheduler (.github/workflows/keepalive.yml). It keeps a hosted database that
// stops when idle (FalkorDB Cloud's free tier: stopped after a day unused, deleted after seven) in use, and reseeds any
// clinic whose graph came back empty (that tier keeps no data across a restart). Needs CRON_SECRET as a Bearer token.
export const GET = handle(async (req: NextRequest) => {
  requireCron(req);
  const db = await ping();
  if (!db.ok) return NextResponse.json({ db }, { status: 503 });
  return NextResponse.json({ db, clinics: await resetDemo({ missingOnly: true }) });
});
