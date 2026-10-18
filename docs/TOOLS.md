# Agent tools

Generated from `src/lib/agent/tools.ts`. A review run is bound to one patient, so no tool takes a patient id from the model.
Arguments are validated with zod before anything touches the graph.

| Tool | Agents | Kind | What it does |
| - | - | - | - |
| `get_patient_context` | detective, domino | read | Load the patient under review: age, diagnoses with dates, and every medication with start date, dose, prescriber and the indication charted on the prescription. |
| `recall_memory` | detective, pharmacist, domino | read | Recall what the care team decided about this patient in earlier sessions (verified, signed decisions), earlier review runs, team notes (handovers, protocols, chats) that concern this patient, and learned procedures. Respect these decisions: do not re-raise a link the team marked intentional or not a cascade. |
| `find_cascades` | detective, domino | read | Walk the medication graph for this patient: every link where one of their drugs causes an effect another of their drugs treats, scored for timing, other reasons and documented evidence; multi-hop chains grouped by root drug; and feedback loops. |
| `check_harms` | detective, pharmacist, domino | read | Check combined harm for this patient: side-effect pile-ups, drugs that lead to falls, fractures or kidney injury, dangerous named combinations (triple whammy, bleeding stack, sedation stack), anticholinergic burden and AGS Beers 2023 flags. |
| `explain_link` | pharmacist, domino | read | Explain one cascade link with its evidence: every scoring factor, the documented pattern and references, real-world signal strength, and the question a pharmacist should ask. |
| `find_safer_alternatives` | pharmacist, domino | read | For a root drug and the effect it causes, find drugs that treat the same diagnosis, do not cause that effect, and check them against the patient’s diagnoses, current drugs (pile-ups) and class conflicts. Returns options for a pharmacist to consider, not a prescription. |
| `simulate_untangle` | pharmacist, domino | read | What-if: if this root drug were reviewed and changed, which downstream drugs might no longer be needed, and how pill count, anticholinergic burden, fall-risk drugs and dangerous combinations would change. |
| `population_signal` | pharmacist, domino | read | Check the population: across all patients, does the second drug’s class start after the first drug’s class more often than before it (prescription sequence symmetry analysis, adjusted for prescribing trends)? Also returns the published real-world signal if one exists. |
| `find_chokepoints` | pharmacist, domino | read | Graph algorithm: run FalkorDB betweenness centrality over the whole cascade graph (drugs and effects joined by CAUSES and TREATED_BY) and report which of this patient’s drugs and diagnoses are chokepoints, nodes that many possible cascades pass through. |
| `trace_route` | pharmacist, domino | read | Graph algorithm: allShortestPaths over CAUSES and TREATED_BY between two drugs in the whole knowledge graph. Answers "how could drug A lead to drug B?", even through drugs this patient does not take. |
| `resolve_drug` | pharmacist, domino | read | Resolve a medicine the question names (generic, brand or plain alias) against the knowledge graph, and say whether this patient takes it. If they do not, it runs the prescriber check to say what adding it would mean. Call it for any medicine that is not in get_patient_context before reasoning about it. If it is not in the graph, say that Domino cannot check it and stop: never guess. |
| `record_findings` | detective | **write** | ACTION: record cascade links as Findings in the graph for the care team. Only record likely or possible links that are not intentional. Use link keys from find_cascades, e.g. "amlodipine>furosemide". |
| `propose_task` | scribe | **write** | ACTION: propose a task for a human on the care team (it stays "proposed" until a clinician approves it). Phrase it as a review question, never an instruction to change a medicine. |
| `draft_note` | scribe | **write** | ACTION: save a drafted note. kind "prescriber": a short SBAR-style note for the prescriber. kind "patient": a plain-language note for the patient or family (reading age about 12, no jargon). Notes stay drafts for a human to edit and send. |

## Over MCP

`npm run mcp` serves these over stdio to any MCP client, for one clinic per process (`DOMINO_CLINIC`). Inside the app, Ask Domino and the
care-team brain use the same server through an in-memory transport. Patient tools take an explicit `patient_id` (Ask Domino injects it, so the
model cannot reach another record). Every result carries `_meta["domino/queries"]`: the catalog query ids it ran, which become cited sources.

| MCP tool | Read-only | What it does |
| - | - | - |
| `list_patients` | yes | List synthetic patients with medication counts and the latest sweep summary. |
| `get_patient_context` | yes | Load the patient under review: age, diagnoses with dates, and every medication with start date, dose, prescriber and the indication charted on the prescription. |
| `recall_memory` | yes | Recall what the care team decided about this patient in earlier sessions (verified, signed decisions), earlier review runs, team notes (handovers, protocols, chats) that concern this patient, and learned procedures. Respect these decisions: do not re-raise a link the team marked intentional or not a cascade. |
| `find_cascades` | yes | Walk the medication graph for this patient: every link where one of their drugs causes an effect another of their drugs treats, scored for timing, other reasons and documented evidence; multi-hop chains grouped by root drug; and feedback loops. |
| `check_harms` | yes | Check combined harm for this patient: side-effect pile-ups, drugs that lead to falls, fractures or kidney injury, dangerous named combinations (triple whammy, bleeding stack, sedation stack), anticholinergic burden and AGS Beers 2023 flags. |
| `explain_link` | yes | Explain one cascade link with its evidence: every scoring factor, the documented pattern and references, real-world signal strength, and the question a pharmacist should ask. |
| `find_safer_alternatives` | yes | For a root drug and the effect it causes, find drugs that treat the same diagnosis, do not cause that effect, and check them against the patient’s diagnoses, current drugs (pile-ups) and class conflicts. Returns options for a pharmacist to consider, not a prescription. |
| `simulate_untangle` | yes | What-if: if this root drug were reviewed and changed, which downstream drugs might no longer be needed, and how pill count, anticholinergic burden, fall-risk drugs and dangerous combinations would change. |
| `population_signal` | yes | Check the population: across all patients, does the second drug’s class start after the first drug’s class more often than before it (prescription sequence symmetry analysis, adjusted for prescribing trends)? Also returns the published real-world signal if one exists. |
| `find_chokepoints` | yes | Graph algorithm: run FalkorDB betweenness centrality over the whole cascade graph (drugs and effects joined by CAUSES and TREATED_BY) and report which of this patient’s drugs and diagnoses are chokepoints, nodes that many possible cascades pass through. |
| `trace_route` | yes | Graph algorithm: allShortestPaths over CAUSES and TREATED_BY between two drugs in the whole knowledge graph. Answers "how could drug A lead to drug B?", even through drugs this patient does not take. |
| `resolve_drug` | yes | Resolve a medicine the question names (generic, brand or plain alias) against the knowledge graph, and say whether this patient takes it. If they do not, it runs the prescriber check to say what adding it would mean. Call it for any medicine that is not in get_patient_context before reasoning about it. If it is not in the graph, say that Domino cannot check it and stop: never guess. |
| `check_new_prescription` | yes | Before adding a drug: would it treat a side effect of something the patient already takes, pile onto an existing problem, or complete a dangerous combination? |
| `search_team_memory` | yes | Search everything the care team and the agents wrote down in this clinic, by words and (when embeddings are on) by meaning, ranked higher when connected in the graph to a patient, drug or symptom the query names: review tasks (with who decided and why), draft notes, team notes, signed care-team decisions, open findings and the asking person’s own past conversations. Each hit names its patient and says how it matched. |
| `who_knows` | yes | Which people on the care team have handled each kind of prescribing cascade (tasks they acted on or dismissed, decisions they signed). Optionally for one pattern id. |
| `care_team_flows` | yes | For every open cascade link in the clinic: who prescribed the first drug and who added the second. Shows which prescriber handoffs cascades start at, and how many cross from one prescriber to another. |
| `learned_procedures` | yes | Procedural memory: for each kind of cascade, who review tasks go to and for which tier, learned from what the care team did with earlier tasks, with the reason. |
| `run_review` | **no** (only with `DOMINO_MCP_ALLOW_WRITES=true`) | Run the full Domino agent team (Detective, Pharmacist, Scribe) on one patient. Writes findings, proposed tasks and draft notes into the graph for human approval. |

| MCP resource | What it is |
| - | - |
| `domino://queries` | Every Cypher query Domino runs, with its purpose and mode. |
| `domino://graph-model` | Node labels and relationship types in a Domino clinic graph. |
