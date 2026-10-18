import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { DrugId, guard, handle, HttpError, parsePatientId, readJson, writesAllowedWithKey } from '@/lib/api';
import { openDemo } from '@/lib/demoMode';
import { PERSONAS } from '@/data/personas';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { checkPrescription } from '@/lib/engine/gatekeeper';
import { BusyError, isBusy, runReview } from '@/lib/agent/runner';
import { cleanText } from '@/lib/agent/guard';
import { DRUG, EFFECT } from '@/data/knowledge';
import { TODAY_DAY } from '@/data/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const Body = z
  .object({
    drug: DrugId,
    dose: z.string().min(1).max(60).default('as prescribed'),
    indication: z
      .string()
      .regex(/^[a-z0-9_]{2,40}$/)
      .nullable()
      .default(null),
  })
  .strict();

// Adding a prescription is an event the agents act on: the Detective re-runs automatically.
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req, { write: 'demo', bucket: 'agent' });
  const pid = parsePatientId((await ctx.params).id);
  // On the public demo the six story patients stay as they are, so every visitor sees the same story (a benztropine
  // added to Rosa would change the EHR example for everyone). Any other patient, or a check-up, can take a new drug.
  if (openDemo() && !writesAllowedWithKey(req) && PERSONAS.some((p) => p.id === pid))
    throw new HttpError(403, 'The story patients stay as they are on the public demo. Try adding a prescription to another patient, or build a check-up.');
  const body = await readJson(req, Body);
  if (!DRUG[body.drug]) throw new HttpError(404, 'Unknown drug.');
  if (body.indication && !EFFECT[body.indication]) throw new HttpError(400, 'Unknown indication.');
  // Refuse before writing, so a busy patient never ends up with a new drug and no review of it.
  if (await isBusy(pid)) throw new BusyError();
  const check = await checkPrescription(pid, body.drug);
  if (check.alreadyTaking) throw new HttpError(409, 'The patient already takes this drug.');
  await run(Q.addPrescription, {
    pid,
    drug: body.drug,
    start: TODAY_DAY,
    dose: cleanText(body.dose, 60),
    // Always the demo prescriber: the name feeds prescriber flows, task owners and the undo, so it never comes from the request.
    prescriber: 'Demo prescriber',
    indication: body.indication,
  });
  try {
    const review = await runReview({ patientId: pid, mode: 'planner', trigger: 'new_prescription' });
    return NextResponse.json({ check, review });
  } catch (err) {
    // A review started between the check and the write: the prescription is saved and that review will see it.
    if (err instanceof BusyError) {
      return NextResponse.json(
        { check, review: { summary: 'Prescription added. A review was already running for this patient and will include it.', tasks: 0, runId: null } },
        { status: 202 },
      );
    }
    throw err;
  }
});

// Undo: removes only prescriptions added from the app (the demo prescriber), so it is open wherever adding is.
export const DELETE = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req, { write: 'demo' });
  const pid = parsePatientId((await ctx.params).id);
  const rows = await run<{ n: number }>(Q.removeAdded, { pid });
  return NextResponse.json({ removed: rows[0]?.n ?? 0 });
});
