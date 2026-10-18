// One command to get a working graph for every clinic: seed, sweep, evaluate.
import './env';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ping, closeDb } from '../src/lib/db';
import { seedGraph } from '../src/lib/seed';
import { sweepPopulation } from '../src/lib/engine/population';
import { evaluate } from '../src/lib/engine/evaluate';
import { CLINICS, graphFor, runInScope } from '../src/lib/tenant';
import { embedAll } from './embed';

const p = await ping();
if (!p.ok) {
  console.error(`\n✗ Cannot reach FalkorDB: ${p.error}`);
  console.error('  Start it with "npm run db" (Docker) or set FALKORDB_URL in .env.local for FalkorDB Cloud.\n');
  process.exit(1);
}
console.log(`✓ FalkorDB reachable (${p.ms} ms)`);

for (const clinic of CLINICS) {
  await runInScope({ clinic: clinic.id }, async () => {
    console.log(`\n${clinic.name}  (graph "${graphFor(clinic.id)}")`);
    const r = await seedGraph((m) => console.log(`  seed: ${m}`));
    console.log(`✓ Seeded ${r.drugs} drugs, ${r.effects} effects, ${r.patterns} patterns, ${r.patients} patients, ${r.prescriptions} prescriptions`);
    const s = await sweepPopulation(
      (d, t) => {
        if (d % 100 === 0 || d === t) process.stdout.write(`\r  sweep: ${d}/${t}`);
      },
      undefined,
      { proposeTasks: true },
    );
    console.log(`\n✓ Population sweep: ${s.withLikely}/${s.patients} patients with a likely cascade, ${s.findings} findings, ${s.tasks} tasks in the inbox`);
    if (clinic.id === CLINICS[0].id) {
      const e = await evaluate();
      mkdirSync('src/data/generated', { recursive: true });
      writeFileSync('src/data/generated/eval.json', JSON.stringify(e, null, 2));
      const full = e.variants.find((v) => v.id === 'full')!;
      console.log(`✓ Evaluation: precision ${full.precision}, recall ${full.recall}, F1 ${full.f1}`);
      const pv = e.prevention;
      console.log(
        `✓ Prevention replay: ${pv.caught}/${pv.trueCascadeMarkers} cascades stopped at the first downstream prescription, ${pv.prescriptionsAvoided} prescriptions avoided (PPV ${pv.cascadeStopPpv})`,
      );
    }
  });
}
// Search by meaning: embed what the team wrote (only with a Gemini key; never fatal).
try {
  await embedAll((m) => console.log(m));
} catch (err) {
  console.log(`! Embeddings skipped: ${(err as Error).message}. Run "npm run embed" later; search by words works meanwhile.`);
}
console.log('\nReady. Run "npm run dev" and open http://localhost:3000\n');
await closeDb();
