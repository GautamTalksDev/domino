'use client';
import { useMemo, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { Analysis } from '@/lib/engine/types';

interface N extends SimulationNodeDatum {
  id: string;
  label: string;
  kind: 'drug' | 'effect';
  role?: 'root' | 'down' | 'other';
  effectKind?: string;
}
interface E extends SimulationLinkDatum<N> {
  type: 'CAUSES' | 'TREATED_BY';
  hot: boolean;
  tier?: string;
}

const W = 880;
const H = 560;

export function PatientGraph({ analysis }: { analysis: Analysis }) {
  const [hover, setHover] = useState<string | null>(null);
  const { nodes, edges } = useMemo(() => {
    const roots = new Set(analysis.trees.map((t) => t.root));
    const down = new Set(analysis.trees.flatMap((t) => t.downstream));
    const nodes = new Map<string, N>();
    for (const m of analysis.patient.meds)
      nodes.set(m.id, { id: m.id, label: m.name, kind: 'drug', role: roots.has(m.id) ? 'root' : down.has(m.id) ? 'down' : 'other' });
    const edges: E[] = [];
    const seen = new Set<string>();
    const addEdge = (s: string, t: string, type: E['type'], hot: boolean, tier?: string) => {
      const k = `${s}|${t}|${type}`;
      if (seen.has(k)) return;
      seen.add(k);
      edges.push({ source: s, target: t, type, hot, tier });
    };
    for (const l of analysis.links) {
      if (l.tier === 'excluded') continue;
      const eid = `e:${l.effect}`;
      if (!nodes.has(eid)) nodes.set(eid, { id: eid, label: l.effectName, kind: 'effect' });
      const hot = l.tier === 'likely' || l.tier === 'possible';
      addEdge(l.from, eid, 'CAUSES', hot, l.tier);
      addEdge(eid, l.to, 'TREATED_BY', hot, l.tier);
    }
    for (const p of analysis.pileups) {
      const eid = `e:${p.id}`;
      if (!nodes.has(eid)) nodes.set(eid, { id: eid, label: p.name, kind: 'effect', effectKind: p.kind });
      for (const d of p.drugs) addEdge(d.id, eid, 'CAUSES', false);
    }
    const falls = analysis.harms.find((h) => h.harm === 'falls');
    if (falls) {
      nodes.set('e:falls', { id: 'e:falls', label: 'Falls', kind: 'effect', effectKind: 'harm' });
      for (const d of falls.drugs) addEdge(d.id, 'e:falls', 'CAUSES', false, 'harm');
    }
    const ns = [...nodes.values()];
    const sim = forceSimulation(ns)
      .force(
        'link',
        forceLink<N, E>(edges)
          .id((d) => d.id)
          .distance((e) => (e.hot ? 70 : 95))
          .strength(0.6),
      )
      .force('charge', forceManyBody().strength(-420))
      .force('center', forceCenter(W / 2, H / 2))
      .force('x', forceX(W / 2).strength(0.04))
      .force('y', forceY(H / 2).strength(0.07))
      .force(
        'collide',
        forceCollide<N>((d) => (d.kind === 'drug' ? 46 : 34)),
      )
      .stop();
    for (let i = 0; i < 320; i++) sim.tick();
    for (const n of ns) {
      n.x = Math.max(60, Math.min(W - 60, n.x ?? 0));
      n.y = Math.max(30, Math.min(H - 30, n.y ?? 0));
    }
    return { nodes: ns, edges };
  }, [analysis]);

  const neighbors = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of edges) {
      const a = (e.source as N).id;
      const b = (e.target as N).id;
      if (a === hover) s.add(b);
      if (b === hover) s.add(a);
    }
    return s;
  }, [hover, edges]);

  return (
    <div className="card dot-grid mt-6 overflow-hidden p-3">
      <div className="flex flex-wrap items-center gap-4 px-2 pb-2 pt-1 text-xs text-dim">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-2 rounded-[3px] bg-bone" /> medicine
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-amber" /> effect
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-vermilion" /> cascade path
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-5 border-t border-dashed border-white/40" /> CAUSES
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-white/40" /> TREATED_BY
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Patient medication subgraph">
        <defs>
          <marker id="arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff5b3a" />
          </marker>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(244,239,228,0.4)" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const s = e.source as N;
          const t = e.target as N;
          const dim = neighbors && !(neighbors.has(s.id) && neighbors.has(t.id));
          const dx = (t.x ?? 0) - (s.x ?? 0);
          const dy = (t.y ?? 0) - (s.y ?? 0);
          const len = Math.hypot(dx, dy) || 1;
          const pad = t.kind === 'drug' ? 30 : 16;
          const x2 = (t.x ?? 0) - (dx / len) * pad;
          const y2 = (t.y ?? 0) - (dy / len) * pad;
          const color = e.hot ? (e.tier === 'possible' ? '#f2b544' : '#ff5b3a') : e.tier === 'intentional' ? '#a596ff' : 'rgba(244,239,228,0.32)';
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={e.hot ? 2.2 : 1.2}
              strokeDasharray={e.type === 'CAUSES' && !e.hot ? '4 4' : undefined}
              markerEnd={e.hot ? 'url(#arrow-hot)' : 'url(#arrow)'}
              opacity={dim ? 0.12 : 1}
            />
          );
        })}
        {nodes.map((n) => {
          const dim = neighbors && !neighbors.has(n.id);
          if (n.kind === 'drug') {
            const stroke = n.role === 'root' ? '#ff5b3a' : n.role === 'down' ? '#ff8a6f' : 'transparent';
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={dim ? 0.25 : 1}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                className="cursor-default"
              >
                <rect x={-44} y={-17} width={88} height={34} rx={9} fill="#f4efe4" stroke={stroke} strokeWidth={2.5} />
                <text textAnchor="middle" y={4.5} fontSize="12" fontWeight={600} fill="#17151a" fontFamily="var(--font-display)">
                  {n.label.length > 13 ? n.label.slice(0, 12) + '…' : n.label}
                </text>
              </g>
            );
          }
          const harm = n.effectKind === 'harm' || n.id === 'e:falls' || n.id === 'e:kidney_injury' || n.id === 'e:gi_bleed';
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              opacity={dim ? 0.25 : 1}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
            >
              <circle r={harm ? 13 : 10} fill="#131218" stroke={harm ? '#ff5b3a' : '#f2b544'} strokeWidth={2} />
              <text textAnchor="middle" y={26} fontSize="10.5" fill={harm ? '#ff8a6f' : '#d9d3c6'}>
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="px-2 pb-1 text-xs text-mute">
        This is {analysis.patient.name.split(' ')[0]}’s slice of the FalkorDB graph: her medicines, the effects that link them, and where they converge. Hover a
        node to isolate it.
      </p>
    </div>
  );
}
