'use client';
import { useState } from 'react';
import { BadgeCheck, BookOpen, CircleHelp, Loader2, Network } from 'lucide-react';
import { Provenance } from './Provenance';
import type { QueryMap } from './Workspace';
import type { Link } from '@/lib/engine/types';
import { REF } from '@/data/references';
import { postJson } from '@/lib/client';
import { toast } from '@/lib/toast';
import { dayToLabel } from '@/data/time';

const FACTOR_LABEL: Record<string, string> = {
  cause: 'How often it causes this',
  timing: 'Timing',
  indication: 'Other reasons',
  history: 'Already diagnosed',
  pattern: 'Published evidence',
  memory: 'Care team memory',
};

export function Evidence({
  link,
  patientId,
  onDecided,
  queries,
  userName,
  recorded,
}: {
  link: Link;
  patientId: string;
  onDecided: () => void;
  queries: QueryMap;
  userName: string;
  recorded: boolean;
}) {
  const [form, setForm] = useState<null | 'intentional' | 'confirmed' | 'not_cascade'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trace, setTrace] = useState(false);
  const pat = link.patterns[0];
  const tierColor =
    link.tier === 'likely' ? 'text-vermilion-2' : link.tier === 'possible' ? 'text-amber' : link.tier === 'intentional' ? 'text-iris' : 'text-dim';

  const submit = async () => {
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      await postJson(`/api/patients/${patientId}/decisions`, { from: link.from, to: link.to, verdict: form, reason });
      toast({
        tone: 'learn',
        title: 'Signed into memory',
        body: `${link.fromName} → ${link.toName}: ${form === 'confirmed' ? 'confirmed as a cascade' : form === 'intentional' ? 'marked intentional' : 'not a cascade'}, signed as ${userName}. Every future review reads it first.`,
      });
      setForm(null);
      setReason('');
      onDecided();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 sm:p-6" aria-label="Evidence for the selected link">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker">Why Domino thinks so</p>
          <h3 className="font-display mt-1.5 text-2xl font-semibold">{link.headline}</h3>
          <p className="mt-1 text-sm text-dim">
            {link.fromName} started {dayToLabel(link.fromStart)} · {link.toName} started {dayToLabel(link.toStart)}
          </p>
        </div>
        <div className="text-right">
          <div className={`font-display text-4xl font-semibold ${tierColor}`}>{link.score.toFixed(2)}</div>
          <div className={`mono text-xs ${tierColor}`}>{link.tier}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-2">
        {link.factors.map((f, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_54px] items-start gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-sm odd:bg-white/[0.02] sm:grid-cols-[140px_54px_1fr]"
          >
            <span className="text-dim">{FACTOR_LABEL[f.name]}</span>
            <span className={`mono text-right ${f.value > 1 ? 'text-vermilion-2' : f.value < 1 ? 'text-sky' : 'text-bone-2'}`}>×{f.value}</span>
            <span className="col-span-2 text-bone-2 sm:col-span-1">{f.note}</span>
          </div>
        ))}
      </div>

      {pat && (
        <div className="mt-5 rounded-2xl border hairline bg-white/[0.02] p-4">
          <div className="flex items-start gap-3">
            <BookOpen size={16} className="mt-0.5 shrink-0 text-sage" />
            <div className="min-w-0">
              <p className="font-medium">{pat.title}</p>
              <p className="mt-1 text-xs text-dim">
                Evidence: {pat.evidence === 'consensus' ? 'expert consensus' : pat.evidence === 'study' ? 'published study' : 'product labelling'}
              </p>
              {pat.realWorld && (
                <p className="mt-2 text-sm text-bone-2">
                  Real-world signal: adjusted sequence ratio <strong className="text-bone">{pat.realWorld.asr}</strong> (95% CI {pat.realWorld.lo}–
                  {pat.realWorld.hi}), found in {pat.realWorld.prevalence}% of {pat.realWorld.note}.
                </p>
              )}
              {pat.realWorldNegative && <p className="mt-2 text-sm text-amber">{pat.realWorldNegative}</p>}
              {pat.intentional && <p className="mt-2 text-sm text-iris">{pat.intentional}</p>}
              <ul className="mt-3 space-y-1">
                {pat.refs.map((r) =>
                  REF[r] ? (
                    <li key={r} className="text-xs text-dim">
                      {REF[r].url ? (
                        <a href={REF[r].url} target="_blank" rel="noopener noreferrer" className="link-u">
                          {REF[r].citation}
                        </a>
                      ) : (
                        REF[r].citation
                      )}
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-vermilion/[0.07] p-3">
            <CircleHelp size={16} className="mt-0.5 shrink-0 text-vermilion-2" />
            <p className="text-sm text-bone">
              <span className="font-semibold">Question for the pharmacist: </span>
              {pat.question}
            </p>
          </div>
        </div>
      )}

      {recorded && (
        <div data-tour="provenance" className="mt-5 rounded-2xl border border-sky/20 bg-sky/[0.03] p-4">
          <button className="group flex w-full items-start gap-3 text-left" onClick={() => setTrace(!trace)} aria-expanded={trace}>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-sky/25 bg-sky/10 text-sky">
              <Network size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-bone">How Domino got here</span>
              <span className="block text-xs text-dim">
                The provenance graph: the run, its steps and queries, the evidence and memory it used, and what it led to.
              </span>
            </span>
            <span className="mt-1 shrink-0 rounded-full border border-sky/30 px-2 py-0.5 text-[11px] text-sky transition-colors group-hover:bg-sky/10">
              {trace ? 'Hide' : 'Show'}
            </span>
          </button>
          {trace && <Provenance patientId={patientId} linkKey={link.key} queries={queries} />}
        </div>
      )}

      {link.decision ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-iris">
          <BadgeCheck size={16} /> {link.decision.by} marked this “{link.decision.verdict.replace('_', ' ')}”: {link.decision.reason}
        </p>
      ) : (
        link.tier !== 'excluded' && (
          <div className="mt-5">
            <p className="text-xs text-dim">Teach Domino. Your decision becomes memory every future review respects.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn btn-ghost" onClick={() => setForm('confirmed')}>
                Confirm cascade
              </button>
              <button className="btn btn-ghost" onClick={() => setForm('intentional')}>
                Mark intentional
              </button>
              <button className="btn btn-ghost" onClick={() => setForm('not_cascade')}>
                Not a cascade
              </button>
            </div>
            {form && (
              <form
                className="mt-3 grid gap-2 rounded-xl border hairline p-3 sm:grid-cols-[1fr_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <input
                  required
                  minLength={3}
                  maxLength={400}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (e.g. planned with the diuretic)"
                  className="field px-3 py-2 text-sm"
                />
                <button className="btn btn-primary" disabled={busy}>
                  {busy && <Loader2 size={14} className="animate-spin" />} Save as {form.replace('_', ' ')}
                </button>
                <p className="text-xs text-dim sm:col-span-2">
                  Signed as {userName}. Every later review reads it first; nobody can edit it without breaking the signature.
                </p>
                {error && <p className="text-sm text-vermilion-2 sm:col-span-2">{error}</p>}
              </form>
            )}
          </div>
        )
      )}
    </section>
  );
}
