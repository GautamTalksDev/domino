import { DatabaseZap } from 'lucide-react';

export function DbError({ message }: { message?: string }) {
  return (
    <div className="card mx-auto mt-16 max-w-2xl p-8">
      <DatabaseZap className="text-vermilion" size={28} />
      <h1 className="font-display mt-4 text-3xl font-semibold">Domino can’t reach its graph</h1>
      <p className="mt-3 text-bone-2">FalkorDB is the engine: without it there are no cascades to find. Start it, seed it, and reload.</p>
      <pre
        tabIndex={0}
        className="mono mt-5 overflow-x-auto rounded-xl bg-black/40 p-4 text-[13px] leading-relaxed text-bone-2"
      >{`npm run db      # starts FalkorDB in Docker on :6379
npm run setup   # seeds the graph and runs the first sweep
# or set FALKORDB_URL in .env.local for FalkorDB Cloud`}</pre>
      {message && <p className="mono mt-4 text-xs text-mute">{message}</p>}
    </div>
  );
}

export async function withDb<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}
