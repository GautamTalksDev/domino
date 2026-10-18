'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Radar } from 'lucide-react';
import { streamPost } from '@/lib/client';

export function SweepButton() {
  const router = useRouter();
  const [state, setState] = useState<{ running: boolean; done: number; total: number; msg: string }>({ running: false, done: 0, total: 0, msg: '' });
  const go = async () => {
    setState({ running: true, done: 0, total: 0, msg: '' });
    try {
      await streamPost('/api/population/sweep', {}, (e) => {
        if (e.type === 'progress') setState((s) => ({ ...s, done: Number(e.done), total: Number(e.total) }));
        if (e.type === 'done')
          setState((s) => ({
            ...s,
            msg: `${e.withLikely} of ${e.patients} patients with a likely cascade · ${e.findings} findings written · ${e.tasks} tasks proposed · ${(Number(e.ms) / 1000).toFixed(1)} s`,
          }));
        if (e.type === 'error') setState((s) => ({ ...s, msg: String(e.message) }));
      });
      router.refresh();
    } catch (err) {
      setState((s) => ({ ...s, msg: err instanceof Error ? err.message : 'Sweep failed' }));
    } finally {
      setState((s) => ({ ...s, running: false }));
    }
  };
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button className="btn btn-hot" onClick={go} disabled={state.running}>
        {state.running ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />}
        {state.running ? `Sweeping ${state.done}/${state.total || '…'}` : 'Run the population sweep'}
      </button>
      {state.msg && <p className="mono text-xs text-dim">{state.msg}</p>}
    </div>
  );
}
