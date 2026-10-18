'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Brain,
  Database,
  FileSignature,
  GitBranch,
  Loader2,
  MessagesSquare,
  NotebookPen,
  Pill,
  Route,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import type { Trace } from '@/lib/provenance';
import type { QueryMap } from './Workspace';

const AGENT: Record<string, { name: string; color: string; ring: string; icon: typeof GitBranch }> = {
  detective: { name: 'Detective', color: 'text-vermilion', ring: 'border-vermilion/35', icon: GitBranch },
  pharmacist: { name: 'Pharmacist', color: 'text-amber', ring: 'border-amber/35', icon: Stethoscope },
  scribe: { name: 'Scribe', color: 'text-iris', ring: 'border-iris/35', icon: FileSignature },
};

type Edge = { from: string; to: string; kind: 'flow' | 'seq' | 'key' | 'up' };

/**
 * "How Domino got here": the provenance subgraph behind one finding, read from FalkorDB.
 * Evidence and memory on the left, the agent's tool calls (with the catalog queries each ran) next,
 * the finding in the middle, and what it led to on the right.
 */
export function Provenance({ patientId, linkKey, queries }: { patientId: string; linkKey: string; queries: QueryMap }) {
  const [trace, setTrace] = useState<Trace | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`/api/patients/${patientId}/trace?link=${encodeURIComponent(linkKey)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'Could not load the trace.');
        if (live) setTrace(j.trace);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load the trace.'));
    return () => {
      live = false;
    };
  }, [patientId, linkKey]);

  if (error) return <p className="mt-3 text-sm text-vermilion-2">{error}</p>;
  if (trace === undefined)
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-dim">
        <Loader2 size={14} className="animate-spin" /> Reading the provenance graph…
      </p>
    );
  if (trace === null)
    return <p className="mt-3 text-sm text-dim">No agent has recorded this link yet. Run a review and the path behind it will appear here.</p>;
  return <TraceGraph t={trace} queries={queries} />;
}

function TraceGraph({ t, queries }: { t: Trace; queries: QueryMap }) {
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<{ d: string; kind: Edge['kind'] }[]>([]);
  const [wide, setWide] = useState(false);

  const reg = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) nodes.current.set(id, el);
      else nodes.current.delete(id);
    },
    [],
  );

  const steps = t.steps.map((s) => `s-${s.i}`);
  const outcomes = [...t.handoffs.map((h) => `o-h-${h.id}`), ...t.tasks.map((x) => `o-t-${x.id}`)];
  const edges: Edge[] = [
    { from: 'e-box', to: 'f', kind: 'up' },
    ...steps.slice(1).map((s, i) => ({ from: steps[i], to: s, kind: 'seq' as const })),
    ...(steps.length ? [{ from: steps[steps.length - 1], to: 'f', kind: 'key' as const }] : []),
    ...outcomes.map((o) => ({ from: 'f', to: o, kind: 'flow' as const })),
  ];

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const draw = () => {
      // Edges only where the four columns sit side by side (the lg breakpoint).
      const w = window.matchMedia('(min-width: 1024px)').matches;
      setWide(w);
      if (!w) return setPaths([]);
      const base = el.getBoundingClientRect();
      const r = (id: string) => {
        const n = nodes.current.get(id);
        if (!n) return null;
        const b = n.getBoundingClientRect();
        return {
          l: b.left - base.left,
          r: b.right - base.left,
          t: b.top - base.top,
          b: b.bottom - base.top,
          cx: (b.left + b.right) / 2 - base.left,
          cy: (b.top + b.bottom) / 2 - base.top,
        };
      };
      const out: { d: string; kind: Edge['kind'] }[] = [];
      for (const e of edges) {
        const a = r(e.from);
        const b = r(e.to);
        if (!a || !b) continue;
        if (e.kind === 'seq') out.push({ d: `M ${a.cx} ${a.b} L ${b.cx} ${b.t}`, kind: e.kind });
        else if (e.kind === 'up') out.push({ d: `M ${a.cx} ${a.t} L ${b.cx} ${b.b}`, kind: e.kind });
        else {
          const mx = (a.r + b.l) / 2;
          out.push({ d: `M ${a.r} ${a.cy} C ${mx} ${a.cy}, ${mx} ${b.cy}, ${b.l} ${b.cy}`, kind: e.kind });
        }
      }
      setPaths(out);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="mt-4">
      <p className="text-xs text-dim">
        {t.run ? (
          <>
            Recorded by the <span className="text-bone-2">{AGENT[t.agent ?? '']?.name ?? t.agent}</span> in a{' '}
            {t.run.mode === 'llm' ? t.run.model : 'graph-planner'} run ({t.run.trigger.replace('_', ' ')}) on {when(t.run.at)}, step {t.step}. Every box below
            is a node in FalkorDB; every line is an edge you can query.
          </>
        ) : (
          <>Recorded by the population sweep on {when(t.finding.at)}. Run a review to see the agent steps behind it.</>
        )}
      </p>
      <div ref={box} className="relative mt-4 grid gap-4 lg:grid-cols-[0.95fr_1.15fr_1fr] lg:gap-10">
        {wide && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill="none"
                className={p.kind === 'key' ? 'trace-edge trace-key' : 'trace-edge'}
                style={{ animationDelay: `${i * 40}ms` }}
              />
            ))}
          </svg>
        )}

        <Column title="Agent steps" icon={Route}>
          {t.steps.length === 0 && <p className="text-xs text-dim">No agent steps (sweep finding).</p>}
          {t.steps.map((s) => {
            const A = AGENT[s.agent] ?? AGENT.detective;
            return (
              <div
                key={s.i}
                ref={reg(`s-${s.i}`)}
                className={`rounded-xl border bg-ink-2/80 px-3 py-2 ${s.i === t.step ? 'border-vermilion/60 shadow-[0_0_0_3px_rgba(255,94,58,0.12)]' : A.ring}`}
              >
                <div className="flex items-center gap-1.5">
                  <A.icon size={12} className={A.color} />
                  <span className="mono text-[11.5px] text-bone">{s.tool}</span>
                  <span className="mono ml-auto text-[10px] text-mute">#{s.i}</span>
                </div>
                {s.queries.length > 0 ? (
                  <details className="mt-1">
                    <summary className="mono cursor-pointer text-[10.5px] text-sky">
                      {s.queries.length} quer{s.queries.length === 1 ? 'y' : 'ies'} · {s.ms} ms
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {s.queries.map((q) => (
                        <li key={q.id} className="text-[10.5px] text-dim" title={queries[q.id]?.purpose}>
                          {q.title} <span className="mono text-mute">({q.mode})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <p className="mono mt-1 text-[10.5px] text-mute">cached analysis · {s.ms} ms</p>
                )}
              </div>
            );
          })}
        </Column>

        <Column title="Finding, and the graph it rests on" icon={Pill}>
          <div ref={reg('f')} className="rounded-2xl border border-vermilion/45 bg-vermilion/[0.07] p-4">
            <p className="kicker text-vermilion-2">
              {t.finding.tier} · {t.finding.score.toFixed(2)}
            </p>
            <p className="font-display mt-1 text-lg font-semibold leading-tight">
              {t.from.name} → {t.to.name}
            </p>
            <p className="mt-1 text-[12px] text-dim">{t.finding.label}</p>
            {t.finding.factors && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-sky">Scoring factors, as stored</summary>
                <pre className="mono mt-1 whitespace-pre-wrap text-[10.5px] leading-relaxed text-bone-2">{t.finding.factors}</pre>
              </details>
            )}
            <p className="mono mt-2 text-[10px] text-mute">
              {t.finding.status} · {t.finding.source}
            </p>
          </div>
          <div ref={reg('e-box')} className="mt-6 rounded-2xl border border-dashed border-white/12 p-3">
            <p className="kicker mb-2 flex items-center gap-1.5">
              <Database size={12} /> Evidence and memory
            </p>
            <div className="flex flex-col items-stretch gap-1.5">
              <Node tone="drug" label="Drug" title={t.from.name} />
              <Hop label={`CAUSES · ${t.causes?.freq.replace('_', ' ') ?? ''}${t.causes ? ` · onset ${t.causes.onsetMin}–${t.causes.onsetMax} days` : ''}`} />
              <Node tone="effect" label="Effect" title={t.effect.plain} />
              <Hop label={`TREATED_BY · ${t.line ?? ''} line`} />
              <Node tone="drug" label="Drug" title={t.to.name} />
              {t.pattern && (
                <div className="mt-2">
                  <Node tone="pattern" label={`MATCHES pattern · ${t.pattern.evidence}`} title={t.pattern.title}>
                    {t.refs.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {t.refs.map((r) =>
                          r.url ? (
                            <a
                              key={r.id}
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-sage hover:bg-white/10"
                            >
                              <BookOpen size={9} className="mr-0.5 inline" /> {r.short}
                            </a>
                          ) : (
                            <span key={r.id} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-dim">
                              {r.short}
                            </span>
                          ),
                        )}
                      </span>
                    )}
                  </Node>
                </div>
              )}
              {t.decisions.map((d) => (
                <Node key={d.id} tone="memory" label={`CONSIDERED · decision by ${d.by}`} title={d.verdict.replace('_', ' ')}>
                  <span className="mt-0.5 block text-[11px] text-dim">“{d.reason}”</span>
                </Node>
              ))}
            </div>
          </div>
        </Column>

        <Column title="What it led to" icon={ArrowRight}>
          {outcomes.length === 0 && <p className="text-xs text-dim">Nothing yet.</p>}
          {t.handoffs.map((h) => (
            <div key={h.id} ref={reg(`o-h-${h.id}`)} className="rounded-xl border border-sage/30 bg-sage/[0.05] px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11.5px] text-sage">
                <BadgeCheck size={12} /> Signed handoff
              </p>
              <p className="text-[12px] text-bone-2">
                {AGENT[h.from]?.name ?? h.from} → {AGENT[h.to]?.name ?? h.to}
              </p>
            </div>
          ))}
          {t.tasks.map((x) => (
            <div key={x.id} ref={reg(`o-t-${x.id}`)} className="rounded-xl border border-iris/30 bg-iris/[0.06] px-3 py-2">
              <p className="mono text-[10px] uppercase text-iris">
                task · {x.role} · {x.status}
              </p>
              <p className="text-[12px] leading-snug text-bone">{x.title}</p>
              {x.owner && (
                <p className="mt-1 flex items-center gap-1 text-[10.5px] text-dim">
                  <UserRound size={10} /> root prescribed by {x.owner}
                </p>
              )}
              {x.note && (
                <p className="mt-1 flex items-start gap-1 text-[10.5px] text-iris">
                  <NotebookPen size={10} className="mt-0.5 shrink-0" /> raised by {x.noteBy}’s {x.noteKind}: “{x.note}”
                </p>
              )}
              {x.version != null && x.procedureReason && (
                <p className="mt-1 flex items-start gap-1 text-[10.5px] text-iris" title={x.procedureReason}>
                  <Brain size={10} className="mt-0.5 shrink-0" /> followed procedure v{x.version}
                </p>
              )}
              {x.decidedBy && (
                <p className="mt-1 flex items-center gap-1 text-[10.5px] text-sage">
                  <MessagesSquare size={10} /> decided by {x.decidedBy}
                </p>
              )}
            </div>
          ))}
        </Column>
      </div>
    </div>
  );
}

function Column({ title, icon: Icon, children }: { title: string; icon: typeof Database; children: React.ReactNode }) {
  return (
    <div className="relative min-w-0">
      <p className="kicker mb-2 flex items-center gap-1.5">
        <Icon size={12} /> {title}
      </p>
      <div className="relative z-10 flex flex-col gap-3">{children}</div>
    </div>
  );
}

const TONE: Record<string, string> = {
  drug: 'border-white/15 bg-ink-2/80',
  effect: 'border-amber/35 bg-amber/[0.06]',
  pattern: 'border-sage/35 bg-sage/[0.05]',
  memory: 'border-iris/35 bg-iris/[0.06]',
};

const Node = ({ tone, label, title, children }: { tone: string; label: string; title: string; children?: React.ReactNode }) => (
  <div className={`rounded-xl border px-3 py-2 ${TONE[tone]}`}>
    <p className="mono text-[10px] uppercase tracking-wide text-dim">{label}</p>
    <p className="text-[12.5px] font-medium leading-snug text-bone">{title}</p>
    {children}
  </div>
);

const Hop = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2 pl-4">
    <span className="h-4 w-px bg-white/20" />
    <span className="mono text-[10px] uppercase tracking-wide text-mute">{label}</span>
  </div>
);
