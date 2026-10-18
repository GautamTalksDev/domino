import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { DrugId, guard, handle, HttpError, readJson } from '@/lib/api';
import { createCheckup } from '@/lib/checkup';

export const dynamic = 'force-dynamic';

const Body = z
  .object({
    meds: z
      .array(z.object({ drug: DrugId, start: z.number().int().min(-3650).max(2000).nullable() }).strict())
      .min(2)
      .max(20),
    conditions: z
      .array(z.string().regex(/^[a-z0-9_]{2,40}$/))
      .max(12)
      .default([]),
    age: z.number().int().min(40).max(105).default(78),
    sex: z.enum(['F', 'M']).default('F'),
    /** Lines Domino could not match, so the check-up says it did not check them. */
    unchecked: z.array(z.string().max(200)).max(20).default([]),
  })
  .strict();

// Build a temporary check-up patient in the clinic's graph. It expires on its own (2 hours) and is never
// listed, swept, counted in the population or shown in the inbox. No names are taken.
export const POST = handle(async (req: NextRequest) => {
  guard(req, { write: 'demo', bucket: 'heavy' });
  const body = await readJson(req, Body);
  try {
    return NextResponse.json(await createCheckup(body));
  } catch (err) {
    if (err instanceof Error && /^(Too many|Add at least)/.test(err.message)) throw new HttpError(400, err.message);
    throw err;
  }
});
