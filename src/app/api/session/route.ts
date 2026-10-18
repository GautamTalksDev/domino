import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guard, handle, HttpError, isHttps, readJson } from '@/lib/api';
import { CLINIC_COOKIE, CLINICS, clinicById, currentScope, resolveScope, USER_COOKIE, USERS, userById } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

const Id = z.string().regex(/^[a-z]{2,20}$/);
const Body = z.object({ clinic: Id, user: Id.optional() }).strict();

// The current clinic and demo identity, and the choices available.
export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const s = await currentScope();
  const c = clinicById(s.clinic)!;
  return NextResponse.json({
    clinic: { id: c.id, name: c.name, short: c.short },
    user: userById(s.user),
    clinics: CLINICS.map((c) => ({ id: c.id, name: c.name, short: c.short, blurb: c.blurb })),
    users: USERS,
  });
});

// Switch clinic (which FalkorDB graph every request uses) and demo identity.
// Not authentication: see src/lib/tenant.ts. Values are checked against allowlists.
export const POST = handle(async (req: NextRequest) => {
  guard(req, { sameOrigin: true });
  const body = await readJson(req, Body);
  if (!clinicById(body.clinic)) throw new HttpError(400, 'Unknown clinic.');
  if (body.user && userById(body.user)?.clinic !== body.clinic) throw new HttpError(400, 'Unknown person for this clinic.');
  const s = resolveScope(body.clinic, body.user);
  const c = clinicById(s.clinic)!;
  const u = userById(s.user)!;
  const res = NextResponse.json({ ok: true, clinic: { id: c.id, name: c.name, short: c.short }, user: { id: u.id, name: u.name, role: u.role } });
  const opts = { httpOnly: true, sameSite: 'lax' as const, secure: isHttps(req), path: '/', maxAge: 60 * 60 * 24 * 30 };
  res.cookies.set(CLINIC_COOKIE, s.clinic, opts);
  res.cookies.set(USER_COOKIE, s.user, opts);
  return res;
});
