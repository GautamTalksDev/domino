import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle } from '@/lib/api';
import { populationSummary, pssa } from '@/lib/engine/population';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const [summary, signals] = await Promise.all([populationSummary(), pssa()]);
  return NextResponse.json({ summary, signals });
});
