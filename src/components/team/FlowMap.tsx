// Where cascades cross prescribers: a small Sankey diagram drawn as plain SVG (no chart library),
// from the care_team_flows Cypher query. Left: who prescribed the first drug. Right: who added the second.

interface Flow {
  fromBy: string;
  toBy: string;
  links: number;
  likely: number;
}

const KIND_COLOR: Record<string, string> = { family: '#7fd6a4', walk_in: '#f2b544', specialist: '#a596ff' };

function short(name: string) {
  const m = /^(.*?)\s*\(([^)]+)\)$/.exec(name);
  return m ? { who: m[1], what: m[2] } : { who: name, what: '' };
}

export function FlowMap({ flows, kinds, max = 12 }: { flows: Flow[]; kinds: Record<string, string>; max?: number }) {
  const shown = flows.filter((f) => f.fromBy !== f.toBy).slice(0, max);
  if (!shown.length) return <p className="text-sm text-dim">No cross-prescriber cascades yet.</p>;
  const W = 760;
  const top = 20;
  const gap = 8;
  const minBlock = 30; // room for a two-line label, even for a thin bar
  const barW = 10;
  const xL = 200;
  const xR = W - 200 - barW;

  const sum = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  for (const f of shown) {
    sum(out, f.fromBy, f.links);
    sum(inn, f.toBy, f.links);
  }
  const total = shown.reduce((s, f) => s + f.links, 0);
  const left = [...out.entries()].sort((a, b) => b[1] - a[1]);
  const right = [...inn.entries()].sort((a, b) => b[1] - a[1]);
  const scale = 360 / total;

  const place = (list: [string, number][]) => {
    const pos = new Map<string, { y: number; h: number; used: number }>();
    let y = top;
    for (const [k, v] of list) {
      const h = Math.max(3, v * scale);
      pos.set(k, { y, h, used: 0 });
      y += Math.max(h, minBlock) + gap;
    }
    return { pos, end: y };
  };
  const { pos: L, end: endL } = place(left);
  const { pos: R, end: endR } = place(right);
  const H = Math.max(endL, endR) + 6;
  const order = [...shown].sort(
    (a, b) =>
      left.findIndex((x) => x[0] === a.fromBy) - left.findIndex((x) => x[0] === b.fromBy) ||
      right.findIndex((x) => x[0] === a.toBy) - right.findIndex((x) => x[0] === b.toBy),
  );
  const ribbons = order.map((f) => {
    const a = L.get(f.fromBy)!;
    const b = R.get(f.toBy)!;
    const h = Math.max(1.5, f.links * scale);
    const y0 = a.y + a.used;
    const y1 = b.y + b.used;
    a.used += h;
    b.used += h;
    const x0 = xL + barW;
    const x1 = xR;
    const xm = (x0 + x1) / 2;
    return {
      f,
      d: `M ${x0} ${y0} C ${xm} ${y0}, ${xm} ${y1}, ${x1} ${y1} L ${x1} ${y1 + h} C ${xm} ${y1 + h}, ${xm} ${y0 + h}, ${x0} ${y0 + h} Z`,
      color: KIND_COLOR[kinds[f.toBy]] ?? '#a39e93',
    };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Cascade handoffs between prescribers">
      <title>Where cascades cross prescribers</title>
      <text x={xL + barW / 2} y={10} textAnchor="middle" className="fill-[var(--color-mute)] text-[10px] uppercase tracking-wider">
        first drug
      </text>
      <text x={xR + barW / 2} y={10} textAnchor="middle" className="fill-[var(--color-mute)] text-[10px] uppercase tracking-wider">
        drug added
      </text>
      {ribbons.map((r, i) => (
        <path key={i} d={r.d} fill={r.color} fillOpacity={0.22} stroke={r.color} strokeOpacity={0.35} strokeWidth={0.6}>
          <title>{`${r.f.fromBy} → ${r.f.toBy}: ${r.f.links} cascade links (${r.f.likely} likely)`}</title>
        </path>
      ))}
      {left.map(([k]) => {
        const p = L.get(k)!;
        const s = short(k);
        return (
          <g key={`l-${k}`}>
            <rect x={xL} y={p.y} width={barW} height={p.h} rx={2} fill={KIND_COLOR[kinds[k]] ?? '#a39e93'} />
            <text x={xL - 8} y={p.y + p.h / 2 - 1} textAnchor="end" className="fill-[var(--color-bone)] text-[12px]">
              {s.who}
            </text>
            <text x={xL - 8} y={p.y + p.h / 2 + 12} textAnchor="end" className="fill-[var(--color-dim)] text-[10px]">
              {s.what} · {out.get(k)}
            </text>
          </g>
        );
      })}
      {right.map(([k]) => {
        const p = R.get(k)!;
        const s = short(k);
        return (
          <g key={`r-${k}`}>
            <rect x={xR} y={p.y} width={barW} height={p.h} rx={2} fill={KIND_COLOR[kinds[k]] ?? '#a39e93'} />
            <text x={xR + barW + 8} y={p.y + p.h / 2 - 1} className="fill-[var(--color-bone)] text-[12px]">
              {s.who}
            </text>
            <text x={xR + barW + 8} y={p.y + p.h / 2 + 12} className="fill-[var(--color-dim)] text-[10px]">
              {s.what} · {inn.get(k)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
