import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle } from '@/lib/api';
import { seedGraph } from '@/lib/seed';
import { sweepPopulation } from '@/lib/engine/population';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Rebuilds the demo graph. Needs DOMINO_WRITE_KEY in production.
export const POST = handle(async (req: NextRequest) => {
  guard(req, { admin: true, bucket: 'heavy' });
  const report = await seedGraph();
  const sweep = await sweepPopulation();
  return NextResponse.json({ report, sweep });
});
