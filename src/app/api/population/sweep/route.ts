import { type NextRequest } from 'next/server';
import { guard, handle, sse } from '@/lib/api';
import { sweepPopulation } from '@/lib/engine/population';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = handle(async (req: NextRequest) => {
  guard(req, { write: true, bucket: 'heavy' });
  // One sweep per clinic at a time: sweepPopulation holds the clinic's "sweep" lease in the graph,
  // so a second click, a second instance or the nightly cron gets a clear "already running" instead.
  return sse(async (send) => {
    let last = 0;
    const res = await sweepPopulation(
      (done, total) => {
        if (done - last >= 20 || done === total) {
          last = done;
          send({ type: 'progress', done, total });
        }
      },
      undefined,
      { proposeTasks: true },
    );
    send({ type: 'done', ...res });
  }, req);
});
