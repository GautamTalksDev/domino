# Graph model

Each clinic is its own FalkorDB graph (`domino` for Riverside, `domino_lakeview` for Lakeview) with the same model.
The knowledge part is identical in every clinic; patients, prescribers, memory and procedures are the clinic's own.

The memory, provenance and care-team part of the model is drawn on the *How it works* page.

## Knowledge

| Label | Key properties | Notes |
| - | - | - |
| `Drug` | `id`, `name`, `acb` (0–3), `beers` (text or null), `terms` | 116 medicines common in older adults. `terms` holds brand names and plain words ("water pill") for the full-text index |
| `DrugClass` | `id`, `name` | 60 classes. Patterns, combinations and conflicts are defined on classes so they generalise to every drug in the class |
| `Effect` | `id`, `name`, `plain`, `kind` (`symptom`, `condition`, `lab`, `harm`), `terms` | 50 effects. One node type for side effects and diagnoses, because a cascade is exactly a side effect being treated as a diagnosis |
| `Pattern` | `id`, `title`, `evidence`, `refs`, `question`, `intentional`, `asr`, `asrLo`, `asrHi`, `prevalence` | 27 documented cascades, with the real-world sequence ratio where published |
| `Reference` | `id`, `short`, `citation`, `url` | 15 published sources the patterns cite |
| `Combo` | `id`, `title`, `why`, `refs`, `groups` | 4 dangerous combinations |
| `Query` | `id`, `title`, `purpose`, `mode`, `cypher` | the 105 catalog queries, so steps and messages can link to the exact Cypher they ran |

| Type | From → To | Properties | Meaning |
| - | - | - | - |
| `CAUSES` | Drug → Effect | `freq`, `weight`, `onsetMin`, `onsetMax`, `source` | adverse effect with frequency band and typical onset window (days) |
| `TREATED_BY` | Effect → Drug | `line` (`first`, `second`, `off_label`) | what a prescriber might reach for |
| `RAISES` | Effect → Effect | `weight` | harm chains (dizziness → falls → fracture) |
| `IN_CLASS` | Drug → DrugClass | | |
| `AVOID_WITH` | DrugClass → DrugClass | `why` | class conflicts used when suggesting alternatives |
| `INDEX`, `MARKER` | Pattern → DrugClass | | the two ends of a documented cascade |
| `VIA` | Pattern → Effect | | the side effect in the middle |
| `CITES` | Pattern → Reference | | the evidence behind a pattern |
| `GROUP` | Combo → DrugClass | `g` (group index) | a combination is complete when every group is matched |
| `HARM` | Combo → Effect | | what the combination risks |

## Clinic and patients

| Label | Key properties | Notes |
| - | - | - |
| `Clinic` | `id`, `name` | one per graph; the care-team brain's conversations are `ABOUT` it |
| `Patient` | `id`, `name`, `age`, `sex`, `persona`, `sandbox`, `expiresAt`, plus sweep results `likely`, `possible`, `acb`, `topScore`, `avoidable`, `reviewedAt` | 606 synthetic patients at Riverside, 300 at Lakeview. Check-up patients carry `sandbox: true` and expire |
| `Prescriber` | `name`, `specialty`, `kind` | who writes the prescriptions (GP, cardiology, psychiatry, urology…) |

| Type | From → To | Properties | Meaning |
| - | - | - | - |
| `TAKES` | Patient → Drug | `start` (day number), `dose`, `prescriber`, `indication`, `assumedDate` | a prescription. `assumedDate` marks a check-up line with no start date |
| `HAS` | Patient → Effect | `since` | a diagnosis on record |
| `SEES` | Patient → Prescriber | `first`, `prescriptions` | who prescribes for this patient |

## Agent memory, provenance and coordination

| Label | Key properties | Notes |
| - | - | - |
| `Run` | `id`, `at`, `mode`, `model`, `trigger`, `summary`, `changes`, `previous` | one per agent run (episodic memory). `changes` is what changed since the previous run |
| `Step` | `i`, `agent`, `kind`, `tool`, `args`, `ok`, `text`, `ms` | every event of a run, one per tool call, in order |
| `Finding` | `id`, `key`, `from`, `to`, `effect`, `label`, `chain`, `score`, `tier`, `pattern`, `evidence`, `factors`, `status`, `source`, `step` | a cascade link worth a human look; superseded on the next run |
| `Handoff` | `id`, `from`, `to`, `payload`, `sig` | shared state between agents, signed |
| `Task` | `id`, `title`, `body`, `role`, `due`, `status`, `owner`, `finding`, `pattern`, `procedure`, `step`, `note`, `decidedBy`, `decidedAt`, `sig` | a review action proposed for a person, `proposed` until approved; signed over its title and body |
| `Note` | `id`, `kind` (`prescriber`, `patient`), `text`, `status` | drafts |
| `Decision` | `id`, `from`, `to`, `verdict`, `reason`, `by`, `day`, `sig` | a clinician's judgement on a link, written by people only, signed |
| `Procedure` | `id`, `key` (a pattern id or `default`), `version`, `role`, `dueLikely`, `duePossible`, `minTier`, `reason`, `acted`, `dismissed`, `active` | procedural memory: how the team wants a kind of cascade handled |
| `Conversation` | `id`, `about`, `user`, `userName`, `title`, `messages`, `updatedAt` | one person's thread about a patient or the clinic |
| `Message` | `id`, `i`, `role`, `text`, `sources`, `model`, `user` | one question or answer |
| `Doc` | `id`, `kind` (`protocol`, `handover`, `chat`, `minutes`), `title`, `text`, `by`, `byId`, `at` | a team note a person wrote |
| `Memory` (extra label) | `embedding` (768-d vector), `embedModel` | on any `Doc`, `Task`, `Note`, `Decision` or `Message` that has been embedded for search by meaning; one vector index covers the label |
| `CdsCard` | `uuid`, `service`, `hook`, `hookInstance`, `drug`, `drugName`, `verdict`, `indicator`, `summary`, `pattern`, `client`, `at`, `outcome`, `outcomeReason`, `outcomeReasonText`, `outcomeComment`, `outcomeAt` | a card Domino showed an EHR at order-sign (CDS Hooks), and what the prescriber did with it |
| `Lock` | `key`, `owner`, `until`, `at` | a lease (`review:<patient>`, `sweep`) |
| `Meta` | `seededAt`, `version`, `patients`, `seed`, `clinic` | what the graph was seeded with |

| Type | From → To | Meaning |
| - | - | - |
| `REVIEWED`, `STEP`, `FOUND`, `PROPOSED`, `DRAFTED`, `HANDOFF` | Run → … | what a run did |
| `FOLLOWS` | Run → Run | the previous review of the same patient |
| `RAN` | Step / Message → Query | the catalog queries behind a tool call or an answer |
| `PRODUCED` | Step → Finding / Task / Note | which tool call wrote it |
| `FOR` | Finding / Task / Note → Patient | |
| `ROOT`, `TO`, `VIA` | Finding → Drug, Drug, Effect | the link a finding is about (`ROOT` also drives the population queries) |
| `MATCHES` | Finding → Pattern | the documented cascade it matches, which `CITES` its references |
| `CONSIDERED` | Finding → Decision | a signed care-team decision the run read and applied |
| `CARRIED` | Handoff → Finding | the findings an agent passed on |
| `ABOUT` | Task → Finding; Decision → Patient; Conversation → Patient / Clinic | |
| `ON_PATTERN` | Decision → Pattern | semantic memory: feedback accumulates on the pattern |
| `ADDRESSED_TO` | Task → Prescriber | the prescriber of the root drug |
| `FOLLOWED` | Task → Procedure | the procedure version that routed it |
| `SUPERSEDES` | Procedure → Procedure | the version it replaced |
| `LEARNED_FROM` | Procedure → Task | the decided tasks it was learned from |
| `FOR_PATTERN` | Procedure → Pattern | |
| `HAS` | Conversation → Message | |
| `MENTIONS` | Doc → Drug / Effect / Patient | what a team note names, linked through the full-text index and a whole-phrase check |
| `IN` | Doc → Clinic | |
| `FROM_NOTE` | Task → Doc | the note that raised the task |
| `CORROBORATES` | Doc → Task | a later note that reports what an open task already asks |
| `FOLLOWS_UP` | Task → Task | the follow-up the agents scheduled when a review task was completed |
| `ABOUT`, `CHECKED`, `CULPRIT` | CdsCard → Patient, Drug, Drug | the patient, the drug being ordered, and the drug whose side effect it would treat |

## Design decisions

**`CAUSES` points drug → effect and `TREATED_BY` points effect → drug.** With both pointing "forward", a cascade is a directed
path of alternating types, so `(a)-[:CAUSES|TREATED_BY*2..6]->(z)` can only ever walk drug → effect → drug → effect…
No filtering on alternation is needed.

**Dates are integer day numbers** (day 0 = 1 January 2024). Cypher can subtract and compare them directly, and the population
query can count "B after A within 365 days" in one aggregate. The prescriber check and the replay pass `$asOf` and keep only
prescriptions started before it.

**Patterns are nodes, not code.** A documented cascade is matched by traversal (`(a)-[:IN_CLASS]->()<-[:INDEX]-(pt)-[:VIA]->(e)`),
so adding a pattern is a data change. The same holds for combinations and class conflicts.

**Vectors live on the nodes they describe.** An embedding is a property of the note or task itself (with a `Memory` label for the
index), not a row in a separate vector store, so a vector hit is already a graph node: its patient, drugs and people are one hop away,
and the care-team search ranks meaning and graph connections together.

**Memory lives next to the data it is about.** Decisions hang off the patient (episodic) and the pattern (semantic), so "how often
has this pattern been judged intentional?" is a one-line aggregate (`pattern_feedback`). Procedures hang off the pattern and the tasks
they learned from, so "why does this task go to the prescriber?" is one traversal.

**Provenance is edges, not log lines.** A finding links to the step that wrote it, the step to the queries it ran, the finding to the
evidence and decisions it used. "How did Domino get here?" is `trace_finding`, one query.

**Queries are nodes too.** The catalog is seeded into the graph, so a step or a message links to the exact Cypher behind it, and the
care-team brain can cite it.

**A graph per clinic** keeps tenants apart at the database level. Nothing in a query can reach another clinic's graph.

**Indexes** exist on `id` for every label the app looks up, on `Lock.key`, `Prescriber.name` and `Finding.key`. **Full-text indexes**
(RediSearch inside FalkorDB) cover `Drug` (`name`, `terms`), `Effect` (`name`, `plain`, `terms`), `Task` (`title`, `body`, `note`), `Note`,
`Decision` (`reason`), `Finding` (`label`), `Message` (`text`) and `Doc` (`title`, `text`).

All queries: [CYPHER.md](CYPHER.md).
