import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guard, handle, readJson } from '@/lib/api';
import { previewLinks } from '@/lib/docs';

export const dynamic = 'force-dynamic';

const Body = z.object({ text: z.string().max(4200) }).strict();

// What a note being written would be linked to, so the form can show it live. Read-only: three read queries and
// nothing stored. POST only because the text can be long; same-origin, so another site cannot probe patient names.
export const POST = handle(async (req: NextRequest) => {
  guard(req, { sameOrigin: true, bucket: 'read' });
  const { text } = await readJson(req, Body, 8192);
  return NextResponse.json(await previewLinks(text));
});
