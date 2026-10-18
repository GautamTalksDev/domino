import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, HttpError } from '@/lib/api';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^[a-z0-9_]{2,40}$/.test(id)) throw new HttpError(400, 'Invalid id.');
  const t0 = performance.now();
  const edges = await run(Q.neighborhood, { id });
  return NextResponse.json({ edges, ms: Math.round(performance.now() - t0), cypher: Q.neighborhood.cypher });
});
