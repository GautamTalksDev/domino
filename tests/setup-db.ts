import { existsSync } from 'node:fs';
for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
import { ping } from '../src/lib/db';

export async function dbAvailable() {
  const p = await ping();
  return p.ok;
}
