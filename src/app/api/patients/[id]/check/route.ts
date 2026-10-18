import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { DrugId, guard, handle, HttpError, parsePatientId, readJson } from '@/lib/api';
import { checkPrescription } from '@/lib/engine/gatekeeper';
import { DRUG, EFFECT } from '@/data/knowledge';

export const dynamic = 'force-dynamic';

const Body = z
  .object({
    drug: DrugId,
    indication: z
      .string()
      .regex(/^[a-z0-9_]{2,40}$/)
      .nullish(),
  })
  .strict();

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req);
  const pid = parsePatientId((await ctx.params).id);
  const { drug, indication } = await readJson(req, Body);
  if (!DRUG[drug]) throw new HttpError(404, 'Unknown drug.');
  if (indication && !EFFECT[indication]) throw new HttpError(400, 'Unknown indication.');
  // The same scoring as the review: what the prescriber charts it for changes the answer.
  return NextResponse.json(await checkPrescription(pid, drug, undefined, { indication: indication ?? null }));
});
