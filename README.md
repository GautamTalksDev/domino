<div align="center">

<img src="public/icon-192.png" width="88" alt="Domino logo: a domino toppling into the next one" />

# Domino

**Some pills are treating other pills.**

A team of AI agents that walk a FalkorDB medication graph, find *prescribing cascades* in older adults,<br />
prove every link, remember what the care team decides, and hand a pharmacist the one question worth asking.

Graph Hacks 2026 · **Track 01: Agents That Act on Connected Data** (primary) · **Track 02: Agent Memory and Coordination** · **Track 03: Company Brain**

[Demo](#demo) · [Quick start](#quick-start) · [Tracks](docs/TRACKS.md) · [How it works](#how-it-works) · [Graph model](#graph-model) · [Cypher](docs/CYPHER.md) · [Evaluation](#evaluation) · [Security](docs/SECURITY.md)

<img src="docs/images/dominoes.gif" alt="Animation: Beatrice's four medicines as 3D dominoes; amlodipine knocks over furosemide, oxybutynin and donepezil, and each side effect lights up between them" width="820" />

</div>

---

> **Judges, start here.** Live: **[domino.gautamkhosla.com](https://domino.gautamkhosla.com)** · Video (3 min): **[Watch on YouTube](https://youtu.be/9OHJUJJjd0Q)** · The guided tour (ten steps, all three tracks)
> starts from the landing page's main button or at `/?judge=1`. Everything works without a key; only admin actions (rebuilding or sweeping
> a clinic) are locked behind an access key, and nothing a judge needs to try requires it. The six story patients stay as they are, so every judge sees the same story.

## The problem

A side effect gets mistaken for a new illness, so a second drug is prescribed to treat it. That second drug has side effects too.
Geriatricians call this a **prescribing cascade** (Rochon & Gurwitz, BMJ 1997). Each prescription looks reasonable on its own,
often from a different prescriber, months apart. The harm only shows up when you follow the chain:

> Beatrice, 84, starts **amlodipine** for blood pressure → her ankles swell → a walk-in clinic adds **furosemide** → her potassium drops, so **potassium chloride** follows → she starts leaking urine, so a urologist adds **oxybutynin** → she becomes confused, so a geriatric clinic starts **donepezil**. Nine medicines. One of them started four of the others.

In 2022, 38 clinicians from six countries agreed on nine cascades that usually do more harm than good (ThinkCascades, *Drugs & Aging*).
A 2025 study of 533,464 Irish adults aged 65+ found a diuretic was **1.93×** more likely to start *after* a calcium channel blocker than before it (Doherty et al., *Ann Fam Med*).

A cascade is a **path**: drug → side effect → drug → side effect → drug. That is why Domino is built on a graph.

## Why it needs a graph

```cypher
// Every cascade chain inside one patient's own medicines: drug → effect → drug → effect → drug
MATCH (p:Patient {id: $pid})-[:TAKES]->(m:Drug)
WITH p, collect(m.id) AS meds
MATCH (p)-[:TAKES]->(a:Drug)-[:CAUSES]->(:Effect)-[:TREATED_BY]->(:Drug)<-[:TAKES]-(p)
WITH DISTINCT a, meds
MATCH path = (a)-[:CAUSES|TREATED_BY*2..6]->(z:Drug)
WHERE z <> a AND all(n IN nodes(path) WHERE NOT n:Drug OR n.id IN meds)
RETURN [r IN relationships(path) | [startNode(r).id, type(r), endNode(r).id]] AS hops
```

What the graph does that the agents could not do without it, and the landing page proves it live: **"Same question. Same
model. One has a graph."** The same language model gets Beatrice's whole record as text, with no FalkorDB, and is asked
what Domino's agents answer from the graph; both answers are scored side by side, with the model's unedited answer and
the exact prompt it got (nothing pre-written; `src/lib/compare.ts`).


- **Finds the chain.** A variable-length path, kept inside the patient's own medicines, across prescribers and months. No single prescription looks wrong; the path does.
- **Is the medical knowledge.** 116 drugs, 50 effects, 27 documented cascade patterns with their citations, the dangerous-combination rules and each drug's class, burden and taper caution are nodes and edges. The engine reads them from FalkorDB, so the knowledge a reviewer can query is the knowledge the agents use.
- **Sets priority with an algorithm.** FalkorDB's betweenness centrality finds the chokepoint drugs many possible cascades pass through. A review task for a cascade that runs through one is due in half the usual time, and says why.
- **Refuses to guess.** Every medicine a question, an EHR order or a pasted list names is resolved against the graph's full-text index. One that is not there is said out loud ("not in Domino's graph, so not checked"), in the answer, on the CDS card and on the check-up: not in the graph is not the same as safe.
- **Remembers, so the next run differs.** Signed decisions, learned procedures, handoffs, team notes and conversations are nodes the agents read before they act. Mark a link "not a cascade" and the next review says the team decided and stops raising it; decide enough tasks of one kind and the agents re-learn who those tasks go to.
- **Shows its path.** Every finding links back through the agent step to the exact Cypher queries that wrote it.

Remove FalkorDB and nothing works: there is no in-memory fallback, by design.

## What Domino does

**Acts on connected data (Track 01)**

| | |
| - | - |
| **Finds cascades** | Multi-hop paths over `CAUSES` and `TREATED_BY`, kept inside the patient's own medicines, scored on how common the side effect is, timing against its usual onset, other reasons for the second drug, and published evidence. |
| **Shows how it got there** | A **provenance graph** behind every finding: the run, the agent step, the exact Cypher queries it ran, the drugs, effect, pattern and references it rests on, the memory it considered, the handoffs that carried it and the tasks it led to. |
| **Simulates the untangle** | "If amlodipine were reviewed": which medicines exist only because of it, what happens to pill count, anticholinergic burden, fall-risk drugs and dangerous combinations, and which medicines need a **gradual taper** if changed. |
| **Acts, with a human in the loop** | Records findings, proposes review tasks routed to the right role and addressed to the prescriber who owns the root drug, drafts an SBAR note and a family note. Nothing happens until a clinician approves. |
| **Acts on what people write** | A handover that says "Beatrice has had a dry cough for weeks" is read against her slice of the graph the moment it is saved: lisinopril causes it and nothing treats it yet, so it is a **prevention window**, and the Detective proposes a signed review task linked back to the note (`FROM_NOTE`). When a second drug was started for the symptom, it says **cascade in progress** instead. It acts only when a note is clearly about one patient and reports the symptom (“no cough today” is not a report); a note about a question already open backs that task up (`CORROBORATES`) instead of claiming it. |
| **Closes the loop** | Mark a review task done and the agents schedule their own follow-up four weeks out: has the symptom settled since the root drug was reviewed, and if so, could the medicines that were only there because of it (with their taper warnings) be reviewed too? Signed like every task, linked to the one it continues (`FOLLOWS_UP`). |
| **Speaks the EHR's language** | *Export FHIR* on any patient returns the review as a FHIR R4 Bundle: `Patient`, a `MedicationStatement` per medicine, a `DetectedIssue` per cascade link and dangerous combination (implicating both medicines, with the score, evidence and pattern), a `Task` per open review task focused on its issue, and a `Provenance` naming the agents and the graph. |
| **Answers inside any EHR** | Domino is a **CDS Hooks 2.0** service (`/cds-services`, the HL7 standard EHRs use for order-entry alerts). When a prescriber picks or signs a medicine, the EHR sends the draft order and the active medication list; Domino runs the prescriber check on the graph and answers with standard cards: a summary, the evidence, a one-click suggestion that **holds the draft order**, and override reasons that mirror Domino's signed decisions. Patients Domino doesn't hold are checked from what the EHR shares, as a temporary patient with no name kept. Every card shown at signing and the prescriber's answer become `CdsCard` nodes in the graph, live in the team's activity feed. Try it at `/ehr`, a fictional EHR that speaks the real protocol. |
| **Stops a cascade before it starts** | The prescriber check scores "this new drug treats a side effect of that one" with the same engine as the review. **Replayed over the synthetic cohort's 2,443 prescriptions as they were written, it would have stopped 401 of the 534 cascade drugs it met (75%) at the first downstream prescription** and spared 510 prescriptions, with 95% of its cascade stops correct. The cost, said plainly: about 21 stops and 33 cautions per 100 prescriptions checked ([evaluation](docs/EVALUATION.md)). |
| **Uses graph algorithms as tools** | Betweenness centrality (`find_chokepoints`) runs in every review and **sets task priority**: a cascade through a chokepoint drug is reviewed in half the time. Also allShortestPaths (`trace_route`), cycles, and prescription sequence symmetry across the population, joined to mechanism paths. |
| **Refuses to guess** | A medicine the question, an EHR order or a pasted list names is resolved against the graph (`resolve_drug`, the full-text index). One Domino does not know is named as not checked, never guessed at; one that is not on the patient's list gets the prescriber check instead of a generic answer. |
| **Selects tools through MCP** | *Ask Domino* and the *care-team brain* call every tool through Domino's own MCP server (`tools/call`); with a language model they also discover the tools (`tools/list`) and the model chooses them. Every result carries the query ids it ran, so answers cite them. |

**Remembers and coordinates (Track 02)**

| | |
| - | - |
| **Episodic, semantic, procedural** | Runs, steps and signed decisions; decisions on `Pattern` nodes that accumulate across patients; **procedures learned from what the team does with tasks** (prescribers act on CCB-swelling tasks at one clinic, so they now go to prescribers there). The demo starts with a few synthetic task outcomes so there is something learned to show; decide tasks in the inbox to watch it learn live. |
| **Conversations that persist** | Every question and answer is stored per person; "what could replace it?" resolves against the earlier turns, tomorrow as well as today. |
| **Shared state** | Signed handoffs read back from the graph and verified; a lease in the graph so only one review per patient runs across every app instance; and **live team activity**: every open screen follows the clinic's graph, so when one person dismisses a task or writes a handover, everyone else's inbox, notes and bell update within seconds. |
| **Per tenant, per user** | Each clinic is its own FalkorDB graph; conversations and decisions belong to a person. |
| **Under load** | Parallel agent runs reading and writing one graph, benchmarked in [docs/BENCHMARK.md](docs/BENCHMARK.md). |

**Knows how the care team works (Track 03)**

| | |
| - | - |
| **One graph for docs, tickets and chats** | Team notes (protocols, handovers, chats) are linked to the drugs, symptoms and patients they name (brand names such as "Flomax" and "Antivert" included, previewed live as you type); one full-text search over them, tasks, drafted notes, decisions, findings and your conversations. Before a review the Detective reads each note about the patient for the symptoms it reports (negations understood) and checks them against the graph: which of the patient's drugs can cause it, and whether one already treats it. The note's own words never reach a model. |
| **Who owns what, who knows what** | Prescribers behind every drug; where cascades cross from one prescriber to another; who has handled each kind of cascade. |
| **Decisions traced to their source** | Task → procedure version → the decided tasks it learned from. |
| **Answers with sources** | The care-team brain cites every tool call and graph query. |

**And**: a **check-up** where anyone can paste a medicine list in brand names with typos ("Norvasc, Lasix, Ditropan, Aricpet") and watch the agents
review it (FalkorDB's full-text index with fuzzy matching maps it to the graph; the temporary patient deletes itself after two hours).

**Built like a product:** a **three-minute guided tour** walks a judge through all three tracks across pages, ringing what to look at and
doing the one action each step needs (the landing page's main button, ⌘K, or any URL with `?judge=1`). The landing page opens on Beatrice's four medicines as real 3D dominoes that knock each other over (three.js,
paused off screen, the fallen end state as a still frame under reduced motion, and the lightweight version on machines without a real GPU), and `/graph` puts the whole medication knowledge graph
from FalkorDB in 3D, where you can light up any patient's cascade inside it. Press <kbd>⌘K</kbd> (or <kbd>/</kbd>) anywhere to jump to any
patient, page or action, or to switch clinic (<kbd>g</kbd> then a letter jumps to a page, <kbd>?</kbd> lists every shortcut); a toast tells you the moment procedural memory learns something; a deployment with an access key
asks for it once, in place; the app generates its own share card; and every page works on a phone. Accessibility is checked with axe-core
(`npm run a11y`, WCAG 2 A/AA) on every page and overlay.

## Demo

<img src="docs/images/review.png" alt="Beatrice's review: the agents found a cascade rooted in amlodipine; untangling it would leave 4 of 9 medicines" />

<img src="docs/images/ehr.png" alt="A fictional EHR signing benztropine for Rosa: Domino's CDS Hooks card pauses the signature, explains it may treat a side effect of risperidone, and offers to hold the order; the request and response JSON are shown alongside" />

*Inside the EHR, over CDS Hooks: Domino's card pauses the signature, and one click holds the order.*

| How Domino got here | Replay at the prescriber's desk |
| - | - |
| <img src="docs/images/provenance.png" alt="Provenance graph: agent steps and queries lead to the finding, which rests on drug, effect and pattern nodes and led to handoffs and a routed task" /> | <img src="docs/images/replay.png" alt="Timeline replay: the prescriber check would have stopped furosemide in June 2024, and four later prescriptions fade out" /> |

| A handover the Detective reads and acts on | The whole knowledge graph in 3D, Beatrice's cascade lit |
| - | - |
| <img src="docs/images/noticed.png" alt="A handover saying Beatrice has a dry cough: Domino noticed lisinopril causes it and nothing treats it yet, a prevention window, and proposed a signed review task" /> | <img src="docs/images/graph.png" alt="The medication knowledge graph in 3D: 116 drugs and 50 effects, with Beatrice's cascade from amlodipine to donepezil lit as a path through it" /> |

| Discovery: sequence symmetry joined to the graph | Live team activity |
| - | - |
| <img src="docs/images/discovery.png" alt="Forest plot of adjusted sequence ratios for drug class pairs, each joined to a mechanism path in the graph" /> | <img src="docs/images/activity.png" alt="Sam Lee's inbox updates the moment Dr. Okafor dismisses a task in another browser: a toast and the team activity feed" /> |

| Care-team brain | Check-up from a pasted list | Evaluation |
| - | - | - |
| <img src="docs/images/team.png" alt="Care team page: prescriber handoff Sankey, who knows what, learned procedures, search" /> | <img src="docs/images/checkup.png" alt="A pasted list in brand names mapped to graph drugs" /> | <img src="docs/images/evaluation.png" alt="Ablation of each graph signal and the prevention replay" /> |

| Inbox, routed by learned procedure | Prescriber check | ⌘K, anywhere |
| - | - | - |
| <img src="docs/images/inbox.png" alt="Care team inbox: signed tasks by role, one routed to the prescriber by a learned procedure" /> | <img src="docs/images/prescriber-check.png" alt="Prescriber check stops benztropine for Rosa as a documented cascade" /> | <img src="docs/images/palette.png" alt="Command palette searching patients, pages and actions" /> |

- **Video:** https://youtu.be/9OHJUJJjd0Q
- **Live:** [domino.gautamkhosla.com](https://domino.gautamkhosla.com)
- **Guided tour:** open `/?judge=1` (or press *Take the 3-minute tour*): ten steps, all three tracks, including the same question asked twice and a medicine Domino doesn't know.
- **Story mode:** open `/patients/p-beatrice?tour=1`. The agents run, then her chain untangles on its own.

Six synthetic story patients each exercise a different part of the system:

| Patient | Story | What it shows |
| - | - | - |
| **Beatrice Hale, 84** | Amlodipine → furosemide → potassium, oxybutynin → donepezil | A 4-drug tree from one root, a feedback loop, the triple whammy, the untangle (9 → 4 medicines), a task routed to her family doctor by learned procedure |
| **Walter Brooks, 79** | Tamsulosin → meclizine; sertraline → zolpidem | Four drugs converging on a fall; a late ACE-inhibitor cough marked only "possible" |
| **Rosa Alvarez, 88** | Lorazepam → risperidone → levodopa → quetiapine | A 4-step chain of ThinkCascades links; taper warnings for every drug the what-if touches |
| **Henry Okafor, 91** | Naproxen → hydrochlorothiazide → colchicine → loperamide | Bleeding stack with apixaban; deliberate stomach protection set aside |
| **Dorothy Chen, 76** | Same pair as Beatrice, but furosemide came first, for heart failure | The control: Domino checks, finds the reasons, and stays quiet |
| **Frank Russo, 82** | Gabapentin → furosemide → potassium; lithium → levothyroxine | Memory: the care team already marked two links intentional |

## Quick start

You need **Node 20.12+** and either **Docker** (for a local FalkorDB) or a free **FalkorDB Cloud** instance.

```bash
npm install
npm run db        # FalkorDB in Docker on localhost:6379
npm run setup     # seed both clinics' graphs, sweep, learn, evaluate (about a minute)
npm run dev       # http://localhost:3000
```

**FalkorDB Cloud instead of Docker:** copy `.env.example` to `.env.local` and set `FALKORDB_URL` (for example
`redis://falkordb:PASSWORD@HOST:PORT` with the host, port and user from the instance's Connect page; use `rediss://` only if
the instance has TLS on, which the free tier does not), then run `npm run setup` and `npm run dev`.

**LLM agents and search by meaning (optional):** set `GEMINI_API_KEY` in `.env.local` (or `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` for the agents), then run `npm run embed` once. With a Gemini key:
- every agent (Detective, Pharmacist, Scribe, Ask Domino, the care-team brain) is a Gemini tool-calling loop on the
  current models (3.8 Flash by default, falling back to 3.6 Flash, 3.5 Flash-Lite and 2.5 Flash). If every model fails
  (quota, outage), the graph planner finishes that step with the same tools, and the console says so;
- notes, tasks, decisions and conversations are embedded with `gemini-embedding-2` into a FalkorDB vector index, and the
  care-team search fuses three signals: words (full-text index), meaning (vector index) and the graph (memories about the
  patients, drugs and symptoms the question names rank higher).

Without a key, the agents run as a deterministic graph planner (same tools, same graph, same memory, same audit trail)
and the search works by words and the graph. `/api/health` shows which models are in use.

`npm run check` diagnoses your setup. Opening it in VS Code on Windows (WSL): see [docs/VSCODE_SETUP.md](docs/VSCODE_SETUP.md).

| Script | What it does |
| - | - |
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run db` | FalkorDB in Docker (`docker compose up -d falkordb`) |
| `npm run setup` | Seed both clinics, population sweep, learned procedures, evaluation and prevention replay |
| `npm run seed` | Rebuild the graphs from scratch |
| `npm run scan` | Population sweep + sequence symmetry analysis for every clinic (`--tasks` to fill the inboxes) |
| `npm run eval` | Evaluation with ablation and the prevention replay, writes `src/data/generated/eval.json` |
| `npm run bench` | Concurrency benchmark in a throwaway graph, writes `docs/BENCHMARK.md` |
| `npm run mcp` | MCP server over stdio (one clinic per process, `DOMINO_CLINIC`) |
| `npm run embed` | Embed the team's memory for search by meaning, in every clinic (needs `GEMINI_API_KEY`; only what is missing) |
| `npm test` | 150+ tests on their own graphs (`domino_test*`, seeded fresh each run): knowledge integrity, guardrails, signatures, engine, agents, LLM adapters, MCP, memory, privacy, tenants, leases, provenance, replay, check-ups, notes that become tasks (negation cases included), follow-ups, FHIR export, CDS Hooks, the 3D graph data |
| `npm run check` | Setup doctor |
| `npm run smoke` | End-to-end smoke test against the running app |
| `npm run a11y` | axe-core (WCAG 2 A/AA) on every page, the command palette and the shortcuts sheet, plus a phone-width pass, against the running app (needs a Chromium for Playwright: `npx playwright install chromium`) |
| `npm run verify:labels` | Cross-check every `CAUSES` edge against FDA labels via openFDA (needs internet) |
| `npm run docs` | Regenerate `docs/CYPHER.md` and `docs/TOOLS.md` from code |

## How it works

```mermaid
flowchart LR
  UI[Web app<br/>Next.js] --> API[API guard<br/>zod · CSRF · rate limits<br/>session → clinic graph]
  MCPC[MCP clients] --> MCP
  RX[New prescription] --> API
  API --> TEAM
  API --> ASK[Ask Domino ·<br/>care-team brain]
  ASK -->|tools/list · tools/call| MCP[Domino MCP server]

  subgraph TEAM[Agent team]
    D[Detective] -- signed handoff --> P[Pharmacist] -- signed handoff --> S[Scribe]
  end

  TEAM <-->|tool calls| LLM[LLM, optional]
  ASK <--> LLM
  TEAM --> T[14 tools · 105 named queries]
  MCP --> T
  T -->|parameterised Cypher<br/>reads via GRAPH.RO_QUERY| DB[(FalkorDB<br/>one graph per clinic)]
  TEAM -->|Run · Step · Finding · Task · Note · Handoff · Lock| DB
  ASK -->|Conversation · Message| DB
```

**The Detective** loads the patient, recalls memory (decisions, earlier runs, learned procedures), walks the cascade paths, checks combined harm,
says what changed since the last review and records findings. **The Pharmacist** explains the evidence for each root, finds safer alternatives that
don't clash with anything else the patient takes, simulates the untangle (with taper warnings), checks the population signal and runs betweenness centrality for the graph's chokepoints.
**The Scribe** turns that into review tasks (routed by procedural memory, prioritised when a cascade runs through a chokepoint) and two draft notes.

```mermaid
sequenceDiagram
  autonumber
  participant D as Detective
  participant P as Pharmacist
  participant S as Scribe
  participant G as FalkorDB
  Note over G: lease "review:patient" taken in the graph
  D->>G: get_patient_context · find_cascades · recall_memory · check_harms
  G-->>D: paths, loops, pile-ups, combos, signed decisions, procedures
  D->>G: record_findings (Finding → drugs, effect, pattern, decisions considered)
  D->>G: Handoff {payload, HMAC} -[:CARRIED]-> findings
  G-->>P: read handoff back, verify signature
  P->>G: explain_link · find_safer_alternatives · simulate_untangle · population_signal · find_chokepoints
  P->>G: Handoff {payload, HMAC}
  G-->>S: read handoff back, verify signature
  S->>G: propose_task (procedure → role, owner) · draft_note
  Note over G: every Step -[:RAN]-> Query and -[:PRODUCED]-> what it wrote
  Note over G: a person approves or dismisses tasks, and procedures re-learn
```

**Why each agent has only its own tools:** least privilege. The Detective cannot draft notes, the Scribe cannot read another patient,
and no agent can write a clinician decision. A run is bound to one patient, so no tool accepts a patient id from the model.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/AGENTS_AND_MEMORY.md](docs/AGENTS_AND_MEMORY.md).

### Why the graph is load-bearing

Remove FalkorDB and nothing works. Every cascade is a path query, every "other reason" is a `HAS`/`TREATED_BY` pattern, every alternative is a
traversal that checks diagnoses, current drugs and `AVOID_WITH` class conflicts, every pile-up and combination on a record is an aggregate, the
medical knowledge the engine scores with (patterns, combination rules, drug cards) is read from the graph, task priority comes from betweenness
centrality, every memory, handoff, lease, procedure and conversation is a node, provenance is edges, the care-team brain is Cypher aggregates and a
full-text index, and each clinic is a graph. The knowledge is written into the graph once, by the seed, from a source file with a citation on
every pattern ([docs/DATA.md](docs/DATA.md)); the app also uses that file for display names and to validate input.

## Graph model

```mermaid
flowchart LR
  Patient -- "TAKES {start, dose, prescriber, indication}" --> Drug
  Patient -- "HAS {since}" --> Effect
  Patient -- SEES --> Prescriber
  Drug -- "CAUSES {freq, weight, onset}" --> Effect
  Effect -- "TREATED_BY {line}" --> Drug
  Effect -- RAISES --> Effect
  Drug -- IN_CLASS --> DrugClass
  DrugClass -- AVOID_WITH --> DrugClass
  Pattern -- "INDEX / MARKER" --> DrugClass
  Pattern -- VIA --> Effect
  Pattern -- CITES --> Reference
  Combo -- GROUP --> DrugClass
  Run -- REVIEWED --> Patient
  Run -- STEP --> Step
  Step -- RAN --> Query
  Step -- PRODUCED --> Finding
  Finding -- "ROOT / TO" --> Drug
  Finding -- MATCHES --> Pattern
  Finding -- CONSIDERED --> Decision
  Handoff -- CARRIED --> Finding
  Task -- ABOUT --> Finding
  Task -- FOLLOWED --> Procedure
  Task -- ADDRESSED_TO --> Prescriber
  Procedure -- LEARNED_FROM --> Task
  Conversation -- HAS --> Message
  Message -- RAN --> Query
```

| Node | Count | What it is |
| - | - | - |
| `Drug` | 116 | Medicines common in older adults, with ACB score, AGS Beers 2023 note and brand-name search terms |
| `Effect` | 50 | Side effects, conditions, lab problems and harms, with plain-language synonyms |
| `DrugClass` | 60 | Pharmacological classes, with deprescribing taper notes where they apply |
| `Pattern` | 27 | Documented cascades (9 ThinkCascades, published studies, labelling) citing `Reference` nodes |
| `Combo` | 4 | Dangerous combinations: triple whammy, bleeding stack, sedation stack, potassium stack |
| `Patient` | 606 + 300 | Two clinics: 6 story personas + 600 generated, and 300 generated |
| `Prescriber` | 11 | Family doctors, walk-in clinics and specialists |
| `Query` | 105 | The Cypher catalog itself, so provenance can point at it |
| `Run`, `Step`, `Finding`, `Task`, `Note`, `Handoff`, `Decision`, `Procedure`, `Conversation`, `Message`, `Lock` | grows | Memory, actions, provenance, shared state |

Full model and rationale: [docs/GRAPH_MODEL.md](docs/GRAPH_MODEL.md).

## The Cypher the product depends on

**The cascade path.** One variable-length pattern over two relationship types, kept inside the patient's own medicine list:

```cypher
MATCH (p:Patient {id: $pid})-[:TAKES]->(m:Drug)
WITH p, collect(m.id) AS meds
MATCH (p)-[:TAKES]->(a:Drug)-[:CAUSES]->(:Effect)-[:TREATED_BY]->(:Drug)<-[:TAKES]-(p)
WITH DISTINCT a, meds
MATCH path = (a)-[:CAUSES|TREATED_BY*2..6]->(z:Drug)
WHERE z <> a AND all(n IN nodes(path) WHERE NOT n:Drug OR n.id IN meds)
RETURN [r IN relationships(path) | [startNode(r).id, type(r), endNode(r).id]] AS hops
```

**Each link, with timing, the charted indication and any documented pattern:**

```cypher
MATCH (p:Patient {id: $pid})-[ta:TAKES]->(a:Drug)-[c:CAUSES]->(e:Effect)-[tr:TREATED_BY]->(b:Drug)<-[tb:TAKES]-(p)
WHERE a <> b
OPTIONAL MATCH (a)-[:IN_CLASS]->(:DrugClass)<-[:INDEX]-(pt:Pattern)-[:VIA]->(e),
               (pt)-[:MARKER]->(:DrugClass)<-[:IN_CLASS]-(b)
RETURN a.id AS from, b.id AS to, e.id AS effect, c.freq AS freq, c.onsetMin AS onsetMin, c.onsetMax AS onsetMax,
       ta.start AS fromStart, tb.start AS toStart, tb.indication AS toIndication, collect(DISTINCT pt.id) AS patterns
```

**The path behind a finding** (provenance), **what the team knows** (one full-text search over six kinds of memory with `UNION ALL`: tasks, drafted notes, team notes, decisions, findings and your own messages),
**a lease** (`MERGE` + conditional `SET`, atomic because FalkorDB serialises writes per graph), **learned procedures** (`SUPERSEDES`,
`LEARNED_FROM`), **the prescriber check as the record stood on any day** (`$asOf`, `$exclude`), **feedback loops**, **safer alternatives**,
**dangerous combinations**, **allShortestPaths**, **betweenness centrality** (`algo.betweenness`) and **prescription sequence symmetry**.
All 105 queries (71 read, 34 write): [docs/CYPHER.md](docs/CYPHER.md).

## Evaluation

The generator hides cascades in 600 synthetic patients by sampling real `CAUSES` and `TREATED_BY` edges, and adds the confounders a real record has:
second drugs prescribed for a genuine diagnosis, deliberate pairs started together, and drugs in the wrong order. Ground truth never enters the graph.

| Signal added | Precision | Recall | F1 | Deliberate pairs wrongly flagged |
| - | - | - | - | - |
| Graph links only | 0.30 | 1.00 | 0.46 | 227 of 227 |
| + time order | 0.44 | 1.00 | 0.61 | 200 |
| + onset window | 0.59 | 1.00 | 0.74 | 200 |
| + other reasons | 0.58 | 0.96 | 0.72 | 226 |
| **Domino (full)** | **0.75** | **0.96** | **0.84** | **0** |

**Prevention replay.** Every prescription in the cohort is re-checked as the record stood the day it was written. When the check stops a true
cascade, that drug and everything that followed from it leave the replay.

| | |
| - | - |
| Cascades stopped at the first downstream prescription | **401 of 534 (75%)** |
| Prescriptions that might never have been written | **510** |
| Cascade stops that were true cascades | **95%** |
| Deliberate companions (a PPI with an NSAID) stopped as a cascade | **1 of 210** |

This tests the reasoning, not clinical validity: generator and engine share one knowledge graph. Two consequences, said plainly: the
deliberate pairs go from 227 to 0 by construction (the generator marks them with the same "usually deliberate" patterns the engine
recognises, so this shows the mechanism works, not that it generalises); and the replay meets 534 cascade drugs, not 632, because several
hidden cascades can end at the same drug and a drug removed by an earlier stop is never checked again. Details, caveats and the per-pattern recall:
[docs/EVALUATION.md](docs/EVALUATION.md). Re-run it live on the Evaluation page or with `npm run eval`.

## Safety and security

- **Clinical safety:** Domino raises questions. A wording guardrail checks everything an agent writes or says (tasks, notes, follow-ups, handoffs
  and answers) for instructions to stop, start, switch or change the dose of a medicine: a task or note that fails is refused, a handoff is held
  back, and a model's answer is replaced by the graph planner's.
  Deliberate pairings (stomach protection with an NSAID, potassium with a loop diuretic) are recognised as planned care, not cascades. The what-if names medicines that need a gradual taper. Every action is a proposal
  until a person approves it. [docs/CLINICAL_SAFETY.md](docs/CLINICAL_SAFETY.md)
- **OWASP Top 10:2025, LLM Top 10 (2025) and Agentic Top 10 (2026):** a graph per clinic chosen on the server, parameterised Cypher only,
  database-enforced read-only tools, least-privilege agents, signed handoffs, tasks and decisions (memory-poisoning defence), sanitised full-text input,
  nonce CSP, CSRF checks, rate limits, agent time budgets, model and embedding timeouts, a 15-second timeout on every read query, and a graph
  lease. [docs/SECURITY.md](docs/SECURITY.md)
- **Data:** synthetic patients only; the knowledge graph is public knowledge curated by hand with references. [docs/DATA.md](docs/DATA.md)
- **Accessibility:** `npm run a11y` runs axe-core (WCAG 2 A/AA) on every page and both overlays, and passes; visible focus, skip link, text alternatives for every diagram, `prefers-reduced-motion` respected.

## Documentation

| Doc | |
| - | - |
| [TRACKS.md](docs/TRACKS.md) | Every track requirement, what Domino does, where to see it, the code |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, request flow, tenancy, scoring, the untangle, the replay |
| [GRAPH_MODEL.md](docs/GRAPH_MODEL.md) | Every node and relationship, and why it is shaped that way |
| [CYPHER.md](docs/CYPHER.md) | All queries, generated from code |
| [TOOLS.md](docs/TOOLS.md) | Agent and MCP tools, generated from code |
| [AGENTS_AND_MEMORY.md](docs/AGENTS_AND_MEMORY.md) | Agents, memory types, procedures, conversations, provenance, leases |
| [BENCHMARK.md](docs/BENCHMARK.md) | Concurrency benchmark |
| [EVALUATION.md](docs/EVALUATION.md) | Method, results, prevention replay, caveats |
| [SECURITY.md](docs/SECURITY.md) | Threat model and OWASP mappings |
| [CLINICAL_SAFETY.md](docs/CLINICAL_SAFETY.md) | Principles and hazard log |
| [DATA.md](docs/DATA.md) | Sources, the synthetic cohort and its assumptions |
| [FIRST_PRINCIPLES.md](docs/FIRST_PRINCIPLES.md) | First principles, the idiot index and Delta 4 |
| [VSCODE_SETUP.md](docs/VSCODE_SETUP.md) | Windows + WSL + VS Code, step by step |
| [VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md) | Three-minute demo, shot by shot |
| [BLOG.md](docs/BLOG.md) | Blog post for the side prize |
| [SUBMISSION.md](docs/SUBMISSION.md) | Paste-ready submission copy |

## Project structure

```
src/
  app/                 pages and API routes (Next.js 16 App Router)
  components/          UI: domino tiles, agent console, provenance, timeline replay, care team, check-up
  data/                knowledge graph, brands and synonyms, references, personas, cohort generator, seeded outcomes
  lib/
    cypher.ts          the Cypher catalog (every query in one place)
    db.ts              FalkorDB client: graph per clinic, traced, read-only for reads
    tenant.ts          clinics and demo identities (AsyncLocalStorage scope)
    lock.ts            leases in the graph
    seed.ts            builds a clinic's graph
    provenance.ts      the path behind a finding
    careteam.ts        prescribers, who knows what, search
    checkup.ts         pasted lists → temporary patients
    memory/            procedures (procedural memory), conversations
    engine/            scoring, untangle, prescriber check, replay, population, evaluation
    agent/             tools, actions, runner (agents, Ask, care-team brain), providers, guardrails, signing, MCP client
    mcp.ts             MCP server
  proxy.ts             nonce-based Content Security Policy
scripts/               seed, setup, scan, eval, bench, mcp-server, check, docs, icons, smoke
tests/                 vitest suites
docs/                  tracks, architecture, model, Cypher, security, safety, evaluation, benchmark, video script, blog
```

## Deploying

- **Vercel + FalkorDB Cloud:** create the FalkorDB instance in the region nearest your Vercel functions (Vercel's default is `iad1`, so AWS
  `us-east-1`). Import the repo and set `FALKORDB_URL`, `DOMINO_SIGNING_SECRET`, `DOMINO_TRUST_PROXY=true`, `DOMINO_SITE_URL`, `CRON_SECRET`,
  (recommended) `DOMINO_WRITE_KEY` and (for Gemini agents and search by meaning) `GEMINI_API_KEY`. Then seed it from the server, in the same
  region: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/keepalive` builds every clinic's graph that is empty (or run
  `npm run setup` from your machine against the same `FALKORDB_URL` with the same `DOMINO_SIGNING_SECRET`; slower over a long distance).
- **As a public demo** (many people trying it at once): add `DOMINO_OPEN_DEMO=true` so everything a visitor needs works without the key (the key
  still guards admin actions; visitors' team notes may not contain links, and the six story patients' medicine lists stay as they are) and `DOMINO_DEMO_RESET=nightly` so the nightly cron rebuilds every clinic from the
  seed. FalkorDB Cloud's free tier stops an instance after a day unused and keeps no data across a restart: set the repository variable
  `DOMINO_URL` and secret `CRON_SECRET`, and `.github/workflows/keepalive.yml` calls the keep-alive every three hours, which also reseeds any
  graph that came back empty. Check a deployment with `DOMINO_URL=https://your-app npm run smoke`.
- **Any VM or container host:** `docker compose --profile app up --build` runs FalkorDB and the app together (set `DOMINO_SIGNING_SECRET` in `.env`). Put it behind HTTPS for anything public (a reverse proxy that sets `X-Forwarded-Proto` is enough); it also works over plain HTTP on a private network.

## Graph Hacks requirements

| Requirement | Where |
| - | - |
| FalkorDB is the primary graph database and central to the product | Every feature is a graph query; see [Why the graph is load-bearing](#why-the-graph-is-load-bearing) |
| Public, synthetic or own data only | Synthetic patients; public-knowledge graph with citations ([docs/DATA.md](docs/DATA.md)) |
| Public repository with a README, setup instructions and the graph data model | This file, [Quick start](#quick-start), [Graph model](#graph-model), [docs/GRAPH_MODEL.md](docs/GRAPH_MODEL.md) |
| The Cypher queries the product depends on | [The Cypher](#the-cypher-the-product-depends-on), [docs/CYPHER.md](docs/CYPHER.md) (generated from code) |
| Demo video | [Demo](#demo) |
| Live deployment or complete local setup | [Quick start](#quick-start), [Deploying](#deploying), [docs/VSCODE_SETUP.md](docs/VSCODE_SETUP.md) |
| Tracks named | Track 01 (primary), Track 02 and Track 03; line by line in [docs/TRACKS.md](docs/TRACKS.md) |
| AI assistance disclosed | [AI assistance disclosure](#ai-assistance-disclosure) |

## Built with

FalkorDB (Cypher, variable-length paths, full-text indexes, `algo.betweenness`, multiple graphs) · Next.js 16 · React 19 · TypeScript ·
Tailwind CSS 4 · three.js · Motion · d3-force · Model Context Protocol SDK · zod · Vitest · Fraunces and Geist typefaces · optional Gemini, Claude or OpenAI-compatible models.

## AI assistance disclosure

Domino was built with an AI coding assistant (Claude, by Anthropic), as the Graph Hacks rules allow. The assistant wrote most of the code, tests
and documentation, working from my direction and reviews, and an independent AI review pass was used to find gaps before submission.
What I did myself: I set the direction and the rules. I chose the problem, the three-agent design and the safety limits: agents raise questions for a clinician and never tell anyone to stop a medicine, every action waits for a human, and the data is synthetic only. I ran the whole stack locally and tested it by hand, and I reviewed what was built. I found a profile switch that looked like it did nothing, a live comparison that failed with a misleading error, and layout problems on the landing page, and I had each one fixed and re-tested. I did the deployment myself: FalkorDB Cloud, Vercel, a GitHub Actions keep-alive job and my own domain on Cloudflare, with every key and secret entered by me and kept server-side. I can explain the graph model, the Cypher queries and the architecture.

The clinical knowledge is public and cited: every documented pattern carries its references. `npm run verify:labels` cross-checks every side
effect in the graph against current FDA drug labels and writes `docs/LABEL_CHECK.md`. I ran it on 2026-10-18: 249 of 265 side-effect edges (94%) are mentioned in the drug's current US label, and 3 more belong to drugs not sold in the US. The 16 that are not mentioned are listed in `docs/LABEL_CHECK.md` with the reason for each: mostly class effects in older adults that the label words differently (heavy, urgent urination from diuretics; anticholinergic effects named by the AGS Beers criteria), and over-the-counter products whose label has no adverse-reactions section.

## Disclaimer

Domino is a hackathon prototype for clinicians to review. It uses synthetic data, is not a medical device, does not diagnose, and never recommends
stopping or changing a medicine.

## License

MIT
