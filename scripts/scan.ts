// Population sweep for every clinic (each in its own graph). Add --tasks to put the strongest findings in each inbox.
import './env';
import { sweepPopulation, pssa, populationSummary } from '../src/lib/engine/population';
import { closeDb } from '../src/lib/db';
import { CLINICS, graphFor, runInScope } from '../src/lib/tenant';

for (const clinic of CLINICS) {
  await runInScope({ clinic: clinic.id }, async () => {
    console.log(`\n${clinic.name} (graph "${graphFor(clinic.id)}")`);
    const res = await sweepPopulation(
      (d, t) => {
        if (d % 100 === 0 || d === t) process.stdout.write(`\r[scan] ${d}/${t} patients`);
      },
      undefined,
      { proposeTasks: process.argv.includes('--tasks') },
    );
    console.log(
      `\n[scan] ${res.withLikely}/${res.patients} patients with a likely cascade, ${res.findings} findings written, ${res.tasks} tasks proposed, ${res.ms} ms`,
    );
    const sig = await pssa();
    console.log(`[pssa] ${sig.filter((s) => s.signal).length} signals of ${sig.length} class pairs`);
    for (const s of sig.slice(0, 8))
      console.log(`  ${s.signal ? '*' : ' '} ${s.aName} -> ${s.bName}: ${s.fwd}/${s.rev} aSR=${s.asr} (${s.lo}-${s.hi}) sr0=${s.sr0} via=${s.via.join(',')}`);
    const sum = await populationSummary();
    console.log(sum.totals);
  });
}
await closeDb();
