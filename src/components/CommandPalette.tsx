'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Brain,
  Compass,
  Building2,
  ClipboardList,
  CornerDownLeft,
  FlaskConical,
  Home,
  Inbox,
  Keyboard,
  Loader2,
  Network,
  NotebookPen,
  Pill,
  Play,
  Plug,
  Search,
  ScrollText,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { postJson } from '@/lib/client';
import { toast } from '@/lib/toast';
import { useDialogFocus } from '@/lib/useDialogFocus';
import type { ScopeInfo } from './ScopeSwitcher';
import { openShortcuts } from './Shortcuts';
import { startJudgeTour } from './JudgeTour';

interface Item {
  id: string;
  group: 'Go to' | 'Do' | 'Patients' | 'Clinic';
  label: string;
  hint?: string;
  keywords?: string;
  icon: LucideIcon;
  run: () => void | Promise<void>;
}

interface PatientRow {
  id: string;
  name: string;
  age: number;
  meds: number;
  likely: number | null;
  persona: boolean;
  headline: string | null;
}

/** Opens the palette from anywhere (the nav button, the landing page). */
export function openCommandPalette() {
  window.dispatchEvent(new Event('domino:palette'));
}

function score(item: Item, words: string[]): number {
  if (!words.length) return 1;
  const hay = `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase();
  let s = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    s += i === 0 ? 3 : hay[i - 1] === ' ' ? 2 : 1;
  }
  return s;
}

export function CommandPalette({ scope }: { scope: ScopeInfo }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [patients, setPatients] = useState<PatientRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const path = usePathname();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !typing && !open && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
        setQ('');
        setActive(0);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('domino:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('domino:palette', onOpen);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => input.current?.focus(), 10);
    if (!patients) {
      fetch('/api/patients')
        .then((r) => r.json())
        .then((j: { patients?: PatientRow[] }) => setPatients(j.patients ?? []))
        .catch(() => setPatients([]));
    }
  }, [open, patients]);

  // A clinic switch changes the patient list.
  useEffect(() => setPatients(null), [scope.clinic.id]);

  const go = useCallback(
    (href: string) => () => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const switchTo = useCallback(
    (clinic: string, user?: string) => async () => {
      setBusy(true);
      try {
        await postJson('/api/session', { clinic, ...(user ? { user } : {}) });
        const c = scope.clinics.find((x) => x.id === clinic);
        const u = user ? scope.users.find((x) => x.id === user) : null;
        close();
        if (clinic !== scope.clinic.id && path.startsWith('/patients/')) router.push('/patients');
        router.refresh();
        toast(
          u
            ? { tone: 'info', title: `Working as ${u.name}`, body: 'Conversations, decisions and inbox actions are now signed in this name.' }
            : {
                tone: 'info',
                title: `Now in ${c?.name ?? clinic}`,
                body: 'Every query, memory and procedure now comes from this clinic’s own FalkorDB graph.',
              },
        );
      } catch (err) {
        toast({ tone: 'error', title: 'Could not switch', body: err instanceof Error ? err.message : undefined });
      } finally {
        setBusy(false);
      }
    },
    [close, path, router, scope],
  );

  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      {
        id: 'do-tour',
        group: 'Do',
        label: 'Watch Beatrice’s review',
        hint: 'the agents, live',
        keywords: 'demo tour run agents detective pharmacist scribe',
        icon: Play,
        run: go('/patients/p-beatrice?tour=1'),
      },
      {
        id: 'do-check',
        group: 'Do',
        label: 'Check a new prescription',
        hint: 'before it is written',
        keywords: 'gatekeeper prescriber check stop',
        icon: Pill,
        run: go('/check'),
      },
      {
        id: 'do-ehr',
        group: 'Do',
        label: 'Sign an order in the demo EHR',
        hint: 'Domino over CDS Hooks',
        keywords: 'ehr cds hooks order sign select epic interoperability fhir card',
        icon: Plug,
        run: go('/ehr'),
      },
      {
        id: 'do-list',
        group: 'Do',
        label: 'Paste a medication list',
        hint: 'brand names and typos are fine',
        keywords: 'checkup try list sandbox',
        icon: ClipboardList,
        run: go('/checkup'),
      },
      {
        id: 'do-brain',
        group: 'Do',
        label: 'Ask the care-team brain',
        hint: 'who knows what, what was learned',
        keywords: 'team brain search memory company',
        icon: Brain,
        run: go('/team'),
      },
      {
        id: 'do-note',
        group: 'Do',
        label: 'Add a team note',
        hint: 'protocol, handover or chat',
        keywords: 'doc document handover protocol chat minutes memory',
        icon: NotebookPen,
        run: go('/team#team-notes'),
      },
      {
        id: 'do-brief',
        group: 'Do',
        label: 'Open Beatrice’s pharmacist brief',
        hint: 'printable',
        keywords: 'brief print pdf sbar',
        icon: ScrollText,
        run: go('/patients/p-beatrice/brief'),
      },
      { id: 'go-home', group: 'Go to', label: 'Home', icon: Home, run: go('/') },
      { id: 'go-patients', group: 'Go to', label: 'Patients', hint: 'every record in this clinic', icon: Users, run: go('/patients') },
      {
        id: 'go-inbox',
        group: 'Go to',
        label: 'Inbox',
        hint: 'review tasks waiting for a person',
        keywords: 'tasks approve dismiss',
        icon: Inbox,
        run: go('/inbox'),
      },
      { id: 'go-team', group: 'Go to', label: 'Care team', icon: Brain, run: go('/team') },
      {
        id: 'go-population',
        group: 'Go to',
        label: 'Population',
        hint: 'sweep, sequence symmetry, chokepoints',
        keywords: 'pssa betweenness sweep',
        icon: Activity,
        run: go('/population'),
      },
      {
        id: 'go-graph',
        group: 'Go to',
        label: 'Graph explorer',
        hint: 'walk the knowledge graph',
        keywords: 'cypher query console path',
        icon: Network,
        run: go('/graph'),
      },
      {
        id: 'go-eval',
        group: 'Go to',
        label: 'Evaluation',
        hint: 'ablation and prevention replay',
        keywords: 'precision recall f1 replay',
        icon: FlaskConical,
        run: go('/evaluation'),
      },
      {
        id: 'go-how',
        group: 'Go to',
        label: 'How it works',
        hint: 'architecture, tracks, security',
        keywords: 'architecture mcp owasp tracks',
        icon: BookOpen,
        run: go('/how'),
      },
      {
        id: 'judge-tour',
        group: 'Do',
        label: 'Take the 3-minute tour',
        hint: 'all three tracks',
        keywords: 'judge guide demo walkthrough tracks',
        icon: Compass,
        run: () => {
          close();
          setTimeout(startJudgeTour, 30);
        },
      },
      {
        id: 'shortcuts',
        group: 'Do',
        label: 'Keyboard shortcuts',
        hint: 'press ? anywhere',
        keywords: 'keys hotkeys help',
        icon: Keyboard,
        run: () => {
          close();
          setTimeout(openShortcuts, 30);
        },
      },
    ];
    for (const c of scope.clinics) {
      if (c.id !== scope.clinic.id)
        base.push({
          id: `clinic-${c.id}`,
          group: 'Clinic',
          label: `Switch to ${c.name}`,
          hint: 'its own graph',
          keywords: 'tenant clinic graph',
          icon: Building2,
          run: switchTo(c.id),
        });
    }
    for (const u of scope.users.filter((x) => x.clinic === scope.clinic.id && x.id !== scope.user.id)) {
      base.push({
        id: `user-${u.id}`,
        group: 'Clinic',
        label: `Work as ${u.name}`,
        hint: u.title,
        keywords: `identity person ${u.role}`,
        icon: UserRound,
        run: switchTo(scope.clinic.id, u.id),
      });
    }
    for (const p of patients ?? []) {
      base.push({
        id: `p-${p.id}`,
        group: 'Patients',
        label: p.name,
        hint: `${p.age} · ${p.meds} meds${p.likely ? ` · ${p.likely} likely` : ''}`,
        keywords: `${p.id} ${p.headline ?? ''}`,
        icon: UserRound,
        run: go(`/patients/${p.id}`),
      });
    }
    return base;
  }, [close, go, patients, scope, switchTo]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const ranked = items
      .map((it, i) => ({ it, s: score(it, words), i }))
      .filter((x) => x.s > 0)
      // With no query: actions and pages, plus the six story patients. With a query: best matches first.
      .filter((x) => words.length || x.it.group !== 'Patients' || (patients ?? []).find((p) => `p-${p.id}` === x.it.id)?.persona)
      .sort((a, b) => (words.length ? b.s - a.s : 0) || a.i - b.i)
      .slice(0, 40)
      .map((x) => x.it);
    const order = ['Do', 'Go to', 'Patients', 'Clinic'];
    return order.flatMap((g) => ranked.filter((r) => r.group === g));
  }, [items, q, patients]);

  const trap = useDialogFocus(dialog, open, close);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  let i = -1;
  // Portalled to <body>: the sticky header uses backdrop-filter, which would otherwise trap a fixed overlay inside it.
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[6px]" onMouseDown={close}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="pop-in card card-glow w-full max-w-[620px] overflow-hidden !bg-ink-2/95 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.95)]"
        onMouseDown={(e) => {
          e.stopPropagation();
          // Clicking anywhere in the palette keeps the cursor in the search box, so the keys keep working.
          if (e.target !== input.current) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(shown.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void shown[active]?.run();
          } else if (e.key === '?' && !q) {
            // The footer's "? shortcuts" hint works from here too (the search box would otherwise just type it).
            e.preventDefault();
            close();
            setTimeout(openShortcuts, 30);
          } else {
            trap(e);
          }
        }}
      >
        <div className="flex items-center gap-3 border-b hairline px-4">
          {busy ? <Loader2 size={17} className="shrink-0 animate-spin text-dim" /> : <Search size={17} className="shrink-0 text-dim" />}
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[active] ? `palette-${shown[active].id}` : undefined}
            placeholder="Search patients, pages and actions…"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-bone outline-none placeholder:text-mute"
          />
          <span className="kbd">esc</span>
        </div>
        <ul id="palette-list" ref={list} role="listbox" className="max-h-[56vh] overflow-y-auto p-2">
          {shown.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-dim">{patients === null ? 'Loading patients…' : `Nothing matches “${q}”.`}</li>
          )}
          {shown.map((it, idx) => {
            i++;
            const n = i;
            const first = idx === 0 || shown[idx - 1].group !== it.group;
            const Icon = it.icon;
            return (
              <li key={it.id} role="presentation">
                {first && <p className="kicker px-3 pb-1.5 pt-3 !text-[10px]">{it.group}</p>}
                <div
                  id={`palette-${it.id}`}
                  role="option"
                  aria-selected={n === active}
                  data-i={n}
                  onMouseMove={() => setActive(n)}
                  onClick={() => void it.run()}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${n === active ? 'bg-white/[0.07] text-bone' : 'text-bone-2'}`}
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-lg border hairline ${n === active ? 'bg-vermilion/15 text-vermilion-2' : 'bg-white/[0.03] text-dim'}`}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{it.label}</span>
                  {it.hint && <span className="hidden truncate text-xs text-mute sm:block">{it.hint}</span>}
                  {n === active ? <CornerDownLeft size={14} className="shrink-0 text-dim" /> : <ArrowRight size={14} className="shrink-0 text-transparent" />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t hairline px-4 py-2.5 text-[11px] text-mute">
          <span className="flex items-center gap-1.5">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> move
          </span>
          <span className="flex items-center gap-1.5">
            <span className="kbd">↵</span> open
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <span className="kbd">?</span> shortcuts
          </span>
          <span className="ml-auto">
            {scope.clinic.name} · {scope.user.name}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
