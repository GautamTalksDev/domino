// The read-only query console: run any read query from the catalog with validated parameters.
import { Q, type CypherQuery } from './cypher';

export const CONSOLE_QUERIES = [
  'paths',
  'links',
  'loops',
  'reasons',
  'pileups',
  'harms',
  'combos',
  'burden',
  'alternatives',
  'gatekeeper',
  'drug',
  'neighborhood',
  'shortest',
  'chokepoints',
  'stats',
  'edgeStats',
  'pssaPairs',
  'findingsByPattern',
  'populationSummary',
  'rootDrugs',
  'memory',
  'patternFeedback',
  'patient',
] as const satisfies readonly (keyof typeof Q)[];

export type ConsoleKey = (typeof CONSOLE_QUERIES)[number];

export function consoleQuery(key: string): CypherQuery | null {
  if (!(CONSOLE_QUERIES as readonly string[]).includes(key)) return null;
  const q = Q[key as ConsoleKey];
  return q.mode === 'read' ? q : null;
}

/** Parameter names a query needs, from its $tokens. */
export function paramsOf(q: CypherQuery): string[] {
  return [...new Set([...q.cypher.matchAll(/\$([A-Za-z_]+)/g)].map((m) => m[1]))];
}

export const FIXED_PARAMS: Record<string, unknown> = {
  harms: ['falls', 'fracture', 'kidney_injury'],
  from: 0,
  window: 365,
  minPairs: 8,
  min: 0.5,
  asOf: 1e9,
  exclude: [],
};

/** Parameters a caller may set, per query. Anything else uses FIXED_PARAMS (so pssa_pairs' numeric $from is never a drug id). */
export const USER_PARAMS: Record<string, readonly string[]> = {
  shortest_cascade: ['from', 'to'],
};

export function userMaySet(q: CypherQuery, name: string) {
  if (name === 'from' || name === 'to') return USER_PARAMS[q.id]?.includes(name) ?? false;
  return !(name in FIXED_PARAMS);
}
