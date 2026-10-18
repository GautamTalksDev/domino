import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, HttpError } from '@/lib/api';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const from = req.nextUrl.searchParams.get('from') ?? '';
  const to = req.nextUrl.searchParams.get('to') ?? '';
  if (!/^[a-z0-9_]{2,40}$/.test(from) || !/^[a-z0-9_]{2,40}$/.test(to)) throw new HttpError(400, 'Invalid drug id.');
  const t0 = performance.now();
  const paths = await run(Q.shortest, { from, to });
  return NextResponse.json({ paths, ms: Math.round(performance.now() - t0), cypher: Q.shortest.cypher });
});
