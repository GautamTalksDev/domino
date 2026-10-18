'use client';
import { useEffect, useState } from 'react';
import { Check, Loader2, Minus, Play, X } from 'lucide-react';
import { postJson } from '@/lib/client';
import type { Comparison, Side } from '@/lib/compare';

// The judging question, answered live: the same model, the same record, with and without FalkorDB.

function Mark({ ok, partial }: { ok: boolean; partial?: boolean }) {
  if (partial) return <Minus size={15} className="mt-0.5 shrink-0 text-amber" aria-label="partly" />;
  return ok ? <Check size={15} className="mt-0.5 shrink-0 text-sage" aria-label="yes" /> : <X size={15} className="mt-0.5 shrink-0 text-vermilion" aria-label="no" />;
}

function Row({ title, graph, plain }: { title: string; graph: React.ReactNode; plain: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t hairline py-3 sm:grid-cols-[200px_1fr_1fr] sm:gap-6">
      <p className="text-[13px] text-dim">{title}</p>
      <div className="flex items-start gap-2 text-[13px] text-bone-2">
        <span className="mono w-16 shrink-0 text-[10px] uppercase leading-5 text-vermilion-2 sm:hidden">Without</span>
        {plain}
      </div>
      <div className="flex items-start gap-2 text-[13px] text-bone-2">
        <span className="mono w-16 shrink-0 text-[10px] uppercase leading-5 text-sage sm:hidden">With</span>
        {graph}
      </div>
    </div>
  );
}

const of = (n: number, d: number) => `${n} of ${d}`;

function Links({ s, total }: { s: Side; total: number }) {
  const n = s.links.found.length;
  return (
    <>
      <Mark ok={n === total} partial={n > 0 && n < total} />
      <span>
        <span className="text-bone">{of(n, total)}</span>
        {s.links.missed.length > 0 && <span className="block text-dim">missed {s.links.missed.join(', ')}</span>}
      </span>
    </>
  );
}

export function GraphVsPlain() {
  const [c, setC] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/compare')
      .then((r) => r.json())
      .then((j) => j.comparison && setC(j.comparison))
      .catch(() => {});
  }, []);

  const runIt = async () => {
    setBusy(true);
    setError('');
    try {
      const j = await postJson<{ comparison: Comparison }>('/api/compare', { patientId: 'p-beatrice' });
      setC(j.comparison);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'It did not run. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  };

  const total = c ? c.graph.links.found.length : 0;
  const plainScore = c ? c.plain.links.found.length + c.plain.loop.found + c.plain.combos.found.length + (c.plain.unknown.honest ? 1 : 0) : 0;
  const max = c ? total + c.graph.loop.expected + c.graph.combos.expected.length + 1 : 0;
  const notBacked = c ? c.plain.links.unsupported.length + c.plain.links.plannedFlagged.length : 0;

  return (
    <section className="mt-20" aria-labelledby="vs-title">
      <p className="kicker">The judging question, answered live</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <h2 id="vs-title" className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
          Same question. Same model. <span className="italic text-vermilion">One has a graph.</span>
        </h2>
        <button onClick={runIt} disabled={busy} className="btn btn-hot">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {busy ? 'Asking both… about 20 s' : 'Run it live'}
        </button>
      </div>
      <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-bone-2">
        The language model gets Beatrice’s whole record as text, every medicine with its start date and reason, and no FalkorDB. Domino’s agents get the
        graph. Both are asked the same thing, and a medicine that does not exist is slipped into the question.
      </p>

      <div className="card mt-6 p-5 sm:p-6">
        {!c && !busy && <p className="py-8 text-center text-sm text-dim">Press “Run it live” to ask both, right now. Nothing on this card is pre-written.</p>}
        {busy && !c && <p className="py-8 text-center text-sm text-dim">Asking the model without the graph, and the graph without the model…</p>}
        {c && (
          <>
            <p className="text-[13px] italic text-dim">“{c.question}”</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[200px_1fr_1fr] sm:gap-6">
              <span />
              <div className="rounded-xl border border-vermilion/25 bg-vermilion/[0.05] p-3">
                <p className="mono text-[10.5px] uppercase tracking-wide text-vermilion-2">Without the graph</p>
                <p className="mt-1 font-display text-3xl font-semibold">{of(plainScore, max)}</p>
                <p className="text-[12px] text-dim">
                  {c.model.split(':')[1] ?? c.model} from memory{notBacked ? ` · ${notBacked} claim${notBacked === 1 ? '' : 's'} the graph does not back` : ''}
                </p>
              </div>
              <div className="rounded-xl border border-sage/25 bg-sage/[0.05] p-3">
                <p className="mono text-[10.5px] uppercase tracking-wide text-sage">With FalkorDB</p>
                <p className="mt-1 font-display text-3xl font-semibold">{of(max, max)}</p>
                <p className="text-[12px] text-dim">
                  every answer traced to its path · {c.graph.queries} graph queries, {c.graph.ms} ms
                </p>
              </div>
            </div>
            <div className="mt-4">
              <Row title="Cascade links in her record" plain={<Links s={c.plain} total={total} />} graph={<Links s={c.graph} total={total} />} />
              <Row
                title="Feedback loop"
                plain={
                  <>
                    <Mark ok={c.plain.loop.found === c.plain.loop.expected} />
                    {c.plain.loop.expected ? of(c.plain.loop.found, c.plain.loop.expected) : 'none expected'}
                  </>
                }
                graph={
                  <>
                    <Mark ok />
                    {c.graph.loop.expected ? `${of(c.graph.loop.found, c.graph.loop.expected)}, a cycle query` : 'none'}
                  </>
                }
              />
              <Row
                title="Dangerous combinations"
                plain={
                  <>
                    <Mark ok={c.plain.combos.found.length === c.plain.combos.expected.length} partial={c.plain.combos.found.length > 0 && c.plain.combos.found.length < c.plain.combos.expected.length} />
                    <span>
                      {of(c.plain.combos.found.length, c.plain.combos.expected.length)}
                      {c.plain.combos.found.length < c.plain.combos.expected.length && (
                        <span className="block text-dim">missed {c.plain.combos.expected.filter((x) => !c.plain.combos.found.includes(x)).join(', ')}</span>
                      )}
                    </span>
                  </>
                }
                graph={
                  <>
                    <Mark ok />
                    <span>{c.graph.combos.found.join(', ') || 'none'}</span>
                  </>
                }
              />
              <Row
                title="Zorbaxapril, a medicine that does not exist"
                plain={
                  <>
                    <Mark ok={c.plain.unknown.honest} />
                    <span>
                      {c.plain.unknown.honest ? 'said it does not know' : `answered “${c.plain.unknown.verdict}”`}
                      {c.plain.unknown.text && <span className="block text-dim">“{c.plain.unknown.text}”</span>}
                    </span>
                  </>
                }
                graph={
                  <>
                    <Mark ok />
                    <span>Not in the graph, so not checked. Not in the graph is not the same as safe.</span>
                  </>
                }
              />
              {notBacked > 0 && (
                <Row
                  title="Claims the graph does not back"
                  plain={
                    <>
                      <Mark ok={false} />
                      <span>
                        {[...c.plain.links.unsupported, ...c.plain.links.plannedFlagged.map((x) => `${x} (a planned pairing)`)].join('; ')}
                      </span>
                    </>
                  }
                  graph={
                    <>
                      <Mark ok />
                      <span>Each link is a path in the graph with its timing, other reasons and citation.</span>
                    </>
                  }
                />
              )}
            </div>
            <div className="mt-4 grid gap-2 border-t hairline pt-4 text-[12px] text-dim sm:grid-cols-2">
              <details>
                <summary className="cursor-pointer text-bone-2">The exact prompt the model got</summary>
                <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed">{c.plain.prompt}</pre>
              </details>
              <details>
                <summary className="cursor-pointer text-bone-2">Its answer, unedited</summary>
                <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed">{c.plain.raw}</pre>
                {c.plain.parseError && <p className="mt-1 text-amber">Could not read the answer as JSON ({c.plain.parseError}); scored as empty.</p>}
              </details>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-mute">
              Scored against what the graph shows from her record and its cited knowledge, so the graph column is the reference, not a contestant. Read the
              model’s own answer and decide for yourself. Run {new Date(c.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              , live, nothing pre-written. Synthetic patient.
            </p>
          </>
        )}
        {error && <p className="mt-3 rounded-lg bg-vermilion/10 px-3 py-2 text-[13px] text-vermilion-2">{error}</p>}
      </div>
    </section>
  );
}
