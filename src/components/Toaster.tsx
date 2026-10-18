'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Brain, CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { onToast, type Toast } from '@/lib/toast';

const TONE = {
  ok: { icon: CircleCheck, ring: 'ring-sage/25', color: 'text-sage' },
  info: { icon: Info, ring: 'ring-sky/25', color: 'text-sky' },
  learn: { icon: Brain, ring: 'ring-iris/35', color: 'text-iris' },
  error: { icon: CircleAlert, ring: 'ring-vermilion/30', color: 'text-vermilion-2' },
} as const;

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(
    () =>
      onToast((t) => {
        setItems((xs) => [...xs.slice(-3), t]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === 'learn' ? 9000 : t.tone === 'error' ? 7000 : 4500);
      }),
    [],
  );
  return (
    <div aria-live="polite" className="no-print pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {items.map((t) => {
          const tone = TONE[t.tone ?? 'ok'];
          const Icon = tone.icon;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className={`pointer-events-auto flex gap-3 rounded-2xl border hairline bg-ink-3/95 p-3.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] ring-1 backdrop-blur-xl ${tone.ring}`}
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${tone.color}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-bone">{t.title}</p>
                {t.body && <p className="mt-0.5 text-[13px] leading-snug text-dim">{t.body}</p>}
                {t.href && (
                  <Link href={t.href} className="mt-1.5 inline-block text-xs text-vermilion-2 hover:text-vermilion">
                    {t.hrefLabel ?? 'Open'} →
                  </Link>
                )}
              </div>
              <button
                className="self-start rounded-md p-0.5 text-mute hover:text-bone"
                aria-label="Dismiss"
                onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
