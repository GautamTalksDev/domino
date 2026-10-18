import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { guard, handle, readJson, sse } from '@/lib/api';
import { askTeam } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const Body = z
  .object({
    question: z.string().min(3).max(500),
    conversationId: z
      .string()
      .regex(/^c-[0-9a-f-]{36}$/)
      .nullish(),
  })
  .strict();

// Ask the care-team brain about the whole clinic. Read-only; remembered per person.
export const POST = handle(async (req: NextRequest) => {
  guard(req, { bucket: 'ask', write: 'demo' });
  const { question, conversationId } = await readJson(req, Body);
  return sse(async (send, signal) => {
    await askTeam(question, send, signal, undefined, { conversationId });
  }, req);
});
