// Domino as an MCP server: the same graph tools the agents use, for any MCP client.
// Read tools are always available: the patient tools, the prescriber check, and the care-team
// brain (search what the team wrote down, who knows what, where cascades cross prescribers, what
// the agents learned). run_review writes findings, tasks and notes into the graph, so it is only
// registered when DOMINO_MCP_ALLOW_WRITES=true. Every result carries the catalog query ids it ran
// in _meta, so a client can cite them. Resources expose the graph model and the query catalog.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callTool, TOOLS, type ToolContext } from './agent/tools';
import { runReview } from './agent/runner';
import { run } from './db';
import { Q } from './cypher';
import { checkPrescription } from './engine/gatekeeper';
import { DRUG, PATTERN } from '../data/knowledge';
import { careTeam, learnedProcedures, searchMemory, whoKnows } from './careteam';
import { QUERY_LIST } from './cypher';
import type { QueryTrace } from './db';
import type { AgentEvent } from './agent/events';

const GRAPH_MODEL = `# Domino graph model (one graph per clinic)

Knowledge: (:Drug)-[:CAUSES {freq, weight, onsetMin, onsetMax}]->(:Effect)-[:TREATED_BY {line}]->(:Drug),
(:Drug)-[:IN_CLASS]->(:DrugClass)-[:AVOID_WITH]-(:DrugClass), (:Effect)-[:RAISES]->(:Effect),
(:Pattern)-[:INDEX|MARKER]->(:DrugClass), (:Pattern)-[:VIA]->(:Effect), (:Pattern)-[:CITES]->(:Reference),
(:Combo)-[:GROUP]->(:DrugClass), (:Combo)-[:HARM]->(:Effect), (:Query) for every catalog query.

Patients: (:Patient)-[:TAKES {start, dose, prescriber, indication}]->(:Drug), (:Patient)-[:HAS {since}]->(:Effect),
(:Patient)-[:SEES]->(:Prescriber).

Memory: (:Run)-[:REVIEWED]->(:Patient), (:Run)-[:STEP]->(:Step)-[:RAN]->(:Query), (:Step)-[:PRODUCED]->(:Finding|:Task|:Note),
(:Run)-[:FOUND]->(:Finding)-[:ROOT|TO]->(:Drug), (:Finding)-[:VIA]->(:Effect), (:Finding)-[:MATCHES]->(:Pattern),
(:Finding)-[:CONSIDERED]->(:Decision), (:Run)-[:HANDOFF]->(:Handoff)-[:CARRIED]->(:Finding),
(:Task)-[:ABOUT]->(:Finding), (:Task)-[:FOLLOWED]->(:Procedure), (:Task)-[:ADDRESSED_TO]->(:Prescriber),
(:Procedure)-[:SUPERSEDES]->(:Procedure), (:Procedure)-[:LEARNED_FROM]->(:Task), (:Decision)-[:ABOUT]->(:Patient),
(:Conversation)-[:ABOUT]->(:Patient|:Clinic), (:Conversation)-[:HAS]->(:Message)-[:RAN]->(:Query), (:Lock).
`;

const patientId = z
  .string()
  .regex(/^p-?[a-z0-9-]{2,40}$/)
  .describe('Patient id, e.g. "p-beatrice". Use list_patients to find ids.');

function ctxFor(pid: string): ToolContext {
  return {
    runId: null,
    patientId: pid,
    role: 'domino',
    tracer: () => {},
    cache: {},
    step: null,
    counters: { findings: 0, tasks: 0, notes: 0 },
    emit: () => {},
    artifacts: { findings: [], findingKeys: [], tasks: [], notes: [] },
  };
}

const text = (t: string, isError = false, queries: string[] = []) => ({
  content: [{ type: 'text' as const, text: t }],
  isError,
  _meta: { 'domino/queries': [...new Set(queries)] },
});

/** Runs fn with a tracer and returns the catalog query ids it ran. */
async function traced<T>(fn: (tracer: (t: QueryTrace) => void) => Promise<T>): Promise<{ value: T; queries: string[] }> {
  const queries: string[] = [];
  const value = await fn((t) => queries.push(t.id));
  return { value, queries };
}

export function createMcpServer(opts: { allowWrites?: boolean } = {}) {
  const server = new McpServer({ name: 'domino', version: '1.0.0' });

  server.registerTool(
    'list_patients',
    {
      title: 'List patients',
      description: 'List synthetic patients with medication counts and the latest sweep summary.',
      inputSchema: { demo_only: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ demo_only }) => {
      const rows = await run<{ id: string; name: string; age: number; meds: number; likely: number | null; persona: boolean }>(Q.patientList);
      const list = rows.filter((r) => !demo_only || r.persona).slice(0, 80);
      return text(
        list.map((r) => `${r.id}: ${r.name}, ${r.age}, ${r.meds} medicines${r.likely != null ? `, ${r.likely} likely cascade link(s)` : ''}`).join('\n'),
      );
    },
  );

  // Read tools, exposed with an explicit patient id (the web agents get it from the run instead).
  for (const tool of TOOLS.filter((t) => !t.write && t.roles.includes('domino'))) {
    const shape: Record<string, z.ZodTypeAny> = { patient_id: patientId };
    for (const [k, v] of Object.entries(tool.parameters.properties)) {
      shape[k] = z.string().describe(String((v as { description?: string }).description ?? k));
    }
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: shape, annotations: { readOnlyHint: true } },
      async (args: Record<string, unknown>) => {
        const { patient_id, ...rest } = args as { patient_id: string };
        const r = await callTool(ctxFor(patient_id), tool.name, rest);
        return text(
          r.summary,
          !r.ok,
          r.queries.map((q) => q.id),
        );
      },
    );
  }

  server.registerTool(
    'check_new_prescription',
    {
      description:
        'Before adding a drug: would it treat a side effect of something the patient already takes, pile onto an existing problem, or complete a dangerous combination?',
      inputSchema: { patient_id: patientId, drug: z.string().regex(/^[a-z0-9_]{2,40}$/) },
      annotations: { readOnlyHint: true },
    },
    async ({ patient_id, drug }) => {
      if (!DRUG[drug]) return text(`Unknown drug id "${drug}".`, true);
      const queries: string[] = [];
      const r = await checkPrescription(patient_id, drug, (t) => queries.push(t.id));
      return text(
        [
          `${r.verdict.toUpperCase()}: ${r.headline}`,
          ...r.treatsSideEffectOf.map((t) => `- treats ${t.effectName} from ${t.fromName}${t.pattern ? ` (documented: ${t.pattern})` : ''}`),
          ...r.combosCompleted.map((c) => `- completes ${c}`),
          ...r.conflicts.map((c) => `- conflicts with ${c.drug}: ${c.why}`),
          `Anticholinergic burden ${r.acbBefore} → ${r.acbAfter}`,
        ].join('\n'),
        false,
        queries,
      );
    },
  );

  // ─── Care-team brain (clinic-wide, read-only) ───────────────────────────────
  server.registerTool(
    'search_team_memory',
    {
      title: 'Search what the team knows',
      description:
        'Search everything the care team and the agents wrote down in this clinic, by words and (when embeddings are on) by meaning, ranked higher when connected in the graph to a patient, drug or symptom the query names: review tasks (with who decided and why), draft notes, team notes, signed care-team decisions, open findings and the asking person’s own past conversations. Each hit names its patient and says how it matched.',
      inputSchema: { query: z.string().min(2).max(200).describe('words to search for, e.g. "swelling amlodipine" or "dismissed cough"') },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const { value: hits, queries } = await traced((t) => searchMemory(query, t));
      if (!hits.length) return text('Nothing in the team’s memory matches that.', false, queries);
      return text(
        hits
          .slice(0, 12)
          .map(
            (h) =>
              `- [${h.kind}${h.status ? `, ${h.status}` : ''}${h.match ? `, matched by ${h.match === 'both' ? 'words and meaning' : h.match}` : ''}] ${h.patientName}${h.patientId ? ` (${h.patientId})` : ''}: ${h.title ?? ''}${h.text ? ` — ${String(h.text).slice(0, 220)}` : ''}${h.by ? ` (by ${h.by})` : ''}`,
          )
          .join('\n'),
        false,
        queries,
      );
    },
  );

  server.registerTool(
    'who_knows',
    {
      title: 'Who knows what',
      description:
        'Which people on the care team have handled each kind of prescribing cascade (tasks they acted on or dismissed, decisions they signed). Optionally for one pattern id.',
      inputSchema: {
        pattern: z
          .string()
          .regex(/^[a-z0-9_]{2,60}$/)
          .optional()
          .describe('pattern id, e.g. "ccb_edema_diuretic"'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ pattern }) => {
      if (pattern && !PATTERN[pattern]) return text(`Unknown pattern "${pattern}".`, true);
      const { value: experts, queries } = await traced((t) => whoKnows(pattern ?? null, t));
      if (!experts.length) return text('No one has decided on that kind of cascade yet.', false, queries);
      return text(experts.map((e) => `- ${e.person}: ${e.patterns.map((p) => `${p.title} (${p.n})`).join('; ')}`).join('\n'), false, queries);
    },
  );

  server.registerTool(
    'care_team_flows',
    {
      title: 'Where cascades cross prescribers',
      description:
        'For every open cascade link in the clinic: who prescribed the first drug and who added the second. Shows which prescriber handoffs cascades start at, and how many cross from one prescriber to another.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { value: t, queries } = await traced((tr) => careTeam(tr));
      return text(
        [
          `${t.totals.links} open cascade links; ${t.totals.crossing} (${Math.round(t.totals.crossingShare * 100)}%) cross from one prescriber to another.`,
          `Downstream drugs added by walk-in clinics: ${t.totals.addedByWalkIn}; by specialists: ${t.totals.addedBySpecialist}; by family doctors: ${t.totals.addedByFamily}.`,
          'Top handoffs:',
          ...t.flows
            .filter((f) => f.fromBy !== f.toBy)
            .slice(0, 8)
            .map((f) => `- ${f.fromBy} → ${f.toBy}: ${f.links} links (${f.likely} likely)`),
        ].join('\n'),
        false,
        queries,
      );
    },
  );

  server.registerTool(
    'learned_procedures',
    {
      title: 'What the agents learned',
      description:
        'Procedural memory: for each kind of cascade, who review tasks go to and for which tier, learned from what the care team did with earlier tasks, with the reason.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { value: rows, queries } = await traced((t) => learnedProcedures(t));
      return text(
        rows
          .map(
            (r) =>
              `- ${r.pattern ?? 'Default'} (v${r.procedure.version}): tasks to the ${r.procedure.role}, from tier ${r.procedure.minTier}. ${r.procedure.reason} [learned from ${r.learnedFrom} decided tasks]`,
          )
          .join('\n'),
        false,
        queries,
      );
    },
  );

  // ─── Resources: the graph model and the query catalog ──────────────────────
  server.registerResource(
    'query-catalog',
    'domino://queries',
    { title: 'Cypher query catalog', description: 'Every Cypher query Domino runs, with its purpose and mode.', mimeType: 'text/markdown' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: QUERY_LIST.map((q) => `## ${q.title} (\`${q.id}\`, ${q.mode})\n${q.purpose}\n\n\`\`\`cypher\n${q.cypher}\n\`\`\``).join('\n\n'),
        },
      ],
    }),
  );
  server.registerResource(
    'graph-model',
    'domino://graph-model',
    { title: 'Graph model', description: 'Node labels and relationship types in a Domino clinic graph.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GRAPH_MODEL }] }),
  );

  if (opts.allowWrites) {
    server.registerTool(
      'run_review',
      {
        description:
          'Run the full Domino agent team (Detective, Pharmacist, Scribe) on one patient. Writes findings, proposed tasks and draft notes into the graph for human approval.',
        inputSchema: { patient_id: patientId },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ patient_id }) => {
        const log: string[] = [];
        const res = await runReview({
          patientId: patient_id,
          trigger: 'mcp',
          emit: (e: AgentEvent) => {
            if (e.type === 'tool') log.push(`[${e.agent}] ${e.name}`);
            if (e.type === 'task') log.push(`  task proposed: ${e.title}`);
          },
        });
        return text(`${res.summary}\n${res.findings} findings, ${res.tasks} tasks proposed, ${res.notes} notes drafted (${res.mode}).\n\n${log.join('\n')}`);
      },
    );
  }
  return server;
}
