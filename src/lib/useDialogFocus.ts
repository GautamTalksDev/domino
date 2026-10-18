'use client';

import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus handling: remembers what had focus when the dialog opened and gives it back on close,
 * and keeps Tab / Shift+Tab inside the dialog. Spread the returned onKeyDown on the dialog element.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean, onEscape: () => void) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    const el = opener.current;
    opener.current = null;
    if (el && document.contains(el)) el.focus();
  }, [open]);

  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    // Focus on the dialog box itself (after a click on its text) counts as "before the first item".
    const onBox = document.activeElement === ref.current || !ref.current.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || onBox)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || onBox)) {
      e.preventDefault();
      first.focus();
    }
  };
}
