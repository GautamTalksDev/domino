'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, Link2, Loader2, MessagesSquare, NotebookPen, Plus, ScrollText, X } from 'lucide-react';
import { postJson } from '@/lib/client';
import { toast } from '@/lib/toast';
import { Noticed, type NoteSignal } from './Noticed';
import { ACTIVITY_EVENT } from '../ActivityBell';

interface Ref {
  id: string;
  name: string;
}
interface Doc {
  id: string;
  kind: 'protocol' | 'handover' | 'chat' | 'minutes';
  title: string;
  text: string;
  by: string;
  at: number;
  drugs: Ref[];
  effects: Ref[];
  patients: Ref[];
  /** Review tasks this note raised (FROM_NOTE) or backs up (CORROBORATES: the task was already open). */
  tasks?: { id: string; title: string; status: string; role: string; how?: 'raised' | 'corroborates' }[];
}

const KIND = {
  protocol: { label: 'Protocol', icon: ScrollText, tone: 'text-sage border-sage/30 bg-sage/[0.07]' },
  handover: { label: 'Handover', icon: NotebookPen, tone: 'text-amber border-amber/30 bg-amber/[0.07]' },
  chat: { label: 'Chat', icon: MessagesSquare, tone: 'text-sky border-sky/30 bg-sky/[0.07]' },
  minutes: { label: 'Minutes', icon: FileText, tone: 'text-iris border-iris/30 bg-iris/[0.07]' },
} as const;

const ago = (at: number) => {
  const d = Math.round((Date.now() - at) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`;
};

export function TeamNotes({ userName }: { userName: string }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Doc['kind']>('handover');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ drugs: Ref[]; effects: Ref[]; patients: Ref[] } | null>(null);
  // What the Detective noticed in notes saved this session, by note id.
  const [noticed, setNoticed] = useState<Record<string, NoteSignal[]>>({});

  // Live preview of what the note will be linked to, as it is written (debounced; read-only on the server).
  useEffect(() => {
    if (!adding) return;
    const body = `${title}. ${text}`.trim();
    if (body.length < 6) {
      setPreview(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/team/docs/link', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: body.slice(0, 4200) }),
          signal: ctrl.signal,
        });
        setPreview(r.ok ? await r.json() : null);
      } catch {
        /* typing on; the next keystroke tries again */
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [adding, title, text]);

  const load = useCallback(async () => {
    const r = await fetch('/api/team/docs');
    const j = (await r.json()) as { docs?: Doc[] };
    setDocs(j.docs ?? []);
  }, []);
  useEffect(() => {
    load();
    // Arriving from "Add a team note" (⌘K) opens the form.
    if (window.location.hash === '#team-notes') setAdding(true);
    // A colleague's new note (or a task one raised) appears without a reload.
    const onActivity = (e: Event) => {
      const types = ((e as CustomEvent<{ type: string }[]>).detail ?? []).map((x) => x.type);
      if (types.some((t) => t === 'note' || t === 'task')) load();
    };
    window.addEventListener(ACTIVITY_EVENT, onActivity);
    // The judge tour fills in an example handover.
    const onFill = (e: Event) => {
      const d = (e as CustomEvent<{ kind: Doc['kind']; title: string; text: string }>).detail;
      setAdding(true);
      setKind(d.kind);
      setTitle(d.title);
      setText(d.text);
    };
    window.addEventListener('domino:fill-note', onFill);
    return () => {
      window.removeEventListener(ACTIVITY_EVENT, onActivity);
      window.removeEventListener('domino:fill-note', onFill);
    };
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await postJson<{ id: string; drugs: string[]; effects: string[]; patients: string[]; noticed?: NoteSignal[]; held?: string | null }>('/api/team/docs', {
        kind,
        title,
        text,
      });
      const n = r.drugs.length + r.effects.length + r.patients.length;
      const acted = (r.noticed ?? []).find((x) => x.task?.status === 'proposed');
      if (r.noticed?.length) setNoticed((m) => ({ ...m, [r.id]: r.noticed! }));
      toast(
        acted
          ? {
              tone: 'learn',
              title: 'The Detective read your note',
              body: `${acted.headline} It proposed a signed review task for the ${acted.task!.role}.`,
              href: '/inbox',
              hrefLabel: 'Open the inbox',
            }
          : r.held
          ? { tone: 'info', title: 'Added to team memory; no task raised', body: r.held }
          : {
              tone: 'learn',
              title: 'Added to team memory',
              body: n
                ? `Linked to ${r.drugs.length} drug${r.drugs.length === 1 ? '' : 's'}, ${r.effects.length} symptom${r.effects.length === 1 ? '' : 's'} and ${r.patients.length} patient${r.patients.length === 1 ? '' : 's'} in the graph. The agents and the brain can find it now.`
                : 'Saved. It did not name a drug, symptom or patient Domino knows, so it is searchable but not linked.',
            },
      );
      setTitle('');
      setText('');
      setPreview(null);
      setAdding(false);
      setOpen(r.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="team-notes" data-tour="notes" className="card scroll-mt-24 p-5 sm:p-6" aria-labelledby="team-notes-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <NotebookPen size={16} className="text-amber" />
            <h2 id="team-notes-title" className="font-semibold">
              Team notes
            </h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-dim">
            Protocols, handovers, chat messages and minutes, in the same graph as everything else. Each note is linked to the drugs, symptoms and patients it
            names, so it shows up in a patient’s memory, in search, and in what the agents read before a review.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => setAdding(!adding)} aria-expanded={adding}>
          {adding ? <X size={14} /> : <Plus size={14} />} {adding ? 'Cancel' : 'Add a note'}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {adding && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="mt-4 grid gap-3 rounded-2xl border hairline bg-ink/40 p-4">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of note">
                {(Object.keys(KIND) as Doc['kind'][]).map((k) => {
                  const K = KIND[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => setKind(k)}
                      className={`chip gap-1.5 transition-colors ${kind === k ? K.tone : 'hover:text-bone'}`}
                    >
                      <K.icon size={12} /> {K.label}
                    </button>
                  );
                })}
              </div>
              <label className="sr-only" htmlFor="note-title">
                Title
              </label>
              <input
                id="note-title"
                className="field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Title, e.g. Walter Brooks dizzy on standing"
                required
                minLength={3}
              />
              <label className="sr-only" htmlFor="note-text">
                Note
              </label>
              <textarea
                id="note-text"
                className="field min-h-28 leading-relaxed"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={4000}
                required
                minLength={10}
                placeholder="Write it the way you would in a handover. Name drugs (brands are fine), symptoms and patients, and Domino links them."
              />
              <div className="flex min-h-7 flex-wrap items-center gap-1.5" aria-live="polite">
                <span className="mono mr-1 text-[10px] uppercase tracking-wide text-mute">will link</span>
                {preview && preview.drugs.length + preview.effects.length + preview.patients.length > 0 ? (
                  <>
                    {preview.patients.map((p) => (
                      <span key={`p-${p.id}`} className="pop-in rounded-full border border-vermilion/30 bg-vermilion/[0.07] px-2 py-0.5 text-[11.5px] text-vermilion-2">
                        {p.name}
                      </span>
                    ))}
                    {preview.drugs.map((d) => (
                      <span key={`d-${d.id}`} className="pop-in rounded-full border border-white/15 px-2 py-0.5 text-[11.5px] text-bone-2">
                        {d.name}
                      </span>
                    ))}
                    {preview.effects.map((e) => (
                      <span key={`e-${e.id}`} className="pop-in rounded-full border border-amber/25 px-2 py-0.5 text-[11.5px] text-amber">
                        {e.name}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-xs text-mute">nothing yet: name a drug (brands are fine), a symptom or a patient</span>
                )}
              </div>
              {error && <p className="text-sm text-vermilion-2">{error}</p>}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-mute">Signed as {userName}. Visible to everyone in this clinic.</p>
                <button className="btn btn-primary" disabled={busy || title.trim().length < 3 || text.trim().length < 10}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Add and link
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <ul id="notes-list" className="mt-4 grid scroll-mt-24 gap-2.5">
        {!docs &&
          [0, 1].map((i) => (
            <li key={i} className="rounded-2xl border hairline p-4">
              <div className="skeleton h-3 w-40" />
              <div className="skeleton mt-3 h-4 w-2/3" />
            </li>
          ))}
        {docs?.length === 0 && <li className="rounded-2xl border hairline p-4 text-sm text-dim">No team notes yet. Add the first one.</li>}
        {docs?.map((d) => {
          const K = KIND[d.kind] ?? KIND.minutes;
          const expanded = open === d.id;
          const chips = [
            ...d.patients.map((p) => ({ ...p, t: 'patient' as const })),
            ...d.drugs.map((x) => ({ ...x, t: 'drug' as const })),
            ...d.effects.map((x) => ({ ...x, t: 'effect' as const })),
          ];
          return (
            <li key={d.id} className="rounded-2xl border hairline bg-white/[0.015] p-4 transition-colors hover:border-white/15">
              <button className="w-full text-left" onClick={() => setOpen(expanded ? null : d.id)} aria-expanded={expanded}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${K.tone}`}>
                    <K.icon size={11} /> {K.label}
                  </span>
                  <span className="text-bone-2">{d.by}</span>
                  <span className="text-mute">· {ago(d.at)}</span>
                </div>
                <p className="mt-2 font-medium text-bone">{d.title}</p>
                <p className={`mt-1 max-w-[90ch] text-sm leading-relaxed text-dim ${expanded ? '' : 'line-clamp-2'}`}>{d.text}</p>
              </button>
              {chips.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="mono text-[10px] uppercase tracking-wide text-mute">mentions</span>
                  {chips.map((c) =>
                    c.t === 'patient' ? (
                      <Link
                        key={`p-${c.id}`}
                        href={`/patients/${c.id}`}
                        className="rounded-full border border-vermilion/30 bg-vermilion/[0.07] px-2 py-0.5 text-[11.5px] text-vermilion-2 hover:bg-vermilion/15"
                      >
                        {c.name}
                      </Link>
                    ) : (
                      <span
                        key={`${c.t}-${c.id}`}
                        className={`rounded-full border px-2 py-0.5 text-[11.5px] ${c.t === 'drug' ? 'border-white/15 text-bone-2' : 'border-amber/25 text-amber'}`}
                      >
                        {c.name}
                      </span>
                    ),
                  )}
                </div>
              )}
              {noticed[d.id] ? (
                <Noticed signals={noticed[d.id]} />
              ) : (
                (d.tasks?.length ?? 0) > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    {(['raised', 'corroborates'] as const).map((how) => {
                      const ts = d.tasks!.filter((t) => (t.how ?? 'raised') === how);
                      if (!ts.length) return null;
                      return (
                        <div key={how} className="flex flex-wrap items-center gap-1.5">
                          <span className="mono text-[10px] uppercase tracking-wide text-iris">{how === 'raised' ? 'led to' : 'backs up'}</span>
                          {ts.map((t) => (
                            <Link
                              key={t.id}
                              href="/inbox"
                              className="rounded-full border border-iris/30 bg-iris/[0.07] px-2 py-0.5 text-[11.5px] text-iris hover:bg-iris/15"
                            >
                              {t.title} <span className="text-mute">· {t.status}</span>
                            </Link>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
