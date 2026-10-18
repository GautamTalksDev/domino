// Leases in the graph: shared state between agent runs, app instances and the nightly sweep.
// A review takes the lease "review:<patient>", the sweep takes "sweep". The lease expires on its own
// if a process dies, and is renewed while the work is still running.

import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { run } from './db';
import { Q } from './cypher';

const LEASE_MS = 2 * 60_000;
const RENEW_MS = 30_000;
const INSTANCE = `${hostname().slice(0, 40)}:${process.pid}`;

export class BusyError extends Error {
  constructor(message = 'A review for this patient is already running.') {
    super(message);
    this.name = 'BusyError';
  }
}

export async function holder(key: string): Promise<string | null> {
  const rows = await run<{ owner: string }>(Q.lockHolder, { key, now: Date.now() });
  return rows[0]?.owner ?? null;
}

async function acquire(key: string, owner: string): Promise<boolean> {
  const now = Date.now();
  const rows = await run<{ owner: string }>(Q.acquireLock, { key, owner, now, until: now + LEASE_MS });
  return rows[0]?.owner === owner;
}

/** Runs fn while holding the lease on key, or throws BusyError if someone else holds it. */
export async function withLease<T>(key: string, fn: () => Promise<T>, busyMessage?: string): Promise<T> {
  const owner = `${INSTANCE}:${randomUUID().slice(0, 8)}`;
  if (!(await acquire(key, owner))) throw new BusyError(busyMessage);
  const timer = setInterval(() => {
    acquire(key, owner).catch(() => undefined);
  }, RENEW_MS);
  timer.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    await run(Q.releaseLock, { key, owner }).catch(() => undefined);
  }
}
