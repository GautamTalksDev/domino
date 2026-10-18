'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Cypher } from './Cypher';

interface Item {
  id: string;
  title: string;
  purpose: string;
  mode: 'read' | 'write';
  cypher: string;
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'read', label: 'Read' },
  { id: 'write', label: 'Write' },
] as const;

/** Every catalog query, searchable by title, purpose, id or Cypher, and filterable by mode. */
export function CypherCatalog({ items }: { items: Item[] }) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<(typeof FILTERS)[number]['id']>('all');
  const [all, setAll] = useState(false);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter(
      (x) =>
        (mode === 'all' || x.mode === mode) &&
        (!s || x.title.toLowerCase().includes(s) || x.purpose.toLowerCase().includes(s) || x.id.includes(s) || x.cypher.toLowerCase().includes(s)),
    );
  }, [items, q, mode]);
  const limited = all || q.trim() ? shown : shown.slice(0, 12);
  const count = (m: string) => (m === 'all' ? items.length : items.filter((x) => x.mode === m).length);

  return (
    <div className="mt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter queries">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setMode(f.id)}
              aria-pressed={mode === f.id}
              className={`chip transition ${mode === f.id ? 'border-bone/40 bg-white/10 text-bone' : 'hover:text-bone'}`}
            >
              {f.label} <span className="mono text-[10.5px] text-mute">{count(f.id)}</span>
            </button>
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Search the catalog</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search: lease, betweenness, MATCHES…"
            className="field w-full py-2 pl-9 pr-3 text-sm sm:w-80"
          />
        </label>
      </div>
      <div className="mt-4 grid gap-2.5">
        {limited.map((x) => (
          <details key={x.id} className="card group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-start gap-3 [&::-webkit-details-marker]:hidden">
              <span
                className={`mono mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${x.mode === 'read' ? 'bg-sage/15 text-sage' : 'bg-vermilion/15 text-vermilion-2'}`}
              >
                {x.mode}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-bone">{x.title}</span>
                <span className="mono ml-2 text-[11px] text-mute">{x.id}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-dim">{x.purpose}</span>
              </span>
              <ChevronDown size={16} className="mt-1 shrink-0 text-mute transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <Cypher code={x.cypher} className="mt-3" />
          </details>
        ))}
        {limited.length === 0 && <p className="card p-6 text-center text-sm text-dim">No query matches “{q}”.</p>}
      </div>
      {!all && !q.trim() && shown.length > limited.length && (
        <div className="mt-4 text-center">
          <button className="btn btn-ghost" onClick={() => setAll(true)}>
            Show all {shown.length} queries
          </button>
        </div>
      )}
    </div>
  );
}
