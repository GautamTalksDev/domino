import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, parsePatientId } from '@/lib/api';
import { analyzePatient } from '@/lib/engine/analyze';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { learnedProcedures } from '@/lib/careteam';
import { patientDocs } from '@/lib/docs';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req);
  const pid = parsePatientId((await ctx.params).id);
  const [analysis, notes, mem, procedures, docs] = await Promise.all([
    analyzePatient(pid),
    run(Q.notes, { pid }),
    run<{ runs: unknown[] }>(Q.memory, { pid }),
    learnedProcedures(),
    patientDocs(pid),
  ]);
  return NextResponse.json({ analysis, notes, runs: (mem[0]?.runs ?? []).filter(Boolean), procedures, docs });
});
