import './env';
import { writeFileSync, mkdirSync } from 'node:fs';
import { evaluate } from '../src/lib/engine/evaluate';
import { closeDb } from '../src/lib/db';

const res = await evaluate((d, t) => {
  if (d % 100 === 0 || d === t) process.stdout.write(`\r[eval] ${d}/${t} patients`);
});
console.log('');
console.log(`[eval] ${res.truthCascades} true cascades, ${res.truthDeliberate} deliberate pairs, ${res.candidateLinks} candidate links, ${res.ms} ms`);
for (const v of res.variants) {
  console.log(
    `  ${v.label.padEnd(18)} P=${v.precision.toFixed(3)} R=${v.recall.toFixed(3)} F1=${v.f1.toFixed(3)}  tp=${v.tp} fp=${v.fp} fn=${v.fn} deliberate-flagged=${v.deliberateFlagged}`,
  );
}
const pv = res.prevention;
console.log(
  `  prevention replay: caught ${pv.caught}/${pv.trueCascadeMarkers} cascades at the first downstream prescription, ${pv.prescriptionsAvoided} prescriptions avoided, cascade-stop PPV ${pv.cascadeStopPpv}, stops per 100 prescriptions ${pv.stopRatePer100}`,
);
console.log('  by pattern:');
for (const p of res.byPattern) console.log(`    ${String(p.found).padStart(3)}/${String(p.truth).padEnd(3)} ${p.pattern}`);
mkdirSync('src/data/generated', { recursive: true });
writeFileSync('src/data/generated/eval.json', JSON.stringify(res, null, 2));
console.log('[eval] wrote src/data/generated/eval.json');
await closeDb();
