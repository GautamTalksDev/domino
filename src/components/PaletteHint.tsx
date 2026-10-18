'use client';

import { Keyboard } from 'lucide-react';
import { openCommandPalette } from './CommandPalette';
import { useModKey } from '@/lib/useModKey';

export function PaletteHint() {
  const mod = useModKey();
  return (
    <button onClick={openCommandPalette} className="mt-4 hidden items-center gap-2 text-xs text-mute transition-colors hover:text-bone-2 sm:inline-flex">
      <Keyboard size={13} /> Press <span className="kbd">{mod}K</span> or <span className="kbd">/</span> anywhere to jump to a patient, a page or an action.
    </button>
  );
}
