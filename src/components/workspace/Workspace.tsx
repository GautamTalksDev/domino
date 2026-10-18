'use client';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, FileJson, FileText, Pill, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import { sendDelete } from '@/lib/client';
import { onTabKey } from '@/lib/tabs';
import type { Analysis, Link as CLink } from '@/lib/engine/types';
import { DominoTree } from '../Domino';
import { AgentConsole } from './AgentConsole';
import { Evidence } from './Evidence';
import { Timeline } from './Timeline';
import { PatientGraph } from './PatientGraph';
import { Harms } from './Harms';
import { Memory, type DocView, type NoteRow, type ProcedureView, type RunRow } from './Memory';

export type QueryMap = Record<string, { title: string; cypher: string; purpose: string }>;

interface Initial {
  analysis: Analysis;
  notes: NoteRow[];
  runs: RunRow[];
  procedures: ProcedureView[];
  docs: DocView[];
}

const TABS = ['Cascades', 'Timeline', 'Graph', 'Harms', 'Memory'] as const;
type Tab = (typeof TABS)[number];

export function Workspace({
  initial,
  queries,
  agentLabel,
  autorun,
  tour = false,
  user,
}: {
  initial: Initial;
  queries: QueryMap;
  agentLabel: string;
  autorun: boolean;
  tour?: boolean;
  user: { name: string; title: string };
}) {
  const [data, setData] = useState<Initial>(initial);
  const [tab, setTab] = useState<Tab>('Cascades');
  const [selected, setSelected] = useState<string | undefined>(initial.analysis.trees[0]?.chains[0]?.links[0]?.key);
  const [untangled, setUntangled] = useState<Record<string, boolean>>({});
  const [runCount, setRunCount] = useState(0);
  const a = data.analysis;
  const p = a.patient;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/patients/${p.id}`);
    if (res.ok) {
      const j = await res.json();
      setData({ analysis: j.analysis, notes: j.notes, runs: j.runs, procedures: j.procedures, docs: j.docs ?? [] });
    }
  }, [p.id]);

  // Story mode for demos and recordings: after the agents finish, untangle the strongest root.
  const afterRun = useCallback(async () => {
    await refresh();
    const root = data.analysis.trees[0]?.root;
    if (tour && root) {
      setTimeout(() => {
        document.getElementById(`tree-${root}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setUntangled((u) => ({ ...u, [root]: true }));
      }, 1400);
    }
  }, [refresh, tour, data.analysis.trees]);

  const selectedLink = useMemo(() => a.links.find((l) => l.key === selected), [a.links, selected]);
  const classNames = useMemo(() => Object.fromEntries(p.meds.map((m) => [m.id, m.clsName.replace(/\s*\(.*\)/, '')])), [p.meds]);
  const fallDrugs = a.harms.find((h) => h.harm === 'falls')?.drugs.length ?? 0;
  const others = a.links.filter((l) => !a.trees.some((t) => t.chains.some((c) => c.links.some((x) => x.key === l.key))));
  const added = p.meds.some((m) => m.prescriber === 'Demo prescriber');

  return (
    <div className="pt-8">
      {/* Header */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href="/patients" className="kicker hover:text-bone">
              Patients
            </Link>
            <span className="kicker">/</span>
            <span className="kicker mono">{p.id}</span>
          </div>
          <h1 className="font-display mt-2 text-[42px] font-semibold leading-none sm:text-[54px]">{p.name}</h1>
          <p className="mt-3 text-bone-2">
            {p.age} · {p.sex === 'F' ? 'female' : 'male'} · {p.conditions.map((c) => c.name).join(', ') || 'no diagnoses recorded'}
          </p>
          {p.headline && !p.sandbox && <p className="font-display mt-3 max-w-2xl text-xl italic text-dim">{p.headline}</p>}
          {p.sandbox && (
            <p className="mt-3 max-w-2xl rounded-2xl border border-sky/30 bg-sky/[0.06] px-4 py-3 text-sm text-bone-2">
              A check-up built from a pasted list. Temporary: it and everything the agents write about it are deleted at{' '}
              {/* The viewer's local time; the server may render another time zone, so let the browser's text win. */}
              <span suppressHydrationWarning>{new Date(p.sandbox.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>.
              {p.meds.some((m) => m.assumedDate) &&
                ` ${p.meds.filter((m) => m.assumedDate).length} start date(s) were assumed from the order of the list, so timing is approximate.`}{' '}
              Questions to take to a pharmacist, not a diagnosis.
              {p.headline?.match(/Not in Domino’s graph, so not checked: [^]*$/)?.[0] && (
                <span className="mt-2 block text-amber">{p.headline.match(/Not in Domino’s graph, so not checked: [^]*$/)![0]}</span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/patients/${p.id}/brief`} className="btn btn-ghost">
            <FileText size={15} /> Pharmacist brief
          </Link>
          <Link href={`/check?patient=${p.id}`} className="btn btn-ghost">
            <Pill size={15} /> Check a new prescription
          </Link>
          {/* A plain download link: the review as a FHIR R4 Bundle for an EHR or decision-support pipeline. */}
          <a
            href={`/api/patients/${p.id}/fhir?download=1`}
            className="btn btn-ghost"
            title="Patient, MedicationStatement, DetectedIssue, Task and Provenance resources (FHIR R4)"
          >
            <FileJson size={15} /> Export FHIR
          </a>
          {added && (
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await sendDelete(`/api/patients/${p.id}/prescriptions`).catch(() => null);
                refresh();
              }}
            >
              <Undo2 size={15} /> Undo demo prescriptions
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Medicines" value={a.summary.medCount} />
        <Metric label="Likely cascade links" value={a.summary.likely} tone={a.summary.likely ? 'hot' : 'ok'} />
        <Metric
          label="Could be avoidable"
          value={a.summary.avoidable}
          tone={a.summary.avoidable ? 'hot' : 'ok'}
          hint="medicines that might not be needed if the root were reviewed"
        />
        <Metric label="Anticholinergic burden" value={a.acb.total} tone={a.acb.total >= 3 ? 'warn' : 'ok'} hint="3 or more is linked to confusion and falls" />
        <Metric label="Drugs toward falls" value={fallDrugs} tone={fallDrugs >= 3 ? 'warn' : 'ok'} />
        <Metric label="Dangerous combos" value={a.combos.length} tone={a.combos.length ? 'hot' : 'ok'} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* First in the page (and in tab and screen-reader order): the agent team is what you came to run. On wide screens it sits on the right. */}
        <aside className="xl:sticky xl:top-20 xl:col-start-2 xl:row-start-1 xl:self-start">
          <AgentConsole
            patientId={p.id}
            patientName={p.name}
            askHint={(() => {
              const d = a.trees[0]?.downstream[0];
              const name = d ? p.meds.find((m) => m.id === d)?.name : null;
              return name ? `why is ${p.sex === 'F' ? 'she' : 'he'} on ${name.toLowerCase()}?` : 'what could cause a fall?';
            })()}
            agentLabel={agentLabel}
            queries={queries}
            autorun={autorun}
            onFinished={afterRun}
            userName={user.name}
            sandbox={!!p.sandbox}
          />
          {!p.sandbox && (
            <Link href="/inbox" className="mt-3 flex items-center justify-between rounded-xl border hairline px-4 py-3 text-sm text-dim hover:text-bone">
              Care team inbox <ArrowRight size={14} />
            </Link>
          )}
        </aside>
        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
          <div
            className="-mx-4 flex gap-1 overflow-x-auto border-b hairline px-4 sm:mx-0 sm:px-0"
            role="tablist"
            aria-label="Patient views"
            onKeyDown={(e) => onTabKey(e, TABS, tab, setTab, (t) => `ws-tab-${t}`)}
          >
            {TABS.map((t) => (
              <button
                key={t}
                id={`ws-tab-${t}`}
                role="tab"
                aria-selected={tab === t}
                aria-controls="ws-panel"
                tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)}
                className={`relative -mb-px shrink-0 px-4 py-2.5 text-sm transition-colors ${tab === t ? 'text-bone' : 'text-dim hover:text-bone'}`}
              >
                {tab === t && (
                  <motion.span
                    layoutId="workspace-tab"
                    className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-vermilion shadow-[0_0_12px_rgba(255,91,58,0.7)]"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
                {t}
                {t === 'Memory' && a.decisions.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-iris/20 px-1.5 text-[10px] text-iris">{a.decisions.length}</span>
                )}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="ws-panel" aria-labelledby={`ws-tab-${tab}`}>
            {tab === 'Cascades' && (
              <div className="mt-6 space-y-6">
                {a.trees.length === 0 && (
                  <div className="card p-8">
                    <Sparkles className="text-sage" />
                    <h2 className="font-display mt-3 text-2xl font-semibold">No likely cascades</h2>
                    <p className="mt-2 max-w-xl text-bone-2">
                      Domino checked {a.links.length} candidate link{a.links.length === 1 ? '' : 's'} between {p.name.split(' ')[0]}’s medicines and set each
                      one aside. The reasons are below.
                    </p>
                  </div>
                )}
                {a.trees.map((t) => {
                  const u = t.untangle;
                  const on = !!untangled[t.root];
                  return (
                    <section key={t.root} id={`tree-${t.root}`} className="card scroll-mt-24 p-5 sm:p-6" aria-label={`Cascade from ${t.rootName}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="kicker">
                            Root drug · <span className={t.tier === 'likely' ? 'text-vermilion-2' : 'text-amber'}>{t.tier}</span> · score {t.score.toFixed(2)}
                          </p>
                          <h2 className="font-display mt-1.5 text-2xl font-semibold">
                            {t.rootName} <span className="text-dim">→ {t.downstream.length} downstream</span>
                          </h2>
                        </div>
                        <div className="flex gap-2">
                          <button className="btn btn-ghost" onClick={() => setRunCount((n) => n + 1)} aria-label="Replay the cascade animation">
                            <RotateCcw size={14} /> Replay
                          </button>
                          <button
                            className={`btn ${on ? 'btn-primary' : 'btn-hot'}`}
                            onClick={() => setUntangled({ ...untangled, [t.root]: !on })}
                            aria-pressed={on}
                          >
                            {on ? 'Show the cascade' : `What if ${t.rootName} were reviewed?`}
                          </button>
                        </div>
                      </div>
                      <DominoTree
                        tree={t}
                        untangled={on}
                        run={runCount + 1}
                        selected={selected}
                        onSelect={(l: CLink) => setSelected(l.key)}
                        classNames={classNames}
                      />
                      {on ? (
                        <div className="mt-2 grid gap-3 rounded-2xl border border-sage/30 bg-sage/[0.06] p-4 sm:grid-cols-4">
                          <Delta label="Medicines" from={u.pillsBefore} to={u.pillsAfter} />
                          <Delta label="Anticholinergic burden" from={u.acbBefore} to={u.acbAfter} />
                          <Delta label="Drugs toward falls" from={u.fallDrugsBefore} to={u.fallDrugsAfter} />
                          <div>
                            <div className="text-xs text-dim">Combinations resolved</div>
                            <div className="mt-1 text-sm font-medium text-sage">{u.combosResolved.join(', ') || 'none'}</div>
                          </div>
                          <p className="text-sm text-bone-2 sm:col-span-4">
                            A simulation over the graph, not advice: it asks which medicines exist only because of {t.rootName}. A pharmacist decides.
                            {u.alsoContributing.length > 0 &&
                              ` ${u.alsoContributing.map((c) => `${c.fromName} may also contribute to ${c.effect}`).join('; ')}, so review together.`}
                          </p>
                        </div>
                      ) : (
                        t.contributors.length > 0 && (
                          <p className="mt-1 text-sm text-amber">
                            Also feeding this chain:{' '}
                            {t.contributors.map((c) => `${c.rootName} → ${c.effect} → ${c.toName} (possible, ${c.score.toFixed(2)})`).join('; ')}.
                          </p>
                        )
                      )}
                    </section>
                  );
                })}

                {a.loops.length > 0 && (
                  <section className="card border-amber/25 p-5">
                    <p className="kicker text-amber">Feedback loop</p>
                    {a.loops.map((l) => (
                      <p key={l.id} className="mt-2 text-bone-2">
                        {l.steps.map((s, i) => (
                          <span key={i}>
                            <strong className="text-bone">{s.fromName}</strong> can cause {s.effectName.toLowerCase()}, which {s.toName} treats
                            {i < l.steps.length - 1 ? '; ' : '. '}
                          </span>
                        ))}
                        Each drug can feed the problem the other is treating.
                      </p>
                    ))}
                  </section>
                )}

                {selectedLink && (
                  <Evidence
                    key={selectedLink.key}
                    link={selectedLink}
                    patientId={p.id}
                    onDecided={refresh}
                    queries={queries}
                    userName={user.name}
                    recorded={selectedLink.tier === 'likely' || selectedLink.tier === 'possible'}
                  />
                )}

                {others.length > 0 && (
                  <section className="card p-5">
                    <p className="kicker">Checked and set aside</p>
                    <ul className="mt-2 divide-y divide-white/5">
                      {others.map((l) => (
                        <li key={l.key + l.effect}>
                          <button
                            className="group flex w-full items-start justify-between gap-4 py-3 text-left"
                            onClick={() => setSelected(l.key)}
                          >
                            <span className="min-w-0">
                              <span className="block text-sm text-bone-2 transition-colors group-hover:text-bone">{l.headline}</span>
                              <span className="mt-0.5 block text-[13px] leading-snug text-dim">
                                {
                                  l.factors.find((f) => f.name === (l.tier === 'excluded' ? 'timing' : l.tier === 'intentional' ? 'pattern' : 'indication'))
                                    ?.note
                                }
                              </span>
                            </span>
                            <span
                              className={`mono mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] ${
                                l.tier === 'possible'
                                  ? 'border-amber/30 text-amber'
                                  : l.tier === 'intentional'
                                    ? 'border-iris/30 text-iris'
                                    : 'border-white/10 text-dim'
                              }`}
                            >
                              {l.tier}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {tab === 'Timeline' && <Timeline analysis={a} patientId={p.id} />}
            {tab === 'Graph' && <PatientGraph analysis={a} />}
            {tab === 'Harms' && <Harms analysis={a} />}
            {tab === 'Memory' && <Memory analysis={a} notes={data.notes} runs={data.runs} procedures={data.procedures} docs={data.docs} />}
          </div>

          <p className="mono mt-6 text-[11px] text-mute">
            Analysis: {a.queries.length} FalkorDB queries, run in parallel, {a.ms} ms
          </p>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = 'ok', hint }: { label: string; value: number; tone?: 'ok' | 'hot' | 'warn'; hint?: string }) {
  const color = tone === 'hot' ? 'text-vermilion' : tone === 'warn' ? 'text-amber' : 'text-bone';
  return (
    <div className="card p-4" title={hint}>
      <div className={`font-display text-3xl font-semibold ${color}`}>{value}</div>
      <div className="mt-1 text-xs text-dim">{label}</div>
    </div>
  );
}

function Delta({ label, from, to }: { label: string; from: number; to: number }) {
  return (
    <div>
      <div className="text-xs text-dim">{label}</div>
      <div className="font-display mt-1 text-2xl font-semibold">
        {from} <span className="text-dim">→</span> <span className={to < from ? 'text-sage' : 'text-bone'}>{to}</span>
      </div>
    </div>
  );
}
