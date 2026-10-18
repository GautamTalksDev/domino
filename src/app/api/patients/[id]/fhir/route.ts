import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, parsePatientId } from '@/lib/api';
import { analyzePatient } from '@/lib/engine/analyze';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { reviewBundle } from '@/lib/fhir';
import { siteUrl } from '@/lib/siteUrl';

export const dynamic = 'force-dynamic';

// The review as a FHIR R4 Bundle (Patient, MedicationStatement, Condition, DetectedIssue, Task, Provenance), for an
// EHR or a clinical decision support pipeline. Read-only; synthetic data, tagged HTEST.
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req);
  const pid = parsePatientId((await ctx.params).id);
  const [analysis, tasks] = await Promise.all([
    analyzePatient(pid),
    run<{ id: string; title: string; status: string; finding: string | null }>(Q.openTasksFor, { pid }),
  ]);
  const bundle = reviewBundle(analysis, tasks, await siteUrl());
  const download = req.nextUrl.searchParams.get('download') === '1';
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      'content-type': 'application/fhir+json; charset=utf-8',
      ...(download ? { 'content-disposition': `attachment; filename="${pid}-domino-fhir.json"` } : {}),
    },
  });
});
