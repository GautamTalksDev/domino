// Running as a public demo: which writes need the access key, and who may call the scheduled jobs.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { NextRequest } from 'next/server';
import { guard, requireCron, writesAllowed } from '../src/lib/api';

const KEYS = ['DOMINO_WRITE_KEY', 'DOMINO_OPEN_DEMO', 'CRON_SECRET'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

let ip = 0;
const req = (headers: Record<string, string> = {}) =>
  // A fresh client address per request, so the rate limiter never decides a test.
  new NextRequest('http://domino.test/api/x', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', 'x-real-ip': `10.0.0.${++ip % 250}`, ...headers } });
const status = (fn: () => void) => {
  try {
    fn();
    return 200;
  } catch (err) {
    return (err as { status?: number }).status ?? 500;
  }
};

describe('public demo mode', () => {
  it('without a key, every write is open (a local or private deployment)', () => {
    delete process.env.DOMINO_WRITE_KEY;
    expect(status(() => guard(req(), { write: true }))).toBe(200);
    expect(status(() => guard(req(), { write: 'demo' }))).toBe(200);
  });

  it('with a key, every write needs it unless the deployment is an open demo', () => {
    process.env.DOMINO_WRITE_KEY = 'judge-key-123456';
    delete process.env.DOMINO_OPEN_DEMO;
    expect(status(() => guard(req(), { write: 'demo' }))).toBe(401);
    expect(status(() => guard(req({ 'x-domino-key': 'judge-key-123456' }), { write: 'demo' }))).toBe(200);
    expect(status(() => guard(req({ 'x-domino-key': 'wrong-key-1234567' }), { write: true }))).toBe(401);
  });

  it('an open demo lets visitors try the product, but the key still guards admin and destructive operations', () => {
    process.env.DOMINO_WRITE_KEY = 'judge-key-123456';
    process.env.DOMINO_OPEN_DEMO = 'true';
    expect(status(() => guard(req(), { write: 'demo' }))).toBe(200);
    expect(status(() => guard(req(), { write: true }))).toBe(401);
    expect(status(() => guard(req(), { admin: true }))).toBe(401);
    // Still same-origin only: another site cannot drive a visitor's browser into writing.
    expect(status(() => guard(req({ 'sec-fetch-site': 'cross-site' }), { write: 'demo' }))).toBe(403);
  });

  it("lets Domino's own pages (the EHR demo) write CDS cards in an open demo, but not outside callers", () => {
    process.env.DOMINO_WRITE_KEY = 'judge-key-123456';
    process.env.DOMINO_OPEN_DEMO = 'true';
    expect(writesAllowed(req())).toBe(true);
    expect(writesAllowed(req({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    delete process.env.DOMINO_OPEN_DEMO;
    expect(writesAllowed(req())).toBe(false);
    expect(writesAllowed(req({ 'x-domino-key': 'judge-key-123456' }))).toBe(true);
  });

  it('runs scheduled jobs only for the cron secret, and never with a short or missing one', () => {
    delete process.env.CRON_SECRET;
    expect(status(() => requireCron(req({ authorization: 'Bearer ' })))).toBe(401);
    process.env.CRON_SECRET = 'short';
    expect(status(() => requireCron(req({ authorization: 'Bearer short' })))).toBe(401);
    process.env.CRON_SECRET = 'a-long-enough-cron-secret';
    expect(status(() => requireCron(req({ authorization: 'Bearer a-long-enough-cron-secret' })))).toBe(200);
    expect(status(() => requireCron(req({ authorization: 'Bearer a-long-enough-cron-secreT' })))).toBe(401);
  });
});
