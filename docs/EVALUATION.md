# Evaluation

## Setup

- **Cohort:** 600 synthetic adults aged 65–97 from a seeded generator (`src/data/generator.ts`, seed 20261015).
  Chronic conditions are drawn with realistic prevalence, each with a first-line medicine and a start date.
- **Hidden cascades:** for every medicine and each side effect it causes, the generator rolls whether the effect appeared, was
  mistaken for a new problem and treated (probability scales with frequency and age), picks a treating drug from `TREATED_BY`,
  and starts it inside the effect's onset window. Cascades can chain up to three links.
- **Confounders:**
  - deliberate pairs started together: a PPI with an NSAID, anticoagulant or antiplatelet (age 72+), a laxative with an opioid,
    potassium with a loop diuretic;
  - "marker" drugs prescribed for a genuine diagnosis (furosemide for heart failure, zolpidem for insomnia, oxybutynin for overactive bladder);
  - genuine diagnoses for effects (gout, dizziness, cough), so the order and the reason have to be read, not assumed;
  - indications charted only some of the time (80% for base drugs, 45% for cascade drugs).
- **Ground truth** stays in memory in the evaluation script; it never enters the graph.
- **Unit:** a (patient, first drug, second drug) pair. A prediction is any link scored likely or possible (≥ 0.25) and not tiered intentional.

## Results

632 hidden cascades, 227 deliberate pairs, 2,154 candidate links found by the graph.

| Signal added | Precision | Recall | F1 | TP | FP | FN | Deliberate flagged |
| - | - | - | - | - | - | - | - |
| Graph links only | 0.302 | 1.000 | 0.464 | 632 | 1,463 | 0 | 227 |
| + time order | 0.438 | 0.997 | 0.608 | 630 | 810 | 2 | 200 |
| + onset window | 0.592 | 0.997 | 0.743 | 630 | 434 | 2 | 200 |
| + other reasons | 0.576 | 0.959 | 0.720 | 606 | 446 | 26 | 226 |
| **Domino (full)** | **0.748** | **0.959** | **0.840** | 606 | 204 | 26 | **0** |

The evaluation runs on FalkorDB in about 15 seconds on our build container, including the prevention replay (`npm run eval`, or **Re-run live** on the Evaluation page).

## Prevention replay: if Domino had been at the prescriber's desk

The ablation asks whether Domino finds cascades after the fact. The replay asks whether it would have **stopped** them. For every patient,
every prescription after the first is re-checked with the prescriber check exactly as the record stood the day it was written: only earlier
prescriptions and diagnoses count (`asOf`). When the check raises a documented-cascade stop on a drug the ground truth says was a cascade, that
drug and everything the ground truth says followed from it are removed from the rest of the patient's replay, and later prescriptions are
checked against the record without them.

| | |
| - | - |
| Prescriptions re-checked | 2,443 |
| True cascade drugs met in the replay | 534 |
| **Stopped at the first downstream prescription** | **401 (75%)** |
| Got at least a caution | 522 (98%) |
| **Prescriptions that might never have been written** | **510** |
| Cascade stops on drugs that were not cascades | 22 |
| **Cascade-stop precision** | **0.948** |
| Other stops (dangerous combinations, class conflicts) | 88 |
| Cautions | 794 |
| Deliberate companions checked / stopped for any reason / stopped as a cascade | 210 / 7 / 1 |
| Stops per 100 prescriptions | 20.9 |

**How the verdict is decided** (`src/lib/engine/gatekeeper.ts`): each "the new drug treats a side effect of that one" link is scored with the
review engine's own `scoreLink()`, so the check and the review never disagree. A documented pattern stops when it scores likely, or possible when
the effect is not already charted as a diagnosis; a graph-inferred link stops only when it scores likely; anything else possible is a caution;
unlikely links raise nothing. A deliberate companion link (a PPI with an NSAID) never raises a stop by itself. The one deliberate companion
stopped as a cascade was a PPI that also matched a *likely* bisphosphonate → indigestion → acid suppression cascade in the same record.

**What changed during the build, and why it matters.** An independent AI review pass found that the first version of the check stopped on any documented
pattern regardless of its score, and treated any charted diagnosis of the side effect as "its own reason", even one charted after the first drug
started (which is the cascade itself). Aligning the verdict with the engine's tiers raised cascade-stop precision from 0.931 to 0.948,
cut false cascade stops from 30 to 22 and deliberate companions stopped as a cascade from 5 to 1, for two fewer
cascades caught (403 to 401).

**Alert burden, honestly.** About 21 stops per 100 prescriptions is high for a real clinic. This cohort is deliberately
enriched with cascades (roughly half the patients have one), so the rate says little about a real practice, where most prescriptions are routine.
A real deployment would tune the thresholds on real prescribing data.

## Reading it honestly

- **The jump is the point.** Raw graph links find everything and are wrong two times out of three. Each graph signal removes a class of false alarm.
- **"Other reasons" alone does not help precision.** A charted indication raises confidence in real cascades *and* in deliberate pairs
  (a PPI is charted "for stomach protection"). Only the pattern layer can tell them apart, which is why the full model goes from
  226 deliberate pairs flagged to zero.
- **The 26 misses are deliberate.** They are cascades where the second drug also has a genuine diagnosis on record. Domino lowers
  its confidence there on purpose: in a real record, that is exactly when a pharmacist should not be told "this is a cascade".
- **This tests the reasoning, not clinical validity.** The generator and the engine share one knowledge graph, so graph-level recall is high
  by construction. Clinical validation needs real prescribing data, for example a prescription sequence symmetry analysis like
  Doherty et al. (Ann Fam Med 2025), plus pharmacist review of flagged records.
- **The knowledge graph is hand-curated** for a hackathon. Frequency bands and onset windows are approximate.

## Population signals

The Population page runs prescription sequence symmetry analysis (Hallas 1996) with a trend-adjusted null-effect ratio over every
pair of drug classes, then joins each signal to mechanism paths in the graph. In the synthetic cohort, signals with a mechanism are the
injected cascades; strong signals without one (anticoagulant → beta blocker) are care pathways, which is the distinction the graph adds.
