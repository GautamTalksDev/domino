import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, HttpError } from '@/lib/api';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req);
  const id = (await ctx.params).id;
  if (!/^r-[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, 'Invalid run id.');
  return NextResponse.json({ steps: await run(Q.runSteps, { run: id }) });
});
