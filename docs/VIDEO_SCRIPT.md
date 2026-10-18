# Demo video script (3 minutes)

Judging is online, so for most judges this video is the product. It follows the organisers' own advice: show the graph doing work the agent
could not do without it, **run the same question twice**, and show the agent saying "not in the graph" instead of guessing. Everything on
screen is live; nothing is pre-rendered. Say "synthetic" whenever a number appears.

Seven beats, one idea each:

1. A cascade is a path (0:00–0:25)
2. The agents walk it, an algorithm sets priority, and every finding shows its path (0:25–1:05)
3. It stops the next one inside the EHR (1:05–1:30)
4. **The same question twice**: memory changes the answer (1:30–2:00)
5. A handover becomes a ticket, and the care-team brain answers with sources (2:00–2:25)
6. **Not in the graph is not safe** (2:25–2:42)
7. Close (2:42–3:00)

## Before you record

```bash
npm run setup     # fresh graphs for both clinics (also undoes any rehearsal)
npm run dev       # then click through every page once so it is compiled and fast
```

- **Record with the language model on.** Put `GEMINI_API_KEY` in `.env.local` before `npm run setup` and restart. The console header then shows
  the model, and Ask Domino's steps show the **MCP** badge with the model choosing tools. (Without a key the graph planner runs; it works, but
  the video should show the model choosing tools over MCP.)
- Browser at 1920×1080 (or 1440×900), zoom 100%, bookmarks bar hidden. Keep the cursor slow.
- Open these tabs in order: `/`, `/patients/p-beatrice?tour=1` (don't load it yet), `/ehr`, `/patients/p-walter`, `/team`.
- Record the voice separately if you can, in your own words. The lines below are a guide, not a script to read.
- With the model on, a full review takes 20 to 60 seconds, longer than its slot below. Record it whole, then speed up or cut the wait in
  editing and put "sped up" on screen. Never fake a result: every shot should be something the live app did.

## Shot list

| Time | Screen | Do | Say |
| - | - | - | - |
| 0:00–0:12 | Landing hero | Let the 3D dominoes fall once | "Beatrice is 84. She takes nine medicines. One of them started four of the others." |
| 0:12–0:25 | Landing, "A prescribing cascade is a path", hover the Cypher | Slow scroll to the Cypher | "A side effect gets mistaken for a new illness, so another drug treats it, then another. Each prescription looks fine on its own. The harm is the path: drug, side effect, drug. So Domino's agents run on a FalkorDB graph." |
| 0:25–0:50 | `/patients/p-beatrice?tour=1` | Load it; the agents run. Point at the model name in the console header, a Detective step's Cypher, the Pharmacist's **find_chokepoints** step, a green "signature verified" handoff | "Three agents. The Detective walks her slice of the graph. The Pharmacist runs betweenness centrality, a graph algorithm, to find chokepoint drugs, and that sets how soon a review is due. Every handoff is signed and checked." |
| 0:50–1:05 | The untangle, then select amlodipine → furosemide and open **How Domino got here** | Let the tiles turn green, then the provenance graph draw | "If amlodipine were reviewed, four more of her medicines might not be needed: nine down to four. A simulation; a pharmacist decides. And every finding shows its path, back to the exact queries that wrote it." |
| 1:05–1:30 | `/ehr` (Rosa is selected): **Benztropine**, **Sign order**; when the card pauses the signature, **Hold Benztropine and review Risperidone first** | Point at the card, then the JSON on the right | "It also works where prescribing happens. Inside an EHR, over CDS Hooks, the HL7 standard, Domino pauses the signature: benztropine may be treating a side effect of risperidone. Replayed over 600 synthetic patients, this check would have stopped three in four cascades at the first downstream drug." |
| 1:30–1:42 | `/patients/p-walter`: **Run review** | Let it finish; point at tamsulosin → meclizine in the findings | "Now the same question twice. Walter's review flags tamsulosin, then meclizine for the dizziness." |
| 1:42–1:52 | Select tamsulosin → meclizine, **Not a cascade**, reason "Meclizine is for his vertigo, diagnosed by ENT before the tamsulosin", save | Show the signed decision | "His doctor knows something the record doesn't, and says so. The decision is signed and stored in the graph." |
| 1:52–2:00 | **Run review** again | Point at "Since the last review: no longer flagged: Tamsulosin → Meclizine (the care team decided)" | "Same question, different answer, because the graph remembered." |
| 2:00–2:13 | `/team`, *Team notes* → Add a note: title "Beatrice has a dry cough", text "Beatrice Hale has had a dry tickly cough for three weeks; her daughter asked for something for it." → *Add and link* | Watch the "will link" chips and the "Domino noticed" panel | "A handover is knowledge too. Lisinopril causes a dry cough, and nothing treats it yet: that's the moment before a cough syrup gets prescribed. So it proposes a signed review task, linked to the note." |
| 2:13–2:25 | Same page: ask the care-team brain "Who on the team knows calcium channel blocker swelling cascades?" | Point at the sources under the answer | "And the care-team brain answers about the whole clinic, citing every query it ran." |
| 2:25–2:42 | `/patients/p-beatrice`, Ask Domino: "Is zorbaxapril safe with her amlodipine?" | Point at the first sentence of the answer | "Zorbaxapril isn't a real medicine. Domino doesn't guess: it isn't in the graph, so it says it wasn't checked. Not in the graph is not the same as safe." |
| 2:42–3:00 | `/graph`, the 3D graph with Beatrice's cascade lit | Let it orbit | "Synthetic patients, public knowledge with citations, and an evaluation that tests the reasoning, not clinical validity. Remove FalkorDB and nothing works. Domino: find the pill that's treating another pill." |

## If something goes wrong while recording

- "Someone else is running … review right now": a rehearsal still holds the lease; the page starts the review by itself when it ends (at most two minutes).
- "Too many requests": the agent endpoint allows 6 runs a minute. Wait a minute.
- Walter's link is already marked from a rehearsal, or the inbox has rehearsal tasks: `npm run setup` resets both clinics.
- The console header says "Graph planner": the key isn't loaded. Check `.env.local`, restart `npm run dev`.
- FalkorDB Cloud stopped: start the instance in the console, then reload.

## B-roll included

`docs/media/domino-screen-capture.mp4` is a silent capture of the core flow (landing → Beatrice's story mode → prescriber check → population →
evaluation), recorded from the app. Use it as B-roll if a shot doesn't work.

## Thumbnail and title

- **Title:** Domino: AI agents that find the pill treating another pill (FalkorDB · Graph Hacks 2026)
- **Thumbnail:** `/opengraph-image` (the share card the app generates), or the landing hero's falling dominoes with "9 → 4 medicines".
