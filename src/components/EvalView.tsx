'use client';
import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { streamPost } from '@/lib/client';
import type { EvalResult } from '@/lib/engine/evaluate';

export function EvalView({ initial }: { initial: EvalResult }) {
  const [r, setR] = useState<EvalResult>(initial);
  const [progress, setProgress] = useState<string | null>(null);
  const rerun = async () => {
    setProgress('starting');
    try {
      await streamPost('/api/eval', {}, (e) => {
        if (e.type === 'progress') setProgress(`${e.done}/${e.total}`);
        if (e.type === 'done') setR(e.result as EvalResult);
        if (e.type === 'error') setProgress(String(e.message));
      });
      setProgress(null);
    } catch (err) {
      setProgress(err instanceof Error ? err.message : 'failed');
    }
  };
  const full = r.variants.find((v) => v.id === 'full')!;
  return (
    <div className="mt-8">
      <div className="grid gap-3 sm:grid-cols-4">
        <Big value={full.precision} label="precision" />
        <Big value={full.recall} label="recall" />
        <Big value={full.f1} label="F1" />
        <div className="card p-5">
          <div className="font-display text-4xl font-semibold text-sage">{full.deliberateFlagged}</div>
          <div className="mt-1 text-sm text-dim">of {r.truthDeliberate} deliberate pairs wrongly flagged</div>
        </div>
      </div>

      {r.prevention && <Prevention p={r.prevention} />}

      <section className="card mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Ablation: what each graph signal adds</h2>
            <p className="text-xs text-dim">
              {r.truthCascades} hidden cascades · {r.candidateLinks} candidate links found by the graph · threshold {r.threshold} · {(r.ms / 1000).toFixed(1)} s
              on FalkorDB
            </p>
          </div>
          <button className="btn btn-ghost" onClick={rerun} disabled={!!progress}>
            {progress ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {progress ? `Evaluating ${progress}` : 'Re-run live'}
          </button>
        </div>
        <div className="mt-6 space-y-5">
          {r.variants.map((v) => (
            <div key={v.id} className="grid gap-3 sm:grid-cols-[220px_1fr]">
              <div>
                <p className={`text-sm font-medium ${v.id === 'full' ? 'text-vermilion-2' : 'text-bone'}`}>{v.label}</p>
                <p className="text-xs text-dim">{v.description}</p>
              </div>
              <div className="space-y-1.5">
                <Bar label="Precision" value={v.precision} color="bg-vermilion" />
                <Bar label="Recall" value={v.recall} color="bg-sky" />
                <Bar label="F1" value={v.f1} color="bg-bone" />
                <p className="mono text-[11px] text-mute">
                  tp {v.tp} · fp {v.fp} · fn {v.fn} · deliberate pairs flagged {v.deliberateFlagged}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-semibold">Recall by pattern</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {r.byPattern.map((p) => (
              <li key={p.pattern} className="flex items-center justify-between gap-3">
                <span className="text-bone-2">{p.pattern}</span>
                <span className="mono shrink-0 text-xs">
                  <span className={p.found === p.truth ? 'text-sage' : 'text-amber'}>{p.found}</span>
                  <span className="text-mute">/{p.truth}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="font-semibold">Read this honestly</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-bone-2">
            <li>
              This tests the reasoning, not clinical truth. The generator and the engine share one knowledge graph, so graph-level recall is high by
              construction. The point is the jump in precision as each signal is added.
            </li>
            <li>
              The misses are real ones: cascades where the second drug also had a genuine diagnosis on record, which Domino correctly treats as less certain.
            </li>
            <li>
              Clinical validation would need real prescribing data, for example a prescription sequence symmetry analysis like Doherty et al. (2025), and
              pharmacist review of flagged records.
            </li>
            <li>The knowledge graph is hand-curated for a hackathon: frequency bands and onset windows are approximate.</li>
            <li>
              The prevention replay counts a cascade as caught only on a hard stop at the first downstream prescription; cautions are counted separately.
              “Avoided” means the replay removes that drug and every drug the ground truth says followed from it.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Prevention({ p }: { p: NonNullable<EvalResult['prevention']> }) {
  const pct = (a: number, b: number) => `${Math.round((a / Math.max(1, b)) * 100)}%`;
  return (
    <section className="card mt-6 overflow-hidden">
      <div className="border-b hairline p-5">
        <p className="kicker text-vermilion-2">Counterfactual replay</p>
        <h2 className="font-display mt-1 text-2xl font-semibold">If Domino had been at the prescriber’s desk</h2>
        <p className="mt-1 max-w-3xl text-sm text-bone-2">
          Every one of the cohort’s {p.prescriptionsChecked.toLocaleString('en-US')} prescriptions is re-checked as the record stood the day it was written (only
          earlier prescriptions and diagnoses count). When the check stops a true cascade, that drug and everything that followed from it are removed from the
          rest of the replay.
        </p>
      </div>
      <div className="grid gap-px bg-white/[0.04] sm:grid-cols-2 lg:grid-cols-4">
        <Cell
          value={pct(p.caught, p.trueCascadeMarkers)}
          label={`of ${p.trueCascadeMarkers} cascades stopped at the first downstream prescription (${p.caught})`}
          tone="text-vermilion"
        />
        <Cell value={p.prescriptionsAvoided.toLocaleString('en-US')} label="prescriptions that might never have been written" tone="text-sage" />
        <Cell value={p.cascadeStopPpv.toFixed(2)} label={`of cascade stops were true cascades (${p.falseCascadeStops} were not)`} tone="text-bone" />
        <Cell
          value={`${p.deliberateCascadeStops ?? 0}/${p.deliberateChecked}`}
          label={`deliberate companions (a PPI with an NSAID) stopped as a cascade${p.deliberateStopped ? `; ${p.deliberateStopped} stopped for completing a dangerous combination` : ''}`}
          tone="text-iris"
        />
      </div>
      <p className="mono px-5 py-3 text-[11px] text-mute">
        {p.caughtAnyAlert} of {p.trueCascadeMarkers} cascades got at least a caution · {Number(p.stopRatePer100).toFixed(1)} stops per 100 prescriptions in a cohort seeded with
        cascades · {p.cautions} cautions · {(p.ms / 1000).toFixed(1)} s
      </p>
    </section>
  );
}

function Cell({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className="bg-ink p-5">
      <div className={`font-display text-4xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-sm text-dim">{label}</div>
    </div>
  );
}

function Big({ value, label }: { value: number; label: string }) {
  return (
    <div className="card p-5">
      <div className="font-display text-4xl font-semibold">{value.toFixed(2)}</div>
      <div className="mt-1 text-sm text-dim">{label}</div>
    </div>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="grid grid-cols-[70px_1fr_44px] items-center gap-2">
      <span className="text-xs text-dim">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value * 100}%`, transition: 'width .6s ease' }} />
      </div>
      <span className="mono text-right text-xs text-bone-2">{value.toFixed(2)}</span>
    </div>
  );
}
