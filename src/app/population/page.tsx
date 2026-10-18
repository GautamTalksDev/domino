import type { Metadata } from 'next';
import { populationSummary, pssa } from '@/lib/engine/population';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { PATTERNS } from '@/data/knowledge';
import { DbError, withDb } from '@/components/DbError';
import { SweepButton } from '@/components/SweepButton';
import { Forest } from '@/components/Forest';
import { Cypher } from '@/components/Cypher';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Population' };

export default async function PopulationPage() {
  const res = await withDb(async () => {
    const [summary, signals, chokepoints] = await Promise.all([
      populationSummary(),
      pssa(),
      run<{ label: string; id: string; name: string; score: number }>(Q.chokepoints),
    ]);
    return { summary, signals, chokepoints };
  });
  if (!res.ok) return <DbError message={res.error} />;
  const { summary, signals, chokepoints } = res.data;
  const pct = summary.totals.patients ? Math.round((summary.totals.withLikely / summary.totals.patients) * 100) : 0;
  const maxPat = Math.max(1, ...summary.patterns.map((p) => Number(p.patients)));
  const rows = signals
    .filter((s) => s.signal || s.via.length)
    .slice(0, 18)
    .map((s) => {
      const pat = PATTERNS.find((p) => p.index.includes(s.a) && p.marker.includes(s.b));
      return { ...s, pattern: pat?.title, intentional: !!pat?.intentional, evidence: pat?.evidence };
    });
  const realWorld = PATTERNS.filter((p) => p.realWorld || p.realWorldNegative);

  return (
    <div className="pt-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="kicker">Population sweep agent</p>
          <h1 className="font-display mt-3 text-5xl font-semibold">The whole panel, at once</h1>
          <p className="mt-3 max-w-2xl text-bone-2">
            The sweep runs the cascade engine on every patient and writes each finding back into FalkorDB. Everything on this page is a Cypher aggregate over
            those findings and the prescriptions themselves.
          </p>
        </div>
        <SweepButton />
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-4">
        <Stat value={summary.totals.patients} label="patients" />
        <Stat value={`${pct}%`} label="with a likely cascade" tone="hot" />
        <Stat value={summary.patterns.reduce((s, p) => s + Number(p.patients), 0)} label="open findings" />
        <Stat value={signals.filter((s) => s.signal).length} label="sequence signals across class pairs" />
      </div>
      <p className="mt-2 text-xs text-mute">
        The synthetic cohort is deliberately enriched with cascades so there is something to find. These numbers are not a prevalence estimate.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="card p-5">
          <h2 className="font-semibold">Most common cascade patterns</h2>
          <ul className="mt-4 space-y-3">
            {summary.patterns.slice(0, 10).map((p) => (
              <li key={p.label}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-bone">{p.label}</span>
                  <span className="mono shrink-0 text-xs text-dim">{p.patients} pts</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className={`h-full rounded-full ${p.evidence === 'graph' ? 'bg-amber/70' : 'bg-vermilion'}`}
                    style={{ width: `${(Number(p.patients) / maxPat) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-dim">
            <span className="text-vermilion-2">Red</span>: documented pattern. <span className="text-amber">Amber</span>: inferred from the graph alone.
          </p>
        </section>
        <section className="grid gap-6">
          <div className="card p-5">
            <h2 className="font-semibold">By age</h2>
            <div className="mt-4 space-y-3">
              {summary.bands.map((b) => {
                const share = Number(b.patients) ? Number(b.withLikely) / Number(b.patients) : 0;
                return (
                  <div key={b.band}>
                    <div className="flex justify-between text-sm">
                      <span>{b.band}</span>
                      <span className="mono text-xs text-dim">
                        {Math.round(share * 100)}% · ACB {Number(b.avgAcb ?? 0).toFixed(1)} · {Number(b.avgMeds ?? 0).toFixed(1)} meds
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                      <div className="h-full rounded-full bg-vermilion" style={{ width: `${share * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card p-5">
            <h2 className="font-semibold">Drugs that most often start a cascade</h2>
            <ol className="mt-3 space-y-1.5 text-sm">
              {summary.roots.map((r, i) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3">
                  <span className="flex items-baseline">
                    <span className="mono w-6 shrink-0 text-xs tabular-nums text-mute">{i + 1}</span>
                    {r.name}
                  </span>
                  <span className="mono text-xs tabular-nums text-dim">{r.findings}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      <section className="mt-12">
        <p className="kicker">Discovery</p>
        <h2 className="font-display mt-2 text-3xl font-semibold">Prescription sequence symmetry, joined to the graph</h2>
        <p className="mt-3 max-w-3xl text-bone-2">
          The method pharmacoepidemiologists use to find cascades in national data: among people who start both drug classes within a year, does B start after A
          more often than before it? Domino adjusts for prescribing trends (the null-effect ratio), then asks the graph for a mechanism. A signal with a path is
          a candidate cascade. A signal without one is usually a care pathway, like anticoagulation before rate control.
        </p>
        <div className="card mt-6 overflow-x-auto p-5">
          <Forest rows={rows} />
        </div>
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-semibold">Real-world reference: ThinkCascades in Ireland</h2>
          <p className="mt-1 text-xs text-dim">
            Doherty et al., Ann Fam Med 2025: 533,464 adults aged 65+, PSSA with a 365-day window. Stored on each Pattern node in the graph.
          </p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {realWorld.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3">
                <span className="text-bone-2">{p.title}</span>
                {p.realWorld ? (
                  <span className="mono shrink-0 text-xs text-vermilion-2">
                    aSR {p.realWorld.asr} ({p.realWorld.lo}–{p.realWorld.hi})
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-amber">not confirmed</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-5">
          <h2 className="font-semibold">Cascade chokepoints</h2>
          <p className="mt-1 text-xs text-dim">
            FalkorDB betweenness centrality over drugs and effects: the nodes most cascade routes pass through. Good places for a prescriber prompt.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {chokepoints.slice(0, 12).map((c) => (
              <li key={c.id} className="flex justify-between gap-2">
                <span className={c.label === 'Effect' ? 'text-amber' : 'text-bone'}>{c.name}</span>
                <span className="mono text-xs text-dim">{Math.round(Number(c.score))}</span>
              </li>
            ))}
          </ul>
          <Cypher code={Q.chokepoints.cypher} className="mt-4" />
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number | string; label: string; tone?: 'hot' }) {
  return (
    <div className="card p-5">
      <div className={`font-display text-4xl font-semibold ${tone === 'hot' ? 'text-vermilion' : ''}`}>{value}</div>
      <div className="mt-1 text-sm text-dim">{label}</div>
    </div>
  );
}
