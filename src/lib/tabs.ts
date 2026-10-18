import type { KeyboardEvent } from 'react';

/** Arrow-key navigation for a tablist (WAI-ARIA tabs pattern): ←/→ move, Home/End jump, selection follows focus. */
export function onTabKey<T extends string>(e: KeyboardEvent, tabs: readonly T[], current: T, select: (t: T) => void, idOf: (t: T) => string) {
  const i = tabs.indexOf(current);
  const n =
    e.key === 'ArrowRight'
      ? (i + 1) % tabs.length
      : e.key === 'ArrowLeft'
        ? (i - 1 + tabs.length) % tabs.length
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? tabs.length - 1
            : -1;
  if (n < 0) return;
  e.preventDefault();
  select(tabs[n]);
  document.getElementById(idOf(tabs[n]))?.focus();
}
