import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, HttpError } from '@/lib/api';
import { searchMemoryDetailed } from '@/lib/careteam';

export const dynamic = 'force-dynamic';

// One search over the clinic's tasks, notes, decisions, findings and the person's conversations: by words (full-text
// index), by meaning (vector index, when a Gemini key is set) and through the graph (src/lib/careteam.ts).
export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 200);
  if (q.trim().length < 2) throw new HttpError(400, 'Type at least two letters.');
  const queries: string[] = [];
  const res = await searchMemoryDetailed(q, (t) => queries.push(t.id));
  return NextResponse.json({ q, ...res, queries: [...new Set(queries)] });
});
