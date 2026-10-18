# Data

## Knowledge graph

Curated by hand in `src/data/knowledge.ts` from public sources. No paywalled, private or login-protected data is loaded.

- **Side effects and treatments** (`CAUSES`, `TREATED_BY`): product monographs and prescribing information, summarised into frequency bands
  (very common > 10%, common 1–10%, uncommon 0.1–1%, rare) and typical onset windows in days. These are approximations for a prototype.
- **Anticholinergic burden:** Anticholinergic Cognitive Burden scale (Boustani et al. 2008 and updates). Scores are approximate.
- **Potentially inappropriate medicines:** American Geriatrics Society Beers Criteria, 2023 update.
- **Documented cascades** (`Pattern`): the nine ThinkCascades (McCarthy et al., Drugs Aging 2022) and cascades from published studies
  (Savage 2020, Gill 2005, Avorn 1995, Gurwitz 1994, Vegter 2010, Read 2021), plus labelling-based patterns. Real-world adjusted sequence
  ratios for five ThinkCascades come from Doherty et al., Ann Fam Med 2025 (533,464 adults aged 65+ in Ireland); the four not confirmed in that study are labelled so.
- **Dangerous combinations:** the "triple whammy" (Lapi et al., BMJ 2013) and Beers 2023 drug-drug interactions.

Full citations: `src/data/references.ts` (also shown in the app next to every pattern).

## Patients

All synthetic.

- **6 personas** written by hand (`src/data/personas.ts`), each designed to exercise one part of Domino.
- **Two clinics.** Riverside Family Health: the 6 personas plus 600 generated patients (seed 20261015). Lakeview Geriatric Clinic: 300 generated
  patients (seed 20261016). Each clinic is its own FalkorDB graph.
- **Generated patients** (`src/data/generator.ts`) are deterministic for a given seed. The cohort is deliberately enriched with cascades so
  there is something to find; its prevalence is not an estimate of anything real.
- **Prescribers.** Each generated patient has one family doctor, who writes three in four of their base medicines (a specialist writes the
  rest). A drug added for a side effect is written by the family doctor 40% of the time, a walk-in clinic 35% and a specialist 25%. That
  assumption is what the care-team Sankey shows, and it is synthetic.
- **Care-team history** (`src/data/history.ts`): a few months of decided review tasks per clinic, invented, so procedural memory has something
  to have learned from on day one. Riverside's NSAID blood-pressure history is deliberately one decision away from a change, for the demo.
- **Check-ups** (`/checkup`): a pasted list becomes a temporary patient with no name, which expires after two hours and never enters
  clinic-wide memory, lists or search.
- **Brand names and plain words** (`src/data/brands.ts`): US and UK brand names and lay terms ("water pill") for the full-text index.

Names, prescribers and histories are invented. Any resemblance to real people is coincidental.

## Dates

Stored as integer day numbers from 1 January 2024. "Today" in the synthetic world is 1 October 2026 (day 1004).
