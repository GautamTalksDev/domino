'use client';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

const CHAIN = [
  { name: 'Amlodipine', sub: 'blood pressure', effect: 'ankle swelling' },
  { name: 'Furosemide', sub: 'for the swelling', effect: 'leaking urine' },
  { name: 'Oxybutynin', sub: 'for the bladder', effect: 'confusion' },
  { name: 'Donepezil', sub: 'for the memory', effect: '' },
];

const PIP_SETS = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8]];

export function HeroDominoes() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<'stand' | 'fall'>('stand');
  useEffect(() => {
    if (reduce) return;
    const t1 = setTimeout(() => setPhase('fall'), 1200);
    const loop = setInterval(() => {
      setPhase('stand');
      setTimeout(() => setPhase('fall'), 1400);
    }, 6200);
    return () => {
      clearTimeout(t1);
      clearInterval(loop);
    };
  }, [reduce]);

  return (
    <div
      className="relative"
      aria-label="Animation: amlodipine causes ankle swelling, treated with furosemide, which causes leaking urine, treated with oxybutynin, which causes confusion, treated with donepezil."
    >
      <div className="flex items-end gap-0">
        {CHAIN.map((d, i) => (
          <div key={d.name} className="flex items-end">
            <motion.div
              className={`tile ${i === 0 ? 'is-root' : ''}`}
              style={{ transformOrigin: '92% 100%' }}
              animate={
                phase === 'fall'
                  ? {
                      rotate: i === CHAIN.length - 1 ? 9 : 15,
                      boxShadow: '0 0 0 2px #ff5b3a, 0 0 40px -6px rgba(255,91,58,.7), 0 14px 30px -12px rgba(0,0,0,.65)',
                    }
                  : { rotate: 0 }
              }
              transition={{ type: 'spring', stiffness: 180, damping: 14, delay: phase === 'fall' ? i * 0.32 : (CHAIN.length - i) * 0.08 }}
            >
              <div className="tile-top">
                <div>
                  <div className="font-display text-[15px] font-semibold leading-tight">{d.name}</div>
                  <div className="mt-1 text-[10.5px] leading-tight text-[#5b5650]">{d.sub}</div>
                </div>
              </div>
              <div className="tile-split" />
              <div className="tile-bottom">
                {Array.from({ length: 9 }, (_, k) => (
                  <span key={k} className={PIP_SETS[i].includes(k) ? `pip ${i === 0 ? 'pip-root' : ''}` : ''} />
                ))}
              </div>
            </motion.div>
            {d.effect && (
              <div className="mx-2 mb-7 flex w-[96px] flex-col items-center">
                <svg width="88" height="12" viewBox="0 0 88 12" aria-hidden>
                  <line x1="2" y1="6" x2="80" y2="6" stroke="#ff5b3a" strokeWidth="2" strokeLinecap="round" opacity={0.85} />
                  <path d="M78 2 L85 6 L78 10" stroke="#ff5b3a" strokeWidth="2" fill="none" strokeLinecap="round" />
                </svg>
                <motion.span
                  className="mt-1.5 text-center text-[12px] font-medium leading-tight text-vermilion-2"
                  animate={{ opacity: phase === 'fall' ? 1 : 0.4 }}
                  transition={{ delay: phase === 'fall' ? i * 0.32 + 0.2 : 0 }}
                >
                  {d.effect}
                </motion.span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
