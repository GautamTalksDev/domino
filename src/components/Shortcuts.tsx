'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Keyboard, X } from 'lucide-react';
import { useDialogFocus } from '@/lib/useDialogFocus';
import { useModKey } from '@/lib/useModKey';

// Keyboard navigation in the style of the tools clinicians' IT teams already use: "g" then a letter jumps to a page,
// "?" lists every shortcut. Ignored while typing, and never bound to a modifier the browser needs.

export const GO: { key: string; href: string; label: string }[] = [
  { key: 'h', href: '/', label: 'Home' },
  { key: 'p', href: '/patients', label: 'Patients' },
  { key: 'i', href: '/inbox', label: 'Inbox' },
  { key: 't', href: '/team', label: 'Care team' },
  { key: 'c', href: '/check', label: 'Prescriber check' },
  { key: 'l', href: '/checkup', label: 'Try a list' },
  { key: 'o', href: '/population', label: 'Population' },
  { key: 'g', href: '/graph', label: 'Graph' },
  { key: 'e', href: '/evaluation', label: 'Evaluation' },
  { key: 'w', href: '/how', label: 'How it works' },
];

const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Opens the shortcuts sheet from anywhere. */
export function openShortcuts() {
  window.dispatchEvent(new Event('domino:shortcuts'));
}

export function Shortcuts() {
  const router = useRouter();
  const mod = useModKey().trim();
  // Read through a ref, so the key listener is attached once and never reset mid-sequence by a re-render.
  const routerRef = useRef(router);
  routerRef.current = router;
  const [open, setOpen] = useState(false);
  const [leader, setLeader] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trap = useDialogFocus(box, open, () => setOpen(false));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.querySelector('[data-shortcuts]')) {
        setOpen(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target) || document.querySelector('[role="dialog"][aria-modal="true"]:not([data-shortcuts])')) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (pending) {
        pending = false;
        setLeader(false);
        clearTimeout(timer);
        const hit = GO.find((g) => g.key === e.key.toLowerCase());
        if (hit) {
          e.preventDefault();
          setOpen(false);
          routerRef.current.push(hit.href);
        }
        return;
      }
      if (e.key === 'g' && !e.shiftKey) {
        pending = true;
        setLeader(true);
        timer = setTimeout(() => {
          pending = false;
          setLeader(false);
        }, 1500);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('domino:shortcuts', onOpen);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('domino:shortcuts', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => box.current?.querySelector<HTMLElement>('button')?.focus(), 20);
  }, [open]);

  // Nothing to show until a key is pressed, so nothing renders on the server or during hydration.
  if (!open && !leader) return null;
  return createPortal(
    <>
      {/* A small hint while "g" waits for its second key. */}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 transition-all duration-200 ${leader ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
      >
        {leader && (
          <span className="flex items-center gap-2 rounded-full border hairline bg-ink-2/95 px-3.5 py-1.5 text-xs text-bone-2 shadow-2xl backdrop-blur-xl">
            <kbd className="kbd">g</kbd> then a letter · <kbd className="kbd">?</kbd> for the list
          </span>
        )}
      </div>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            ref={box}
            data-shortcuts
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            onKeyDown={trap}
            onClick={(e) => e.stopPropagation()}
            className="card pop-in w-full max-w-md p-6 shadow-2xl outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-xl bg-white/[0.06] text-bone-2">
                  <Keyboard size={17} />
                </span>
                <h2 id="shortcuts-title" className="font-display text-xl font-semibold">
                  Keyboard shortcuts
                </h2>
              </div>
              <button className="btn btn-ghost px-2" onClick={() => setOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <dl className="mt-5 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2.5 text-sm">
              <dt className="text-bone-2">Search patients, pages and actions</dt>
              <dd className="flex gap-1">
                <kbd className="kbd">{mod}</kbd>
                <kbd className="kbd">K</kbd>
                <span className="px-0.5 text-mute">or</span>
                <kbd className="kbd">/</kbd>
              </dd>
              <dt className="text-bone-2">This list</dt>
              <dd>
                <kbd className="kbd">?</kbd>
              </dd>
              <dt className="text-bone-2">Close a dialog</dt>
              <dd>
                <kbd className="kbd">Esc</kbd>
              </dd>
            </dl>
            <p className="kicker mt-6">Go to</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
              {GO.map((g) => (
                <div key={g.key} className="flex items-center justify-between gap-3">
                  <dt className="text-bone-2">{g.label}</dt>
                  <dd className="flex gap-1">
                    <kbd className="kbd">g</kbd>
                    <kbd className="kbd">{g.key}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
