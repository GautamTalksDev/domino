import { NextResponse, type NextRequest } from 'next/server';
import { guard } from '@/lib/api';
import { discovery } from '@/lib/cds';
import { cdsHandle, preflight } from '@/lib/cdsHttp';

export const dynamic = 'force-dynamic';

// CDS Hooks discovery: the services an EHR can call, with the hooks they answer and the prefetch they want.
export const GET = cdsHandle(async (req: NextRequest) => {
  guard(req);
  return NextResponse.json(discovery());
});

export const OPTIONS = preflight;
