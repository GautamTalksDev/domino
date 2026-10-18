'use client';
import Link from 'next/link';
import { useState } from 'react';
import { BadgeCheck, Brain, History, ShieldAlert } from 'lucide-react';
import type { Analysis } from '@/lib/engine/types';
import { dayToLabel, msToLabel } from '@/data/time';

export interface DocView {
  id: string;
  kind: string;
  title: string;
  text: string;
  by: string;
  at: number;
  direct: boolean;
}
export interface NoteRow {
  id: string;
  kind: string;
  text: string;
  at: number;
  status: string;
}
export interface RunRow {
  id: string;
  at: number;
  mode: string;
  model: string;
  summary: string | null;
  likely: number | null;
  changes?: string | null;
  trigger?: string | null;
}

export interface ProcedureView {
  procedure: { id: string; key: string; version: number; role: string; minTier: string; reason: string; at: number; acted: number; dismissed: number };
  pattern: string | null;
  learnedFrom: number;
}

interface StepRow {
  i: number;
  agent: string;
  kind: string;
  tool: string | null;
  text: string;
  ms: number;
  queries: string[];
  produced: string[];
}

export function Memory({
  analysis: a,
  notes,
  runs,
  procedures,
  docs = [],
}: {
  analysis: Analysis;
  notes: NoteRow[];
  runs: RunRow[];
  procedures: ProcedureView[];
  docs?: DocView[];
}) {
  const [steps, setSteps] = useState<Record<string, StepRow[]>>({});
  const mine = new Set(a.links.flatMap((l) => l.patterns.map((p) => p.id)));
  const load = async (id: string) => {
    if (steps[id]) return setSteps(({ [id]: _, ...rest }) => rest);
    const res = await fetch(`/api/runs/${id}`);
    if (res.ok) {
      const j = await res.json();
      setSteps((s) => ({ ...s, [id]: j.steps }));
    }
  };
  return (
    <div className="mt-6 grid gap-4">
      {docs.length > 0 && (
        <section className="card p-5">
          <h3 className="font-semibold">Team notes about {a.patient.name.split(' ')[0]}</h3>
          <p className="mt-1 text-xs text-dim">
            Protocols, handovers and chats that name {a.patient.name.split(' ')[0]}, or one of these medicines together with one of these problems. The agents
            read their titles before a review.{' '}
            <Link href="/team" className="link-u">
              All team notes
            </Link>
          </p>
          <ul className="mt-3 space-y-2.5">
            {docs.map((d) => (
              <li key={d.id} className="rounded-xl border hairline p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="mono uppercase tracking-wide text-amber">{d.kind}</span>
                  <span className="text-bone-2">{d.by}</span>
                  <span className="text-mute">· {msToLabel(d.at)}</span>
                  {d.direct && (
                    <span className="rounded-full border border-vermilion/30 px-1.5 text-[10.5px] text-vermilion-2">names {a.patient.name.split(' ')[0]}</span>
                  )}
                </div>
                <p className="mt-1.5 font-medium text-bone">{d.title}</p>
                <p className="mt-1 leading-relaxed text-dim">{d.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card p-5">
        <h3 className="font-semibold">Care team decisions</h3>
        <p className="mt-1 text-xs text-dim">Episodic memory. Only people write these, each one is signed, and every agent run reads them first.</p>
        <ul className="mt-3 space-y-3">
          {a.decisions.map((d) => (
            <li key={d.id} className="rounded-xl border hairline p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {d.verified ? <BadgeCheck size={15} className="text-sage" /> : <ShieldAlert size={15} className="text-vermilion" />}
                <span className="mono text-xs text-iris">
                  {d.from} → {d.to}
                </span>
                <span className="rounded bg-iris/15 px-1.5 py-0.5 text-[11px] text-iris">{d.verdict.replace('_', ' ')}</span>
                <span className="ml-auto text-xs text-dim">
                  {d.by} · {dayToLabel(d.day)}
                </span>
              </div>
              <p className="mt-2 text-bone-2">{d.reason}</p>
              {!d.verified && <p className="mt-1 text-xs text-vermilion-2">Signature check failed: ignored by the agents.</p>}
            </li>
          ))}
          {a.decisions.length === 0 && (
            <li className="text-sm text-dim">No decisions yet. Open a link on the Cascades tab to confirm it or mark it intentional.</li>
          )}
        </ul>
        {a.memoryWarnings.map((w) => (
          <p key={w} className="mt-3 rounded-lg bg-vermilion/10 p-2 text-xs text-vermilion-2">
            {w}
          </p>
        ))}
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-iris" />
          <h3 className="font-semibold">How the agents act here</h3>
        </div>
        <p className="mt-1 text-xs text-dim">
          Procedural memory, learned from what this clinic did with earlier tasks. Each version supersedes the last and links to the decided tasks it learned
          from.
        </p>
        <ul className="mt-3 space-y-2">
          {procedures.map((p) => (
            <li
              key={p.procedure.id}
              className={`rounded-xl border p-3 text-sm ${p.pattern && mine.has(p.procedure.key) ? 'border-iris/40 bg-iris/[0.05]' : 'hairline'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-bone">{p.pattern ?? 'Default procedure'}</span>
                <span className="chip">v{p.procedure.version}</span>
                <span className="chip">tasks to the {p.procedure.role}</span>
                {p.procedure.minTier === 'likely' && <span className="chip">likely links only</span>}
                {p.pattern && mine.has(p.procedure.key) && <span className="mono text-[10.5px] text-iris">applies to this patient</span>}
              </div>
              <p className="mt-1.5 text-[13px] text-bone-2">{p.procedure.reason}</p>
              {p.learnedFrom > 0 && (
                <p className="mono mt-1 text-[11px] text-dim">
                  learned from {p.learnedFrom} decided tasks: {p.procedure.acted} acted on, {p.procedure.dismissed} dismissed
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <History size={16} className="text-dim" />
          <h3 className="font-semibold">Earlier agent runs</h3>
        </div>
        <p className="mt-1 text-xs text-dim">Episodic memory. Each run starts by reading what changed since the one before.</p>
        <ul className="mt-3 space-y-2">
          {runs.map((r) => (
            <li key={r.id} className="rounded-xl border hairline p-3 text-sm">
              <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => load(r.id)} aria-expanded={!!steps[r.id]}>
                <span className="mono text-xs text-dim">{new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="chip">{r.mode === 'llm' ? r.model : 'graph planner'}</span>
                <span className="text-bone-2">{r.summary ?? 'unfinished'}</span>
                <span className="ml-auto text-xs text-sky">{steps[r.id] ? 'hide steps' : 'replay steps'}</span>
              </button>
              {r.changes && <p className="mt-2 text-[12.5px] text-iris">{r.changes}</p>}
              {steps[r.id] && (
                <ol className="mt-3 space-y-1 border-t hairline pt-3">
                  {steps[r.id].map((s) => (
                    <li key={s.i} className="mono grid grid-cols-[28px_84px_1fr_auto] gap-2 text-[11px]">
                      <span className="text-mute">{s.i}</span>
                      <span className="text-dim">{s.agent}</span>
                      <span className="truncate text-bone-2">
                        {s.tool ? `${s.tool}: ` : ''}
                        {s.text}
                      </span>
                      <span className="text-mute">
                        {s.queries?.length ? `${s.queries.length}q` : ''}
                        {s.produced?.length ? ` → ${s.produced.join(', ')}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
          {runs.length === 0 && <li className="text-sm text-dim">No runs yet. Press “Run review”.</li>}
        </ul>
      </section>

      <section className="card p-5">
        <h3 className="font-semibold">Drafted notes</h3>
        <ul className="mt-3 space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl border hairline p-3">
              <p className="mono text-[11px] uppercase text-iris">{n.kind === 'patient' ? 'For the patient and family' : 'For the prescriber'} · draft</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-bone-2">{n.text}</p>
            </li>
          ))}
          {notes.length === 0 && <li className="text-sm text-dim">No notes yet.</li>}
        </ul>
      </section>
    </div>
  );
}
