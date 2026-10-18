'use client';
import { useEffect, useState } from 'react';

interface Health {
  db: { ok: boolean; ms?: number; error?: string };
  seeded: boolean;
  agent: string;
  devSecret: boolean;
}

export function StatusPill() {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/health')
        .then((r) => r.json())
        .then((j) => alive && setH(j))
        .catch(() => alive && setH({ db: { ok: false, error: 'offline' }, seeded: false, agent: '', devSecret: false }));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!h)
    return (
      <span className="chip hidden sm:inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-mute pulse-dot" />
        Connecting
      </span>
    );
  const ok = h.db.ok && h.seeded;
  const llm = h.agent && !h.agent.startsWith('Graph planner');
  return (
    <span
      className="chip hidden sm:inline-flex"
      title={
        ok
          ? `FalkorDB connected (${h.db.ms} ms). Agents: ${h.agent}`
          : h.db.ok
            ? 'FalkorDB is up but the graph is empty: run npm run seed'
            : `FalkorDB unreachable: ${h.db.error}`
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-sage' : 'bg-vermilion pulse-dot'}`} />
      <span className="mono text-[11px]">{ok ? 'FalkorDB' : h.db.ok ? 'Graph empty' : 'FalkorDB offline'}</span>
      <span className="sr-only">, agents: {llm ? (h.agent.split(':')[1] ?? h.agent) : 'graph planner'}</span>
    </span>
  );
}
