// Dates are stored in the graph as integer day numbers so Cypher can do arithmetic on them.
// Day 0 is 1 January 2024. "Today" in the synthetic world is 1 October 2026.

export const EPOCH_UTC = Date.UTC(2024, 0, 1);
export const TODAY_DAY = 1004;
const DAY_MS = 86_400_000;

export function dayToDate(day: number): Date {
  return new Date(EPOCH_UTC + day * DAY_MS);
}

export function dayToISO(day: number): string {
  return dayToDate(day).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayToLabel(day: number): string {
  const d = dayToDate(day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function dayToShort(day: number): string {
  const d = dayToDate(day);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

export function daysBetweenLabel(days: number): string {
  const abs = Math.abs(days);
  if (abs < 14) return `${abs} day${abs === 1 ? '' : 's'}`;
  if (abs < 90) return `${Math.round(abs / 7)} weeks`;
  if (abs < 730) return `${Math.round(abs / 30.4)} months`;
  return `${(abs / 365).toFixed(1)} years`;
}

/** A real timestamp (ms) as "Oct 15, 2026". UTC, so the server and the browser always render the same text. */
export function msToLabel(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
