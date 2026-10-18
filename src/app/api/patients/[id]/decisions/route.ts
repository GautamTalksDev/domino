import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DrugId, guard, handle, HttpError, parsePatientId, readJson } from '@/lib/api';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { analyzePatient } from '@/lib/engine/analyze';
import { decisionPayload, signPayload } from '@/lib/agent/sign';
import { cleanText } from '@/lib/agent/guard';
import { TODAY_DAY } from '@/data/time';
import { currentUser } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

const Body = z
  .object({
    from: DrugId,
    to: DrugId,
    verdict: z.enum(['intentional', 'confirmed', 'not_cascade']),
    reason: z.string().min(3).max(400),
  })
  .strict();

// Only people write decisions; agents can read them but have no tool to create them (OWASP ASI06).
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req, { write: 'demo' });
  const pid = parsePatientId((await ctx.params).id);
  const body = await readJson(req, Body);
  const a = await analyzePatient(pid);
  const link = a.links.find((l) => l.from === body.from && l.to === body.to);
  if (!link) throw new HttpError(404, 'No such link for this patient.');
  const id = `dec-${randomUUID()}`;
  // The decision is signed in the name of the person working in this session (demo identity).
  const by = (await currentUser()).name;
  const reason = cleanText(body.reason, 400);
  const payload = decisionPayload({ id, patientId: pid, from: body.from, to: body.to, verdict: body.verdict, by, reason });
  await run(Q.recordDecision, {
    pid,
    id,
    from: body.from,
    to: body.to,
    verdict: body.verdict,
    reason,
    by,
    day: TODAY_DAY,
    at: Date.now(),
    sig: signPayload(payload),
    pattern: link.patterns[0]?.id ?? '',
  });
  return NextResponse.json({ ok: true, id });
});
