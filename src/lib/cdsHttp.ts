// HTTP plumbing for the CDS Hooks endpoints (src/app/cds-services). EHRs, and browser-based CDS clients such as the
// public CDS Hooks sandbox, call them from other origins, so these routes (and only these) answer with CORS headers.
// They send no cookies cross-origin, so a call from an EHR runs in the default clinic; a call from Domino's own pages
// runs in the clinic the person chose.
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { handle, HttpError, writesAllowed } from './api';
import { CdsError } from './cds';
import { CdsAuthError, cdsAuthEnforced, verifyCdsToken } from './cdsAuth';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '600',
};

export function cors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export const preflight = () => cors(new NextResponse(null, { status: 204 }));

/** Like handle(), plus CORS on every response (errors included, so a CDS client can read why), and CdsError → HTTP. */
export function cdsHandle<C>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  const h = handle<C>(async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof CdsError) throw new HttpError(err.status, err.message);
      if (err instanceof CdsAuthError) throw new HttpError(401, err.message);
      throw err;
    }
  });
  return async (req: NextRequest, ctx: C) => cors(await h(req, ctx));
}

/**
 * Who may call: with DOMINO_CDS_ISSUERS set, an EHR with a valid signed token, or a session unlocked with the deployment's
 * access key (Domino's own demo EHR, run by the operator). Returns the verified issuer, if any.
 */
export async function authorizeCds(req: NextRequest, audiences: string[]): Promise<string | null> {
  if (!cdsAuthEnforced()) return null;
  if (process.env.DOMINO_WRITE_KEY && writesAllowed(req)) return null;
  return verifyCdsToken(req.headers.get('authorization'), audiences);
}

/**
 * Who the activity feed says asked. Callers cannot name themselves (that would let anyone post as anyone): only a
 * verified token's issuer is shown, or Domino's own demo page.
 */
export function clientLabel(req: NextRequest, issuer: string | null): string | null {
  if (issuer) {
    try {
      return `An EHR (${new URL(issuer).host})`;
    } catch {
      return 'A verified EHR';
    }
  }
  return req.headers.get('x-domino-client') === 'demo' ? 'The demo EHR' : null;
}
