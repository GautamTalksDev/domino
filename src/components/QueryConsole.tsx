'use client';
import { useMemo, useState } from 'react';
import { Loader2, Play, Terminal } from 'lucide-react';
import { Cypher } from './Cypher';

interface Item {
  key: string;
  title: string;
  purpose: string;
  cypher: string;
  params: string[];
}

const LABELS: Record<string, string> = { pid: 'Patient', drug: 'Drug', effect: 'Effect', id: 'Drug or effect', from: 'From drug', to: 'To drug' };
const FIXED = new Set(['harms', 'window', 'minPairs', 'min']);

export function QueryConsole({
  items,
  patients,
  drugs,
  effects,
}: {
  items: Item[];
  patients: { id: string; name: string }[];
  drugs: { id: string; name: string }[];
  effects: { id: string; name: string }[];
}) {
  const [key, setKey] = useState('paths');
  const [values, setValues] = useState<Record<string, string>>({
    pid: 'p-beatrice',
    drug: 'amlodipine',
    effect: 'peripheral_edema',
    id: 'amlodipine',
    from: 'amlodipine',
    to: 'donepezil',
  });
  const [res, setRes] = useState<{ ms: number; total: number; rows: unknown[]; params: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const item = useMemo(() => items.find((i) => i.key === key)!, [items, key]);
  // pssa uses $from as a day number, not a drug
  const inputs = item.params.filter((p) => !FIXED.has(p) && !(key === 'pssaPairs' && p === 'from'));

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const qs = new URLSearchParams({ q: key });
      for (const p of inputs) qs.set(p, values[p] ?? '');
      const r = await fetch(`/api/queries/run?${qs}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Query failed');
      setRes(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
      setRes(null);
    } finally {
      setBusy(false);
    }
  };

  const optionsFor = (p: string) => (p === 'pid' ? patients : p === 'effect' ? effects : p === 'id' ? [...drugs, ...effects] : drugs);

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <Terminal size={16} className="text-sky" />
        <h2 className="font-semibold">Query console</h2>
        <span className="chip ml-1 text-[11px]">read-only</span>
      </div>
      <p className="mt-1 text-xs text-dim">
        Run any read query from the catalog against the live graph. Parameters are validated and sent separately; the database runs it as GRAPH.RO_QUERY.
      </p>
      <div className="mt-4 grid gap-3 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-xs text-dim">Query</span>
            <select
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setRes(null);
              }}
              className="mt-1 w-full rounded-xl border hairline bg-ink-3 px-3 py-2 text-sm"
            >
              {items.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.title}
                </option>
              ))}
            </select>
          </label>
          {inputs.map((p) => (
            <label key={p} className="block text-sm">
              <span className="text-xs text-dim">{LABELS[p] ?? p}</span>
              <select
                value={values[p] ?? ''}
                onChange={(e) => setValues({ ...values, [p]: e.target.value })}
                className="mt-1 w-full rounded-xl border hairline bg-ink-3 px-3 py-2 text-sm"
              >
                {optionsFor(p).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button className="btn btn-hot w-full" onClick={go} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run on FalkorDB
          </button>
          <p className="text-xs text-dim">{item.purpose}</p>
        </div>
        <div className="min-w-0 space-y-3">
          <Cypher code={item.cypher} />
          {error && <p className="text-sm text-vermilion-2">{error}</p>}
          {res && (
            <div>
              <p className="mono text-xs text-dim">
                {res.total} row{res.total === 1 ? '' : 's'} · {res.ms} ms{res.total > res.rows.length ? ` · showing ${res.rows.length}` : ''}
              </p>
              <pre
                tabIndex={0}
                className="mono mt-2 max-h-80 overflow-auto rounded-xl border hairline bg-black/40 p-3 text-[11.5px] leading-relaxed text-bone-2"
              >
                {JSON.stringify(res.rows, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
