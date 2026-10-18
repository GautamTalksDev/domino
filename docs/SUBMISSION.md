# Submission copy (paste-ready)

## Project name
Domino

## Tagline
AI agents that find the pill that's treating another pill, remember what the care team decides, and stop the next one before it is written.

## Tracks
- **Track 01: Agents That Act on Connected Data** (primary)
- **Track 02: Agent Memory and Coordination**
- **Track 03: Company Brain**, as a care-team brain for a clinic

Every requirement on every track, with where to see it and the code: [docs/TRACKS.md](TRACKS.md).

## Short description
Domino is a team of AI agents that walk a FalkorDB medication graph to find prescribing cascades in older adults: a side effect mistaken for
a new illness and treated with another drug, then another. The Detective finds multi-hop cascade paths, loops and dangerous combinations; the
Pharmacist checks the evidence, finds safer options and simulates the untangle; the Scribe proposes review tasks routed by what the team has
taught it, and drafts notes. Every finding links back through a provenance graph to the exact steps and Cypher queries that produced it. A
prescriber check stops the next cascade before it is written, and a care-team brain answers questions about the whole clinic with sources.

## What it does
- **Finds** prescribing cascades as variable-length paths over `CAUSES` and `TREATED_BY`, constrained to the patient's own medicines, scored on
  side-effect frequency, timing against the usual onset window, other reasons for the second drug, and published evidence (27 documented patterns
  including the 9 ThinkCascades).
- **Explains** every link with named factors, references and the real-world sequence ratio, and with a **provenance graph**: run → step → the
  catalog queries it ran → finding → drugs, effect, pattern, references, the care-team decisions it considered → the handoffs that carried it →
  the tasks it led to and the learned procedure they followed.
- **Simulates** "what if this drug were reviewed?" with a fixed-point computation over the patient's cascade links (read from the graph), and names the medicines that need a taper.
- **Acts**: records findings, proposes signed review tasks (addressed to the prescriber who owns the root drug), drafts an SBAR note and a family note.
- **Prevents**: a prescriber check scores a new drug with the same engine before it is written. Replayed over the synthetic cohort's 2,443
  prescriptions as they were written, it would have stopped 401 of the 534 cascade drugs it met (75%) at the first downstream prescription (95%
  of its cascade stops correct), sparing 510 prescriptions, at a cost of about 21 stops and 33 cautions per 100 prescriptions checked.
- **Refuses to guess**: every medicine a question, an EHR order or a pasted list names is resolved against the graph. One Domino does not know
  is named as not checked, in the answer, on the CDS card and on the check-up: not in the graph is not the same as safe.
- **Lets an algorithm decide**: FalkorDB's betweenness centrality runs in every review; a cascade through a chokepoint drug gets its review task
  in half the usual time, and the task says why.
- **Remembers**: episodic (runs, steps, what changed since last time), semantic (signed clinician decisions on the patient and the pattern),
  procedural (who a task goes to and when, re-learned from every decided task, versioned with `SUPERSEDES` and `LEARNED_FROM`), and conversations
  per person that a follow-up question can resolve against days later.
- **Coordinates**: signed handoffs read back from the graph, a lease per patient so two app instances never run the same review, separate graphs
  per clinic, and a population sweep agent whose tasks the review agents see and do not duplicate.
- **Knows the clinic**: the care-team brain searches tasks, notes, decisions, findings and your own conversations in one full-text query; knows
  who prescribes what, who has decided on each kind of cascade, where cascades cross from one prescriber to another, and what the agents learned.
- **Takes a real-looking list**: paste "Norvasc since March 2025, Lasix, Aricpet" and FalkorDB's fuzzy full-text index maps it onto the graph.
- **Speaks FHIR**: any review exports as a FHIR R4 Bundle (`DetectedIssue` per cascade, `Task` per review task, `Provenance` for the agents), ready for an EHR or decision-support pipeline.
- **Answers inside the EHR**: Domino is a CDS Hooks 2.0 service. At order-select and order-sign an EHR sends the draft order and the medication list; Domino answers with standard cards (hold the order in one click, or override with a reason), and every card and answer becomes a `CdsCard` in the graph. `/ehr` is a fictional EHR that speaks the real protocol, with the JSON on screen.
- **Speaks MCP**: Ask Domino and the care-team brain call every tool over Domino's own MCP server, and with a language model they discover the
  tools there too and the model chooses them; any MCP client can use the same server.
- **Feels like a product**: a three-minute guided tour of all three tracks (`/?judge=1`), including the same question asked twice and a medicine Domino doesn't know; the landing hero is Beatrice's chain as real 3D dominoes; `/graph` shows the whole knowledge graph in 3D with any
  patient's cascade lit inside it; ⌘K / `/` searches every patient, page and action; `g` then a letter jumps between pages; team notes show
  what they will link to while you type; every page works on a phone and passes axe-core's WCAG 2 A/AA checks (`npm run a11y`).

## How we built it
Next.js 16, React 19, TypeScript, FalkorDB (Cypher, variable-length paths, cycles, `allShortestPaths`, `algo.betweenness`, full-text indexes,
one graph per tenant), three.js for the 3D dominoes and the 3D knowledge graph, Motion and d3-force for the other visuals, the Model
Context Protocol SDK, zod, Vitest. Agents run as LLM tool-calling loops
(Gemini, Claude or any OpenAI-compatible model) or as a deterministic graph planner when no key is set; if the model fails mid-run, the planner
finishes with the same tools and the run says so. All 105 Cypher queries live in one catalog that is also seeded into the graph as `Query`
nodes; reads run as `GRAPH.RO_QUERY` with a timeout.

## How FalkorDB is used (and why it is load-bearing)
Every finding is a path query; every "other reason" is a `HAS`/`TREATED_BY` pattern; documented cascades and dangerous combinations are nodes matched
by traversal, and the engine reads the medical knowledge it scores with (patterns, combination rules, drug cards) from the graph; task priority comes
from betweenness centrality; alternatives are traversals checked against diagnoses, existing side effects and `AVOID_WITH` class conflicts. All agent memory is in
the graph: runs, steps, findings, tasks, notes, handoffs, decisions, procedures, conversations, and the provenance edges between them. The lease
that stops two reviews running at once is a single write query, atomic because FalkorDB serialises writes per graph. Tenants are graphs. Search is
FalkorDB's full-text index. Remove FalkorDB and nothing works.

## Challenges
- Telling cascades from good care: a PPI started with an NSAID looks exactly like a cascade. Pattern nodes marked "usually deliberate" took
  wrongly flagged deliberate pairs from 227 to 0 on our synthetic cohort. That is by construction (the generator marks deliberate pairs with the
  same patterns), so it shows the mechanism works, not that it generalises.
- Time: the same two drugs are a cascade in one order and not the other (Beatrice vs Dorothy), and a replay has to see the record as it was.
- Learning without being poisoned: procedures change only from tasks people decided, whose signatures verify, by a rule you can read, and each
  version keeps links to the evidence it learned from.
- Making agents safe to let write: least-privilege tools, a patient-bound context, write limits, a wording guardrail, signed handoffs, tasks and decisions.
- Independent AI review passes over our own code (reviewers that had not seen it being written) found real issues: a conversation leak through
  search, a cache shared across clinics, a verdict that ignored the engine's tiers, claims in our docs the code did not back, and more. We fixed
  each one and added a test for each.

## Accomplishments
- Precision 0.75 at recall 0.96 on 632 hidden cascades in a synthetic cohort, up from 0.30 with raw graph links, with an ablation that shows each signal's contribution.
- A prevention replay: 401 of 534 cascades stopped at the first downstream prescription, cascade-stop precision 0.948.
- About 100 full analyses per second (about 1,000 graph queries per second) on one FalkorDB, and about 30 agent runs per second in planner mode
  (no language model) writing every step; 12 simultaneous reviews of one patient → exactly one runs.
- 150+ automated tests on their own graphs, including forged and edited memory, tampered tasks, conversation privacy, clinic isolation, leases,
  provenance, the replay, LLM adapters against mock provider servers, and MCP.
- Mapped to OWASP Top 10:2025, the LLM Top 10 and the Agentic Top 10 (2026).

## What's next
Validation on real prescribing data with pharmacist adjudication; dose and kidney-function awareness; SIDER and openFDA loaders to widen the
knowledge graph; SSO identities in place of the demo switcher; integration at the point of prescribing.

## Links (fill in)
- Repository: TODO_REPO_URL
- Demo video: TODO_VIDEO_URL
- Live deployment: TODO_LIVE_URL
- Access key for judges (only admin actions need it): put it in the submission form's notes for judges, not in the repository
- Blog post: `docs/BLOG.md` (publish it on Hashnode, dev.to or Medium and link it)

## AI assistance disclosure
Domino was built with an AI coding assistant (Claude, by Anthropic), which wrote most of the code, tests and documentation from our direction
and reviews. TODO(gautam): in your own words, what you decided, designed, reviewed and tested yourself.

## Requirements checklist
- [x] Public source repository
- [x] README with setup instructions and the graph data model
- [x] The Cypher queries the product depends on (`README.md`, `docs/CYPHER.md`)
- [ ] Demo video showing the working project ([VIDEO_SCRIPT.md](VIDEO_SCRIPT.md))
- [ ] Live deployment, or local setup instructions (README Quick start)
- [x] Tracks named: Track 01, Track 02 and Track 03
