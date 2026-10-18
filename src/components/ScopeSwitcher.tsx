'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, Check, ChevronDown, Loader2, UserRound } from 'lucide-react';
import { postJson } from '@/lib/client';
import { toast } from '@/lib/toast';

export interface ScopeInfo {
  clinic: { id: string; name: string; short: string };
  user: { id: string; name: string; role: string; title: string };
  clinics: { id: string; name: string; short: string; blurb: string }[];
  users: { id: string; name: string; role: string; title: string; clinic: string }[];
}

const DOT: Record<string, string> = { riverside: 'bg-sage', lakeview: 'bg-sky' };

export function ScopeSwitcher({ scope }: { scope: ScopeInfo }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const path = usePathname();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const choose = async (clinic: string, user?: string) => {
    setBusy(true);
    try {
      await postJson('/api/session', { clinic, ...(user ? { user } : {}) });
      setOpen(false);
      // A patient in one clinic does not exist in another: go to the patient list when the clinic changes.
      if (clinic !== scope.clinic.id && (path.startsWith('/patients/') || path.startsWith('/trace'))) router.push('/patients');
      router.refresh();
      const c = scope.clinics.find((x) => x.id === clinic);
      const u = user ? scope.users.find((x) => x.id === user) : null;
      if (clinic !== scope.clinic.id)
        toast({
          tone: 'info',
          title: `Now in ${c?.name ?? clinic}`,
          body: 'Every query, memory and learned procedure now comes from this clinic’s own FalkorDB graph.',
        });
      else if (u && u.id !== scope.user.id)
        toast({
          tone: 'info',
          title: `Working as ${u.name}, ${u.title.toLowerCase()}`,
          body: `The clinic's patients and findings are shared by the whole team, so they stay the same. What changes: tasks for the ${u.role} come first in the inbox, Ask Domino keeps your own conversations, and every decision is signed in your name.`,
        });
    } catch (err) {
      toast({ tone: 'error', title: 'Could not switch', body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={box}>
      <button
        className="flex items-center gap-2 rounded-xl border hairline bg-white/[0.03] px-2.5 py-1.5 text-left text-xs hover:border-white/20"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${scope.clinic.short} ${scope.user.name}: switch clinic or person (now ${scope.clinic.name})`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[scope.clinic.id] ?? 'bg-iris'}`} />
        <span className="hidden sm:block">
          <span className="block font-medium text-bone">{scope.clinic.short}</span>{' '}
          <span className="block text-[10.5px] text-dim">{scope.user.name}</span>
        </span>
        {busy ? <Loader2 size={13} className="animate-spin text-dim" /> : <ChevronDown size={13} className="text-dim" />}
      </button>
      {open && (
        <div role="dialog" aria-label="Clinic and identity" className="card card-pop absolute right-0 top-11 z-50 w-[320px] p-3">
          <p className="kicker px-1">Clinic · its own FalkorDB graph</p>
          <ul className="mt-2 space-y-1">
            {scope.clinics.map((c) => (
              <li key={c.id}>
                <button
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/5 ${c.id === scope.clinic.id ? 'bg-white/[0.05]' : ''}`}
                  onClick={() => choose(c.id)}
                  disabled={busy}
                >
                  <Building2 size={15} className="mt-0.5 shrink-0 text-dim" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm text-bone">
                      <span className={`h-1.5 w-1.5 rounded-full ${DOT[c.id] ?? 'bg-iris'}`} />
                      {c.name}
                    </span>
                    <span className="block text-[11px] leading-snug text-dim">{c.blurb}</span>
                  </span>
                  {c.id === scope.clinic.id && <Check size={14} className="mt-0.5 text-sage" />}
                </button>
              </li>
            ))}
          </ul>
          <p className="kicker mt-3 px-1">Working as (demo identity)</p>
          <ul className="mt-2 space-y-1">
            {scope.users
              .filter((u) => u.clinic === scope.clinic.id)
              .map((u) => (
                <li key={u.id}>
                  <button
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/5 ${u.id === scope.user.id ? 'bg-white/[0.05]' : ''}`}
                    onClick={() => choose(scope.clinic.id, u.id)}
                    disabled={busy}
                  >
                    <UserRound size={14} className="shrink-0 text-dim" />
                    <span className="min-w-0 flex-1 text-sm text-bone">
                      {u.name} <span className="text-[11px] text-dim">· {u.title}</span>
                    </span>
                    {u.id === scope.user.id && <Check size={14} className="text-sage" />}
                  </button>
                </li>
              ))}
          </ul>
          <p className="mt-3 px-1 text-[11px] leading-snug text-mute">
            Demo identities, not sign-in. They keep conversations and decisions per person; the clinic decides which graph every query runs on.
          </p>
        </div>
      )}
    </div>
  );
}
