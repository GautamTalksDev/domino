// Hand-drawn SVG of the memory, provenance and care-team part of a clinic graph.
const N = (x: number, y: number, label: string, color: string, sub?: string) => ({ x, y, label, color, sub });

export function MemoryDiagram() {
  const nodes = {
    clinic: N(120, 70, 'Clinic', '#7fd6a4', 'one graph each'),
    conv: N(430, 70, 'Conversation', '#6cc4ff', 'per person'),
    message: N(730, 70, 'Message', '#6cc4ff', 'sources'),
    query: N(1000, 200, 'Query', '#ff8a6f', 'the catalog'),
    patient: N(120, 220, 'Patient', '#6cc4ff'),
    run: N(430, 220, 'Run', '#a596ff', 'changes'),
    step: N(730, 220, 'Step', '#a596ff', 'tool, args'),
    prescriber: N(265, 380, 'Prescriber', '#f4efe4', 'kind'),
    finding: N(430, 380, 'Finding', '#ff5b3a', 'tier, factors'),
    handoff: N(730, 380, 'Handoff', '#a596ff', 'signed'),
    decision: N(1000, 380, 'Decision', '#7fd6a4', 'signed'),
    doc: N(100, 530, 'Doc', '#f2b544', 'team note'),
    task: N(330, 530, 'Task', '#a596ff', 'signed'),
    procedure: N(640, 530, 'Procedure', '#a596ff', 'version'),
    lock: N(1000, 530, 'Lock', '#a39e93', 'lease'),
  };
  type K = keyof typeof nodes;
  const edges: [K, K, string, number?][] = [
    ['conv', 'patient', 'ABOUT', 30],
    ['conv', 'clinic', 'ABOUT'],
    ['conv', 'message', 'HAS'],
    ['message', 'query', 'RAN', -30],
    ['run', 'patient', 'REVIEWED'],
    ['run', 'step', 'STEP'],
    ['step', 'query', 'RAN'],
    ['step', 'finding', 'PRODUCED', 20],
    ['run', 'finding', 'FOUND'],
    ['run', 'handoff', 'HANDOFF', 30],
    ['handoff', 'finding', 'CARRIED'],
    ['finding', 'decision', 'CONSIDERED', 90],
    ['patient', 'prescriber', 'SEES'],
    ['task', 'finding', 'ABOUT'],
    ['task', 'procedure', 'FOLLOWED', -26],
    ['procedure', 'task', 'LEARNED_FROM', -26],
    ['task', 'prescriber', 'ADDRESSED_TO'],
    ['procedure', 'procedure', 'SUPERSEDES'],
    ['doc', 'patient', 'MENTIONS'],
  ];
  return (
    <svg viewBox="0 0 1120 630" className="min-w-[860px]" role="img" aria-label="Domino memory and provenance graph model">
      <defs>
        <marker id="mem-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(244,239,228,0.55)" />
        </marker>
      </defs>
      {[false, true].map((labelsOnly) => (
        <g key={String(labelsOnly)}>
          {labelsOnly &&
            Object.entries(nodes).map(([k, n]) => (
              <g key={k} transform={`translate(${n.x},${n.y})`}>
                <rect x={-66} y={-24} width={132} height={48} rx={14} fill="#131218" stroke={n.color} strokeWidth={2} />
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
              return (
                <g key={i}>
                  {!labelsOnly && (
                    <path
                      d={`M ${A.x + 40} ${A.y + 24} C ${A.x + 110} ${A.y + 90}, ${A.x - 110} ${A.y + 90}, ${A.x - 40} ${A.y + 24}`}
                      fill="none"
                      stroke="rgba(244,239,228,0.35)"
                      markerEnd="url(#mem-arrow)"
                    />
                  )}
                  {labelsOnly && (
                    <text x={A.x} y={A.y + 82} textAnchor="middle" fontSize="11" fill="#a39e93" fontFamily="var(--font-geist-mono)">
                      :{label}
                    </text>
                  )}
                </g>
              );
            }
            const dx = B.x - A.x;
            const dy = B.y - A.y;
            const len = Math.hypot(dx, dy);
            const nx = -dy / len;
            const ny = dx / len;
            const mx = (A.x + B.x) / 2 + nx * bend;
            const my = (A.y + B.y) / 2 + ny * bend;
            const sx = A.x + (dx / len) * 62;
            const sy = A.y + (dy / len) * 26;
            const ex = B.x - (dx / len) * 62;
            const ey = B.y - (dy / len) * 26;
            return (
              <g key={i}>
                {!labelsOnly && (
                  <path
                    d={`M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`}
                    fill="none"
                    stroke="rgba(244,239,228,0.35)"
                    strokeWidth={1.4}
                    markerEnd="url(#mem-arrow)"
                  />
                )}
                {labelsOnly && (
                  <text
                    x={(sx + 2 * mx + ex) / 4}
                    y={(sy + 2 * my + ey) / 4 - 5}
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
