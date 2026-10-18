import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle, sse } from '@/lib/api';
import { evaluate } from '@/lib/engine/evaluate';
import { withLease } from '@/lib/lock';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = handle(async (req: NextRequest) => {
  // Read-only (ground truth never enters the graph) but heavy: open on a public demo, one run at a time per clinic.
  guard(req, { write: 'demo', bucket: 'heavy' });
  return sse(async (send) => {
    let last = 0;
    const res = await withLease(
      'eval',
      () =>
        evaluate((done, total) => {
          if (done - last >= 25 || done === total) {
            last = done;
            send({ type: 'progress', done, total });
          }
        }),
      'An evaluation is already running for this clinic. Try again in a minute.',
    );
    send({ type: 'done', result: res });
  }, req);
});

export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const mod = await import('@/data/generated/eval.json');
  return NextResponse.json(mod.default);
});
