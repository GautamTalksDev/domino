import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guard, handle, HttpError, parsePatientId, readJson } from '@/lib/api';
import { lastComparison, NoModelError, runComparison } from '@/lib/compare';
import { ProviderError } from '@/lib/agent/providers/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const Body = z.object({ patientId: z.string().optional() }).strict();

// The last comparison on this clinic's graph, so a visitor sees one before running their own.
export const GET = handle(async (req: NextRequest) => {
  guard(req, { bucket: 'read' });
  return NextResponse.json({ comparison: await lastComparison() });
});

// Run it live: the same question to the same model, with and without the graph. The question is fixed, so nothing a
// visitor types reaches the model.
export const POST = handle(async (req: NextRequest) => {
  guard(req, { bucket: 'ask', write: 'demo' });
  const { patientId } = await readJson(req, Body);
  const pid = parsePatientId(patientId ?? 'p-beatrice');
  try {
    return NextResponse.json({ comparison: await runComparison(pid, AbortSignal.timeout(75_000)) });
  } catch (err) {
    if (err instanceof NoModelError) throw new HttpError(503, err.message);
    if (err instanceof ProviderError || (err instanceof Error && err.name === 'TimeoutError'))
      throw new HttpError(502, 'The language model did not answer in time. Try again in a minute.');
    throw err;
  }
});
