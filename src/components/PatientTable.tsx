'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

export interface PatientRow {
  id: string;
  name: string;
  age: number;
  sex: string;
  persona: boolean;
  headline: string | null;
  meds: number;
  likely: number | null;
  possible: number | null;
  acb: number | null;
  topScore: number | null;
  topLink?: string | null;
  topLinkScore?: number | null;
  avoidable?: number | null;
  reviewedAt: number | null;
}

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'demo', label: 'Demo patients' },
  { id: 'likely', label: 'Likely cascade' },
  { id: 'acb', label: 'High anticholinergic burden' },
] as const;

export function PatientTable({ rows }: { rows: PatientRow[] }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('all');
  const [limit, setLimit] = useState(60);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (s && !r.name.toLowerCase().includes(s) && !r.id.includes(s)) return false;
      if (tab === 'demo') return r.persona;
      if (tab === 'likely') return Number(r.likely) > 0;
      if (tab === 'acb') return Number(r.acb) >= 3;
      return true;
    });
  }, [rows, q, tab]);

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter patients">
          {TABS.filter((t) => t.id !== 'demo' || rows.some((r) => r.persona)).map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`chip transition ${tab === t.id ? 'border-bone/40 bg-white/10 text-bone' : 'hover:text-bone'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Search patients</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className="field w-full py-2 pl-9 pr-3 text-sm sm:w-64" />
        </label>
      </div>
      <div className="card mt-4 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b hairline text-xs text-dim">
            <tr>
              <th className="px-4 py-3 font-medium">Patient</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">Age</th>
              <th className="px-4 py-3 font-medium">Medicines</th>
              <th className="px-4 py-3 font-medium">Cascades</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Anticholinergic burden</th>
              <th className="hidden px-4 py-3 font-medium lg:table-cell">Where the main cascade starts</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r) => (
              <tr key={r.id} className="border-b hairline last:border-0 hover:bg-white/[0.025]">
                <td className="px-4 py-3">
                  <Link href={`/patients/${r.id}`} className="font-medium text-bone hover:text-vermilion-2">
                    {r.name}
                  </Link>
                  {r.persona && <span className="ml-2 rounded-full bg-vermilion/15 px-2 py-0.5 text-[10.5px] text-vermilion-2">demo</span>}
                  {r.headline && <div className="mt-0.5 hidden text-xs text-dim sm:block">{r.headline}</div>}
                </td>
                <td className="hidden px-4 py-3 tabular-nums text-bone-2 sm:table-cell">{r.age}</td>
                <td className="px-4 py-3 tabular-nums text-bone-2">{r.meds}</td>
                <td className="px-4 py-3">
                  {r.reviewedAt == null ? (
                    <span className="text-mute">not reviewed</span>
                  ) : Number(r.likely) > 0 ? (
                    <span className="text-vermilion-2">{r.likely} likely</span>
                  ) : Number(r.possible) > 0 ? (
                    <span className="text-amber">{r.possible} possible</span>
                  ) : (
                    <span className="text-sage">none</span>
                  )}
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <span className={`tabular-nums ${Number(r.acb) >= 3 ? 'text-amber' : 'text-bone-2'}`}>{r.acb ?? '·'}</span>
                </td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  {r.topLink ? (
                    <div className="min-w-0">
                      <div className="truncate text-bone-2">{r.topLink}</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1 w-20 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className={`h-full rounded-full ${Number(r.topLinkScore ?? 0) >= 0.5 ? 'bg-gradient-to-r from-vermilion/60 to-vermilion' : 'bg-amber/80'}`}
                            style={{ width: `${Math.round(Number(r.topLinkScore ?? 0) * 100)}%` }}
                          />
                        </div>
                        <span className="mono text-[10.5px] tabular-nums text-mute">{Number(r.topLinkScore ?? 0).toFixed(2)}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-mute">·</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > limit && (
          <div className="border-t hairline p-3 text-center">
            <button className="btn btn-ghost" onClick={() => setLimit(limit + 120)}>
              Show more ({filtered.length - limit} left)
            </button>
          </div>
        )}
        {filtered.length === 0 && <p className="p-8 text-center text-dim">No patients match.</p>}
      </div>
    </div>
  );
}
