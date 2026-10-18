// Concurrency benchmark: many agents reading and writing one FalkorDB graph at once.
// Runs in its own throwaway graph ("<FALKORDB_GRAPH>_bench"), so it never touches the demo data.
//
//   npm run bench            # prints a table and writes docs/BENCHMARK.md
//
// 1. Read load: patient analyses (10 Cypher queries each) at increasing concurrency.
// 2. Agent load: full Detective → Pharmacist → Scribe runs in parallel, each writing ~30 steps,
//    findings, tasks, notes and signed handoffs.
// 3. Mixed load: agent runs while analyses keep reading.
// 4. Shared state: 12 runs started at once on the same patient; the graph lease must let exactly one through.
// 5. Isolation: two clinics' graphs under load at the same time; no run may land in the other graph.
import './env';
process.env.FALKORDB_GRAPH = `${process.env.FALKORDB_GRAPH || 'domino'}_bench`;

import { cpus, totalmem, platform, arch } from 'node:os';
import { writeFileSync } from 'node:fs';
const { closeDb, deleteGraph, run } = await import('../src/lib/db');
const { Q } = await import('../src/lib/cypher');
const { seedGraph } = await import('../src/lib/seed');
const { analyzePatient } = await import('../src/lib/engine/analyze');
const { runReview, BusyError } = await import('../src/lib/agent/runner');
const { CLINICS, runInScope, graphFor } = await import('../src/lib/tenant');

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

interface Row {
  test: string;
  concurrency: number;
  ops: number;
  seconds: number;
  perSecond: number;
  p50: number;
  p95: number;
  queriesPerSecond?: number;
  writesPerSecond?: number;
}
const rows: Row[] = [];
const checks: string[] = [];

async function readLoad(ids: string[], concurrency: number, n: number) {
  const lat: number[] = [];
  let queries = 0;
  const work = Array.from({ length: n }, (_, k) => ids[k % ids.length]);
  const t0 = performance.now();
  await pool(work, concurrency, async (pid) => {
    const s = performance.now();
    await analyzePatient(pid, { tracer: () => queries++ });
    lat.push(performance.now() - s);
  });
  const sec = (performance.now() - t0) / 1000;
  rows.push({
    test: 'Patient analysis (read)',
    concurrency,
    ops: n,
    seconds: round(sec, 2),
    perSecond: round(n / sec),
    p50: round(pct(lat, 50)),
    p95: round(pct(lat, 95)),
    queriesPerSecond: Math.round(queries / sec),
  });
}

async function agentLoad(ids: string[], concurrency: number, label = 'Agent review run (read + write)') {
  const lat: number[] = [];
  let writes = 0;
  const t0 = performance.now();
  await pool(ids, concurrency, async (pid) => {
    const s = performance.now();
    await runReview({
      patientId: pid,
      mode: 'planner',
      trigger: 'manual',
      emit: (e) => {
        if (e.type === 'result' || e.type === 'finding' || e.type === 'task' || e.type === 'note' || e.type === 'handoff') writes++;
      },
    });
    lat.push(performance.now() - s);
  });
  const sec = (performance.now() - t0) / 1000;
  rows.push({
    test: label,
    concurrency,
    ops: ids.length,
    seconds: round(sec, 2),
    perSecond: round(ids.length / sec, 2),
    p50: round(pct(lat, 50)),
    p95: round(pct(lat, 95)),
    writesPerSecond: Math.round(writes / sec),
  });
}

console.log(`\nDomino concurrency benchmark (graph "${graphFor(CLINICS[0].id)}")\n`);
await runInScope({ clinic: CLINICS[0].id }, async () => {
  const seeded = await seedGraph();
  console.log(`seeded ${seeded.patients} patients, ${seeded.prescriptions} prescriptions`);
  const list = (await run<{ id: string; persona: boolean }>(Q.patientList)).filter((p) => !p.persona).map((p) => p.id);

  for (const c of [1, 8, 32]) await readLoad(list, c, c === 1 ? 60 : 240);
  await agentLoad(list.slice(0, 8), 1);
  await agentLoad(list.slice(8, 40), 8);
  await agentLoad(list.slice(40, 104), 16);

  // Mixed: 16 agent runs while 16 readers keep analysing.
  {
    let stop = false;
    let reads = 0;
    const readers = Array.from({ length: 16 }, async (_, k) => {
      let i = k;
      while (!stop) {
        await analyzePatient(list[200 + (i++ % 200)]);
        reads++;
      }
    });
    const t0 = performance.now();
    await agentLoad(list.slice(104, 136), 16, 'Agent runs during 16 parallel readers');
    stop = true;
    await Promise.all(readers);
    const sec = (performance.now() - t0) / 1000;
    rows.push({
      test: 'Analyses served during those runs',
      concurrency: 16,
      ops: reads,
      seconds: round(sec, 2),
      perSecond: round(reads / sec),
      p50: 0,
      p95: 0,
    });
  }

  // Shared state: the lease lets exactly one run through.
  {
    const pid = list[300];
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => runReview({ patientId: pid, mode: 'planner' })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const busy = results.filter((r) => r.status === 'rejected' && r.reason instanceof BusyError).length;
    const runs = (await run<{ n: number }>({ ...Q.meta, cypher: `MATCH (r:Run)-[:REVIEWED]->(:Patient {id: $pid}) RETURN count(r) AS n` }, { pid }))[0].n;
    checks.push(
      `12 simultaneous reviews of one patient: ${ok} ran, ${busy} refused with "already running", ${runs} run stored in the graph. ${ok === 1 && busy === 11 && runs === 1 ? 'PASS' : 'FAIL'}`,
    );
  }
});

// Isolation: both clinics under load at once, each in its own graph.
{
  const other = CLINICS[1];
  await runInScope({ clinic: other.id }, () => seedGraph());
  const a = await runInScope({ clinic: CLINICS[0].id }, async () =>
    (await run<{ id: string; persona: boolean }>(Q.patientList))
      .filter((p) => !p.persona)
      .slice(400, 416)
      .map((p) => p.id),
  );
  const b = await runInScope({ clinic: other.id }, async () => (await run<{ id: string }>(Q.patientList)).slice(0, 16).map((p) => p.id));
  const before = await runInScope(
    { clinic: other.id },
    async () => (await run<{ n: number }>({ ...Q.meta, cypher: 'MATCH (r:Run) RETURN count(r) AS n' }))[0].n,
  );
  await Promise.all([
    runInScope({ clinic: CLINICS[0].id }, () => pool(a, 8, async (pid) => void (await runReview({ patientId: pid, mode: 'planner' })))),
    runInScope({ clinic: other.id }, () => pool(b, 8, async (pid) => void (await runReview({ patientId: pid, mode: 'planner' })))),
  ]);
  const [ra, rb] = await Promise.all([
    runInScope(
      { clinic: CLINICS[0].id },
      async () =>
        (
          await run<{ n: number }>({
            ...Q.meta,
            cypher: `MATCH (r:Run)-[:REVIEWED]->(p:Patient) WHERE p.id STARTS WITH '${other.idPrefix}0' RETURN count(r) AS n`,
          })
        )[0].n,
    ),
    runInScope({ clinic: other.id }, async () => (await run<{ n: number }>({ ...Q.meta, cypher: 'MATCH (r:Run) RETURN count(r) AS n' }))[0].n),
  ]);
  checks.push(
    `Two clinics reviewed at the same time (16 + 16 runs, concurrency 8 each): ${rb - before} runs landed in ${other.short}'s graph, ${ra} of its patients' runs leaked into ${CLINICS[0].short}'s. ${rb - before === 16 && ra === 0 ? 'PASS' : 'FAIL'}`,
  );
  await runInScope({ clinic: other.id }, () => deleteGraph());
}

await runInScope({ clinic: CLINICS[0].id }, () => deleteGraph());
await closeDb();

const machine = `${cpus().length} × ${cpus()[0]?.model.trim() ?? 'CPU'}, ${Math.round(totalmem() / 2 ** 30)} GB RAM, ${platform()} ${arch()}, Node ${process.versions.node}`;
const table = [
  '| Test | Concurrency | Ops | Seconds | Ops/s | p50 ms | p95 ms | Queries/s | Writes/s |',
  '| - | -: | -: | -: | -: | -: | -: | -: | -: |',
  ...rows.map(
    (r) =>
      `| ${r.test} | ${r.concurrency} | ${r.ops} | ${r.seconds} | ${r.perSecond} | ${r.p50 || ''} | ${r.p95 || ''} | ${r.queriesPerSecond ?? ''} | ${r.writesPerSecond ?? ''} |`,
  ),
].join('\n');
console.log(table);
console.log('');
for (const c of checks) console.log(`  ${c}`);

writeFileSync(
  'docs/BENCHMARK.md',
  `# Concurrency benchmark

Many agents reading and writing one FalkorDB graph at the same time. Generated by \`npm run bench\`, which seeds a throwaway
graph, runs the load and deletes it. Numbers depend on the machine; these are from: ${machine}, FalkorDB on the same machine.

${table}

- **Patient analysis** is the read path every agent starts from: 10 Cypher queries per patient (the patient, then links,
  multi-hop paths, loops, other reasons, pile-ups, harms, combinations, burden and memory in parallel). The medical knowledge
  it scores with (patterns, combination rules, drug cards) is read from the graph too, once per process every few minutes.
- **Agent review run** is the whole team (Detective → Pharmacist → Scribe) in planner mode (no language model) with no
  pacing: around 30 stored steps, betweenness centrality for chokepoints, findings, signed handoffs read back and verified,
  procedures looked up, tasks proposed and notes drafted. With a language model, each run also waits on the model.
- Writes/s counts graph writes the runs made (steps, findings, tasks, notes, handoffs).

## Shared state and isolation checks

${checks.map((c) => `- ${c}`).join('\n')}

FalkorDB executes write queries one at a time per graph, which is what makes the lease's check-and-set atomic; reads run in
parallel on its thread pool. Clinics are separate graphs, so their writes never contend with each other.
`,
);
console.log('\nwrote docs/BENCHMARK.md');
