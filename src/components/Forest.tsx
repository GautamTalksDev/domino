interface Row {
  a: string;
  aName: string;
  b: string;
  bName: string;
  fwd: number;
  rev: number;
  asr: number;
  lo: number;
  hi: number;
  via: string[];
  signal: boolean;
  pattern?: string;
  intentional?: boolean;
}

const MIN = 0.25;
const MAX = 64;
const W = 240;
const PAD = 6;
const x = (v: number) => PAD + ((Math.log(Math.min(MAX, Math.max(MIN, v))) - Math.log(MIN)) / (Math.log(MAX) - Math.log(MIN))) * (W - PAD * 2);
const TICKS = [0.5, 1, 2, 4, 16, 64];

/** A forest plot of adjusted sequence ratios: one row per class pair, a diamond at the estimate, a line across the 95% CI. */
export function Forest({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full min-w-[900px] text-left text-sm">
      <thead className="text-xs text-dim">
        <tr className="border-b hairline">
          <th className="py-2.5 pr-4 font-medium">First class → second class</th>
          <th className="py-2.5 pr-6 text-right font-medium">After / before</th>
          <th className="py-2.5 pr-4 font-medium">
            <span className="sr-only">Adjusted sequence ratio, log scale</span>
            <svg width={W} height={26} aria-hidden className="block">
              <text x={PAD} y={9} fill="#a39e93" fontSize={10.5}>
                Adjusted sequence ratio, log scale
              </text>
              {TICKS.map((t) => (
                <g key={t}>
                  <line x1={x(t)} x2={x(t)} y1={16} y2={20} stroke="rgba(244,239,228,0.3)" />
                  <text x={x(t)} y={26} fill="#6f6b64" fontSize={9} textAnchor="middle" className="mono">
                    {t}
                  </text>
                </g>
              ))}
            </svg>
          </th>
          <th className="py-2.5 pr-6 text-right font-medium">aSR (95% CI)</th>
          <th className="py-2.5 font-medium">Mechanism in the graph</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.a + r.b} className="border-b hairline align-middle last:border-0">
            <td className="py-3 pr-4">
              <span className="text-bone">{r.aName}</span> <span className="text-mute">→</span> <span className="text-bone">{r.bName}</span>
              {r.pattern && (
                <div className={`mt-0.5 text-xs ${r.intentional ? 'text-iris' : 'text-vermilion-2'}`}>
                  {r.intentional ? 'Usually deliberate: ' : 'Documented: '}
                  {r.pattern}
                </div>
              )}
            </td>
            <td className="mono py-3 pr-6 text-right text-xs tabular-nums text-bone-2">
              {r.fwd} / {r.rev}
            </td>
            <td className="py-3 pr-4">
              <svg width={W} height={20} className="block" role="img" aria-label={`aSR ${r.asr}, 95% CI ${r.lo} to ${r.hi >= 64 ? 'over 64' : r.hi}`}>
                <line x1={PAD} x2={W - PAD} y1={10} y2={10} stroke="rgba(244,239,228,0.06)" />
                <line x1={x(1)} x2={x(1)} y1={1} y2={19} stroke="rgba(244,239,228,0.3)" strokeDasharray="2 3" />
                <line x1={x(r.lo)} x2={x(r.hi)} y1={10} y2={10} stroke={r.signal ? '#ff8a6f' : '#6f6b64'} strokeWidth={2} strokeLinecap="round" />
                {r.hi >= MAX && <path d={`M${W - PAD - 1} 6 L${W - PAD + 3} 10 L${W - PAD - 1} 14`} fill="none" stroke={r.signal ? '#ff8a6f' : '#6f6b64'} strokeWidth={1.5} />}
                <rect x={x(r.asr) - 4} y={6} width={8} height={8} fill={r.signal ? '#ff5b3a' : '#a39e93'} transform={`rotate(45 ${x(r.asr)} 10)`} />
              </svg>
            </td>
            <td className="mono py-3 pr-6 text-right text-[11.5px] tabular-nums text-bone-2">
              {r.asr} <span className="text-mute">({r.lo}–{r.hi >= 64 ? '>64' : r.hi})</span>
            </td>
            <td className="py-3 text-xs">
              {r.via.length ? (
                <span className="text-sage">via {r.via.join(', ').toLowerCase()}</span>
              ) : (
                <span className="text-mute">none: likely a care pathway</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
