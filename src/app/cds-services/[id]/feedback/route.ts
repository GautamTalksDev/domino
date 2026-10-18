import { NextResponse, type NextRequest } from 'next/server';
import { guard, HttpError, readJson, writesAllowed } from '@/lib/api';
import { CdsFeedback, recordFeedback } from '@/lib/cds';
import { authorizeCds, cdsHandle, preflight } from '@/lib/cdsHttp';
import { siteUrl } from '@/lib/siteUrl';

export const dynamic = 'force-dynamic';

// CDS Hooks feedback: what the prescriber did with a card (held the order, or overrode it and why). Only cards Domino
// issued, only the first answer per card.
export const POST = cdsHandle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  guard(req, { bucket: 'write' });
  const { id } = await ctx.params;
  const base = await siteUrl();
  const issuer = await authorizeCds(req, [`${base}/cds-services/${id}/feedback`, `${base}/cds-services/${id}`]);
  if (!issuer && !writesAllowed(req)) throw new HttpError(401, 'This action needs the Domino access key.');
  const body = await readJson(req, CdsFeedback, 32_768);
  // The operator (access key) may answer any card; otherwise only cards issued to the same verified EHR, or, in the open
  // demo, cards issued to unverified callers.
  const anyIssuer = !!process.env.DOMINO_WRITE_KEY && writesAllowed(req);
  return NextResponse.json({ recorded: await recordFeedback(id, body, { issuer, anyIssuer }) });
});

export const OPTIONS = preflight;
