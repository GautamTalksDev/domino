import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guard, handle, HttpError, readJson, writesAllowedWithKey } from '@/lib/api';
import { openDemo } from '@/lib/demoMode';
import { DOC_KINDS, listDocs, saveDoc } from '@/lib/docs';
import { noteHold, noticeFromNote } from '@/lib/noticed';
import { currentUser } from '@/lib/tenant';
import { cleanText } from '@/lib/agent/guard';

export const dynamic = 'force-dynamic';

const Body = z
  .object({
    kind: z.enum(DOC_KINDS),
    title: z.string().trim().min(3).max(120),
    text: z.string().trim().min(10).max(4000),
  })
  .strict();

// Team notes in this clinic's graph, newest first.
export const GET = handle(async (req: NextRequest) => {
  guard(req);
  return NextResponse.json({ docs: await listDocs() });
});

// A person adds a protocol, handover, chat message or minutes. Domino links it to the drugs, symptoms and
// patients it mentions; it is signed by the session's person, never a name from the body.
// Then the Detective reads it: when it names exactly one patient and reports (not rules out) a symptom, the patient's own
// drugs that cause that symptom become signals, and the strongest one a signed review task linked back to the note
// (src/lib/noticed.ts).
export const POST = handle(async (req: NextRequest) => {
  guard(req, { write: 'demo' });
  const body = await readJson(req, Body, 8192);
  // On an open public demo, a visitor without the key can add notes (the guided tour does), but not links: the board is
  // shared, so it is no place for spam. The nightly reset clears whatever visitors wrote.
  if (openDemo() && !writesAllowedWithKey(req) && /https?:\/\/|www\.|\[[^\]]*\]\(/i.test(`${body.title} ${body.text}`))
    throw new HttpError(400, 'Links are not allowed in team notes on the public demo.');
  const user = await currentUser();
  const res = await saveDoc({ ...body, by: { id: user.id, name: user.name } });
  // The same cleaned text the links were found in, so the negation check reads exactly what was linked.
  const doc = { id: res.id, title: cleanText(body.title, 120), text: cleanText(body.text, 4000), kind: body.kind, by: user.name };
  const held = noteHold(doc, res);
  const noticed = held ? [] : await noticeFromNote(doc, res);
  return NextResponse.json({ ...res, noticed, held });
});
