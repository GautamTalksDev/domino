import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle } from '@/lib/api';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const [n, e] = await Promise.all([run<{ nodes: unknown }>(Q.stats), run<{ edges: unknown }>(Q.edgeStats)]);
  return NextResponse.json({ nodes: n[0]?.nodes ?? [], edges: e[0]?.edges ?? [] });
});
