# Prescribing cascades are paths: building Domino on FalkorDB

*Graph Hacks 2026 · Track 1: Agents That Act on Connected Data*

Beatrice is 84. In eighteen months she saw five prescribers. Her family doctor started amlodipine for her blood pressure.
Seven weeks later her ankles were swollen, so a walk-in clinic prescribed furosemide. Her potassium dropped, so potassium chloride followed.
The furosemide made her rush to the bathroom and sometimes not make it, so a urologist added oxybutynin. Oxybutynin is strongly
anticholinergic, and a few months later she was confused enough that a geriatric clinic started donepezil for her memory.

Every one of those prescriptions was reasonable on its own. Together, four of her nine medicines may exist only because of the first one.

Beatrice is synthetic. The pattern is not. Geriatricians call it a **prescribing cascade**: a side effect is mistaken for a new illness and
treated with another drug (Rochon and Gurwitz, BMJ 1997). In 2022, 38 clinicians from six countries agreed on nine cascades that usually do
more harm than good (ThinkCascades). In 2025, a study of 533,464 older adults in Ireland found a diuretic was 1.93 times more likely to be
started *after* a calcium channel blocker than before it.

We built **Domino**, a team of AI agents that find these chains in a FalkorDB graph, prove every link, and hand a pharmacist one question.

## The insight: a cascade is a path

Take the medicine out of it and a cascade is five things: drug A starts, a side effect of A appears in its usual time window, someone
misreads it, drug B starts to treat it, and the whole thing repeats from B. Every fact needed to see this already exists: prescription dates
in the pharmacy record, side effects and indications in public labelling. What's missing is the **connection**, because the facts are written
by different people, months apart.

That's a graph problem. Drug → side effect → drug → side effect → drug. In SQL it's a pile of self-joins that breaks with every extra hop.
In Cypher it's one pattern:

```cypher
MATCH (p:Patient {id: $pid})-[:TAKES]->(m:Drug)
WITH p, collect(m.id) AS meds
MATCH (p)-[:TAKES]->(a:Drug)
MATCH path = (a)-[:CAUSES|TREATED_BY*2..8]->(z:Drug)
WHERE z <> a AND all(n IN nodes(path) WHERE NOT n:Drug OR n.id IN meds)
RETURN [r IN relationships(path) | [startNode(r).id, type(r), endNode(r).id]] AS hops
```

On FalkorDB this returns all forty of Beatrice's candidate paths in about a tenth of a second.

## Modelling choices that made the queries simple

**Point both edges forward.** `CAUSES` goes drug → effect and `TREATED_BY` goes effect → drug. With both directed "downstream", any directed
path over those two types alternates drug, effect, drug, effect on its own. The query needs no alternation logic at all.

**One node type for side effects and diagnoses.** A cascade *is* a side effect being treated as a diagnosis, so "ankle swelling" is the same
`Effect` node whether amlodipine causes it or a patient `HAS` it. That makes "does the second drug have another reason?" a two-hop pattern:
`(p)-[:HAS]->(c:Effect)-[:TREATED_BY]->(b)`.

**Dates as integers.** `TAKES.start` is a day number, so timing ("B started 48 days after A, inside amlodipine's 7 to 120 day window for
edema") is arithmetic, and the population query can count "B after A within a year" in a single aggregate.

**Knowledge as nodes, not code.** The 27 documented cascades are `Pattern` nodes linked to drug classes and the effect between them. Matching
a link to the literature is a traversal: `(a)-[:IN_CLASS]->()<-[:INDEX]-(pt)-[:VIA]->(e)`. The same goes for dangerous combinations like
the "triple whammy" (an ACE inhibitor, a diuretic and an NSAID together), and for class conflicts used when suggesting alternatives.

## Agents that use the graph as their tools

Domino's three agents only know the world through thirteen tools, and every tool is a named, parameterised Cypher query from a catalog of 92:

- The **Detective** walks the paths, finds loops (oxybutynin causes confusion, which donepezil treats; donepezil causes incontinence, which
  oxybutynin treats), checks side-effect pile-ups and combinations, and records findings back into the graph.
- The **Pharmacist** explains each root's evidence, looks for alternatives that treat the same diagnosis without that side effect and without
  clashing with anything else the patient takes, runs prescription sequence symmetry across all 606 patients, and simulates the untangle.
- The **Scribe** writes review tasks, an SBAR note for the prescriber and a plain-language note for the family.

The untangle is my favourite piece. It's a fixed-point computation over the cascade links: a medicine stays justified if it has its own diagnosis
or is reached by a strong link from a justified medicine. For Beatrice, "what if amlodipine were reviewed?" leaves 4 of 9 medicines, drops
her anticholinergic burden from 4 to 0, and removes the triple whammy. It's labelled a simulation, because it is one.

Each agent is an LLM tool-calling loop when a key is set (Gemini, Claude, or anything OpenAI-compatible) and a deterministic planner when it
isn't. The planner calls the same tools in the same order and stores the same audit trail. That turned out to be the best proof that the graph
does the work: with no model at all, Domino still finds every cascade.

## Memory and coordination, in the graph

Agents hand off through `Handoff` nodes. Each handoff is signed with HMAC-SHA256, written to FalkorDB, read back by the next agent and verified;
a failed check stops the run. Before a review starts, the runner takes a lease on the patient in the graph: one `MERGE` with a guarded `SET`,
atomic because FalkorDB runs writes one at a time per graph. Start twelve reviews of one patient at once and exactly one runs.

Memory comes in four kinds, all of them nodes and edges:

- **Episodic.** Every run, every tool call (`Step`) and the catalog `Query` nodes it ran, every finding and handoff. Each run starts by saying
  what changed since the last review.
- **Semantic.** Clinicians mark a link *confirmed*, *intentional* or *not a cascade*. Those signed `Decision` nodes hang off the patient and off
  the `Pattern`, so feedback accumulates across patients. Agents have no tool that writes one; a test writes a forged decision straight into
  FalkorDB and checks the agents ignore it.
- **Procedural.** A `Procedure` node says who a review task goes to, how soon, and whether a "possible" link gets one at all. Every task a person
  approves or dismisses is an outcome; when the outcomes favour something else, a new version `SUPERSEDES` the old one and links to every task it
  `LEARNED_FROM`. At our demo clinic, prescribers acted on calcium-channel-blocker swelling tasks that pharmacists kept passing on, so those tasks
  now go to the prescriber, and the inbox says "routed by learned procedure v1".
- **Conversations.** Every question and answer is a `Message` in a `Conversation` owned by one person, so "what could replace it?" resolves days later.

And because all of it is edges, **provenance is a traversal**: from any finding, back to the step that wrote it, the queries that step ran, the
evidence and decisions it used, and forward to the handoffs that carried it and the tasks it led to. The workspace draws that as
*How Domino got here*.

## A care-team brain

Once tasks, notes, decisions and conversations live in one graph next to the prescriptions, the clinic itself becomes queryable. Who prescribed
what (`Prescriber` nodes behind every `TAKES`), who on the team has handled each kind of cascade, where cascades cross from one prescriber to
another (at our synthetic Riverside clinic, 61% do), and one full-text search over everything the team wrote. A brain agent answers questions about all
of it over MCP and cites every query. Each clinic is its own FalkorDB graph, so none of this leaks between tenants.

## Did it work?

We generated 600 synthetic patients with 632 hidden cascades, plus the confounders a real record has: the same drugs prescribed for real
diagnoses, deliberate pairs (stomach protection with an NSAID), and drugs started in the wrong order. Then we turned the graph signals on one at a time:

| Signal | Precision | Recall |
| - | - | - |
| Graph links only | 0.30 | 1.00 |
| + time order | 0.44 | 1.00 |
| + onset window | 0.59 | 1.00 |
| + other reasons | 0.58 | 0.96 |
| **Domino** | **0.75** | **0.96** |

And zero of the 227 deliberate pairs were flagged. The honest caveat: the generator and the engine share one knowledge graph, so this tests the
reasoning, not clinical truth. The interesting row is "+ other reasons": a charted indication raises confidence in real cascades *and* in
deliberate pairs, so it doesn't help on its own. Only the pattern layer, which knows gastroprotection is good care, separates them.

Then the question that matters more: would it have *prevented* them? We replayed every prescription in the cohort as the record stood the day it
was written, with the prescriber check in the way. It would have stopped 401 of the 534 cascade drugs it met at the first downstream prescription, and
510 prescriptions might never have been written. 95% of its cascade stops were real cascades.

## What surprised us

- **FalkorDB's `algo.betweenness` found the chokepoints**: hypertension, cognitive impairment and urinary incontinence sit on the most cascade
  routes. Those are exactly the symptoms where a prescriber prompt would help most. Among drugs, the chokepoints (midodrine, donepezil,
  mirabegron and others) now set priority: a review task for a cascade through one is due in half the usual time.
- **Sequence symmetry without a graph is noisy.** "Anticoagulant then beta blocker" is a strong signal in our cohort, and it's just the normal
  order of care for atrial fibrillation. Joining each signal to a mechanism path in the graph is what separates cascades from care pathways.
- **The best place to break a cascade is before it starts.** The prescriber check (type a new drug, see if it treats a side effect of
  something already taken) became one of the most useful screens, and adding the drug anyway triggers the Detective automatically.

## Try it

Six synthetic patients, each telling a different story, including Dorothy: same two drugs as Beatrice, but her furosemide came first, for heart
failure. Domino checks, finds the reasons, and stays quiet. That's the one I'd show a pharmacist first.

The code, the graph model and every Cypher query are in the repository. Domino is a prototype on synthetic data. It raises questions for clinicians,
and it never tells anyone to stop a medicine.
