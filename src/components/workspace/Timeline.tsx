'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, FastForward, Flag, Loader2, Play, RotateCcw } from 'lucide-react';
import type { Analysis } from '@/lib/engine/types';
import type { PatientReplay } from '@/lib/engine/replay';
import { dayToLabel, dayToShort, EPOCH_UTC, TODAY_DAY } from '@/data/time';

const ROW = 38;
const LABEL_W = 170;
const W = 900;
const DURATION = 7000;

export function Timeline({ analysis, patientId }: { analysis: Analysis; patientId: string }) {
  const meds = analysis.patient.meds;
  const active = analysis.links.filter((l) => l.tier === 'likely' || l.tier === 'possible' || l.tier === 'intentional');
  const roots = new Set(analysis.trees.map((t) => t.root));
  const downstream = new Set(analysis.trees.flatMap((t) => t.downstream));
  const planned = new Set(active.filter((l) => l.tier === 'intentional').map((l) => l.to));

  const [replay, setReplay] = useState<PatientReplay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const raf = useRef<number | null>(null);

  const { x, ticks, start } = useMemo(() => {
    const min = Math.min(...meds.map((m) => m.start), TODAY_DAY - 365);
    const s = Math.max(min, -420) - 30;
    const scale = (d: number) => LABEL_W + ((Math.max(d, s) - s) / (TODAY_DAY - s)) * (W - LABEL_W - 16);
    const t: { day: number; label: string }[] = [];
    for (let y = 2022; y <= 2026; y++) {
      for (const m of [0, 6]) {
        const day = Math.round((Date.UTC(y, m, 1) - EPOCH_UTC) / 86_400_000);
        if (day >= s && day <= TODAY_DAY) t.push({ day, label: dayToShort(day) });
      }
    }
    return { x: scale, ticks: t, start: s };
  }, [meds]);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  useEffect(() => stop, []);

  const animate = useCallback(
    (r: PatientReplay) => {
      stop();
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) return setCursor(TODAY_DAY);
      const from = start;
      const pauses = r.catches.map((c) => c.start);
      let t0 = performance.now();
      let paused = 0;
      let hold: number | null = null;
      const tick = (now: number) => {
        if (hold !== null) {
          if (now - hold < 1400) {
            raf.current = requestAnimationFrame(tick);
            return;
          }
          paused += now - hold;
          hold = null;
        }
        const p = Math.min(1, (now - t0 - paused) / DURATION);
        const day = from + (TODAY_DAY - from) * p;
        // Hold briefly on each catch so a viewer can read it.
        const crossed = pauses.find((d) => d <= day && d > (cursorRef.current ?? -Infinity));
        cursorRef.current = day;
        setCursor(day);
        if (crossed !== undefined) hold = now;
        if (p < 1) raf.current = requestAnimationFrame(tick);
      };
      t0 = performance.now();
      cursorRef.current = null;
      raf.current = requestAnimationFrame(tick);
    },
    [start],
  );
  const cursorRef = useRef<number | null>(null);

  const play = async () => {
    setError('');
    if (replay) return animate(replay);
    setLoading(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/replay`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Replay failed');
      setReplay(j);
      animate(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replay failed');
    } finally {
      setLoading(false);
    }
  };

  const rowOf = new Map(meds.map((m, i) => [m.id, i]));
  const H = meds.length * ROW + 50;
  const replaying = replay && cursor !== null;
  const avoidable = new Set(replay?.avoidable.map((a) => a.id) ?? []);
  const eventOf = new Map(replay?.events.map((e) => [e.drug, e]) ?? []);
  const passed = (d: number) => !replaying || d <= (cursor ?? 0);
  const caught = replay?.catches.filter((c) => passed(c.start)) ?? [];
  const done = replaying && (cursor ?? 0) >= TODAY_DAY - 1;
  const avoidedNow = new Set(caught.flatMap((c) => c.avoidable.map((a) => a.id)));

  return (
    <div className="mt-6 space-y-4">
      <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Replay with Domino at the prescriber’s desk</p>
          <p className="mt-0.5 text-sm text-dim">
            Every prescription re-checked the day it was written, with only what was on record then. Where the check would have stopped a cascade, the drugs
            that followed fade out.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn btn-hot" onClick={play} disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : replay ? <RotateCcw size={15} /> : <Play size={15} />}{' '}
            {replay ? 'Replay again' : 'Play the replay'}
          </button>
          {replaying && !done && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                stop();
                setCursor(TODAY_DAY);
              }}
              aria-label="Skip to the end"
            >
              <FastForward size={15} />
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-vermilion-2">{error}</p>}

      <div className="card overflow-x-auto p-5">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-dim">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-sm border-2 border-vermilion" /> root drug
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-sm bg-vermilion/50" /> started after a side effect
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-sm bg-iris/50" /> planned companion
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-sm bg-white/15" /> other medicine
          </span>
          {replay && (
            <>
              <span className="flex items-center gap-1.5">
                <Flag size={12} className="text-vermilion" /> Domino would have stopped
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber" /> caution
              </span>
            </>
          )}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[760px]" role="img" aria-label={`Medication timeline for ${analysis.patient.name}`}>
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(244,239,228,0.25)" strokeWidth="2" />
            </pattern>
          </defs>
          {ticks.map((t) => (
            <g key={t.day}>
              <line x1={x(t.day)} x2={x(t.day)} y1={8} y2={H - 26} stroke="rgba(244,239,228,0.06)" />
              <text x={x(t.day)} y={H - 8} textAnchor="middle" fontSize="10.5" fill="#6f6b64" fontFamily="var(--font-geist-mono)">
                {t.label}
              </text>
            </g>
          ))}
          <line x1={x(TODAY_DAY)} x2={x(TODAY_DAY)} y1={8} y2={H - 26} stroke="rgba(108,196,255,0.4)" strokeDasharray="3 3" />
          {replaying && <line x1={x(cursor!)} x2={x(cursor!)} y1={4} y2={H - 26} stroke="rgba(244,239,228,0.5)" strokeWidth={1.5} />}
          {caught.map((c) => (
            <g key={`c-${c.drug}`}>
              <line x1={x(c.start)} x2={x(c.start)} y1={4} y2={H - 26} stroke="#ff5b3a" strokeWidth={1.5} strokeDasharray="5 4" />
            </g>
          ))}
          {meds.map((m, i) => {
            const y = 16 + i * ROW;
            const isRoot = roots.has(m.id);
            const isDown = downstream.has(m.id) && !planned.has(m.id);
            const isPlanned = planned.has(m.id);
            const fill = isDown ? 'rgba(255,91,58,0.45)' : isPlanned ? 'rgba(165,150,255,0.45)' : isRoot ? 'rgba(255,91,58,0.12)' : 'rgba(244,239,228,0.12)';
            const visible = passed(m.start);
            const gone = avoidedNow.has(m.id);
            const end = replaying ? Math.min(cursor!, TODAY_DAY) : TODAY_DAY;
            const ev = eventOf.get(m.id);
            return (
              <g key={m.id} opacity={visible ? 1 : 0.18}>
                <text
                  x={0}
                  y={y + 14}
                  fontSize="12.5"
                  fill={gone ? '#6f6b64' : isRoot || isDown ? '#f4efe4' : '#a39e93'}
                  fontWeight={isRoot ? 600 : 400}
                  textDecoration={gone ? 'line-through' : undefined}
                >
                  {m.name}
                </text>
                <text x={0} y={y + 27} fontSize="9.5" fill="#6f6b64" fontFamily="var(--font-geist-mono)">
                  {gone ? 'might not have been needed' : m.start < start ? `before ${dayToShort(start)}` : dayToLabel(m.start)}
                </text>
                {visible && (
                  <rect
                    x={x(m.start)}
                    y={y + 3}
                    width={Math.max(4, x(Math.max(end, m.start)) - x(m.start))}
                    height={18}
                    rx={6}
                    fill={gone ? 'url(#hatch)' : fill}
                    stroke={gone ? 'rgba(244,239,228,0.25)' : isRoot ? '#ff5b3a' : 'none'}
                    strokeWidth={gone ? 1 : 2}
                    opacity={gone ? 0.6 : 1}
                  >
                    <title>{`${m.name} ${m.dose}, from ${dayToLabel(m.start)}, ${m.prescriber}${ev ? `. Domino at the time: ${ev.headline}` : ''}`}</title>
                  </rect>
                )}
                {replay && visible && ev && ev.verdict !== 'clear' && (
                  <g transform={`translate(${x(m.start) - 7}, ${y + 12})`}>
                    {ev.cascadeStop ? (
                      <>
                        <circle r={8} fill="#ff5b3a" />
                        <path d="M -2.5 4 L -2.5 -4.5 L 3.5 -2.5 L -2.5 -0.5" fill="none" stroke="#0d0c10" strokeWidth={1.6} strokeLinejoin="round" />
                      </>
                    ) : (
                      <circle r={4} fill={ev.verdict === 'stop_and_check' ? '#ff8a6f' : '#f2b544'} />
                    )}
                    <title>{ev.headline}</title>
                  </g>
                )}
              </g>
            );
          })}
          {!replaying &&
            active.map((l) => {
              const ra = rowOf.get(l.from);
              const rb = rowOf.get(l.to);
              if (ra == null || rb == null) return null;
              const xa = x(l.fromStart) + 4;
              const ya = 16 + ra * ROW + 12;
              const xb = x(l.toStart);
              const yb = 16 + rb * ROW + 12;
              const color = l.tier === 'likely' ? '#ff5b3a' : l.tier === 'possible' ? '#f2b544' : '#a596ff';
              const mx = (xa + xb) / 2;
              return (
                <g key={l.key + l.effect}>
                  <path
                    d={`M ${xa} ${ya} C ${xa + 24} ${ya}, ${xb - 30} ${yb}, ${xb - 4} ${yb}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.8}
                    strokeDasharray={l.tier === 'likely' ? undefined : '4 3'}
                    opacity={0.9}
                  />
                  <circle cx={xa} cy={ya} r={3} fill={color} />
                  <path d={`M ${xb - 9} ${yb - 4} L ${xb - 3} ${yb} L ${xb - 9} ${yb + 4}`} fill="none" stroke={color} strokeWidth={1.8} />
                  <text x={mx} y={(ya + yb) / 2 - 4} textAnchor="middle" fontSize="10" fill={color}>
                    {l.effectPlain.toLowerCase()}
                  </text>
                </g>
              );
            })}
        </svg>
        <p className="mt-2 text-xs text-mute">
          {replaying
            ? `Replay cursor: ${dayToLabel(Math.round(Math.min(cursor!, TODAY_DAY)))}. Hover a marker for what the prescriber check would have said that day.`
            : `Each arc runs from when a drug started to when the drug that treats its side effect started. The synthetic record runs to ${dayToLabel(TODAY_DAY)}.`}
        </p>
      </div>

      {replaying && caught.length > 0 && (
        <div className="space-y-3">
          {caught.map((c) => (
            <div key={c.drug} className="card border-vermilion/30 p-5">
              <p className="kicker text-vermilion-2">
                {dayToLabel(c.start)} · the day {c.name.toLowerCase()} was written
              </p>
              <p className="mt-1.5 text-bone">
                <Flag size={14} className="mr-1.5 inline text-vermilion" />
                {c.headline}
              </p>
              {c.question && (
                <p className="mt-2 flex items-start gap-2 text-sm text-bone-2">
                  <CircleHelp size={15} className="mt-0.5 shrink-0 text-vermilion-2" /> {c.question}
                </p>
              )}
              <p className="mt-2 text-sm text-dim">
                If the prescriber had asked that question then: {c.avoidable.map((a) => a.name).join(', ')} might never have been written ({c.avoidable.length}{' '}
                prescription{c.avoidable.length === 1 ? '' : 's'}).
              </p>
            </div>
          ))}
          {done && replay && (
            <p className="text-sm text-bone-2">
              In this replay Domino would have stopped {replay.catches.length} cascade{replay.catches.length === 1 ? '' : 's'} at the point of prescribing, and{' '}
              {analysis.patient.name.split(' ')[0]} would take {meds.length - replay.avoidable.length} medicines instead of {meds.length}. A replay on synthetic
              data, not a claim about one real person.
            </p>
          )}
        </div>
      )}
      {done && replay && replay.catches.length === 0 && (
        <p className="text-sm text-dim">No prescription in this record would have triggered a cascade stop at the time it was written.</p>
      )}
    </div>
  );
}
