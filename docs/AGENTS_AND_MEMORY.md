# Agents, memory and coordination

## The agents

| Agent | Job | Tools |
| - | - | - |
| **Detective** | Find cascades, loops and combined harm; say what changed since the last review; record the findings that matter; hand off | `get_patient_context`, `find_cascades`, `recall_memory`, `check_harms`, `record_findings` |
| **Pharmacist** | For the strongest roots: evidence, other reasons, safer options, the what-if (with taper warnings), population signal, chokepoints; hand off | `explain_link`, `find_safer_alternatives`, `simulate_untangle`, `population_signal`, `find_chokepoints`, `trace_route`, `recall_memory`, `check_harms` |
| **Scribe** | Turn the evidence into review tasks (routed by procedural memory) and two draft notes | `propose_task`, `draft_note` |
| **Domino** (Ask) | Answer a clinician's question about one patient, read-only, through MCP, remembering the conversation | patient read tools via MCP |
| **Care-team brain** | Answer questions about the whole clinic, read-only, through MCP, remembering the conversation | `search_team_memory`, `who_knows`, `care_team_flows`, `learned_procedures`, patient read tools via MCP |
| **Sweep** | Review every patient in the clinic, write findings back, put the strongest documented cascades in the inbox | the engine and the same task path as the Scribe |

Full tool list: [TOOLS.md](TOOLS.md). Role prompts: `src/lib/agent/prompts.ts`.

## Track 1: deciding and acting with the graph

- **Multi-hop reasoning.** `find_cascades` walks variable-length paths; the Pharmacist chains further queries off what came back
  (the root, the effect, the downstream drugs).
- **Graph queries and algorithms as tools.** Path finding, cycle detection, pattern matching by traversal, `allShortestPaths` (`trace_route`),
  `algo.betweenness` (`find_chokepoints`, which runs in every review: a review task for a cascade through one of the top drug chokepoints is due
  in half the usual time and says why), and prescription sequence symmetry across all patients (`population_signal`). Every medicine a question
  names is resolved against the graph (`resolve_drug`); one Domino does not know is said to be unchecked, never guessed at.
- **Tool selection through MCP.** Ask Domino and the care-team brain connect to Domino's own MCP server and call every tool with `tools/call`
  (the console marks those steps **MCP**); with a language model they discover the tools with `tools/list` and the model chooses them, and
  without one the planner chooses by rules. For a patient question Domino injects the patient id, so the model can't reach
  another record. Every MCP result carries `_meta["domino/queries"]`: the catalog query ids it ran, which become the answer's cited sources.
  `npm run mcp` exposes the same server, plus the query catalog and graph model as MCP resources, to any MCP client.
- **Actions from what the graph shows.** `record_findings`, `propose_task`, `draft_note`; the prescriber check; and an event trigger: adding a
  prescription re-runs the review automatically.
- **Explainable results.** The provenance graph (below), named scoring factors, evidence on every link, Cypher on every step.

## Track 2: memory and coordination

| Kind | How | Where in the graph |
| - | - | - |
| **Episodic** | Each run, every tool-call step, finding, task, note and handoff; each run records what changed since the previous one | `Run`, `Step`, `Finding`, `Task`, `Note`, `Handoff`, `Run`-[`FOLLOWS`]->`Run` |
| **Semantic** | Clinician decisions attach to the patient and to the pattern; `pattern_feedback` aggregates them across patients; team notes (protocols, handovers, chats) linked to what they name; the knowledge graph | `Decision`-[`ABOUT`]->`Patient`, -[`ON_PATTERN`]->`Pattern`, `Doc`-[`MENTIONS`]->`Drug`/`Effect`/`Patient` |
| **Procedural** | How to act: who a task goes to, how soon, and for which tier, learned from decided tasks | `Procedure`, -[`SUPERSEDES`]->, -[`LEARNED_FROM`]->`Task`, `Task`-[`FOLLOWED`]-> |
| **Conversations** | Every question and answer, per person, resumable | `Conversation`-[`HAS`]->`Message`-[`RAN`]->`Query` |
| **Shared state** | Signed handoffs read back and verified; leases | `Handoff`-[`CARRIED`]->`Finding`, `Lock` |
| **Per tenant, per user** | A graph per clinic; conversations and decisions per person | `FALKORDB_GRAPH` + clinic suffix |

### Procedural memory

A `Procedure` says, for one cascade pattern, **who** a review task goes to (pharmacist, prescriber or nurse), **how soon** it is due, and whether a
"possible" link gets a task at all. Every task a person approves, completes or dismisses is an outcome. A task only moves forward
(proposed → approved or dismissed; approved → done), so an outcome cannot be rewritten later, and only tasks whose signature
verifies (title, body, role, run and pattern) count as outcomes: a task planted in the graph can be dismissed, but it teaches nothing. After each decision Domino re-learns the
procedure for that task's pattern with a rule you can read in `src/lib/memory/procedures.ts`:

- **Routing.** For each role with at least 3 decided tasks, the acted-on rate (approved or done) is Laplace-smoothed: (acted + 1) / (n + 2).
  If another role beats the current one by 0.25 or more, tasks go to that role.
- **Threshold.** With at least 5 decided tasks, if the team acts on fewer than 30%, only *likely* links get a task (possible ones stay as findings);
  if it acts on 60% or more again, possible links get tasks again.

A change writes a new version that `SUPERSEDES` the old one and links to every task it `LEARNED_FROM`. The write only applies if the active
version is still the one the learning read, so two people deciding at once can never produce two "v2"s; the second simply re-learns. The Scribe and the sweep both go through
`proposeTask()` in `src/lib/agent/actions.ts`, which applies the active procedure and links the task to it (`FOLLOWED`). It also refuses to
duplicate a question already open for the patient (same link or same title), so the review agents and the sweep share one inbox without
flooding it: the Scribe's trace says "already in the inbox" instead. So the inbox can say
"routed by learned procedure v1", and a person can follow that back to the eight decided tasks it came from.

The seed gives each clinic a different history (`src/data/history.ts`): at Riverside, prescribers acted on all four calcium-channel-blocker swelling
tasks while pharmacists passed three of four on, so those tasks now go to the prescriber; the team dismissed four of five ACE-inhibitor cough tasks,
so only likely ones get a task. NSAID blood-pressure tasks are one decision away: three of four dismissed so far, so dismissing one more in the
inbox learns a new procedure on the spot. At Lakeview the consultant pharmacist acts on the swelling tasks, so nothing changes there, but
antidepressant insomnia tasks now go to the prescriber.

### Team notes

People add protocols, handovers, chat messages and minutes on the care-team page. `src/lib/docs.ts` asks FalkorDB's full-text indexes which
drugs and symptoms share a word with the note, keeps a candidate only if one of its names (generic, brand or plain word) appears in the text as
a whole phrase, recognises patients by full name, and writes one `Doc` with `MENTIONS` edges. A note then shows in the memory tab of the
patients it concerns (it names them, or it names none and mentions one of their medicines with a problem they have or are treated for), comes
up in the care-team search, and appears in `recall_memory`, so the Detective says "the care team has written a note about this" before it
reviews. Note text is human-written and untrusted: agents see titles only, as data.

### Conversations

Ask Domino and the care-team brain open a `Conversation` for the person in the session (one per patient, or one for the clinic) and append each
question and answer as `Message` nodes, with the tool calls and query ids behind the answer. The next question in the same conversation sends up to
eight earlier messages to the model, so "what could replace it?" knows what "it" is; the planner resolves the same follow-ups from the stored
messages. Every read is scoped to the person (`user`) and the subject (`about`): one person can never read or append to another's conversation,
and the care-team search only ever returns your own messages.

### Provenance

Every tool call becomes one `Step` with the catalog `Query` nodes it `RAN`. What the tool writes is stamped with the step and, when the run ends,
linked back with `PRODUCED`. A finding links to its drugs (`ROOT`, `TO`), effect (`VIA`), pattern (`MATCHES`, which `CITES` its references) and any
signed decision it `CONSIDERED`; handoffs link to the findings they `CARRIED`; tasks link to the finding they are `ABOUT`, the procedure they
`FOLLOWED` and the prescriber they are `ADDRESSED_TO`. `trace_finding` reads all of it in one query, and the workspace draws it as
*How Domino got here*.

### Shared state and leases

Before a review starts, the runner takes the lease `review:<patient>` in the graph:

```cypher
MERGE (l:Lock {key: $key})
ON CREATE SET l.owner = $owner, l.until = $until, l.at = $now
WITH l
WHERE l.owner = $owner OR l.until < $now
SET l.owner = $owner, l.until = $until, l.at = $now
RETURN l.owner AS owner
```

FalkorDB runs write queries one at a time per graph, so the check-and-set is atomic across every app instance. The lease lasts two minutes, is
renewed every 30 seconds while the run is alive, and is released by its owner only; if a process dies, it expires. The population sweep takes
the lease `sweep`, so the button and the nightly cron never overlap. The benchmark starts 12 reviews of one patient at once: one runs, eleven are
refused ([BENCHMARK.md](BENCHMARK.md)).

### Tenants and users

Each clinic is its own FalkorDB graph (`domino`, `domino_lakeview`), seeded with its own patients, history and procedures. The graph is chosen on
the server from the session: route handlers run inside an `AsyncLocalStorage` scope set from the session cookies (validated against an allowlist),
server components read the same cookies, scripts and tests use `runInScope()`, and the MCP server serves one clinic per process (`DOMINO_CLINIC`).
A request parameter or a model's tool call can never name a graph. The demo identities (two or three people per clinic) are not authentication;
in production they map to an SSO identity.

### Memory in action

1. Open Frank Russo. Two links (metformin → B12, lithium → levothyroxine) are already **intentional**: the care team said so in an
   earlier session, and the agents read those signed decisions first.
2. Open Beatrice, select *Furosemide → low potassium → Potassium chloride*, and mark it intentional. Your decision is signed in your name.
3. Run the review again. The Detective says what changed since the last review, the link is set aside, and the Scribe no longer mentions it.
4. Ask "why is she on furosemide?", then "what could replace it?". Come back tomorrow, open the history, and continue.

### Memory poisoning defence

Agents have no tool that writes a `Decision`. Only the `/decisions` API (a person, same-origin, optionally behind an access key) can,
and every decision is signed with HMAC-SHA256 over its canonical content, including the reason a later run shows to clinicians. On read, a
decision whose signature fails is ignored and surfaced as a warning. Tasks are signed over their title and body, so an edited task cannot be
approved. Procedures change only from decided, signature-verified tasks, by the rule above, and keep the evidence they learned from. Check-ups (sandbox patients) never feed clinic-wide memory.

## LLM mode

Set one key (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENAI_BASE_URL` for any compatible endpoint).
Each agent then runs a tool-calling loop:

```
for up to 8 turns:
  model sees: role prompt + earlier conversation (Ask) + task (or verified handoff wrapped as <data>) + previous tool results
  model returns tool calls (4 run per turn; extra calls are answered "skipped") or a final message
  each call → callTool() or MCP: role check → zod validation → Cypher → summary back to the model
final message → signed handoff to the next agent
```

Provider-native content is replayed verbatim between turns (Gemini thought signatures, Anthropic `tool_use` blocks).
Gemini falls back across models on 429/5xx and remembers which model is cooling down. All three adapters are tested
against mock servers that follow each provider's documented request and response shapes (`tests/providers.test.ts`).
With a key, the planner still acts as a safety net: if the Detective records nothing or the Scribe proposes nothing, the planner's step runs and the trace says so.
