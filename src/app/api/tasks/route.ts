import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle } from '@/lib/api';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { taskPayload, verifyPayload } from '@/lib/agent/sign';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const status = req.nextUrl.searchParams.get('status') ?? 'all';
  if (!['all', 'proposed', 'approved', 'done', 'dismissed'].includes(status)) return NextResponse.json({ error: 'bad status' }, { status: 400 });
  const rows = await run<{ id: string; title: string; body: string; patientId: string; role: string; sig: string; run: string } & Record<string, unknown>>(
    Q.tasks,
    { status },
  );
  // Tasks whose signature does not verify were not created by Domino's agents; they are flagged in the UI.
  const tasks = rows.map(({ sig, ...t }) => ({
    ...t,
    verified: verifyPayload(taskPayload(t), sig),
  }));
  return NextResponse.json({ tasks });
});
