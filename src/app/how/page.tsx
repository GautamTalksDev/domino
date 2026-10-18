import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ArchDiagram } from '@/components/ArchDiagram';
import { SchemaDiagram } from '@/components/SchemaDiagram';
import { MemoryDiagram } from '@/components/MemoryDiagram';
import { CLINICS } from '@/lib/tenant';
import { Cypher } from '@/components/Cypher';
import { QUERY_LIST, Q } from '@/lib/cypher';
import { CypherCatalog } from '@/components/CypherCatalog';
import { TOOLS } from '@/lib/agent/tools';
import { AGENT_INFO } from '@/lib/agent/events';

export const metadata: Metadata = { title: 'How it works' };

const OWASP: [string, string][] = [
  [
    'A01 Broken Access Control',
    'Each clinic is its own FalkorDB graph, chosen on the server from the session and never from a parameter. A run is bound to one patient; agents cannot pass a patient id. Conversations are scoped to the person. Writes need same-origin requests and, when set, an access key. Only humans write decisions.',
  ],
  ['A02 Security Misconfiguration', 'Nonce-based CSP, frame-ancestors none, nosniff, strict referrer policy, no x-powered-by, HSTS in production.'],
  [
    'A03 Software Supply Chain',
    'Exact-pinned dependencies, lockfile, zero npm audit findings, no install scripts of our own, ESLint chain dropped to remove a vulnerable transitive dependency.',
  ],
  ['A04 Cryptographic Failures', 'HMAC-SHA256 signatures on handoffs, tasks and decisions with timing-safe comparison; secrets only in server env.'],
  [
    'A05 Injection',
    `No string-built Cypher anywhere: ${QUERY_LIST.length} named, parameterised queries. Free text reaches the full-text index only as plain lower-case words (no search operators). Id lookups use null-prototype maps. LLM output is never executed as code or Cypher, and React escapes all text.`,
  ],
  ['A06 Insecure Design', 'Human approval on every action, per-run write limits, a wording guardrail that rejects instructions to change medicines.'],
  ['A07 Authentication Failures', 'Optional access key exchanged for an httpOnly, SameSite=Strict cookie; constant-time comparison.'],
  ['A08 Data Integrity Failures', 'Signed records are verified on read; a forged decision or task is ignored and flagged.'],
  [
    'A09 Logging & Alerting',
    'Every agent step is a Step node linked to the catalog queries it ran and to what it wrote: a provenance graph you can query. Server logs omit secrets and patient data.',
  ],
  ['A10 Exceptional Conditions', 'Typed errors mapped to safe HTTP responses, timeouts on LLM calls, model fallbacks, a planner when no LLM is set.'],
];

const AGENTIC: [string, string][] = [
  [
    'LLM01 / ASI01 Prompt injection, goal hijack',
    'Record content is wrapped as data; tools never take free text into Cypher; agent goals are fixed by role prompts and tool subsets.',
  ],
  [
    'LLM06 / ASI02 Excessive agency, tool misuse',
    'Least privilege per agent (Detective cannot draft notes, Scribe cannot read other patients), read tools are database-enforced read-only.',
  ],
  [
    'ASI06 Memory poisoning',
    'Only people write decisions, every decision is signed (verdict and reason) and verified before an agent uses it. Procedures change only from decided tasks, by a plain rule, and link to the tasks they learned from.',
  ],
  ['ASI07 Insecure inter-agent communication', 'Handoffs are stored in FalkorDB, signed, read back and verified; a failed check stops the run.'],
  [
    'LLM09 / ASI09 Misinformation, trust exploitation',
    'Every claim carries its graph path and evidence label; the UI shows the Cypher; outputs are questions, not orders.',
  ],
  [
    'LLM10 Unbounded consumption',
    'Rate limits per client and bucket, step and token budgets per agent, a bounded conversation history, timeouts, one run per patient at a time across every instance (a graph lease), and a cap on open check-ups.',
  ],
  [
    'ASI03 Identity and privilege abuse',
    'Tenant isolation by graph; the clinic-wide brain is read-only and confined to the session’s clinic graph; the MCP server serves one clinic per process.',
  ],
];

export default function HowPage() {
  return (
    <div className="pt-10">
      <p className="kicker">Architecture</p>
      <h1 className="font-display mt-3 text-5xl font-semibold">How Domino works</h1>
      <p className="mt-3 max-w-3xl text-bone-2">
        Domino is a team of agents that use FalkorDB as their only source of truth. They decide which graph queries to run, act by writing findings, tasks and
        notes back into the graph, remember what the care team decided and did, learn how to route their work, and show the path behind every answer. Each
        clinic is its own graph: {CLINICS.map((c) => c.name).join(' and ')} in this demo.
      </p>
      <nav
        aria-label="On this page"
        className="no-print sticky top-16 z-30 -mx-4 mt-6 flex gap-1.5 overflow-x-auto border-b hairline bg-ink/90 px-4 py-2.5 backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border sm:px-2"
      >
        {[
          ['architecture', 'Architecture'],
          ['agents', 'Agents'],
          ['tracks', 'Tracks'],
          ['query', 'Core query'],
          ['model', 'Graph model'],
          ['catalog', 'Cypher catalog'],
          ['mcp', 'MCP and safety'],
          ['security', 'Security'],
          ['data', 'Data'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-lg px-2.5 py-1 text-xs text-dim transition-colors hover:bg-white/[0.06] hover:text-bone">
            {label}
          </a>
        ))}
      </nav>
      <div id="architecture" className="card mt-6 scroll-mt-32 overflow-x-auto p-5">
        <ArchDiagram queries={QUERY_LIST.length} tools={TOOLS.length} />
      </div>

      <section id="agents" className="mt-14 grid scroll-mt-32 gap-6 lg:grid-cols-3">
        {(['detective', 'pharmacist', 'scribe'] as const).map((k) => (
          <div key={k} className="card p-5">
            <h2 className="font-display text-2xl font-semibold">{AGENT_INFO[k].name}</h2>
            <p className="mt-2 text-sm text-bone-2">{AGENT_INFO[k].job}</p>
            <ul className="mono mt-4 space-y-1 text-[12px] text-dim">
              {TOOLS.filter((t) => t.roles.includes(k)).map((t) => (
                <li key={t.name}>
                  {t.write ? <span className="text-vermilion-2">write </span> : <span className="text-sage">read </span>}
                  {t.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section id="tracks" className="mt-14 grid scroll-mt-32 gap-8 lg:grid-cols-3">
        <div>
          <p className="kicker text-vermilion-2">Track 1 · Agents that act on connected data</p>
          <h2 className="font-display mt-2 text-3xl font-semibold">Decide with the graph, act on the graph</h2>
          <ul className="mt-4 space-y-3 text-sm text-bone-2">
            <li>
              <strong className="text-bone">Multi-hop reasoning.</strong> Variable-length paths over CAUSES and TREATED_BY, constrained to the patient’s own
              medicines; cycles; harm chains.
            </li>
            <li>
              <strong className="text-bone">Graph queries and algorithms as tools.</strong> {TOOLS.length} agent tools over the catalog, including betweenness
              centrality (find_chokepoints, which sets task priority in every review) and allShortestPaths (trace_route), plus sequence symmetry
              across the population. Every medicine a question names is resolved against the graph first; one it does not know is said to be unchecked.
            </li>
            <li>
              <strong className="text-bone">Tool selection through MCP.</strong> Ask Domino and the care-team brain call every tool through Domino’s own MCP
              server; with a language model they discover the tools there too and the model chooses them. Every result carries the catalog query ids in
              its metadata, so answers can cite them.
            </li>
            <li>
              <strong className="text-bone">Actions from what the graph shows.</strong> Findings, routed tasks and draft notes written back; a prescriber check
              that stops a documented cascade before it is written; a new prescription re-runs the Detective.
            </li>
            <li>
              <strong className="text-bone">Explainable results.</strong> A provenance graph behind every finding: the run, the step, the queries it ran, the
              evidence, the memory it used, the handoffs that carried it and the tasks it led to.
            </li>
          </ul>
        </div>
        <div>
          <p className="kicker text-iris">Track 2 · Agent memory and coordination</p>
          <h2 className="font-display mt-2 text-3xl font-semibold">Remember, learn, hand off</h2>
          <ul className="mt-4 space-y-3 text-sm text-bone-2">
            <li>
              <strong className="text-bone">Episodic.</strong> Runs, steps, findings, signed decisions; each run starts with what changed since the last one.
            </li>
            <li>
              <strong className="text-bone">Semantic.</strong> Decisions attach to Pattern nodes, so feedback accumulates across patients; the knowledge graph
              itself.
            </li>
            <li>
              <strong className="text-bone">Procedural.</strong> Procedure nodes say who a task goes to and for which tier, learned from decided tasks,
              versioned with SUPERSEDES and LEARNED_FROM.
            </li>
            <li>
              <strong className="text-bone">Conversation history.</strong> Every question and answer is a Message in a Conversation owned by one person;
              follow-ups resolve against it, days later.
            </li>
            <li>
              <strong className="text-bone">Shared state and handoffs.</strong> Signed Handoff nodes, read back and verified, linked to the findings they carry;
              a lease node so only one review per patient runs across every instance.
            </li>
            <li>
              <strong className="text-bone">Concurrency.</strong> Benchmarked: parallel agent runs reading and writing one graph, with the lease and tenant
              isolation checked under load (docs/BENCHMARK.md).
            </li>
            <li>
              <strong className="text-bone">Per tenant and per user.</strong> One FalkorDB graph per clinic; conversations per person.
            </li>
          </ul>
        </div>
        <div>
          <p className="kicker text-sage">Track 3 · A care-team brain</p>
          <h2 className="font-display mt-2 text-3xl font-semibold">How the clinic works</h2>
          <ul className="mt-4 space-y-3 text-sm text-bone-2">
            <li>
              <strong className="text-bone">Docs, tickets and chats in one graph.</strong> Team notes (protocols, handovers, chats) linked to the drugs,
              symptoms and patients they name, next to tasks, decisions, findings and conversations, with one full-text search across them.
            </li>
            <li>
              <strong className="text-bone">Who owns what.</strong> Prescriber nodes behind every drug; tasks addressed to the prescriber who owns the root
              drug.
            </li>
            <li>
              <strong className="text-bone">Who knows what.</strong> Who has acted on or decided each kind of cascade.
            </li>
            <li>
              <strong className="text-bone">Decisions traced to their source.</strong> Task → the procedure it followed → the decided tasks that procedure
              learned from.
            </li>
            <li>
              <strong className="text-bone">Knowledge kept current.</strong> Findings superseded on every run, “what changed” recorded, procedures re-learned on
              every decision, labels cross-checked against openFDA.
            </li>
            <li>
              <strong className="text-bone">Answers with clear sources.</strong> The care-team brain cites every tool call and graph query behind an answer.
            </li>
          </ul>
        </div>
      </section>

      <section id="query" className="mt-14 scroll-mt-32">
        <p className="kicker">The core query</p>
        <h2 className="font-display mt-2 text-3xl font-semibold">A cascade is a path</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Cypher code={Q.paths.cypher} />
          <Cypher code={Q.links.cypher} />
        </div>
      </section>

      <section id="model" className="mt-14 scroll-mt-32">
        <p className="kicker">Graph model · knowledge and patients</p>
        <div className="card mt-4 overflow-x-auto p-5">
          <SchemaDiagram />
        </div>
        <p className="kicker mt-8">Graph model · memory, provenance and the care team</p>
        <div className="card mt-4 overflow-x-auto p-5">
          <MemoryDiagram />
        </div>
      </section>

      <section id="catalog" className="mt-14 scroll-mt-32">
        <p className="kicker">Every query Domino runs</p>
        <h2 className="font-display mt-2 text-3xl font-semibold">The Cypher catalog ({QUERY_LIST.length})</h2>
        <p className="mt-2 max-w-3xl text-sm text-dim">
          There is no other Cypher in the app. User input only reaches FalkorDB as a parameter; reads run as GRAPH.RO_QUERY, so the database itself refuses
          writes; and the agents can only write through the fixed templates marked write.
        </p>
        <CypherCatalog items={QUERY_LIST.map((q) => ({ id: q.id, title: q.title, purpose: q.purpose, mode: q.mode, cypher: q.cypher }))} />
      </section>

      <section id="mcp" className="mt-14 grid scroll-mt-32 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-display text-2xl font-semibold">Use Domino from any MCP client</h2>
          <p className="mt-2 text-sm text-bone-2">
            The same tools run as a stdio MCP server for one clinic (DOMINO_CLINIC): patient tools, the prescriber check, and the care-team brain
            (search_team_memory, who_knows, care_team_flows, learned_procedures), plus the query catalog and the graph model as MCP resources. Read-only by
            default; DOMINO_MCP_ALLOW_WRITES=true adds run_review.
          </p>
          <pre
            tabIndex={0}
            aria-label="MCP client configuration"
            className="mono mt-4 overflow-x-auto rounded-xl bg-black/40 p-4 text-[12px] leading-relaxed text-bone-2"
          >{`{
  "mcpServers": {
    "domino": {
      "command": "npx",
      "args": ["tsx", "scripts/mcp-server.ts"],
      "cwd": "/path/to/domino",
      "env": { "FALKORDB_URL": "redis://localhost:6379", "DOMINO_CLINIC": "riverside" }
    }
  }
}`}</pre>
        </div>
        <div className="card p-5">
          <h2 className="font-display text-2xl font-semibold">Clinical safety</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-bone-2">
            <li>Domino raises questions. A guardrail checks everything an agent writes or says (tasks, notes, handoffs, answers) and holds back anything that tells someone to stop, start, switch or change the dose of a medicine.</li>
            <li>Deliberate pairings (stomach protection with an NSAID, potassium with a diuretic, B12 with metformin) are recognised and set aside.</li>
            <li>The what-if is labelled a simulation and always names other contributors.</li>
            <li>Every action is a proposal until a person approves it.</li>
            <li>The what-if says which medicines need a gradual taper if changed (benzodiazepines, antidepressants, beta blockers, levodopa and others).</li>
            <li>
              In the prescriber check, a planned companion (a PPI with an NSAID) never raises a cascade stop by itself, and a link the engine scores unlikely
              raises nothing.
            </li>
            <li>Synthetic data only: no real patient information is ever loaded.</li>
          </ul>
        </div>
      </section>

      <section id="cds-hooks" className="mt-14 grid scroll-mt-32 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <p className="kicker">Interoperability</p>
          <h2 className="font-display mt-2 text-2xl font-semibold">Inside any EHR, over CDS Hooks</h2>
          <p className="mt-2 text-sm leading-relaxed text-bone-2">
            EHRs call outside decision support at the moment of prescribing through CDS Hooks 2.0 (HL7). Domino is a CDS service:{' '}
            <span className="mono text-bone">GET /cds-services</span> lists <span className="mono text-bone">domino-order-select</span> and{' '}
            <span className="mono text-bone">domino-order-sign</span>; a call carries the draft MedicationRequest and, as prefetch, the active medicines and
            conditions. Domino runs the prescriber check on the graph and answers with cards: a summary, a markdown detail, a suggestion that deletes the
            draft order, and override reasons that mirror its signed decisions.
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-bone-2">
            <li>A patient Domino holds is checked against their record; anyone else from the prefetch, as a temporary check-up patient with no name kept.</li>
            <li>Every card is a CdsCard node (ABOUT the patient, CHECKED the drug ordered, CULPRIT the drug whose side effect it treats), and the EHR’s feedback is recorded on it, first answer only.</li>
            <li>Medicines match by name through the full-text index, and only when the generic or brand name is really in the text. No RxNorm mapping yet, so an order that matches nothing gets an info card saying Domino did not check it: not in the graph is not the same as safe.</li>
            <li>CORS for these routes only; rate-limited; stored cards capped at 2,000; with DOMINO_WRITE_KEY set, outside callers can only check patients Domino holds.</li>
            <li>
              With DOMINO_CDS_ISSUERS set, every call needs the EHR’s signed token (ES384 or RS384, checked against its JWKS, audience, five-minute
              lifetime, one use). Without it the service runs as an open demo.
            </li>
          </ul>
          <Link href="/ehr" className="btn btn-ghost mt-4">
            Try it in the demo EHR <ArrowRight size={14} />
          </Link>
        </div>
        <div className="card p-5">
          <p className="text-sm font-semibold">A card, as the EHR receives it</p>
          <pre
            tabIndex={0}
            aria-label="Example CDS Hooks card"
            className="mono mt-3 overflow-x-auto rounded-xl bg-black/40 p-4 text-[12px] leading-relaxed text-bone-2"
          >{`{
  "summary": "Benztropine may be treating a side effect of
              Risperidone: a possible prescribing cascade",
  "indicator": "warning",
  "detail": "Benztropine treats parkinsonism (EPS), a known
             side effect of Risperidone …",
  "source": { "label": "Domino · prescribing cascade check" },
  "suggestions": [{
    "label": "Hold Benztropine and review Risperidone first",
    "actions": [{ "type": "delete",
                  "resourceId": ["MedicationRequest/draft-1"] }]
  }],
  "selectionBehavior": "at-most-one",
  "overrideReasons": [
    { "code": "intentional" }, { "code": "not-a-cascade" },
    { "code": "will-review" }
  ]
}`}</pre>
        </div>
      </section>

      <section id="security" className="mt-14 scroll-mt-32">
        <p className="kicker">Security</p>
        <h2 className="font-display mt-2 text-3xl font-semibold">OWASP Top 10:2025, LLM Top 10 and Agentic Top 10</h2>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <table className="card w-full overflow-hidden text-left text-sm">
            <tbody>
              {OWASP.map(([k, v]) => (
                <tr key={k} className="border-b hairline last:border-0 align-top">
                  <td className="w-[38%] px-4 py-3 font-medium text-bone">{k}</td>
                  <td className="px-4 py-3 text-bone-2">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="card h-fit w-full overflow-hidden text-left text-sm">
            <tbody>
              {AGENTIC.map(([k, v]) => (
                <tr key={k} className="border-b hairline last:border-0 align-top">
                  <td className="w-[38%] px-4 py-3 font-medium text-bone">{k}</td>
                  <td className="px-4 py-3 text-bone-2">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="data" className="card mt-14 scroll-mt-32 p-6">
        <h2 className="font-display text-2xl font-semibold">Data and disclosure</h2>
        <p className="mt-2 text-sm leading-relaxed text-bone-2">
          The knowledge graph (116 drugs, 50 effects, 268 CAUSES and 189 TREATED_BY edges, 27 documented patterns, 4 dangerous combinations) was curated by hand
          from product labelling, the AGS Beers Criteria 2023, the Anticholinergic Cognitive Burden scale, ThinkCascades and published studies, with references
          stored on each pattern. Patients are synthetic, produced by a seeded generator in this repository. AI coding assistants were used while building
          Domino; the team reviewed, tested and can explain every part of it.
        </p>
      </section>
    </div>
  );
}
