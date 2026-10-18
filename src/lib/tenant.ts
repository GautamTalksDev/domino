// Clinics (tenants) and demo identities.
//
// Each clinic is its own FalkorDB graph, so memory is isolated by construction: a query can only
// ever see the graph it was sent to, and the graph is chosen on the server from the session,
// never from a request parameter or a model's tool call (OWASP A01, Agentic ASI03).
//
// The demo identities are NOT authentication. They show how memory is kept per user (conversation
// history, who decided what). In production, map an SSO identity to a clinic and a role here.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface Clinic {
  id: string;
  name: string;
  short: string;
  /** Suffix added to FALKORDB_GRAPH for this clinic's graph ('' for the default clinic). */
  suffix: string;
  cohortSeed: number;
  cohortSize: number;
  personas: boolean;
  /** Patient id prefix for the synthetic cohort, so ids never look shared between clinics. */
  idPrefix: string;
  blurb: string;
}

export const CLINICS: Clinic[] = [
  {
    id: 'riverside',
    name: 'Riverside Family Health',
    short: 'Riverside',
    suffix: '',
    cohortSeed: 20261015,
    cohortSize: Number(process.env.DOMINO_COHORT_SIZE || 600),
    personas: true,
    idPrefix: 'p',
    blurb: 'Family practice. The six story patients live here.',
  },
  {
    id: 'lakeview',
    name: 'Lakeview Geriatric Clinic',
    short: 'Lakeview',
    suffix: '_lakeview',
    cohortSeed: 20261016,
    cohortSize: Math.max(60, Math.round(Number(process.env.DOMINO_COHORT_SIZE || 600) / 2)),
    personas: false,
    idPrefix: 'pl',
    blurb: 'A second clinic with its own graph, patients, inbox and memory.',
  },
];

export type Role = 'pharmacist' | 'prescriber' | 'nurse';

export interface DemoUser {
  id: string;
  name: string;
  role: Role;
  clinic: string;
  title: string;
}

export const USERS: DemoUser[] = [
  { id: 'lee', name: 'Sam Lee', role: 'pharmacist', clinic: 'riverside', title: 'Clinical pharmacist' },
  { id: 'okafor', name: 'Dr. Amara Okafor', role: 'prescriber', clinic: 'riverside', title: 'Family physician' },
  { id: 'brandt', name: 'Nina Brandt', role: 'nurse', clinic: 'riverside', title: 'Practice nurse' },
  { id: 'ellis', name: 'Jo Ellis', role: 'pharmacist', clinic: 'lakeview', title: 'Consultant pharmacist' },
  { id: 'raman', name: 'Dr. Priya Raman', role: 'prescriber', clinic: 'lakeview', title: 'Geriatrician' },
];

export interface Scope {
  clinic: string;
  user: string;
}

export const CLINIC_COOKIE = 'domino_clinic';
export const USER_COOKIE = 'domino_user';

const byId = <T extends { id: string }>(list: T[]) => {
  const m = Object.create(null) as Record<string, T | undefined>;
  for (const x of list) m[x.id] = x;
  return m;
};
const CLINIC_BY_ID = byId(CLINICS);
const USER_BY_ID = byId(USERS);

export function clinicById(id: string | undefined | null): Clinic | undefined {
  return id ? CLINIC_BY_ID[id] : undefined;
}
export function userById(id: string | undefined | null): DemoUser | undefined {
  return id ? USER_BY_ID[id] : undefined;
}

export function defaultClinic(): Clinic {
  return clinicById(process.env.DOMINO_CLINIC) ?? CLINICS[0];
}

/** Validates a clinic and user pair against the allowlists; falls back to the clinic's first user. */
export function resolveScope(clinic?: string | null, user?: string | null): Scope {
  const c = clinicById(clinic) ?? defaultClinic();
  const u = userById(user);
  return { clinic: c.id, user: u && u.clinic === c.id ? u.id : USERS.find((x) => x.clinic === c.id)!.id };
}

export function graphFor(clinicId: string): string {
  const base = process.env.FALKORDB_GRAPH || 'domino';
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(base)) throw new Error('FALKORDB_GRAPH must be letters, digits, _ or -');
  const c = clinicById(clinicId);
  if (!c) throw new Error(`Unknown clinic ${clinicId}`);
  return base + c.suffix;
}

// One AsyncLocalStorage per process, shared across Next.js module instances.
const g = globalThis as unknown as { __domino_scope?: AsyncLocalStorage<Scope> };
const als = (g.__domino_scope ??= new AsyncLocalStorage<Scope>());

/** Runs fn with an explicit clinic and user (route handlers, scripts, the sweep, tests). */
export function runInScope<T>(scope: Partial<Scope>, fn: () => T): T {
  return als.run(resolveScope(scope.clinic, scope.user), fn);
}

async function scopeFromCookies(): Promise<Scope | null> {
  // Only inside the Next.js server runtime; scripts and tests use runInScope or the default clinic.
  if (!process.env.NEXT_RUNTIME) return null;
  try {
    const { cookies } = await import('next/headers');
    const jar = await cookies();
    return resolveScope(jar.get(CLINIC_COOKIE)?.value, jar.get(USER_COOKIE)?.value);
  } catch {
    return null;
  }
}

/** The current clinic and user: explicit scope first, then the session cookies, then the default clinic. */
export async function currentScope(): Promise<Scope> {
  return als.getStore() ?? (await scopeFromCookies()) ?? resolveScope();
}

export async function currentClinic(): Promise<Clinic> {
  return clinicById((await currentScope()).clinic)!;
}

export async function currentUser(): Promise<DemoUser> {
  return userById((await currentScope()).user)!;
}
