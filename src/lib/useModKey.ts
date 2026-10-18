'use client';

import { useSyncExternalStore } from 'react';

const isApple = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

/** "⌘" on Apple devices, "Ctrl" elsewhere. The server renders "⌘"; the browser corrects it without a hydration mismatch. */
export function useModKey(): string {
  return useSyncExternalStore(
    () => () => {},
    () => (isApple() ? '⌘' : 'Ctrl '),
    () => '⌘',
  );
}
