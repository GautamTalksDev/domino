// Route-handler helpers: access control, CSRF defence, rate limiting, input limits and safe errors.
// OWASP Top 10:2025: A01 access control, A02 misconfiguration, A05 injection,
// A07 authentication, A09 logging, A10 mishandling of exceptional conditions;
// OWASP LLM10 unbounded consumption.
import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { DatabaseUnavailableError } from './db';
import { NotFoundError } from './engine/analyze';
import { BusyError } from './lock';
import { openDemo } from './demoMode';
import { ConfigError } from './agent/sign';
import { CLINIC_COOKIE, runInScope, USER_COOKIE } from './tenant';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Bucket = 'read' | 'write' | 'agent' | 'ask' | 'heavy' | 'unlock' | 'cds';
const LIMITS: Record<Bucket, { capacity: number; perMinute: number }> = {
  read: { capacity: 240, perMinute: 240 },
  write: { capacity: 40, perMinute: 40 },
  agent: { capacity: 8, perMinute: 6 },
  ask: { capacity: 12, perMinute: 10 },
  heavy: { capacity: 3, perMinute: 2 },
  // Its own allowance: unlocking never uses up the check-up, sweep or evaluation budget.
  unlock: { capacity: 5, perMinute: 5 },
  // CDS Hooks calls from EHRs: their own allowance, so order-entry traffic never starves the agents (or the reverse).
  cds: { capacity: 30, perMinute: 30 },
};

const g = globalThis as unknown as { __domino_rl?: Map<string, { tokens: number; at: number }> };
const buckets = (g.__domino_rl ??= new Map());

function clientIp(req: NextRequest): string {
  // Client-supplied headers are only trusted behind a proxy that sets them (DOMINO_TRUST_PROXY=true, e.g. on Vercel).
  // Otherwise anyone could send a fresh X-Real-IP per request and dodge the limit, so every caller shares one bucket.
  if (process.env.DOMINO_TRUST_PROXY === 'true') {
    const ip = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0];
    if (ip?.trim()) return ip.trim().slice(0, 64);
  }
  return 'global';
}

function rateLimit(req: NextRequest, bucket: Bucket) {
  const { capacity, perMinute } = LIMITS[bucket];
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    throw new HttpError(429, 'Too many requests. Please wait a moment and try again.');
  }
  b.tokens -= 1;
  buckets.set(key, b);
  // Forget idle clients, so one entry per IP (behind a trusted proxy) cannot grow the map forever.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.at > 10 * 60_000) buckets.delete(k);
  }
  // A request refused for a missing access key gets its token back: unlock-then-retry costs one, not two.
  return () => {
    b.tokens = Math.min(capacity, b.tokens + 1);
  };
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Same-origin check for state-changing requests (CSRF defence). */
function checkOrigin(req: NextRequest) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Cross-site requests are not allowed.');
  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Bad origin.');
    }
    if (!host || originHost !== host) throw new HttpError(403, 'Cross-origin requests are not allowed.');
  }
}

/** Optional write key: when DOMINO_WRITE_KEY is set, every write needs it (header or cookie). */
function checkWriteKey(req: NextRequest, always = false) {
  const key = process.env.DOMINO_WRITE_KEY;
  if (!key) {
    if (always && process.env.NODE_ENV === 'production') throw new HttpError(403, 'This action is disabled. Set DOMINO_WRITE_KEY to enable it.');
    return;
  }
  const given = req.headers.get('x-domino-key') ?? req.cookies.get('domino_key')?.value ?? '';
  if (!given || !safeEqual(given, key)) throw new HttpError(401, 'This action needs the Domino access key.');
}

/**
 * For endpoints other systems call across origins (CDS Hooks): may this request write to the graph? Always, unless the
 * deployment set DOMINO_WRITE_KEY, in which case only with the key (x-domino-key header). An open demo also lets
 * Domino's own pages write (the /ehr demo), recognised by the browser's same-origin fetch metadata.
 */
export function writesAllowed(req: NextRequest): boolean {
  const key = process.env.DOMINO_WRITE_KEY;
  if (!key) return true;
  if (openDemo() && req.headers.get('sec-fetch-site') === 'same-origin') return true;
  const given = req.headers.get('x-domino-key') ?? req.cookies.get('domino_key')?.value ?? '';
  return !!given && safeEqual(given, key);
}

/** Scheduled jobs (nightly reset or sweep, keep-alive): CRON_SECRET (16+ characters) as a Bearer token. */
export function requireCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!secret || secret.length < 16 || !safeEqual(given, secret)) throw new HttpError(401, 'Unauthorized.');
}

/** Whether this request carries the access key (or the deployment has none). */
export function writesAllowedWithKey(req: NextRequest): boolean {
  const key = process.env.DOMINO_WRITE_KEY;
  if (!key) return true;
  const given = req.headers.get('x-domino-key') ?? req.cookies.get('domino_key')?.value ?? '';
  return !!given && safeEqual(given, key);
}

export interface GuardOptions {
  bucket?: Bucket;
  /**
   * A state change. `'demo'` marks one a visitor needs to try the product (a review, a question, a decision, an inbox
   * task, adding a prescription, a check-up): with DOMINO_OPEN_DEMO=true it needs no access key. `true` always does.
   */
  write?: boolean | 'demo';
  admin?: boolean;
  /** Same-origin check only (state change that touches no clinical data, e.g. switching the demo identity). */
  sameOrigin?: boolean;
}

export function guard(req: NextRequest, opts: GuardOptions = {}) {
  const refund = rateLimit(req, opts.bucket ?? (opts.write || opts.sameOrigin ? 'write' : 'read'));
  if (opts.write || opts.admin || opts.sameOrigin) checkOrigin(req);
  if ((opts.write && !(opts.write === 'demo' && openDemo())) || opts.admin) {
    try {
      checkWriteKey(req, !!opts.admin);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) refund();
      throw err;
    }
  }
}

export async function readJson<T extends z.ZodTypeAny>(req: NextRequest, schema: T, maxBytes = 16_384): Promise<z.infer<T>> {
  // The media type itself, not a substring: "text/plain; charset=application/json" is a simple (no-preflight) cross-site request.
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Send JSON (content-type: application/json).');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request body is too large.');
  let body: unknown;
  try {
    body = JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, `Invalid request: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('; ')}`);
  return parsed.data;
}

export const PatientId = z.string().regex(/^p-?[a-z0-9-]{2,40}$/, 'invalid patient id');
export const DrugId = z.string().regex(/^[a-z0-9_]{2,40}$/, 'invalid drug id');

export function parsePatientId(id: string) {
  const r = PatientId.safeParse(id);
  if (!r.success) throw new HttpError(400, 'Invalid patient id.');
  return r.data;
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
  if (err instanceof BusyError) return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof ConfigError) return NextResponse.json({ error: err.message, code: 'config' }, { status: 503 });
  if (err instanceof DatabaseUnavailableError) return NextResponse.json({ error: err.message, code: 'db_unavailable' }, { status: 503 });
  // Log the detail on the server; never send stack traces or internals to the client.
  console.error('[domino] unhandled error:', err instanceof Error ? `${err.name}: ${err.message}` : err);
  return NextResponse.json({ error: 'Something went wrong. Check the server log.' }, { status: 500 });
}

/**
 * Wraps a route handler: errors become safe JSON responses, and everything the handler does
 * (including a streamed agent run) runs in the session's clinic, so it only ever touches that clinic's graph.
 */
export function handle<C>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C) =>
    runInScope({ clinic: req.cookies.get(CLINIC_COOKIE)?.value, user: req.cookies.get(USER_COOKIE)?.value }, async () => {
      try {
        return await fn(req, ctx);
      } catch (err) {
        return errorResponse(err);
      }
    });
}

/** Server-sent events stream for agent runs. */
export function sse(producer: (send: (event: unknown) => void, signal: AbortSignal) => Promise<void>, req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const ping = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            closed = true;
          }
        }
      }, 15_000);
      try {
        await producer(send, req.signal);
      } catch (err) {
        const res = errorResponse(err);
        const body = (await res.json()) as { error?: string };
        send({ type: 'error', message: body.error ?? 'The run failed.', status: res.status });
      } finally {
        clearInterval(ping);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

/** Whether this request came over HTTPS (directly or through a TLS-terminating proxy): cookies are Secure when it did. */
export function isHttps(req: NextRequest): boolean {
  return req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
}
