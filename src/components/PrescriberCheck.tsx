'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertOctagon, ArrowRight, CheckCircle2, Loader2, Plus, Search, TriangleAlert } from 'lucide-react';
import { postJson } from '@/lib/client';
import { toast } from '@/lib/toast';
import type { CheckResult } from '@/lib/engine/gatekeeper';

const EXAMPLES = [
  { patient: 'p-rosa', drug: 'benztropine', label: 'Rosa + benztropine' },
  { patient: 'p-dorothy', drug: 'dextromethorphan', label: 'Dorothy + a cough syrup' },
  { patient: 'p-frank', drug: 'oxycodone', label: 'Frank + oxycodone' },
  { patient: 'p-beatrice', drug: 'meclizine', label: 'Beatrice + meclizine' },
];

export function PrescriberCheck({
  initialPatient,
  patients,
  examples = true,
  drugs,
  effects,
}: {
  initialPatient: string;
  patients: { id: string; name: string; age: number }[];
  /** The worked examples use the story patients, so they show only in the clinic that has them. */
  examples?: boolean;
  drugs: { id: string; name: string; cls: string }[];
  effects: { id: string; name: string }[];
}) {
  const [pid, setPid] = useState(initialPatient);
  const [query, setQuery] = useState('');
  const [drug, setDrug] = useState<string | null>(null);
  const [res, setRes] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<{ summary: string; tasks: number; runId: string } | null>(null);
  const [indication, setIndication] = useState('');

  const matches = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s || drugs.find((d) => d.id === drug)?.name.toLowerCase() === s) return [];
    return drugs.filter((d) => d.name.toLowerCase().includes(s) || d.cls.toLowerCase().includes(s)).slice(0, 8);
  }, [query, drugs, drug]);

  const check = async (patientId: string, drugId: string) => {
    setBusy(true);
    setError('');
    setAdded(null);
    try {
      setRes(await postJson<CheckResult>(`/api/patients/${patientId}/check`, { drug: drugId, indication: indication || null }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check failed');
      setRes(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (drug && pid) check(pid, drug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, drug, indication]);

  const add = async () => {
    if (!drug || !pid) return;
    setBusy(true);
    setError('');
    try {
      const r = await postJson<{ review: { summary: string; tasks: number; runId: string } }>(`/api/patients/${pid}/prescriptions`, {
        drug,
        indication: indication || null,
        dose: 'as prescribed',
      });
      setAdded(r.review);
      toast({ tone: 'ok', title: 'Prescription added, review re-ran', body: r.review.summary, href: `/patients/${pid}`, hrefLabel: 'Open the record' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add');
    } finally {
      setBusy(false);
    }
  };

  const TONE = {
    stop_and_check: { border: 'border-vermilion/40', text: 'text-vermilion' },
    caution: { border: 'border-amber/40', text: 'text-amber' },
    clear: { border: 'border-sage/40', text: 'text-sage' },
  } as const;
  const tone = TONE[res?.verdict ?? 'clear'];
  const Icon = res?.verdict === 'stop_and_check' ? AlertOctagon : res?.verdict === 'caution' ? TriangleAlert : CheckCircle2;

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="card h-fit p-5 lg:sticky lg:top-24">
        <label className="kicker" htmlFor="patient">
          Patient
        </label>
        <select
          id="patient"
          value={pid}
          onChange={(e) => setPid(e.target.value)}
          className="mt-2 w-full rounded-xl border hairline bg-ink-3 px-3 py-2.5 text-sm outline-none"
        >
          {!pid && (
            <option value="" disabled>
              Choose a patient
            </option>
          )}
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {p.age}
            </option>
          ))}
        </select>
        <label className="kicker mt-5 block" htmlFor="drug">
          New prescription
        </label>
        <div className="relative mt-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            id="drug"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Start typing a drug or class"
            autoComplete="off"
            className="field w-full py-2.5 pl-9 pr-3 text-sm"
          />
        </div>
        {matches.length > 0 && (
          <ul className="mt-2 overflow-hidden rounded-xl border hairline" role="listbox">
            {matches.map((d) => (
              <li key={d.id}>
                <button
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5"
                  onClick={() => {
                    setDrug(d.id);
                    setQuery(d.name);
                  }}
                >
                  <span>{d.name}</span>
                  <span className="text-xs text-dim">{d.cls}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {examples && (
          <>
            <p className="kicker mt-6" data-tour="check-examples">Try</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((e) => (
                <button
                  key={e.label}
                  className="chip hover:text-bone"
                  onClick={() => {
                    setPid(e.patient);
                    setDrug(e.drug);
                    setQuery(drugs.find((d) => d.id === e.drug)?.name ?? e.drug);
                  }}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div>
        {busy && !res && (
          <div className="card flex items-center gap-2 p-6 text-dim">
            <Loader2 className="animate-spin" size={16} /> Asking the graph…
          </div>
        )}
        {error && <p className="card p-4 text-vermilion-2">{error}</p>}
        {!res && !busy && !error && (
          <div className="card card-glow dot-grid relative overflow-hidden p-8">
            <p className="kicker">Before the prescription is written</p>
            <h2 className="font-display mt-2 text-2xl font-semibold">Four questions, one graph, about a tenth of a second.</h2>
            <ol className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                {
                  t: 'Is it treating a side effect?',
                  d: 'Does the new drug treat something another of their medicines causes, scored by timing, frequency and other reasons, exactly as a review would.',
                  c: 'text-vermilion-2',
                },
                { t: 'Does it pile on?', d: 'Can it cause a problem that another drug is already being used to treat?', c: 'text-amber' },
                {
                  t: 'Does it complete a combination?',
                  d: 'The triple whammy, bleeding, sedation and potassium stacks, matched by drug class in the graph.',
                  c: 'text-iris',
                },
                { t: 'Does it add burden?', d: 'Anticholinergic load, Beers criteria, class conflicts with what they already take.', c: 'text-sky' },
              ].map((x, i) => (
                <li key={x.t} className="rounded-xl border hairline bg-ink/40 p-4">
                  <span className={`mono text-[11px] ${x.c}`}>0{i + 1}</span>
                  <p className="mt-1 text-sm font-medium text-bone">{x.t}</p>
                  <p className="mt-1 text-[13px] leading-snug text-dim">{x.d}</p>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-sm text-dim">
              Pick a patient and start typing a drug{examples ? ', or try one of the examples' : ''}. Nothing is written until you choose to add it.
            </p>
          </div>
        )}
        {res && (
          <div className={`card ${tone.border} p-6`}>
            <div className="flex items-start gap-3">
              <Icon className={`mt-1 shrink-0 ${tone.text}`} size={22} />
              <div>
                <p className={`kicker ${tone.text}`}>
                  {res.verdict === 'stop_and_check' ? 'Stop and check' : res.verdict === 'caution' ? 'Caution' : 'No graph concerns'}
                </p>
                <h2 className="font-display mt-1 text-2xl font-semibold leading-snug">{res.headline}</h2>
              </div>
            </div>

            {res.treatsSideEffectOf.length > 0 && (
              <div className="mt-6">
                <p className="text-sm font-semibold">Could be treating a side effect</p>
                <ul className="mt-2 space-y-2">
                  {res.treatsSideEffectOf.map((t) => (
                    <li key={t.from + t.effect} className="rounded-xl border hairline p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span>
                          <span className="text-bone">{t.fromName}</span> → {t.effectName.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())} (
                          {t.freq.replace('_', ' ')}, on it for {t.since}){t.diagnosed && <span className="text-dim"> · already a diagnosis on record</span>}
                        </span>
                        <span
                          className={`mono shrink-0 text-xs ${t.tier === 'likely' ? 'text-vermilion-2' : t.tier === 'possible' ? 'text-amber' : t.tier === 'intentional' ? 'text-iris' : 'text-dim'}`}
                          title={t.factors.join('\n')}
                        >
                          {t.tier} · {t.score.toFixed(2)}
                        </span>
                      </div>
                      {t.pattern && <p className="mt-1 text-xs text-vermilion-2">Documented: {t.pattern}</p>}
                      {t.deliberate && <p className="mt-1 text-xs text-iris">Usually deliberate: {t.deliberate}</p>}
                      {t.question && <p className="mt-1 text-xs text-bone-2">{t.question}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {res.combosCompleted.length > 0 && (
              <p className="mt-5 rounded-xl bg-vermilion/10 p-3 text-sm text-vermilion-2">Completes: {res.combosCompleted.join(', ')}</p>
            )}
            {res.conflicts.length > 0 && (
              <ul className="mt-5 space-y-1 text-sm text-amber">
                {res.conflicts.map((c) => (
                  <li key={c.drug}>
                    Conflicts with {c.drug}: {c.why}
                  </li>
                ))}
              </ul>
            )}
            {res.couldCause.length > 0 && (
              <div className="mt-5">
                <p className="text-sm font-semibold">Could start or worsen</p>
                <ul className="mt-2 space-y-1 text-sm text-bone-2">
                  {res.couldCause.map((c) => (
                    <li key={c.id}>
                      {c.name} ({c.freq.replace('_', ' ')}){c.diagnosed && ', already diagnosed'}
                      {c.treatedBy.length > 0 && <span className="text-amber">, which {c.treatedBy.join(' and ')} is treating</span>}
                      {c.alsoCausedBy.length > 0 && <span className="text-dim">, also caused by {c.alsoCausedBy.join(', ')}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border hairline p-3">
                <div className="text-xs text-dim">Anticholinergic burden</div>
                <div className="font-display text-xl font-semibold">
                  {res.acbBefore} → <span className={res.acbAfter >= 3 ? 'text-amber' : ''}>{res.acbAfter}</span>
                </div>
              </div>
              <div className="rounded-xl border hairline p-3 sm:col-span-2">
                <div className="text-xs text-dim">AGS Beers 2023</div>
                <div className="text-sm text-bone-2">{res.drug.beers ?? 'Not listed'}</div>
              </div>
            </div>

            <div className="mt-6 border-t hairline pt-5">
              {res.alreadyTaking ? (
                <p className="text-sm text-dim">The patient already takes {res.drug.name}.</p>
              ) : added ? (
                <div className="rounded-xl border border-sage/30 bg-sage/[0.06] p-4">
                  <p className="text-sm font-semibold text-sage">Added. The Detective re-ran on its own.</p>
                  <p className="mt-1 text-sm text-bone-2">
                    {added.summary} {added.tasks} review task{added.tasks === 1 ? '' : 's'} proposed.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Link className="btn btn-ghost" href={`/patients/${pid}`}>
                      Open the review <ArrowRight size={14} />
                    </Link>
                    <Link className="btn btn-ghost" href="/inbox">
                      Inbox
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    <span className="block text-xs text-dim">Charted for (optional)</span>
                    <select
                      value={indication}
                      onChange={(e) => setIndication(e.target.value)}
                      className="mt-1 rounded-xl border hairline bg-ink-3 px-3 py-2 text-sm"
                    >
                      <option value="">not recorded</option>
                      {effects.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn btn-ghost" onClick={add} disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add to the record anyway (demo)
                  </button>
                </div>
              )}
            </div>
            <p className="mono mt-4 text-[11px] text-mute">
              {res.queries.length} FalkorDB queries · {res.queries.map((q) => q.title).join(' · ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
