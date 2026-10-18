import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { guard, handle, HttpError, isHttps, readJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({ key: z.string().min(8).max(200) }).strict();

// Exchanges the access key for an httpOnly, SameSite=Strict cookie.
export const POST = handle(async (req: NextRequest) => {
  guard(req, { bucket: 'unlock' });
  const expected = process.env.DOMINO_WRITE_KEY;
  if (!expected) return NextResponse.json({ ok: true, open: true });
  const { key } = await readJson(req, Body);
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'Wrong key.');
  const res = NextResponse.json({ ok: true });
  res.cookies.set('domino_key', key, { httpOnly: true, sameSite: 'strict', secure: isHttps(req), path: '/', maxAge: 60 * 60 * 12 });
  return res;
});
