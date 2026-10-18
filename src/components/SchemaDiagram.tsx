// Hand-drawn SVG of Domino's graph model.
const N = (x: number, y: number, label: string, color: string, sub?: string) => ({ x, y, label, color, sub });

export function SchemaDiagram() {
  const nodes = {
    patient: N(110, 210, 'Patient', '#6cc4ff', 'age, sex'),
    drug: N(480, 210, 'Drug', '#f4efe4', 'acb, beers'),
    effect: N(840, 210, 'Effect', '#f2b544', 'kind'),
    cls: N(480, 390, 'DrugClass', '#a39e93'),
    pattern: N(840, 390, 'Pattern', '#ff5b3a', 'evidence, aSR'),
    combo: N(1020, 520, 'Combo', '#ff8a6f'),
    run: N(110, 390, 'Run', '#a596ff', 'mode, model'),
    finding: N(110, 545, 'Finding', '#a596ff'),
    task: N(300, 545, 'Task', '#a596ff', 'proposed'),
    decision: N(1010, 60, 'Decision', '#7fd6a4', 'signed'),
    handoff: N(560, 545, 'Handoff', '#a596ff', 'signed'),
  };
  type K = keyof typeof nodes;
  const edges: [K, K, string, number?][] = [
    ['patient', 'drug', 'TAKES {start, indication}'],
    ['patient', 'effect', 'HAS {since}', -200],
    ['drug', 'effect', 'CAUSES {freq, onset}', -40],
    ['effect', 'drug', 'TREATED_BY {line}', 40],
    ['effect', 'effect', 'RAISES'],
    ['drug', 'cls', 'IN_CLASS'],
    ['cls', 'cls', 'AVOID_WITH'],
    ['pattern', 'cls', 'INDEX / MARKER'],
    ['pattern', 'effect', 'VIA'],
    ['combo', 'cls', 'GROUP', 40],
    ['combo', 'effect', 'HARM'],
    ['run', 'patient', 'REVIEWED'],
    ['run', 'finding', 'FOUND'],
    ['run', 'task', 'PROPOSED'],
    ['run', 'handoff', 'HANDOFF'],
    ['finding', 'drug', 'ROOT'],
    ['decision', 'patient', 'ABOUT', -60],
    ['decision', 'pattern', 'ON_PATTERN', 0],
  ];
  return (
    <svg viewBox="0 0 1120 600" className="min-w-[860px]" role="img" aria-label="Domino graph schema">
      <defs>
        <marker id="sch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(244,239,228,0.55)" />
        </marker>
      </defs>
      {[false, true].map((labelsOnly) => (
        <g key={String(labelsOnly)}>
          {labelsOnly &&
            Object.entries(nodes).map(([k, n]) => (
              <g key={k} transform={`translate(${n.x},${n.y})`}>
                <rect x={-62} y={-24} width={124} height={48} rx={14} fill="#131218" stroke={n.color} strokeWidth={2} />
                <text textAnchor="middle" y={n.sub ? -2 : 5} fontSize="14" fontWeight={600} fill={n.color} fontFamily="var(--font-display)">
                  {n.label}
                </text>
                {n.sub && (
                  <text textAnchor="middle" y={14} fontSize="10" fill="#6f6b64" fontFamily="var(--font-geist-mono)">
                    {n.sub}
                  </text>
                )}
              </g>
            ))}
          {edges.map(([a, b, label, bend = 0], i) => {
            const A = nodes[a];
            const B = nodes[b];
            if (a === b) {
              const up = a === 'effect';
              const sgn = up ? -1 : 1;
              return (
                <g key={i}>
                  {!labelsOnly && (
                    <path
                      d={`M ${A.x + 40} ${A.y + sgn * 24} C ${A.x + 120} ${A.y + sgn * 110}, ${A.x - 120} ${A.y + sgn * 110}, ${A.x - 40} ${A.y + sgn * 24}`}
                      fill="none"
                      stroke="rgba(244,239,228,0.35)"
                      markerEnd="url(#sch-arrow)"
                    />
                  )}
                  {labelsOnly && (
                    <text x={A.x} y={A.y + sgn * 96 + (up ? -4 : 12)} textAnchor="middle" fontSize="11" fill="#a39e93" fontFamily="var(--font-geist-mono)">
                      :{label}
                    </text>
                  )}
                </g>
              );
            }
            const mx = (A.x + B.x) / 2;
            const my = (A.y + B.y) / 2 + bend;
            const dx = B.x - A.x;
            const dy = B.y - A.y;
            const len = Math.hypot(dx, dy);
            const ex = B.x - (dx / len) * 58;
            const ey = B.y - (dy / len) * 26;
            const sx = A.x + (dx / len) * 58;
            const sy = A.y + (dy / len) * 26;
            return (
              <g key={i}>
                {!labelsOnly && (
                  <path
                    d={`M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`}
                    fill="none"
                    stroke="rgba(244,239,228,0.35)"
                    strokeWidth={1.4}
                    markerEnd="url(#sch-arrow)"
                  />
                )}
                {labelsOnly && (
                  <text
                    x={(sx + 2 * mx + ex) / 4}
                    y={(sy + 2 * my + ey) / 4 - 6}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#a39e93"
                    fontFamily="var(--font-geist-mono)"
                    paintOrder="stroke"
                    stroke="#0d0c10"
                    strokeWidth={4}
                  >
                    :{label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
