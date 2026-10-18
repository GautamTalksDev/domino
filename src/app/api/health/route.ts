import { NextResponse, type NextRequest } from 'next/server';
import { guard, handle } from '@/lib/api';
import { ping, run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { geminiCooling, getProvider, modelPause } from '@/lib/agent/providers';
import { activeEmbeddingModel, embeddingsEnabled, embeddingsPaused } from '@/lib/embeddings';
import { signingSecret, usingDevSecret } from '@/lib/agent/sign';
import { nightlyReset, openDemo } from '@/lib/demoMode';

export const dynamic = 'force-dynamic';

function signingReady() {
  try {
    signingSecret();
    return true;
  } catch {
    return false;
  }
}

export const GET = handle(async (req: NextRequest) => {
  guard(req);
  const db = await ping();
  let meta: Record<string, unknown> | null = null;
  if (db.ok) {
    try {
      meta = (await run(Q.meta))[0] ?? null;
    } catch {
      meta = null;
    }
  }
  return NextResponse.json({
    db,
    seeded: !!meta,
    meta,
    agent: getProvider().label,
    // Why the model is being skipped for a minute (quota, outage), if it is: the reason, never the key.
    modelPaused: modelPause()?.reason ?? null,
    // Gemini models being skipped after an error (over quota, not open to this key), so the next one answers.
    modelsCooling: geminiCooling(),
    semantic: !embeddingsEnabled() ? 'off (words only)' : embeddingsPaused() ? `${activeEmbeddingModel()} (paused after an error; words only for a minute)` : activeEmbeddingModel(),
    devSecret: usingDevSecret(),
    signing: signingReady() ? 'ok' : 'missing',
    writeKey: !!process.env.DOMINO_WRITE_KEY,
    // Public demo settings (booleans only): whether visitors can try everything without the key, and the nightly rebuild.
    openDemo: openDemo(),
    demoReset: nightlyReset() ? 'nightly' : null,
    cron: (process.env.CRON_SECRET ?? '').length >= 16,
  });
});
