import type { Analysis } from '@/lib/engine/types';
import { REF } from '@/data/references';
import { AlertTriangle, Brain, Footprints, Layers } from 'lucide-react';

export function Harms({ analysis: a }: { analysis: Analysis }) {
  const falls = a.harms.find((h) => h.harm === 'falls');
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <section className="card p-5 lg:col-span-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-vermilion" />
          <h3 className="font-semibold">Dangerous combinations</h3>
        </div>
        {a.combos.length === 0 ? (
          <p className="mt-2 text-sm text-dim">None of the named combinations is complete.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {a.combos.map((c) => (
              <div key={c.id} className="rounded-xl border border-vermilion/30 bg-vermilion/[0.06] p-4">
                <p className="font-display text-xl font-semibold">{c.title}</p>
                <p className="mt-1 text-sm text-vermilion-2">
                  {c.drugs.join(' + ')} → {c.harm.toLowerCase()}
                </p>
                <p className="mt-2 text-sm text-bone-2">{c.why}</p>
                <p className="mt-2 text-xs text-mute">
                  {c.refs
                    .map((r) => REF[r]?.short)
                    .filter(Boolean)
                    .join('; ')}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Footprints size={16} className="text-amber" />
          <h3 className="font-semibold">Pushing toward a fall</h3>
        </div>
        <p className="mt-1 text-xs text-dim">
          Drugs that reach “falls” in the graph, directly or through dizziness, low blood pressure on standing, sedation or confusion.
        </p>
        <ul className="mt-3 space-y-2">
          {(falls?.drugs ?? []).map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-bone">{d.name}</span>
              <span className="text-right text-xs text-dim">via {d.via.join(', ').toLowerCase()}</span>
            </li>
          ))}
          {!falls && <li className="text-sm text-dim">None.</li>}
        </ul>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-iris" />
          <h3 className="font-semibold">Anticholinergic burden: {a.acb.total}</h3>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className={`h-full rounded-full ${a.acb.total >= 3 ? 'bg-amber' : 'bg-sage'}`} style={{ width: `${Math.min(100, (a.acb.total / 9) * 100)}%` }} />
        </div>
        <p className="mt-2 text-xs text-dim">A total of 3 or more is linked to confusion, falls and higher mortality (ACB scale).</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {a.acb.drugs.map((d) => (
            <li key={d.id} className="flex justify-between">
              <span>{d.name}</span>
              <span className="mono text-dim">+{d.acb}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-sky" />
          <h3 className="font-semibold">Side-effect pile-ups</h3>
        </div>
        <ul className="mt-3 space-y-2">
          {a.pileups.map((p) => (
            <li key={p.id} className="text-sm">
              <span className="text-bone">{p.name}</span>
              <span className="text-dim"> from {p.drugs.map((d) => d.name).join(' + ')}</span>
            </li>
          ))}
          {a.pileups.length === 0 && <li className="text-sm text-dim">None.</li>}
        </ul>
      </section>

      <section className="card p-5">
        <h3 className="font-semibold">AGS Beers Criteria 2023</h3>
        <ul className="mt-3 space-y-3">
          {a.beers.map((b) => (
            <li key={b.id} className="text-sm">
              <span className="text-bone">{b.name}</span>
              <p className="text-xs text-dim">{b.note}</p>
            </li>
          ))}
          {a.beers.length === 0 && <li className="text-sm text-dim">No Beers-listed medicines.</li>}
        </ul>
      </section>
    </div>
  );
}
