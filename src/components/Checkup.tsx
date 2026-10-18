'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CircleAlert, Loader2, Pill, ShieldCheck, Sparkles, Stethoscope, Trash2 } from 'lucide-react';
import { postJson } from '@/lib/client';
import { dayToLabel } from '@/data/time';

interface DrugHit {
  id: string;
  name: string;
  clsName: string;
  score: number;
}
interface Line {
  line: string;
  match: DrugHit | null;
  alternatives: DrugHit[];
  start: number | null;
  startText: string | null;
}
interface Cond {
  text: string;
  match: { id: string; name: string; plain: string; kind: string } | null;
}

const EXAMPLE = `Aleve since Jan 2024
Prilosec Jan 2024
Norvasc 10 mg Apr 2024
Lasix June 2024
Klor-Con July 2024
Ditropan Sept 2024
Aricept Feb 2025`;

export function Checkup() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [conds, setConds] = useState('');
  const [age, setAge] = useState(80);
  const [sex, setSex] = useState<'F' | 'M'>('F');
  const [lines, setLines] = useState<Line[] | null>(null);
  const [conditions, setConditions] = useState<Cond[]>([]);
  const [busy, setBusy] = useState<'parse' | 'build' | null>(null);
  const [error, setError] = useState('');

  const parse = async () => {
    setBusy('parse');
    setError('');
    try {
      const r = await postJson<{ meds: Line[]; conditions: Cond[] }>('/api/checkup/parse', { text, conditions: conds });
      setLines(r.meds);
      setConditions(r.conditions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the list.');
    } finally {
      setBusy(null);
    }
  };

  const chosen = (lines ?? []).filter((l) => l.match);
  const ids = chosen.map((l) => l.match!.id);
  const dupes = new Set(ids.filter((id, i) => ids.indexOf(id) !== i));
  const unique = chosen.filter((l, i) => ids.indexOf(l.match!.id) === i);

  const build = async () => {
    setBusy('build');
    setError('');
    try {
      const r = await postJson<{ pid: string }>('/api/checkup', {
        meds: unique.map((l) => ({ drug: l.match!.id, start: l.start })),
        conditions: conditions.filter((c) => c.match).map((c) => c.match!.id),
        age,
        sex,
        unchecked: (lines ?? []).filter((l) => !l.match).map((l) => l.line),
      });
      router.push(`/patients/${r.pid}?autorun=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the check-up.');
      setBusy(null);
    }
  };

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <section className="card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="meds" className="font-semibold">
              Medicines, one per line
            </label>
            <button
              className="btn btn-ghost text-xs"
              onClick={() => {
                setText(EXAMPLE);
                setConds('high blood pressure, arthritis, swollen ankles');
                setLines(null);
              }}
            >
              <Sparkles size={13} /> Try an example
            </button>
          </div>
          <p className="mt-1 text-xs text-dim">
            Brand or generic names, typos are fine. Add when each one started if you know it (“since March 2025”, “2024-06”, “6 months ago”).
          </p>
          <textarea
            id="meds"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setLines(null);
            }}
            rows={8}
            maxLength={2000}
            placeholder={'Norvasc 10 mg since March 2025\nLasix\nDitropan 6 months ago'}
            className="field mono mt-3 w-full p-3 text-[13px] leading-relaxed"
          />
          <label htmlFor="conds" className="mt-4 block text-sm font-medium">
            Diagnoses or symptoms <span className="text-dim">(optional)</span>
          </label>
          <input
            id="conds"
            value={conds}
            onChange={(e) => {
              setConds(e.target.value);
              setLines(null);
            }}
            maxLength={600}
            placeholder="high blood pressure, swollen ankles, confusion"
            className="field mt-2 w-full px-3 py-2 text-sm"
          />
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="block text-xs text-dim">Age</span>
              <input
                type="number"
                min={40}
                max={105}
                value={age}
                onChange={(e) => setAge(Number(e.target.value) || 80)}
                className="field mt-1 w-24 px-3 py-2"
              />
            </label>
            <div className="text-sm" role="group" aria-labelledby="sex-label">
              <span id="sex-label" className="block text-xs text-dim">
                Sex
              </span>
              <div className="mt-1 inline-flex rounded-xl border hairline bg-black/25 p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]">
                {(['F', 'M'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSex(s)}
                    aria-pressed={sex === s}
                    className={`rounded-lg px-3.5 py-1.5 text-sm transition-colors ${sex === s ? 'bg-white/10 text-bone shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-dim hover:text-bone'}`}
                  >
                    {s === 'F' ? 'Female' : 'Male'}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-primary ml-auto" onClick={parse} disabled={busy !== null || text.trim().length < 3}>
              {busy === 'parse' ? <Loader2 size={15} className="animate-spin" /> : <Pill size={15} />} Read my list
            </button>
          </div>
        </section>

        {lines && (
          <section className="card p-5 sm:p-6">
            <h2 className="font-semibold">What Domino found in the graph</h2>
            <p className="mt-1 text-xs text-dim">
              Each line matched with FalkorDB’s full-text index over drug names, brand names and plain aliases. Remove anything that is wrong.
            </p>
            <ul className="mt-4 divide-y divide-white/5">
              {lines.map((l, i) => (
                <li key={i} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-dim">{l.line}</span>
                  {l.match ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {l.alternatives.length > 0 ? (
                        <select
                          aria-label={`Medicine for "${l.line}"`}
                          value={l.match.id}
                          onChange={(e) => {
                            const all = [l.match!, ...l.alternatives];
                            const pick = all.find((a) => a.id === e.target.value)!;
                            setLines(lines.map((x, j) => (j === i ? { ...x, match: pick, alternatives: all.filter((a) => a.id !== pick.id) } : x)));
                          }}
                          className="rounded-lg border hairline bg-ink-3 px-2 py-1 text-sm"
                        >
                          {[l.match, ...l.alternatives].map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`rounded-lg px-2 py-1 text-sm ${dupes.has(l.match.id) && ids.indexOf(l.match.id) !== chosen.indexOf(l) ? 'bg-white/5 text-dim line-through' : 'bg-sage/15 text-sage'}`}
                        >
                          {l.match.name}
                        </span>
                      )}
                      <span className="text-[11px] text-dim">{l.match.clsName}</span>
                      <span className={`mono text-[11px] ${l.start != null ? 'text-bone-2' : 'text-amber'}`}>
                        {l.start != null ? `from ${dayToLabel(l.start)}` : 'date assumed from order'}
                      </span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[12.5px] text-amber">
                      <CircleAlert size={13} /> not one of the 116 drugs in Domino’s graph
                    </span>
                  )}
                  <button className="btn btn-ghost px-2" aria-label={`Remove ${l.line}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
            {conditions.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {conditions.map((c, i) =>
                  c.match ? (
                    <span key={i} className="chip" title={c.text}>
                      {c.match.plain} <span className="text-mute">({c.match.kind})</span>
                    </span>
                  ) : (
                    <span key={i} className="chip text-amber">
                      “{c.text}” not recognised
                    </span>
                  ),
                )}
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-dim">
                {unique.length} medicine{unique.length === 1 ? '' : 's'} recognised
                {dupes.size ? ` (${dupes.size} duplicate${dupes.size === 1 ? '' : 's'} merged)` : ''}.
              </p>
              <button className="btn btn-hot" onClick={build} disabled={busy !== null || unique.length < 2}>
                {busy === 'build' ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} Build the graph and run the agents
              </button>
            </div>
          </section>
        )}
        {error && <p className="text-sm text-vermilion-2">{error}</p>}
      </div>

      <aside className="space-y-4">
        <div className="card p-5">
          <ShieldCheck className="text-sage" size={20} />
          <h2 className="mt-2 font-semibold">Private by design</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-bone-2">
            <li>No names, no dates of birth. Just medicines.</li>
            <li>The check-up patient lives in this clinic’s graph for 2 hours, then it and everything the agents wrote about it are deleted.</li>
            <li>It never appears in the patient list, the population, the inbox or anyone’s search.</li>
          </ul>
        </div>
        <div className="card p-5">
          <Stethoscope className="text-vermilion-2" size={20} />
          <h2 className="mt-2 font-semibold">What happens next</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-bone-2">
            <li>The list becomes TAKES edges on a temporary patient node.</li>
            <li>The Detective, Pharmacist and Scribe review it, exactly as for any patient.</li>
            <li>You see the dominoes, the evidence, the what-if and the questions to bring to a pharmacist.</li>
          </ol>
          <p className="mt-3 text-xs text-dim">
            Domino raises questions; it never tells anyone to stop or change a medicine. Talk to a pharmacist or doctor before changing anything.
          </p>
        </div>
      </aside>
    </div>
  );
}
