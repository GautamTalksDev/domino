'use client';
import { useEffect, useMemo, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import { ArrowRight, Loader2, Route, Search } from 'lucide-react';
import { Cypher } from './Cypher';

interface Item {
  id: string;
  name: string;
  kind: 'Drug' | 'Effect';
}
interface Edge {
  s: string;
  sl: string;
  sn: string;
  t: string;
  e: string;
  el: string;
  en: string;
}
interface GNode extends SimulationNodeDatum {
  id: string;
  name: string;
  label: string;
}

const W = 960;
const H = 560;
const short = (name: string) => (name.length > 18 ? name.slice(0, 17) + '…' : name);
/** Width of a drug pill: room for its (shortened) name. */
const pillWidth = (name: string) => Math.max(64, Math.min(132, 18 + short(name).length * 6.3));

function Picker({ items, value, onChange, placeholder }: { items: Item[]; value: string; onChange: (id: string) => void; placeholder: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const current = items.find((i) => i.id === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? items.filter((i) => i.name.toLowerCase().includes(s)) : items).slice(0, 10);
  }, [q, items]);
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
      <input
        value={open ? q : (current?.name ?? '')}
        onFocus={() => {
          setOpen(true);
          setQ('');
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="field w-full py-2.5 pl-9 pr-3 text-sm"
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border hairline bg-ink-3 shadow-2xl">
          {list.map((i) => (
            <li key={i.id}>
              <button className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-white/5" onMouseDown={() => onChange(i.id)}>
                <span>{i.name}</span>
                <span className={`text-xs ${i.kind === 'Drug' ? 'text-dim' : 'text-amber'}`}>{i.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GraphExplorer({ drugs, effects }: { drugs: Item[]; effects: Item[] }) {
  const all = useMemo(() => [...drugs, ...effects], [drugs, effects]);
  const [focus, setFocus] = useState('urinary_incontinence');
  const [hover, setHover] = useState<string | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [meta, setMeta] = useState<{ ms: number; cypher: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState('amlodipine');
  const [to, setTo] = useState('donepezil');
  const [paths, setPaths] = useState<{ nodes: { id: string; name: string; label: string }[] }[] | null>(null);
  const [pathMeta, setPathMeta] = useState<{ ms: number; cypher: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setHover(null);
    setLoading(true);
    fetch(`/api/graph/neighborhood?id=${encodeURIComponent(focus)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setEdges(j.edges ?? []);
        setMeta({ ms: j.ms, cypher: j.cypher });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [focus]);

  const layout = useMemo(() => {
    const nodes = new Map<string, GNode>();
    for (const e of edges) {
      if (!nodes.has(e.s)) nodes.set(e.s, { id: e.s, name: e.sn, label: e.sl });
      if (!nodes.has(e.e)) nodes.set(e.e, { id: e.e, name: e.en, label: e.el });
    }
    const ns = [...nodes.values()];
    const links = edges.map((e) => ({ source: e.s, target: e.e, type: e.t }));
    const center = ns.find((n) => n.id === focus);
    if (center) {
      center.fx = W / 2;
      center.fy = H / 2;
    }
    const sim = forceSimulation(ns)
      .force(
        'link',
        forceLink(links)
          .id((d) => (d as GNode).id)
          .distance(80)
          .strength(0.5),
      )
      .force('charge', forceManyBody().strength(-320))
      .force('x', forceX(W / 2).strength(0.05))
      .force('y', forceY(H / 2).strength(0.09))
      // Drugs are labelled pills: keep them apart by their width, effects by their label below the dot.
      .force('collide', forceCollide<GNode>((d) => (d.label === 'Drug' ? pillWidth(d.name) / 2 + 8 : 34)).iterations(3))
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    for (const n of ns) {
      n.x = Math.max(40, Math.min(W - 40, n.x ?? 0));
      n.y = Math.max(20, Math.min(H - 20, n.y ?? 0));
    }
    return { ns, links: links as unknown as { source: GNode; target: GNode; type: string }[] };
  }, [edges, focus]);

  const findPath = async () => {
    setPaths(null);
    const r = await fetch(`/api/graph/path?from=${from}&to=${to}`);
    const j = await r.json();
    setPaths(j.paths ?? []);
    setPathMeta({ ms: j.ms, cypher: j.cypher });
  };

  return (
    <div className="mt-10 grid gap-6">
      <section className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Neighbourhood explorer</h2>
            <p className="text-xs text-dim">Two steps of CAUSES and TREATED_BY around any drug or effect. Click a node to move there.</p>
          </div>
          <div className="w-full sm:w-80">
            <Picker items={all} value={focus} onChange={setFocus} placeholder="Find a drug or effect" />
          </div>
        </div>
        <div className="dot-grid relative mt-4 overflow-hidden rounded-xl border hairline">
          {loading && <Loader2 className="absolute right-3 top-3 animate-spin text-dim" size={16} />}
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Neighbourhood of ${focus}`} onMouseLeave={() => setHover(null)}>
            <defs>
              <filter id="gx-shadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000" floodOpacity="0.55" />
              </filter>
            </defs>
            {layout.links.map((l, i) => {
              const on = !hover || l.source.id === hover || l.target.id === hover;
              return (
                <line
                  key={i}
                  x1={l.source.x}
                  y1={l.source.y}
                  x2={l.target.x}
                  y2={l.target.y}
                  stroke={l.type === 'CAUSES' ? `rgba(255,91,58,${on ? (hover ? 0.85 : 0.45) : 0.08})` : `rgba(127,214,164,${on ? (hover ? 0.8 : 0.4) : 0.07})`}
                  strokeWidth={hover && on ? 1.6 : 1}
                  strokeDasharray={l.type === 'CAUSES' ? '4 3' : undefined}
                  style={{ transition: 'stroke 0.2s ease' }}
                />
              );
            })}
            {layout.ns.map((n) => {
              const near =
                !hover ||
                n.id === hover ||
                layout.links.some((l) => (l.source.id === hover && l.target.id === n.id) || (l.target.id === hover && l.source.id === n.id));
              const w = pillWidth(n.name);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  className="cursor-pointer"
                  onClick={() => setFocus(n.id)}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  opacity={near ? 1 : 0.25}
                  style={{ transition: 'opacity 0.2s ease' }}
                >
                  <title>{`${n.name} (${n.label === 'Drug' ? 'drug' : 'effect'}): click to centre the graph here`}</title>
                  {n.label === 'Drug' ? (
                    <rect x={-w / 2} y={-13} width={w} height={26} rx={9} fill={n.id === focus ? '#ff5b3a' : '#f4efe4'} filter="url(#gx-shadow)" />
                  ) : (
                    <circle r={n.id === focus ? 14 : 9} fill="#131218" stroke={n.id === focus ? '#ff5b3a' : '#f2b544'} strokeWidth={2} />
                  )}
                  <text
                    textAnchor="middle"
                    y={n.label === 'Drug' ? 4 : 23}
                    fontSize="10.5"
                    fontWeight={n.label === 'Drug' ? 600 : 400}
                    fill={n.label === 'Drug' ? '#17151a' : '#d9d3c6'}
                    paintOrder="stroke"
                    stroke={n.label === 'Drug' ? 'none' : '#0d0c10'}
                    strokeWidth={n.label === 'Drug' ? 0 : 3}
                  >
                    {short(n.name)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-dim">
          <span>
            <span className="text-vermilion-2">- - -</span> CAUSES
          </span>
          <span>
            <span className="text-sage">———</span> TREATED_BY
          </span>
          {meta && (
            <span className="mono">
              {edges.length} relationships · {meta.ms} ms
            </span>
          )}
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Route size={16} className="text-vermilion" />
          <h2 className="font-semibold">How could one drug lead to another?</h2>
        </div>
        <p className="mt-1 text-xs text-dim">allShortestPaths over CAUSES and TREATED_BY: every shortest cascade route between two drugs.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center">
          <Picker items={drugs} value={from} onChange={setFrom} placeholder="From drug" />
          <ArrowRight size={16} className="hidden text-dim sm:block" />
          <Picker items={drugs} value={to} onChange={setTo} placeholder="To drug" />
          <button className="btn btn-hot" onClick={findPath}>
            Find routes
          </button>
        </div>
        {paths && (
          <div className="mt-5 space-y-2">
            {paths.length === 0 && <p className="text-sm text-dim">No cascade route within 10 steps.</p>}
            {paths.map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5 text-sm">
                {p.nodes.map((n, k) => (
                  <span key={k} className="flex items-center gap-1.5">
                    {k > 0 && <span className="text-mute">→</span>}
                    <span className={n.label === 'Drug' ? 'rounded-md bg-bone px-2 py-0.5 font-medium text-ink' : 'text-amber'}>{n.name}</span>
                  </span>
                ))}
              </div>
            ))}
            {pathMeta && (
              <details className="mt-3">
                <summary className="mono cursor-pointer text-xs text-sky">Cypher · {pathMeta.ms} ms</summary>
                <Cypher code={pathMeta.cypher} className="mt-2" />
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
