import { NextResponse, type NextRequest } from 'next/server';
import { guard, HttpError, readJson, writesAllowed } from '@/lib/api';
import { CdsRequest, runService } from '@/lib/cds';
import { authorizeCds, cdsHandle, clientLabel, preflight } from '@/lib/cdsHttp';
import { siteUrl } from '@/lib/siteUrl';

export const dynamic = 'force-dynamic';

// A CDS Hooks call (order-select or order-sign): check the draft medication orders against the patient's graph and
// answer with cards. Cross-origin by design (EHRs call it); rate-limited in its own bucket; the only writes are the
// cards shown at signing (deduplicated, bounded) and, for a patient Domino does not hold, a capped temporary check-up.
export const POST = cdsHandle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req, { bucket: 'cds' });
  const { id } = await ctx.params;
  const base = await siteUrl();
  // With DOMINO_CDS_ISSUERS set, only EHRs with a valid signed token (src/lib/cdsAuth.ts).
  const issuer = await authorizeCds(req, [`${base}/cds-services/${id}`]);
  const body = await readJson(req, CdsRequest, 262_144);
  // A verified EHR may write (its cards, a temporary patient); otherwise only when no access key is set, or with it.
  const canWrite = !!issuer || writesAllowed(req);
  // Domino's own demo EHR asks for the key rather than silently not recording the prescriber's answer.
  if (!canWrite && body.hook === 'order-sign' && req.headers.get('x-domino-client') === 'demo')
    throw new HttpError(401, 'Recording order-entry answers needs the Domino access key.');
  const res = await runService(id, body, { base, canWrite, client: clientLabel(req, issuer), issuer });
  return NextResponse.json(res);
});

export const OPTIONS = preflight;
