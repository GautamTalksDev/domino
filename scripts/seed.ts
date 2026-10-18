import './env';
import { seedGraph } from '../src/lib/seed';
import { closeDb } from '../src/lib/db';
import { CLINICS, runInScope } from '../src/lib/tenant';

try {
  for (const clinic of CLINICS) {
    await runInScope({ clinic: clinic.id }, async () => {
      const r = await seedGraph((m) => console.log(`[seed:${clinic.id}] ${m}`));
      console.log(`[seed:${clinic.id}] ${r.drugs} drugs, ${r.effects} effects, ${r.causes} CAUSES, ${r.treats} TREATED_BY, ${r.patterns} patterns`);
      console.log(`[seed:${clinic.id}] ${r.patients} patients, ${r.prescriptions} prescriptions`);
    });
  }
} catch (e) {
  console.error('[seed] failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
