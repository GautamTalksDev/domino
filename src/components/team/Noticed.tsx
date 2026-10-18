'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, Eye, ShieldAlert, Siren } from 'lucide-react';

export interface NoteSignal {
  pid: string;
  patient: string;
  drug: string;
  drugName: string;
  effect: string;
  effectName: string;
  effectPlain: string;
  freq: string;
  kind: 'in_progress' | 'prevention';
  pattern: { id: string; title: string } | null;
  treatedWith: { id: string; name: string; start: number }[];
  link: { key: string; tier: string; score: number } | null;
  headline: string;
  task: { id: string; title: string; role: string; status: 'proposed' | 'existing' | 'skipped'; reason?: string } | null;
}

const KIND = {
  in_progress: { label: 'Cascade in progress', icon: Siren, tone: 'border-vermilion/35 bg-vermilion/[0.08] text-vermilion-2' },
  prevention: { label: 'Prevention window', icon: ShieldAlert, tone: 'border-sage/35 bg-sage/[0.08] text-sage' },
} as const;

const Tile = ({ name, hot, ghost }: { name: string; hot?: boolean; ghost?: boolean }) => (
  <span
    className={`font-display max-w-[120px] truncate rounded-lg px-2 py-1 text-[12.5px] font-semibold ${
      ghost
        ? 'border border-dashed border-white/25 text-dim'
        : `bg-[#f4ecdd] text-[#17151a] ${hot ? 'shadow-[0_0_0_1.5px_rgba(255,91,58,0.85),0_6px_18px_-6px_rgba(255,91,58,0.55)]' : ''}`
    }`}
  >
    {name}
  </span>
);

/** What the Detective made of a note: the patient's drug that causes the symptom it reports, and what happened next. */
export function Noticed({ signals }: { signals: NoteSignal[] }) {
  if (!signals.length) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="mt-3 rounded-2xl border border-iris/25 bg-iris/[0.05] p-3.5"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-iris">
        <Eye size={13} /> Domino noticed
        <span className="mono font-normal text-mute">· the Detective read this note against the graph</span>
      </p>
      <ul className="mt-2.5 grid gap-2.5">
        {signals.map((s) => {
          const K = KIND[s.kind];
          return (
            <li key={`${s.pid}-${s.drug}-${s.effect}`} className="rounded-xl border hairline bg-ink/50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${K.tone}`}>
                  <K.icon size={11} /> {K.label}
                </span>
                <Link href={`/patients/${s.pid}`} className="font-medium text-bone-2 underline-offset-2 hover:text-bone hover:underline">
                  {s.patient}
                </Link>
                {s.link && (
                  <span className="mono text-[10.5px] text-mute">
                    {s.link.tier} · {s.link.score.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2" aria-hidden>
                <Tile name={s.drugName} hot />
                <span className="flex items-center gap-1 text-[11px] text-bone-2">
                  <span className="h-px w-5 bg-vermilion" />
                  {s.effectPlain.toLowerCase()}
                  <ArrowRight size={12} className="text-vermilion" />
                </span>
                {s.kind === 'in_progress' ? s.treatedWith.map((t) => <Tile key={t.id} name={t.name} />) : <Tile name="not treated yet" ghost />}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-bone-2">{s.headline}</p>
              {s.pattern && <p className="mt-1 text-xs text-vermilion-2">Documented: {s.pattern.title}</p>}
              {s.task && (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t hairline pt-2.5 text-xs">
                  <span className="text-dim">
                    {s.task.status === 'proposed' ? (
                      <>
                        Proposed a signed review task for the <span className="text-bone-2">{s.task.role}</span>: “{s.task.title}”
                      </>
                    ) : s.task.status === 'existing' ? (
                      <>Already in the inbox: “{s.task.title}”. This note is now linked to it as evidence.</>
                    ) : (
                      s.task.reason
                    )}
                  </span>
                  {s.task.status !== 'skipped' && (
                    <Link href="/inbox" className="inline-flex items-center gap-1 text-iris hover:text-bone">
                      Open the inbox <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}
