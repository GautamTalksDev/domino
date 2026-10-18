// Embed everything the care team wrote (notes, tasks, decisions, conversations) for search by meaning, in every
// clinic's graph. Needs GEMINI_API_KEY. Safe to run again: only what has no vector from the current model is embedded.
//   npm run embed
import './env';
import { closeDb, graphName, ping } from '../src/lib/db';
import { CLINICS, graphFor, runInScope } from '../src/lib/tenant';
import { activeEmbeddingModel, embeddingsEnabled } from "../src/lib/embeddings";
import { ensureEmbeddings } from '../src/lib/semantic';

export async function embedAll(log: (m: string) => void = console.log) {
  if (!embeddingsEnabled()) {
    log('Search by meaning is off (no GEMINI_API_KEY, or DOMINO_EMBEDDINGS=off): nothing to embed.');
    return;
  }
  for (const clinic of CLINICS) {
    await runInScope({ clinic: clinic.id }, async () => {
      let total = 0;
      for (;;) {
        const r = await ensureEmbeddings({ limit: 100, graphKey: await graphName() });
        total += r.embedded;
        if (!r.more) break;
      }
      log(`✓ ${clinic.name} (graph "${graphFor(clinic.id)}"): ${total} memories embedded with ${activeEmbeddingModel()}`);
    });
  }
}

if (process.argv[1]?.endsWith('embed.ts')) {
  const p = await ping();
  if (!p.ok) {
    console.error(`✗ Cannot reach FalkorDB: ${p.error}`);
    process.exit(1);
  }
  try {
    await embedAll();
  } catch (err) {
    console.error(`✗ Embedding failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
