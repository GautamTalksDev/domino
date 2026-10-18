'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Loader2, Search, Sparkles, Type, Waypoints } from 'lucide-react';

interface Hit {
  kind: string;
  id: string;
  title: string | null;
  text: string | null;
  status: string | null;
  by: string | null;
  patientId: string | null;
  patientName: string;
  at: number | null;
  score: number;
  match?: 'words' | 'meaning' | 'both';
  linked?: boolean;
}

const MATCH = {
  words: { label: 'words', icon: Type, tone: 'text-dim' },
  meaning: { label: 'meaning', icon: Sparkles, tone: 'text-iris' },
  both: { label: 'words + meaning', icon: Sparkles, tone: 'text-iris' },
} as const;

const KIND: Record<string, string> = {
  task: 'text-iris bg-iris/15',
  note: 'text-sky bg-sky/15',
  decision: 'text-sage bg-sage/15',
  finding: 'text-vermilion-2 bg-vermilion/15',
  message: 'text-amber bg-amber/15',
  doc: 'text-bone bg-white/15',
};

export function MemorySearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [mode, setMode] = useState<{ mode: 'hybrid' | 'words'; note: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Only the latest search may show its results: a slow earlier one never overwrites a later one.
  const latest = useRef(0);

  const go = async (text: string) => {
    if (text.trim().length < 2) return;
    const n = ++latest.current;
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/team/search?q=${encodeURIComponent(text)}`);
      const j = await r.json();
      if (n !== latest.current) return;
      if (!r.ok) throw new Error(j.error ?? 'Search failed');
      setHits(j.hits);
      setMode({ mode: j.mode, note: j.note });
    } catch (e) {
      if (n === latest.current) setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      if (n === latest.current) setBusy(false);
    }
  };

  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
      >
        <label className="sr-only" htmlFor="mem-q">
          Search what the team knows
        </label>
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input
            id="mem-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={200}
            placeholder="Search tasks, notes, decisions, findings and conversations… (typos are fine)"
            className="field w-full py-2.5 pl-9 pr-3 text-sm"
          />
        </div>
        <button className="btn btn-primary" disabled={busy || q.trim().length < 2}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {['dismissed', 'swelling amlodipine', 'water retention from blood pressure pills', 'dizziness falls', 'cough'].map((s) => (
          <button
            key={s}
            className="chip hover:text-bone"
            onClick={() => {
              setQ(s);
              go(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-vermilion-2">{error}</p>}
      {mode && (
        <p className="mt-3 flex items-start gap-2 text-[12.5px] text-dim" aria-live="polite">
          {mode.mode === 'hybrid' ? (
            <>
              <Sparkles size={13} className="mt-0.5 shrink-0 text-iris" />
              <span>
                Searched by <span className="text-bone-2">words</span> (full-text index), by <span className="text-bone-2">meaning</span> (Gemini
                embeddings in FalkorDB’s vector index) and through the <span className="text-bone-2">graph</span> (memories about the patients, drugs and
                symptoms you named rank higher).
              </span>
            </>
          ) : (
            <>
              <Type size={13} className="mt-0.5 shrink-0" />
              <span>{mode.note ?? 'Searched by words (full-text index) and through the graph.'}</span>
            </>
          )}
        </p>
      )}
      {hits && (
        <ul className="mt-4 divide-y divide-white/5">
          {hits.length === 0 && <li className="py-3 text-sm text-dim">Nothing in the team’s memory matches.</li>}
          {hits.map((h) => (
            <li key={`${h.kind}-${h.id}`} className="py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`mono rounded px-1.5 py-0.5 text-[10px] uppercase ${KIND[h.kind] ?? 'bg-white/10 text-dim'}`}>{h.kind}</span>
                {h.patientId ? (
                  <Link href={`/patients/${h.patientId}`} className="text-bone-2 hover:text-bone">
                    {h.patientName}
                  </Link>
                ) : (
                  <span className="text-bone-2">{h.patientName}</span>
                )}
                {h.status && <span className="text-dim">· {h.status}</span>}
                {h.by && <span className="text-dim">· {h.by}</span>}
                <span className="ml-auto flex items-center gap-2">
                  {h.linked && (
                    <span className="flex items-center gap-1 text-[10.5px] text-sage" title="Connected in the graph to something your question names">
                      <Waypoints size={11} /> linked
                    </span>
                  )}
                  {h.match &&
                    (() => {
                      const m = MATCH[h.match];
                      return (
                        <span className={`flex items-center gap-1 text-[10.5px] ${m.tone}`} title={`Found by ${m.label}`}>
                          <m.icon size={11} /> {m.label}
                        </span>
                      );
                    })()}
                  <span className="mono text-[10.5px] text-mute">{h.score.toFixed(3)}</span>
                </span>
              </div>
              <p className="mt-1 text-sm text-bone">{h.title}</p>
              {h.text && <p className="mt-0.5 line-clamp-2 text-[13px] text-dim">{h.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
