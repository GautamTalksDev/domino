// Provenance: the path behind a finding, read from the graph.
// Run → Step (tool call) → catalog Queries it ran → Finding → evidence (drugs, effect, pattern, references,
// care-team decisions it took into account) → Handoffs that carried it → Tasks it led to (who they went to,
// the procedure they followed, who decided).

import { run } from './db';
import { Q } from './cypher';

export interface Trace {
  finding: { id: string; key: string; tier: string; score: number; label: string; source: string; status: string; at: number; factors: string | null };
  from: { id: string; name: string };
  to: { id: string; name: string };
  effect: { id: string; name: string; plain: string };
  causes: { freq: string; onsetMin: number; onsetMax: number } | null;
  line: string | null;
  pattern: { id: string; title: string; evidence: string } | null;
  refs: { id: string; short: string; url: string | null }[];
  decisions: { id: string; verdict: string; by: string; reason: string }[];
  run: { id: string; at: number; mode: string; model: string; trigger: string } | null;
  step: number | null;
  agent: string | null;
  tool: string | null;
  handoffs: { id: string; from: string; to: string; at: number }[];
  tasks: {
    id: string;
    title: string;
    status: string;
    role: string;
    decidedBy: string | null;
    version: number | null;
    procedureReason: string | null;
    owner: string | null;
    /** The team note that raised it, if a person's handover or chat did. */
    note?: string | null;
    noteKind?: string | null;
    noteBy?: string | null;
  }[];
  steps: { i: number; agent: string; tool: string; ok: boolean; ms: number; queries: { id: string; title: string; mode: string }[] }[];
}

export async function traceFinding(pid: string, link: string): Promise<Trace | null> {
  const rows = await run<Omit<Trace, 'steps'>>(Q.traceFinding, { pid, key: `${pid}:${link}` });
  const r = rows[0];
  if (!r?.finding) return null;
  const steps = r.run?.id && r.step != null ? await run<Trace['steps'][number]>(Q.traceSteps, { run: r.run.id, upto: r.step }) : [];
  const clean = <T>(xs: T[]) => xs.filter((x) => x && Object.values(x as object).some((v) => v != null));
  return { ...r, refs: clean(r.refs), decisions: clean(r.decisions), handoffs: clean(r.handoffs), tasks: clean(r.tasks), steps };
}
