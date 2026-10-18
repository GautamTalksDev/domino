// HMAC signatures for agent handoffs, proposed tasks and clinician decisions.
// A handoff or decision whose signature does not verify is ignored by the agents,
// so a record injected directly into the graph cannot steer a later run
// (OWASP Agentic ASI06 memory poisoning, ASI07 insecure inter-agent communication).

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEV_SECRET = 'domino-dev-secret-change-me';

/** The server is missing required configuration. Reported as 503 with the fix, never as a stack trace. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function signingSecret(): string {
  const s = process.env.DOMINO_SIGNING_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === 'production' && process.env.DOMINO_ALLOW_DEV_SECRET !== 'true') {
    throw new ConfigError(
      'Signing is not configured: set DOMINO_SIGNING_SECRET (16+ characters) on the server, then run npm run seed so seeded memory is signed with it.',
    );
  }
  return DEV_SECRET;
}

export function usingDevSecret(): boolean {
  const s = process.env.DOMINO_SIGNING_SECRET;
  return !(s && s.length >= 16);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

export function signPayload(payload: unknown): string {
  return createHmac('sha256', signingSecret()).update(canonical(payload)).digest('base64url');
}

/** What a task signature covers: everything a clinician reads before approving it. */
export function taskPayload(t: {
  id: string;
  patientId: string;
  title: string;
  body: string | null;
  role: string;
  run: string | null;
  pattern?: string | null;
}) {
  // The pattern is signed too: it decides which procedure a decision on this task teaches.
  return { kind: 'task', id: t.id, patientId: t.patientId, title: t.title, body: t.body ?? '', role: t.role, run: t.run ?? null, pattern: t.pattern ?? null };
}

/** What a decision signature covers, including the reason that later runs show to clinicians. */
export function decisionPayload(d: { id: string; patientId: string; from: string; to: string; verdict: string; by: string; reason: string | null }) {
  return { kind: 'decision', id: d.id, patientId: d.patientId, from: d.from, to: d.to, verdict: d.verdict, by: d.by, reason: d.reason ?? '' };
}

export function verifyPayload(payload: unknown, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const expected = Buffer.from(signPayload(payload));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
