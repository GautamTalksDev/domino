import type { Metadata } from 'next';
import { graphName, run } from '@/lib/db';
import { GraphStage } from '@/components/three/GraphStage';
import { GRAPH_PRESETS } from '@/data/graphPresets';
import type { KEdge, KNode } from '@/components/three/KnowledgeGraph3D';
import { DRUGS, EFFECTS } from '@/data/knowledge';
import { GraphExplorer } from '@/components/GraphExplorer';
import { SchemaDiagram } from '@/components/SchemaDiagram';
import { withDb, DbError } from '@/components/DbError';
import { QueryConsole } from '@/components/QueryConsole';
import { CONSOLE_QUERIES, paramsOf } from '@/lib/console';
import { Q } from '@/lib/cypher';
import { PERSONAS } from '@/data/personas';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Graph' };

export default async function GraphPage() {
  const res = await withDb(async () => {
    const [n, e, kn, ke, graph] = await Promise.all([
      run<{ nodes: { label: string; count: number }[] }>(Q.stats),
      run<{ edges: { type: string; count: number }[] }>(Q.edgeStats),
      run<KNode>(Q.knowledgeNodes),
      run<KEdge>(Q.knowledgeEdges),
      graphName(),
    ]);
    return { nodes: n[0]?.nodes ?? [], edges: e[0]?.edges ?? [], kNodes: kn, kEdges: ke, graph };
  });
  if (!res.ok) return <DbError message={res.error} />;
  const totalN = res.data.nodes.reduce((s, x) => s + Number(x.count), 0);
  const totalE = res.data.edges.reduce((s, x) => s + Number(x.count), 0);
  return (
    <div className="pt-10">
      <p className="kicker">FalkorDB · graph “{res.data.graph}”</p>
      <h1 className="font-display mt-3 text-5xl font-semibold">The graph</h1>
      <p className="mt-3 max-w-2xl text-bone-2">
        {totalN.toLocaleString()} nodes and {totalE.toLocaleString()} relationships: a curated medication knowledge graph, the documented cascade patterns, the
        synthetic patients, and everything the agents have written back (runs, findings, tasks, decisions).
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {res.data.nodes
          .sort((a, b) => Number(b.count) - Number(a.count))
          .map((n) => (
            <span key={n.label} className="chip">
              <span className="text-bone">{n.label}</span> <span className="mono text-dim">{Number(n.count).toLocaleString()}</span>
            </span>
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {res.data.edges
          .sort((a, b) => Number(b.count) - Number(a.count))
          .map((e) => (
            <span key={e.type} className="chip mono text-[11px]">
              :{e.type} <span className="text-dim">{Number(e.count).toLocaleString()}</span>
            </span>
          ))}
      </div>
      <section className="mt-8" data-tour="graph3d">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-2xl font-semibold">Every path a cascade can take</h2>
            <p className="mt-1 max-w-2xl text-sm text-dim">
              The whole medication knowledge graph from FalkorDB, in 3D: each drug, each side effect or diagnosis, and every CAUSES and TREATED_BY edge between them.
              Light up a patient’s cascade and see where it runs through everything else.
            </p>
          </div>
          <span className="mono text-[11px] text-mute">queries: knowledge_nodes · knowledge_edges</span>
        </div>
        <GraphStage
          nodes={res.data.kNodes}
          edges={res.data.kEdges}
          presets={GRAPH_PRESETS}
        />
      </section>
      <GraphExplorer
        drugs={DRUGS.map((d) => ({ id: d.id, name: d.name, kind: 'Drug' }))}
        effects={EFFECTS.map((e) => ({ id: e.id, name: e.name, kind: 'Effect' }))}
      />
      <div className="mt-6">
        <QueryConsole
          items={CONSOLE_QUERIES.map((k) => ({ key: k, title: Q[k].title, purpose: Q[k].purpose, cypher: Q[k].cypher, params: paramsOf(Q[k]) }))}
          patients={PERSONAS.map((p) => ({ id: p.id, name: `${p.name} (${p.id})` }))}
          drugs={DRUGS.map((d) => ({ id: d.id, name: d.name }))}
          effects={EFFECTS.map((e) => ({ id: e.id, name: e.name }))}
        />
      </div>
      <section className="mt-12">
        <p className="kicker">Data model</p>
        <h2 className="font-display mt-2 text-3xl font-semibold">Schema</h2>
        <div className="card mt-5 overflow-x-auto p-5">
          <SchemaDiagram />
        </div>
      </section>
    </div>
  );
}
