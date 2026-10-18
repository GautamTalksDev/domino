export function ArchDiagram({ queries, tools }: { queries: number; tools: number }) {
  const Box = ({ x, y, w, h, title, sub, color }: { x: number; y: number; w: number; h: number; title: string; sub?: string; color: string }) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} fill="#131218" stroke={color} strokeWidth={1.6} />
      <text x={x + 16} y={y + 26} fontSize="14" fontWeight={600} fill={color} fontFamily="var(--font-display)">
        {title}
      </text>
      {sub &&
        sub.split('\n').map((l, i) => (
          <text key={i} x={x + 16} y={y + 46 + i * 16} fontSize="11" fill="#a39e93" fontFamily="var(--font-geist-mono)">
            {l}
          </text>
        ))}
    </g>
  );
  const Arrow = ({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) => (
    <g>
      <path d={d} fill="none" stroke="rgba(244,239,228,0.4)" strokeWidth={1.4} markerEnd="url(#arch-a)" />
      {label && (
        <text x={lx} y={ly} fontSize="10.5" fill="#6f6b64" fontFamily="var(--font-geist-mono)">
          {label}
        </text>
      )}
    </g>
  );
  return (
    <svg viewBox="0 0 1120 520" className="min-w-[900px]" role="img" aria-label="Domino architecture">
      <defs>
        <marker id="arch-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(244,239,228,0.55)" />
        </marker>
      </defs>
      <Box x={20} y={30} w={210} h={110} title="Web app (Next.js)" sub={'dominoes, timeline,\ngraph, inbox, brief'} color="#f4efe4" />
      <Box x={20} y={190} w={210} h={90} title="MCP clients" sub={'Claude Desktop, IDEs\nstdio, read-only default'} color="#6cc4ff" />
      <Box x={20} y={330} w={210} h={90} title="New prescription" sub={'event → Detective\nre-runs on its own'} color="#f2b544" />
      <Box
        x={290}
        y={30}
        w={230}
        h={150}
        title="API guard"
        sub={'zod validation\nsame-origin check (CSRF)\nrate limits per bucket\noptional access key\nnonce CSP, no stack traces'}
        color="#a39e93"
      />
      <Box
        x={580}
        y={30}
        w={250}
        h={250}
        title="Agent team"
        sub={
          'Detective  → find, record\n   ↓ signed handoff\nPharmacist → evidence,\n   alternatives, what-if\n   ↓ signed handoff\nScribe     → tasks, notes\n\nLLM tool loop, or the\ndeterministic planner\nwhen no key is set'
        }
        color="#a596ff"
      />
      <Box x={880} y={30} w={220} h={110} title="LLM (optional)" sub={'Gemini, Claude or any\nOpenAI-compatible API\nserver-side keys only'} color="#7fd6a4" />
      <Box
        x={580}
        y={320}
        w={250}
        h={130}
        title="Tools + Cypher catalog"
        sub={`${tools} tools, one patient per run\n${queries} named queries, all\nparameterised; reads run as\nGRAPH.RO_QUERY`}
        color="#ff8a6f"
      />
      <Box
        x={880}
        y={300}
        w={220}
        h={170}
        title="FalkorDB"
        sub={'knowledge graph\n  Drug, Effect, Pattern…\npatients + prescriptions\nagent memory\n  Run, Step, Finding,\n  Task, Decision, Handoff'}
        color="#ff5b3a"
      />
      <Arrow d="M 230 85 L 288 85" />
      <Arrow d="M 230 235 C 260 235, 260 150, 288 150" />
      <Arrow d="M 230 375 C 270 375, 270 170, 288 170" />
      <Arrow d="M 520 105 L 578 105" />
      <Arrow d="M 830 85 L 878 85" label="calls" lx={836} ly={76} />
      <Arrow d="M 705 280 L 705 318" />
      <Arrow d="M 830 385 L 878 385" label="Cypher" lx={836} ly={376} />
      <Arrow d="M 990 300 C 990 250, 900 230, 832 230" label="handoffs, memory" lx={836} ly={268} />
      <text x={290} y={470} fontSize="12" fill="#a39e93">
        Remove FalkorDB and nothing works: every finding, path, alternative, memory and handoff is a graph query.
      </text>
    </svg>
  );
}
