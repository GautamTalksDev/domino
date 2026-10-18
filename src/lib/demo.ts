// Running Domino as a public demo that many people (hackathon judges, say) use at once.
//
// - DOMINO_OPEN_DEMO=true: everything a visitor needs to try the product works without the access key (reviews,
//   questions, decisions, inbox tasks, adding and undoing a prescription (not on the six story patients), team notes
//   without links, check-ups, the evaluation re-run, the EHR demo). The key still guards the sweep and the reset.
//   Without DOMINO_WRITE_KEY there is no key at all and everything is open anyway.
// - DOMINO_DEMO_RESET=nightly: the nightly cron rebuilds every clinic's graph from the seed, so what one visitor
//   changed (a dismissed task, a learned procedure, an added prescription) is gone for the next day's visitors.
// - Self-healing: an in-memory database without persistence (FalkorDB Cloud's free tier) can come back empty after a
//   restart; the keep-alive cron reseeds any clinic whose graph is missing.

import { graphName, run } from './db';
import { Q } from './cypher';
import { seedGraph } from './seed';
import { sweepPopulation } from './engine/population';
import { ensureEmbeddings } from './semantic';
import { embeddingsEnabled } from './embeddings';
import { CLINICS, runInScope } from './tenant';

export { openDemo, nightlyReset } from './demoMode';

export interface ClinicReport {
  seeded?: { patients: number; ms: number };
  sweep?: { withLikely: number; tasks: number };
  embedded?: number;
  skipped?: string;
  error?: string;
}

async function isSeeded(): Promise<boolean> {
  try {
    return !!(await run(Q.meta))[0];
  } catch {
    // A graph that does not exist yet reads as empty.
    return false;
  }
}

/** Rebuild the current clinic's graph: seed, sweep (with inbox tasks), then embed its memory within the time left. */
async function rebuild(deadline: number): Promise<ClinicReport> {
  const t0 = Date.now();
  const r = await seedGraph();
  const out: ClinicReport = { seeded: { patients: r.patients, ms: Date.now() - t0 } };
  const s = await sweepPopulation(undefined, undefined, { proposeTasks: true });
  out.sweep = { withLikely: s.withLikely, tasks: s.tasks };
  if (embeddingsEnabled()) {
    // Never fatal: searches embed what is missing as they go, and search by words works meanwhile.
    let n = 0;
    try {
      const graphKey = await graphName();
      while (Date.now() < deadline) {
        const e = await ensureEmbeddings({ limit: 100, graphKey });
        n += e.embedded;
        if (!e.more) break;
      }
    } catch {
      /* left for later searches */
    }
    out.embedded = n;
  }
  return out;
}

/**
 * Rebuild the demo. `missingOnly` rebuilds only clinics whose graph is empty (the keep-alive's self-heal); otherwise
 * every clinic is rebuilt (the nightly reset). One clinic failing never stops the others.
 */
export async function resetDemo(opts: { missingOnly?: boolean; budgetMs?: number } = {}): Promise<Record<string, ClinicReport>> {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const results: Record<string, ClinicReport> = {};
  for (const c of CLINICS) {
    try {
      results[c.id] = await runInScope({ clinic: c.id }, async () => {
        if (opts.missingOnly && (await isSeeded())) return { skipped: 'seeded' };
        return rebuild(deadline);
      });
    } catch (err) {
      results[c.id] = { error: err instanceof Error ? err.message : 'failed' };
    }
  }
  return results;
}
