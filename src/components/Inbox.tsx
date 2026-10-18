'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Brain, Check, CheckCheck, Clock, Inbox as InboxIcon, Loader2, NotebookPen, Repeat, Radar, ShieldAlert, Sparkles, UserRound, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { postJson } from '@/lib/client';
import { toast } from '@/lib/toast';
import { TODAY_DAY } from '@/data/time';
import { onTabKey } from '@/lib/tabs';
import { ACTIVITY_EVENT } from './ActivityBell';

interface Task {
  id: string;
  title: string;
  body: string;
  role: string;
  due: number;
  status: string;
  at: number;
  patientId: string;
  patientName: string;
  verified: boolean;
  decidedBy?: string | null;
  doneBy?: string | null;
  note?: string | null;
  owner?: string | null;
  procedureVersion?: number | null;
  procedureReason?: string | null;
  trigger?: string | null;
  mode?: string | null;
  fromNote?: { id: string; title: string; kind: string; by: string } | null;
  /** Notes written later that report what this task already asks about. */
  backedBy?: { id: string; title: string; kind: string; by: string }[];
  followsUp?: { id: string; title: string; doneBy: string | null } | null;
  link?: { root: string; effect: string | null; to: string | null; score: number | null; tier: string | null } | null;
}

/** The cascade link a task is about, as two small domino tiles: the root drug, the side effect, the drug that treats it. */
function LinkStrip({ link }: { link: NonNullable<Task['link']> }) {
  return (
    <div className="hidden w-[300px] shrink-0 items-center gap-2.5 self-center rounded-2xl border hairline bg-black/25 p-3 xl:flex" aria-hidden>
      <span className="font-display max-w-[96px] truncate rounded-lg bg-[#f4ecdd] px-2 py-1.5 text-[12.5px] font-semibold text-[#17151a] shadow-[0_0_0_1.5px_rgba(255,91,58,0.85),0_6px_18px_-6px_rgba(255,91,58,0.55)]">
        {link.root}
      </span>
      <span className="min-w-0 flex-1 text-center">
        <span className="line-clamp-2 block text-[11px] leading-tight text-bone-2">{link.effect}</span>
        <span className="relative my-1.5 block h-px bg-gradient-to-r from-vermilion/40 to-vermilion">
          <span className="absolute -right-px -top-[3px] border-y-[3.5px] border-l-[6px] border-y-transparent border-l-vermilion" />
        </span>
        {link.score != null && (
          <span className="mono block text-[10px] text-vermilion-2">
            {link.tier} · {Number(link.score).toFixed(2)}
          </span>
        )}
      </span>
      <span className="font-display max-w-[96px] truncate rounded-lg bg-[#f4ecdd] px-2 py-1.5 text-[12.5px] font-semibold text-[#17151a]">{link.to}</span>
    </div>
  );
}

const FILTERS = ['proposed', 'approved', 'done', 'dismissed', 'all'] as const;
const LABEL: Record<(typeof FILTERS)[number], string> = { proposed: 'Waiting', approved: 'Approved', done: 'Done', dismissed: 'Dismissed', all: 'All' };
const ROLE_TONE: Record<string, string> = { pharmacist: 'text-sky', prescriber: 'text-vermilion-2', nurse: 'text-sage' };

function dueLabel(due: number) {
  const d = due - TODAY_DAY;
  if (d === 0) return 'due today';
  if (d > 0) return `due in ${d} day${d === 1 ? '' : 's'}`;
  return `${-d} day${d === -1 ? '' : 's'} overdue`;
}

function source(t: Task) {
  if (t.fromNote) return { icon: NotebookPen, text: `${t.fromNote.by}’s ${t.fromNote.kind}` };
  if (t.followsUp) return { icon: Repeat, text: 'agent follow-up' };
  if (t.trigger === 'sweep') return { icon: Radar, text: 'population sweep' };
  if (t.trigger === 'new_prescription') return { icon: Sparkles, text: 'new prescription' };
  if (t.trigger === 'mcp') return { icon: Sparkles, text: 'MCP client' };
  if (t.trigger) return { icon: Sparkles, text: t.mode === 'llm' ? 'agent review (LLM)' : 'agent review' };
  return { icon: Clock, text: 'care-team history' };
}

export function Inbox({ userName, role }: { userName: string; role: string }) {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('proposed');
  const [mine, setMine] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [learned, setLearned] = useState<{ reason: string; version: number } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/tasks?status=all');
    const j = await r.json();
    if (!r.ok) setError(j.error ?? 'Could not load');
    setTasks(j.tasks ?? []);
  }, []);

  useEffect(() => {
    load();
    // Someone else (or an agent) changed a task: show it without a reload.
    const onActivity = (e: Event) => {
      const types = ((e as CustomEvent<{ type: string }[]>).detail ?? []).map((x) => x.type);
      if (types.some((t) => t === 'task' || t === 'decision' || t === 'done')) load();
    };
    window.addEventListener(ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(ACTIVITY_EVENT, onActivity);
  }, [load]);

  const act = async (id: string, next: string, why?: string) => {
    setBusy(id);
    setError('');
    try {
      const res = await postJson<{
        learned: { reason: string; version: number } | null;
        followUp: { id: string; title: string; due: number; downstream: string[] } | null;
      }>(`/api/tasks/${id}`, { status: next, ...(why ? { note: why } : {}) });
      const t = tasks?.find((x) => x.id === id);
      if (res.followUp) {
        toast({
          tone: 'learn',
          title: 'Done. The agents scheduled a follow-up',
          body: `${t ? `${t.patientName}: ` : ''}“${res.followUp.title}”, ${dueLabel(res.followUp.due)}.${
            res.followUp.downstream.length ? ` If the symptom has settled, ${res.followUp.downstream.join(', ')} may no longer be needed.` : ''
          }`,
        });
      } else if (res.learned) {
        setLearned(res.learned);
        toast({
          tone: 'learn',
          title: `Procedural memory learned v${res.learned.version}`,
          body: res.learned.reason,
          href: '/team',
          hrefLabel: 'See what the agents learned',
        });
      } else {
        toast({
          tone: next === 'dismissed' ? 'info' : 'ok',
          title: next === 'approved' ? 'Approved' : next === 'done' ? 'Marked done' : 'Dismissed',
          body: `${t ? `${t.patientName}: ` : ''}signed as ${userName}. ${next === 'dismissed' ? 'The agents learn from this outcome.' : 'Recorded as an outcome for procedural memory.'}`,
        });
      }
      setDismissing(null);
      setNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    for (const t of tasks ?? []) {
      if (mine && t.role !== role) continue;
      c[t.status] = (c[t.status] ?? 0) + 1;
      c.all++;
    }
    return c;
  }, [tasks, mine, role]);

  const shown = tasks?.filter((t) => (status === 'all' || t.status === status) && (!mine || t.role === role)) ?? null;
  const waiting = (tasks ?? []).filter((t) => t.status === 'proposed');
  const byRole = waiting.reduce<Record<string, number>>((m, t) => ((m[t.role] = (m[t.role] ?? 0) + 1), m), {});
  const learnedRouted = waiting.filter((t) => t.procedureVersion != null && t.procedureReason && !t.procedureReason.startsWith('Starting procedure')).length;

  return (
    <div className="mt-8">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border hairline bg-white/[0.06] sm:grid-cols-4">
        <div className="bg-ink-2/90 p-4">
          <p className="font-display num text-3xl font-semibold">{tasks ? waiting.length : '–'}</p>
          <p className="mt-0.5 text-xs text-dim">waiting for a person</p>
        </div>
        {(['pharmacist', 'prescriber', 'nurse'] as const).map((r) => (
          <div key={r} className="bg-ink-2/90 p-4">
            <p className={`font-display num text-3xl font-semibold ${byRole[r] ? ROLE_TONE[r] : 'text-mute'}`}>{tasks ? (byRole[r] ?? 0) : '–'}</p>
            <p className="mt-0.5 text-xs text-dim">
              for the {r}
              {r === 'prescriber' && learnedRouted > 0 && <span className="text-iris"> · {learnedRouted} routed by learned procedure</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-1.5">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label="Task status"
          onKeyDown={(e) => onTabKey(e, FILTERS, status, setStatus, (f) => `inbox-tab-${f}`)}
        >
          {FILTERS.map((f) => (
            <button
              key={f}
              id={`inbox-tab-${f}`}
              role="tab"
              aria-selected={status === f}
              aria-controls="inbox-panel"
              tabIndex={status === f ? 0 : -1}
              onClick={() => setStatus(f)}
              className={`chip gap-2 transition-colors ${status === f ? 'border-bone/40 bg-white/10 text-bone' : 'hover:border-white/25 hover:text-bone'}`}
            >
              {LABEL[f]}
              <span className={`mono text-[10.5px] ${status === f ? 'text-bone-2' : 'text-mute'}`}>{tasks ? (counts[f] ?? 0) : ''}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-dim hover:text-bone-2">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[var(--color-vermilion)]" />
          Only tasks for my role ({role})
        </label>
      </div>
      <p className="mt-3 text-xs text-dim">
        Working as <span className="text-bone-2">{userName}</span>. What you approve or dismiss here is an outcome the agents learn from (procedural memory).
      </p>

      <AnimatePresence>
        {learned && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 flex items-start gap-3 rounded-2xl border border-iris/40 bg-iris/[0.08] p-4 shadow-[0_0_40px_-12px_rgba(165,150,255,0.45)]"
          >
            <Brain size={18} className="mt-0.5 shrink-0 text-iris" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-iris">Domino learned something (procedure v{learned.version})</p>
              <p className="mt-1 text-sm text-bone-2">{learned.reason}</p>
              <p className="mt-1 text-xs text-dim">
                The next review and the next sweep follow it. The new version links to the tasks it learned from:{' '}
                <Link href="/team" className="link-u text-bone-2">
                  see it on the care-team page
                </Link>
                .
              </p>
            </div>
            <button className="btn btn-ghost px-2" onClick={() => setLearned(null)} aria-label="Close">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="mt-4 rounded-xl border border-vermilion/30 bg-vermilion/[0.06] p-3 text-sm text-vermilion-2">{error}</p>}
      {!shown && (
        <div className="mt-6 grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card p-5">
              <div className="skeleton h-3 w-56" />
              <div className="skeleton mt-4 h-5 w-[60%]" />
              <div className="skeleton mt-3 h-3 w-[90%]" />
              <div className="skeleton mt-2 h-3 w-[70%]" />
            </div>
          ))}
        </div>
      )}
      {shown && shown.length === 0 && (
        <div className="card mt-6 flex flex-col items-center px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-2xl border hairline bg-white/[0.03] text-dim">
            <InboxIcon size={20} />
          </span>
          <p className="font-display mt-4 text-xl font-semibold">
            {status === 'proposed' ? 'Nothing is waiting' : `Nothing ${LABEL[status].toLowerCase()} yet`}
          </p>
          <p className="mt-1 max-w-md text-sm text-dim">
            Tasks arrive when an agent review or the population sweep finds something worth a person’s time. Run a review to see the Scribe propose some.
          </p>
          <Link href="/patients/p-beatrice?autorun=1" className="btn btn-hot mt-5">
            Run Beatrice’s review
          </Link>
        </div>
      )}
      <div id="inbox-panel" data-tour="inbox" role="tabpanel" aria-labelledby={`inbox-tab-${status}`}>
        <ul className="mt-6 grid gap-3">
          <AnimatePresence initial={false}>
            {shown?.map((t) => {
              const src = source(t);
              const SrcIcon = src.icon;
              return (
                <motion.li
                  key={t.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 30, transition: { duration: 0.2 } }}
                  transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                  className="list-none"
                >
                  <div className="card card-hover p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:gap-8">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className={`mono uppercase tracking-wide ${ROLE_TONE[t.role] ?? 'text-iris'}`}>{t.role}</span>
                          <span className="text-mute">·</span>
                          <Link href={`/patients/${t.patientId}`} className="font-medium text-bone-2 underline-offset-2 hover:text-bone hover:underline">
                            {t.patientName}
                          </Link>
                          <span className="text-mute">·</span>
                          <span className={t.status === 'proposed' && t.due < TODAY_DAY ? 'text-amber' : 'text-dim'}>
                            {t.status === 'proposed' ? dueLabel(t.due) : t.status}
                          </span>
                          <span className="text-mute">·</span>
                          <span className="flex items-center gap-1 text-dim">
                            <SrcIcon size={12} /> {src.text}
                          </span>
                          {t.verified ? (
                            <span className="flex items-center gap-1 text-sage" title="HMAC-signed by the run that created it, verified just now">
                              <BadgeCheck size={13} /> signed
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-vermilion-2" title="Not written by Domino’s agents: it can only be dismissed">
                              <ShieldAlert size={13} /> signature invalid
                            </span>
                          )}
                        </div>
                        <p className="font-display mt-2 text-xl font-semibold leading-snug">{t.title}</p>
                        <p className="mt-1.5 max-w-[78ch] text-sm leading-relaxed text-bone-2">{t.body}</p>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          {t.owner && (
                            <span className="flex items-center gap-1 text-dim">
                              <UserRound size={12} /> root drug prescribed by {t.owner}
                            </span>
                          )}
                          {t.followsUp && (
                            <span className="flex items-center gap-1 text-iris">
                              <Repeat size={12} /> follows up “{t.followsUp.title}”{t.followsUp.doneBy ? `, done by ${t.followsUp.doneBy}` : ''}
                            </span>
                          )}
                          {t.fromNote && (
                            <Link href="/team#notes-list" className="flex items-center gap-1 text-iris hover:text-bone">
                              <NotebookPen size={12} /> raised by a {t.fromNote.kind}: “{t.fromNote.title}”
                            </Link>
                          )}
                          {(t.backedBy?.length ?? 0) > 0 && (
                            <Link
                              href="/team#notes-list"
                              className="flex items-center gap-1 text-iris hover:text-bone"
                              title={t.backedBy!.map((n) => `${n.by}: ${n.title}`).join('\n')}
                            >
                              <NotebookPen size={12} /> backed up by {t.backedBy!.length === 1 ? `${t.backedBy![0].by}’s ${t.backedBy![0].kind}` : `${t.backedBy!.length} notes`}
                            </Link>
                          )}
                          {t.procedureVersion != null && t.procedureReason && !t.procedureReason.startsWith('Starting procedure') && (
                            <span
                              className="flex items-center gap-1 rounded-full border border-iris/30 bg-iris/[0.07] px-2 py-0.5 text-iris"
                              title={t.procedureReason}
                            >
                              <Brain size={12} /> routed by learned procedure v{t.procedureVersion}
                            </span>
                          )}
                          {t.decidedBy && (
                            <span className="text-dim">
                              {t.status === 'done' ? 'approved' : t.status} by <span className="text-bone-2">{t.decidedBy}</span>
                              {t.status === 'done' && t.doneBy && (
                                <>
                                  {' '}
                                  · done by <span className="text-bone-2">{t.doneBy}</span>
                                </>
                              )}
                              {t.note ? `: “${t.note}”` : ''}
                            </span>
                          )}
                        </div>
                        {dismissing === t.id && (
                          <form
                            className="pop-in mt-3 flex flex-col gap-2 sm:flex-row"
                            onSubmit={(e) => {
                              e.preventDefault();
                              act(t.id, 'dismissed', note.trim() || undefined);
                            }}
                          >
                            <input
                              autoFocus
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              maxLength={300}
                              placeholder="Why? (optional: needs the prescriber, the cough had another cause…)"
                              className="field min-w-0 flex-1"
                            />
                            <button className="btn btn-ghost" disabled={!!busy}>
                              Dismiss
                            </button>
                          </form>
                        )}
                      </div>
                      {t.link?.to && <LinkStrip link={t.link} />}
                      <div className="flex shrink-0 items-center gap-2">
                        {busy === t.id && <Loader2 size={16} className="animate-spin text-dim" />}
                        {(t.status === 'proposed' || t.status === 'approved') && (
                          <>
                            {t.status === 'proposed' ? (
                              <button className="btn btn-primary" onClick={() => act(t.id, 'approved')} disabled={!!busy || !t.verified}>
                                <Check size={14} /> Approve
                              </button>
                            ) : (
                              <button className="btn btn-ghost" onClick={() => act(t.id, 'done')} disabled={!!busy}>
                                <CheckCheck size={14} /> Mark done
                              </button>
                            )}
                            {/* Approving is the outcome the agents learn from, so an approved task can be completed but not dismissed. */}
                            {t.status === 'proposed' && (
                              <button
                                className="btn btn-ghost px-2.5"
                                onClick={() => setDismissing(dismissing === t.id ? null : t.id)}
                                disabled={!!busy}
                                aria-label="Dismiss"
                                title="Dismiss"
                                aria-expanded={dismissing === t.id}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
