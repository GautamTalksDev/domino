# Clinical safety

Domino is decision support for clinicians, built for a hackathon on synthetic data. It is not a medical device and must not be used for real patients.
Still, it is designed the way a real tool would need to be.

## Principles

1. **Questions, not orders.** Domino never tells anyone to stop, start or change a medicine. Everything an agent writes or says (tasks, notes,
   follow-ups, handoffs, answers) is checked by a guardrail (`src/lib/agent/guard.ts`) for instructions such as "Stop amlodipine.", "should be
   discontinued", "switch to an ARB" or "reduce the dose". A task or note that fails is refused, a handoff is held back, and a model's answer is
   replaced by the graph planner's. Safety cautions ("taper if changed") and descriptions ("switching to an ARB usually fixes the cough") pass.
2. **Not in the graph is not safe.** A medicine Domino cannot match is named as not checked, in answers, on CDS cards and on check-ups, never
   silently dropped.
3. **A person decides.** Findings are recorded for review, tasks are *proposed*, notes are *drafts*.
4. **Show the evidence.** Every link shows how often the side effect happens, the timing, other reasons, the documented pattern and its references.
5. **Know what is deliberate.** Stomach protection with an NSAID, potassium with a diuretic, a laxative with an opioid and B12 with metformin are usually planned. Domino sets them aside, and in the prescriber check a planned companion never raises a cascade stop by itself.
6. **Stop safely.** The what-if names every medicine that must not be stopped abruptly (beta blockers, benzodiazepines, antidepressants, opioids, steroids, antiepileptics, levodopa and more) with the taper or monitoring it needs, and the SBAR note carries the same warning.
7. **Agree with itself.** The prescriber check scores a link with the review engine's own function, so a drug the review would call unlikely is never stopped at the point of prescribing, and one it would call likely is.
8. **Say when it is unsure.** "Possible" links, other contributors and real-world studies that did *not* confirm a pattern are shown, not hidden.

## Hazard log

| # | Hazard | Cause | Effect | Control | Residual |
| - | - | - | - | - | - |
| H1 | A needed medicine is stopped because Domino flagged it | User treats a flag as advice | Relapse of the treated condition | Wording guardrail; tasks phrased as questions; "other reasons" shown; the what-if is labelled a simulation; patient note says "do not change anything on your own" | Low |
| H2 | A real cascade is missed | Effect not in the knowledge graph, or indication charted for another diagnosis | Harm continues | Pattern-level and graph-level detection; "possible" tier; population sweep; misses documented in the evaluation | Medium (knowledge coverage) |
| H3 | A deliberate pairing is flagged as a cascade | Same-day start, gastroprotection | Alert fatigue | Intentional patterns, same-day timing factor, clinician memory | Low (0 of 227 in the evaluation; 1 of 210 stopped in the prevention replay, because the same PPI also matched a likely bisphosphonate cascade) |
| H4 | A forged "intentional" decision hides a cascade | Database tampering | Harm continues | Signed decisions verified on read | Low |
| H5 | An LLM invents a link or a reference | Hallucination | Misleading review | Agents only see tool results; links and references come from the graph, not the model; UI shows the path | Low |
| H6 | Stale knowledge | Labels change | Wrong weighting | Versioned knowledge graph with references; frequency bands documented as approximate | Medium |
| H7 | Over-reliance on the untangle | Simulation read as a plan | Several medicines changed at once | Labelled "a simulation, not advice"; names other contributors; brief asks one question at a time | Low |
| H8 | A medicine is stopped abruptly after a review | Withdrawal (rebound tachycardia, seizures, adrenal crisis) | Acute harm | Taper and monitoring advice on 15 drug classes, shown in the what-if and carried into the SBAR note | Low |
| H9 | Alert fatigue at the point of prescribing | Too many stops | Real stops ignored | Verdict follows the engine's tiers; unlikely links raise nothing; documented links whose effect is also a charted diagnosis are cautions; 95% of cascade stops correct in the replay | Medium (the synthetic cohort is enriched, so the real stop rate is unknown) |
| H10 | The agents learn a bad habit | A run of dismissals that were wrong | Real cascades stop getting tasks | Thresholds need five outcomes; only signed, human-decided tasks count; a "likely" link always gets a task; every version is visible with the tasks it learned from | Low |

## What a real deployment would add

Validation against real prescribing data and pharmacist adjudication, knowledge-base governance with a clinical owner, dose and renal-function
awareness, integration with the medication record (with consent and access control), and regulatory review as clinical decision support software.
