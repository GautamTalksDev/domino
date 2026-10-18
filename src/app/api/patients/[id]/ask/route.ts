import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { guard, handle, parsePatientId, readJson, sse } from '@/lib/api';
import { askDomino } from '@/lib/agent/runner';

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

// Ask about one patient. The question and answer are remembered in the person's conversation.
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req, { bucket: 'ask', write: 'demo' });
  const pid = parsePatientId((await ctx.params).id);
  const { question, conversationId } = await readJson(req, Body);
  return sse(async (send, signal) => {
    await askDomino(pid, question, send, signal, undefined, { conversationId });
  }, req);
});
