'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Brain, CheckCheck, FileSignature, Hand, ListChecks, NotebookPen, Plug, Radar, Sparkles, ThumbsDown, ThumbsUp, type LucideIcon } from 'lucide-react';
import { toast } from '@/lib/toast';

interface Ev {
  type: 'task' | 'decision' | 'done' | 'note' | 'procedure' | 'verdict' | 'run' | 'cds' | 'cds_outcome';
  id: string;
  at: number;
  who: string;
  verb: string;
  title: string | null;
  pid: string | null;
  patient: string | null;
  detail: string | null;
}

/** Fired with the new events, so pages can refresh what they show (the inbox, the notes) without a reload. */
export const ACTIVITY_EVENT = 'domino:activity';

const POLL_MS = 5000;
/**
 * Each poll asks again for the last half minute and drops what it has already seen, so an event written in the same
 * millisecond as the last one, or committed a moment after a poll read past its timestamp, is never skipped.
 */
const OVERLAP_MS = 30_000;
const keyOf = (e: Ev) => `${e.type}:${e.id}:${e.at}`;

const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86_400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
};

function describe(e: Ev, me: string): { icon: LucideIcon; tone: string; who: string; text: string; href: string } {
  const who = e.who === me ? 'You' : e.who;
  const on = e.patient ? ` · ${e.patient}` : '';
  switch (e.type) {
    case 'decision':
      return {
        icon: e.verb === 'dismissed' ? ThumbsDown : ThumbsUp,
        tone: e.verb === 'dismissed' ? 'text-dim' : 'text-sage',
        who,
        text: `${e.verb} “${e.title}”${on}`,
        href: '/inbox',
      };
    case 'done':
      return { icon: CheckCheck, tone: 'text-sage', who, text: `completed “${e.title}”${on}`, href: '/inbox' };
    case 'note':
      return { icon: NotebookPen, tone: 'text-amber', who, text: `wrote a ${e.verb}: “${e.title}”`, href: '/team#notes-list' };
    case 'verdict':
      return { icon: FileSignature, tone: 'text-sky', who, text: `signed a decision: ${e.title} is ${e.verb}${on}`, href: e.pid ? `/patients/${e.pid}` : '/team' };
    case 'procedure':
      return { icon: Brain, tone: 'text-iris', who: 'Procedural memory', text: `re-learned “${e.title}”: ${e.detail ?? ''}`, href: '/team' };
    case 'cds':
      return {
        icon: Plug,
        tone: e.verb === 'stop_and_check' ? 'text-vermilion-2' : 'text-amber',
        who: e.who,
        text: `checked ${e.title} at order entry${on}: ${e.verb === 'stop_and_check' ? 'stop and check' : 'caution'}`,
        href: '/ehr',
      };
    case 'cds_outcome':
      return {
        icon: Hand,
        tone: e.verb === 'accepted' ? 'text-sage' : 'text-dim',
        who: e.who,
        text: e.verb === 'accepted' ? `held the ${e.title} order after Domino’s card${on}` : `signed ${e.title} anyway${on}${e.detail ? `: ${e.detail}` : ''}`,
        href: '/ehr',
      };
    case 'run':
      return {
        icon: e.verb === 'sweep' ? Radar : Sparkles,
        tone: 'text-vermilion-2',
        who: 'The agents',
        text: `finished a review${on}${e.title ? `: ${e.title}` : ''}`,
        href: e.pid ? `/patients/${e.pid}` : '/inbox',
      };
    default:
      return {
        icon: ListChecks,
        tone: 'text-bone-2',
        who: !e.who ? 'The agents' : e.who === me ? 'Your note' : `${e.who}’s note`,
        text: `proposed “${e.title}”${on}`,
        href: '/inbox',
      };
  }
}

/** A toast's title for something another person did. */
function headline(e: Ev): string {
  switch (e.type) {
    case 'decision':
      return `${e.who} ${e.verb} a task`;
    case 'done':
      return `${e.who} completed a task`;
    case 'note':
      return `${e.who} wrote a ${e.verb}`;
    case 'verdict':
      return `${e.who} signed a decision`;
    case 'procedure':
      return `Procedural memory learned from ${e.who}’s decision`;
    case 'cds':
      return `${e.who} asked Domino at order entry`;
    case 'cds_outcome':
      return e.verb === 'accepted' ? 'A cascade was stopped at order entry' : 'A prescriber overrode Domino’s card';
    default:
      return `${e.who}’s note raised a review task`;
  }
}

/** Collapse a burst of agent tasks written in one go (a sweep) into one line. */
function group(events: Ev[]): (Ev & { count?: number })[] {
  const out: (Ev & { count?: number })[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (prev && e.type === 'task' && prev.type === 'task' && !e.who && !prev.who && Math.abs(prev.at - e.at) < 2000) {
      prev.count = (prev.count ?? 1) + 1;
      continue;
    }
    out.push({ ...e });
  }
  return out;
}

/**
 * The clinic's shared activity, live. Every open screen polls the graph (FalkorDB is the shared state), so when one
 * person approves a task or writes a handover, everyone else sees it within seconds, as a toast and in this list.
 */
export function ActivityBell({ me }: { me: string }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const since = useRef<number | null>(null);
  const seen = useRef(new Map<string, number>());
  const busy = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const first = since.current === null;
      const from = first ? 0 : Math.max(0, since.current! - OVERLAP_MS);
      const r = await fetch(`/api/activity?since=${from}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as { events: Ev[]; now: number };
      const fresh = j.events.filter((e) => !seen.current.has(keyOf(e)));
      for (const e of fresh) seen.current.set(keyOf(e), e.at);
      const latest = Math.max(since.current ?? 0, j.events[0]?.at ?? 0);
      since.current = first ? Math.max(latest, j.now - OVERLAP_MS) : latest;
      // Forget what can no longer come back from the overlap window.
      for (const [k, at] of seen.current) if (at < since.current - 2 * OVERLAP_MS) seen.current.delete(k);
      if (first) {
        setEvents(j.events);
        return;
      }
      if (!fresh.length) return;
      setEvents((prev) => [...fresh, ...prev].sort((a, b) => b.at - a.at).slice(0, 60));
      window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: fresh }));
      // Toast what other people did (and what the agents learned from them); your own actions already said so.
      // On the EHR page the person just did the order-entry themselves, and the page already shows it.
      const onEhr = window.location.pathname === '/ehr';
      // An unverified caller's order-entry check stays a quiet row in the feed: anyone can call an open CDS service.
      const others = fresh.filter(
        (e) => e.who && e.who !== me && e.type !== 'run' && !(onEhr && (e.type === 'cds' || e.type === 'cds_outcome')) && !(e.type === 'cds' && e.who === 'An EHR'),
      );
      setUnread((u) => u + others.length);
      for (const e of others.slice(0, 2)) {
        const d = describe(e, me);
        toast({ tone: e.type === 'procedure' ? 'learn' : e.type === 'cds_outcome' && e.verb === 'accepted' ? 'ok' : 'info', title: headline(e), body: d.text, href: d.href, hrefLabel: 'Open' });
      }
    } catch {
      /* offline for a moment; the next poll catches up */
    } finally {
      busy.current = false;
    }
  }, [me]);

  useEffect(() => {
    poll();
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(t);
      if (!document.hidden) t = setInterval(poll, POLL_MS);
    };
    const onVis = () => {
      if (!document.hidden) poll();
      start();
    };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    setUnread(0);
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const shown = useMemo(() => group(events).slice(0, 18), [events]);

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? `Team activity, ${unread} new` : 'Team activity'}
        className="relative grid size-[34px] place-items-center rounded-xl border hairline bg-white/[0.03] text-dim transition hover:border-white/20 hover:text-bone"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-[17px] place-items-center rounded-full bg-vermilion px-1 text-[10px] font-semibold leading-[17px] text-white shadow-[0_0_0_2px_var(--color-ink)]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Team activity" className="card card-pop absolute right-0 top-11 z-50 w-[min(400px,calc(100vw-2rem))] p-0">
          <div className="flex items-center justify-between border-b hairline px-4 py-3">
            <p className="text-sm font-semibold">Team activity</p>
            <span className="mono flex items-center gap-1.5 text-[10.5px] text-mute">
              <span className="h-1.5 w-1.5 rounded-full bg-sage pulse-dot" /> live from the graph
            </span>
          </div>
          <ul className="max-h-[min(70vh,520px)] overflow-y-auto p-1.5">
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-dim">Nothing yet. Decisions, notes and agent work show up here as they happen.</li>}
            {shown.map((e, i) => {
              const d = describe(e, me);
              return (
                <li key={`${keyOf(e)}-${i}`}>
                  <Link href={d.href} onClick={() => setOpen(false)} className="flex gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.04]">
                    <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.04] ${d.tone}`}>
                      <d.icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-bone-2">
                        <span className="font-medium text-bone">{e.count ? 'The population sweep' : d.who}</span>{' '}
                        {e.count ? `proposed ${e.count} review tasks` : d.text}
                      </span>
                      <span className="mono mt-0.5 block text-[10.5px] text-mute">{ago(e.at)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
