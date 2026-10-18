# First principles, the idiot index and Delta 4

How we decided what Domino is, and what it is not.

## 1. First principles: what a prescribing cascade actually is

Strip away the medicine and a cascade has five parts:

1. **Drug A** is started.
2. A **side effect** of A appears, within a typical time.
3. Someone **misreads** the side effect as a new problem.
4. **Drug B** is started to treat it.
5. Repeat from step 2 with B.

What does each part need?

| Part | Information needed | Where it already exists |
| - | - | - |
| Drug A, drug B, their dates | Prescription records | Every pharmacy and practice system |
| A causes the effect, and how soon | Adverse-reaction data | Product labels, published studies |
| B treats the effect | Indication data | Product labels, guidelines |
| B was "for" the effect | The charted indication | Sometimes on the prescription |
| It was a misreading, not a real new problem | Other diagnoses and their dates | The problem list |

Every piece of information already exists. Nothing new has to be measured. **The missing piece is the connection**: the facts sit in
different systems, written by different prescribers, months apart, and no one sees them laid end to end.

So the product is not "an AI that knows medicine". It is **a graph that connects facts that already exist, and agents that walk it and
say what they found, with the evidence**. That is why FalkorDB is the core and the LLM is optional.

Corollaries we built around:

- **A cascade is a path**, so the core query is a variable-length path, not a lookup.
- **Order matters**: B must start after A, near the effect's usual onset. Time lives on the `TAKES` edge.
- **Reasons matter**: if B has its own diagnosis, it may not be a cascade. That is a second traversal (`HAS` → `TREATED_BY`).
- **Some links are deliberate**: stomach protection with an NSAID is good care. That is a pattern node, not a guess.
- **The output is a question**, because only a clinician can tell a side effect from a new illness.

## 2. The idiot index

Elon Musk's *idiot index* is the ratio of a finished part's cost to the cost of its raw materials. A high ratio means the process,
not the material, is where the cost lives.

Apply it to a prescribing cascade. The "raw material" needed to prevent Beatrice's is a handful of facts, all already on record:
amlodipine's start date, that it causes ankle swelling in a common share of patients within weeks, and furosemide's start date seven weeks later.
In Domino, connecting them is one graph query that runs in about a tenth of a second.

The "finished part" is what happened instead: four more prescriptions from four prescribers, eighteen months of side effects being treated as illnesses,
an anticholinergic burden of 4 (a level linked to confusion and falls in older adults), a triple-whammy combination that puts her kidneys at risk,
and five medicines nudging her toward a fall.

| | Raw material | Finished part |
| - | - | - |
| What it is | 3 facts already in the record | 4 extra medicines, their side effects, the visits behind them |
| What it takes | 1 graph query (~0.1 s) | 18 months of care |

We do not put a dollar figure on it: medicine prices and visit costs vary by country and we refuse to invent them. But the ratio is
plainly enormous, and that is the signal that the problem is a **process** problem (information not connected at the moment of
prescribing), not a **knowledge** problem. It is also why Domino has a **prescriber check**: the cheapest place to break a cascade is
before the second drug is written.

Domino's own idiot index is low by design: the knowledge graph is 116 drugs, 50 effects and 27 patterns; the engine is about
1,500 lines of TypeScript (scoring, chains, the untangle, the prescriber check, the replay, the sweep) on top of graph queries; it runs with no
LLM at all.

## 3. Delta 4

Kunal Shah's *Delta 4* asks: on a 0–10 scale of efficiency, is the new way at least **4 points** better than the current way? If so, users
switch and don't go back.

**Today's way:** a pharmacist or geriatrician doing a structured medication review reads the medicine list, checks it against the Beers
Criteria and STOPP/START, and relies on memory and chart archaeology to notice that one drug followed another's side effect. Cascades are
hard to see in a list sorted by name; they live in the dates across prescribers.

| Job | Today | With Domino | Delta |
| - | - | - | - |
| Notice that B followed A's side effect | Depends on the reviewer noticing, from dates scattered across a list | Every link found, ordered by evidence, with the gap in weeks | Large |
| Know if it is documented | Recall a paper, or search | Pattern, evidence level, references and the real-world sequence ratio, inline | Large |
| Rule out deliberate pairs and other reasons | Manual, per pair | Done for every pair, shown as "checked and set aside" | Large |
| See the knock-on effect of one change | Mental simulation | "What if A were reviewed?": medicines, anticholinergic burden, fall-risk drugs, combinations | Large |
| Write it up | Type a note | SBAR note, family note and tasks drafted, ready to edit | Medium |
| Catch it before it happens | Not possible in most workflows | Prescriber check flags the cascade before the second drug is added | New capability |
| Remember what the team decided | In someone's head, or a free-text note | Signed decisions every future review respects | Large |

Our honest self-score: today's cascade-hunting sits around **3/10** for speed and completeness; Domino aims at **8/10** for the same reviewer.
That is a Delta of about 5, with the strongest jump at the two moments that matter: **before prescribing** and **at review**.

## 4. What we deliberately did not build

- **No diagnosis and no orders.** A clinician decides; Domino asks.
- **No dosing engine.** Dose-dependent effects are named ("a lower dose may help") but not calculated.
- **No chatbot as the product.** "Ask Domino" exists, but the value is the graph walk and the evidence, not conversation.
- **No real patient data.** Synthetic only, by rule and by principle.
- **No dependency on an LLM.** The planner proves the graph is doing the work.
