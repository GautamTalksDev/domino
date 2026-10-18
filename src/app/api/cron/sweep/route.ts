import { NextResponse, type NextRequest } from 'next/server';
import { handle, requireCron } from '@/lib/api';
import { sweepPopulation } from '@/lib/engine/population';
import { CLINICS, runInScope } from '@/lib/tenant';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { nightlyReset, resetDemo } from '@/lib/demo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// The nightly job for every clinic (vercel.json cron, or any scheduler). Needs CRON_SECRET as a Bearer token.
// A public demo (DOMINO_DEMO_RESET=nightly) is rebuilt from the seed instead, which includes a fresh sweep.
export const GET = handle(async (req: NextRequest) => {
  requireCron(req);
  if (nightlyReset()) return NextResponse.json({ reset: await resetDemo() });
  // Every clinic is swept in its own graph.
  const results: Record<string, unknown> = {};
  for (const c of CLINICS) {
    // One clinic being busy (a manual sweep holds its lease) never stops the others.
    try {
      results[c.id] = await runInScope({ clinic: c.id }, async () => {
        const purged = (await run<{ n: number }>(Q.purgeSandbox, { now: Date.now() }))[0]?.n ?? 0;
        return { ...(await sweepPopulation(undefined, undefined, { proposeTasks: true })), checkupsPurged: purged };
      });
    } catch (err) {
      results[c.id] = { error: err instanceof Error ? err.message : 'failed' };
    }
  }
  return NextResponse.json(results);
});
