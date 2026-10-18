'use client';

import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, X } from 'lucide-react';
import { registerUnlocker } from '@/lib/client';
import { useDialogFocus } from '@/lib/useDialogFocus';

// Shown only on deployments that set DOMINO_WRITE_KEY: the first write asks for the key once,
// exchanges it for an httpOnly cookie, and the action carries on.
export function UnlockDialog() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  // Several writes can need the key at once (two buttons, a retry): they all wait on the same prompt.
  const pending = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    registerUnlocker(() => {
      pending.current ??= new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setError(null);
        setKey('');
        setOpen(true);
      }).finally(() => {
        pending.current = null;
      });
      return pending.current;
    });
    return () => registerUnlocker(null);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30);
  }, [open]);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const trap = useDialogFocus(form, open, () => close(false));

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => close(false)}>
      <form
        ref={form}
        onKeyDown={trap}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="unlock-title"
        className="card w-full max-w-sm p-5 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await fetch('/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
            if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'That key did not work.');
            close(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'That key did not work.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-vermilion/15 text-vermilion-2">
              <KeyRound size={17} />
            </span>
            <div>
              <h2 id="unlock-title" className="font-display text-lg text-bone">
                Access key
              </h2>
              <p className="text-xs text-dim">This action needs the deployment’s access key.</p>
            </div>
          </div>
          <button type="button" className="rounded-md p-1 text-mute hover:text-bone" aria-label="Close" onClick={() => close(false)}>
            <X size={16} />
          </button>
        </div>
        <input
          ref={input}
          type="password"
          autoComplete="current-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          minLength={8}
          maxLength={200}
          required
          placeholder="Paste the access key"
          className="field mt-4 w-full px-3 py-2.5 text-sm text-bone"
        />
        {error && <p className="mt-2 text-xs text-vermilion-2">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || key.length < 8}>
            {busy && <Loader2 size={14} className="animate-spin" />} Unlock
          </button>
        </div>
        <p className="mt-3 text-[11px] text-mute">
          Judging Graph Hacks? The key is in Domino’s submission notes. Kept for 12 hours in an httpOnly cookie on this browser.
        </p>
      </form>
    </div>
  );
}
