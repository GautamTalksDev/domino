import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guard, handle, readJson } from '@/lib/api';
import { parseList } from '@/lib/checkup';

export const dynamic = 'force-dynamic';

const Body = z.object({ text: z.string().min(3).max(2000), conditions: z.string().max(600).default('') }).strict();

// Map a pasted list to Drug and Effect nodes with FalkorDB's full-text index. Read-only.
export const POST = handle(async (req: NextRequest) => {
  guard(req, { bucket: 'ask' });
  const { text, conditions } = await readJson(req, Body);
  const queries: string[] = [];
  const res = await parseList(text, conditions, (t) => queries.push(t.id));
  return NextResponse.json({ ...res, queries: [...new Set(queries)] });
});
