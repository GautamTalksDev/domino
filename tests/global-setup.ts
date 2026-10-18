// Tests run against their own graphs (domino_test, domino_test_lakeview), seeded fresh for every run,
// so a test run never touches the graphs the app is using and always starts from the same state.
import { existsSync } from 'node:fs';

export default async function setup() {
  for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
  process.env.FALKORDB_GRAPH = TEST_GRAPH;
  const { ping, closeDb } = await import('../src/lib/db');
  const db = await ping();
  if (!db.ok) {
    // Most tests need FalkorDB. Skipping them silently would report a green run that tested little, so this fails
    // unless the run says it only wants the pure tests.
    if (process.env.DOMINO_SKIP_DB_TESTS === '1') {
      console.warn(`\n! FalkorDB is not reachable (${db.error}): running only the tests that need no database.\n`);
      return;
    }
    throw new Error(
      `FalkorDB is not reachable (${db.error}), so the database tests cannot run. Start it with "npm run db" (or set FALKORDB_URL in .env.local), or run "DOMINO_SKIP_DB_TESTS=1 npm test" for the pure tests only.`,
    );
  }
  const { seedGraph } = await import('../src/lib/seed');
  const { sweepPopulation } = await import('../src/lib/engine/population');
  const { CLINICS, runInScope } = await import('../src/lib/tenant');
  for (const c of CLINICS) {
    await runInScope({ clinic: c.id }, async () => {
      await seedGraph(() => {});
      await sweepPopulation(undefined, undefined, { proposeTasks: true });
    });
  }
  await closeDb();
}

export const TEST_GRAPH = process.env.DOMINO_TEST_GRAPH || 'domino_test';
