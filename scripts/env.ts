// Load .env.local / .env for scripts (Next.js loads them itself for the app).
import { existsSync } from 'node:fs';
for (const f of ['.env.local', '.env']) {
  if (existsSync(f)) {
    try {
      process.loadEnvFile(f);
    } catch (err) {
      // Never silently: a skipped .env.local would point the scripts at a different database than the app.
      console.warn(`! Could not read ${f} (${err instanceof Error ? err.message : String(err)}). Domino needs Node 20.12 or newer.`);
    }
  }
}
