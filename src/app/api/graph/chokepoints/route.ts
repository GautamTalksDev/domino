import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle } from '@/lib/api';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest) => {
  guard(req);
  return NextResponse.json({ nodes: await run(Q.chokepoints), cypher: Q.chokepoints.cypher });
});
