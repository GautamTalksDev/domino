// The Cypher catalog: every query Domino runs while it serves a request or runs an agent, in one place.
// The UI shows these to users ("Show the query"), the agent trace logs them,
// and docs/GRAPH_MODEL.md documents them. The only Cypher outside it is the seeder's schema and bulk-load
// statements (src/lib/seed.ts), which build the graph and never run at request time.

export interface CypherQuery {
  id: string;
  title: string;
  purpose: string;
  mode: 'read' | 'write';
  cypher: string;
}

function dedent(text: string): string {
  const lines = text.replace(/^\n+|\s+$/g, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length);
  const min = Math.min(...indents);
  return lines.map((l) => l.slice(min)).join('\n');
}

const q = (id: string, title: string, purpose: string, mode: 'read' | 'write', cypher: string): CypherQuery => ({
  id,
  title,
  purpose,
  mode,
  cypher: dedent(cypher),
});

export const Q = {
  // ─── Patient context ────────────────────────────────────────────────────────
  patient: q(
    'patient',
    'Load the patient',
    'Demographics, diagnoses and the medication timeline.',
    'read',
    `
    MATCH (p:Patient {id: $pid})
    OPTIONAL MATCH (p)-[h:HAS]->(c:Effect)
    WITH p, collect({id: c.id, name: c.name, plain: c.plain, since: h.since}) AS conditions
    OPTIONAL MATCH (p)-[t:TAKES]->(d:Drug)-[:IN_CLASS]->(k:DrugClass)
    RETURN p.id AS id, p.name AS name, p.age AS age, p.sex AS sex, p.persona AS persona,
           p.headline AS headline, p.story AS story, p.sandbox AS sandbox, p.expiresAt AS expiresAt, conditions,
           collect({id: d.id, name: d.name, cls: k.id, clsName: k.name, acb: d.acb, beers: d.beers,
                    start: t.start, dose: t.dose, prescriber: t.prescriber, indication: t.indication, assumedDate: t.assumedDate}) AS meds
    `,
  ),

  patientList: q(
    'patient_list',
    'List patients',
    'Every patient with medication count and the latest review summary written by the sweep.',
    'read',
    `
    MATCH (p:Patient)
    WHERE p.sandbox IS NULL
    OPTIONAL MATCH (p)-[:TAKES]->(d:Drug)
    WITH p, count(d) AS meds
    RETURN p.id AS id, p.name AS name, p.age AS age, p.sex AS sex, p.persona AS persona,
           p.headline AS headline, meds, p.likely AS likely, p.possible AS possible,
           p.acb AS acb, p.topScore AS topScore, p.topLink AS topLink, p.topLinkScore AS topLinkScore, p.avoidable AS avoidable, p.reviewedAt AS reviewedAt
    ORDER BY p.persona DESC, p.topScore DESC, p.name
    `,
  ),

  // ─── Cascade detection ──────────────────────────────────────────────────────
  links: q(
    'cascade_links',
    'Find one-step cascade links',
    'Pairs of the patient’s own drugs where drug A causes an effect that drug B treats, with timing, the recorded indication and any matching documented pattern.',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[ta:TAKES]->(a:Drug)-[c:CAUSES]->(e:Effect)-[tr:TREATED_BY]->(b:Drug)<-[tb:TAKES]-(p)
    WHERE a <> b
    OPTIONAL MATCH (a)-[:IN_CLASS]->(:DrugClass)<-[:INDEX]-(pt:Pattern)-[:VIA]->(e),
                   (pt)-[:MARKER]->(:DrugClass)<-[:IN_CLASS]-(b)
    RETURN a.id AS from, a.name AS fromName, b.id AS to, b.name AS toName, e.id AS effect, e.name AS effectName,
           e.plain AS effectPlain, c.freq AS freq, c.weight AS weight, c.onsetMin AS onsetMin, c.onsetMax AS onsetMax,
           tr.line AS line, ta.start AS fromStart, tb.start AS toStart, tb.indication AS toIndication,
           collect(DISTINCT pt.id) AS patterns
    `,
  ),

  paths: q(
    'cascade_paths',
    'Trace multi-hop cascade chains',
    'Variable-length walk over CAUSES and TREATED_BY edges that stays inside the patient’s medication list: drug → effect → drug → effect → drug, up to three drug-to-drug hops. It starts only from drugs with at least one direct link, which cuts the search by about five times.',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[:TAKES]->(m:Drug)
    WITH p, collect(m.id) AS meds
    MATCH (p)-[:TAKES]->(a:Drug)-[:CAUSES]->(:Effect)-[:TREATED_BY]->(:Drug)<-[:TAKES]-(p)
    WITH DISTINCT a, meds
    MATCH path = (a)-[:CAUSES|TREATED_BY*2..6]->(z:Drug)
    WHERE z <> a AND all(n IN nodes(path) WHERE NOT n:Drug OR n.id IN meds)
    RETURN [r IN relationships(path) | [startNode(r).id, type(r), endNode(r).id]] AS hops
    `,
  ),

  loops: q(
    'feedback_loops',
    'Find feedback loops',
    'Cycles where each drug can cause a problem that another of the patient’s drugs is treating.',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[:TAKES]->(m:Drug)
    WITH p, collect(m.id) AS meds
    MATCH (p)-[:TAKES]->(a:Drug)
    MATCH path = (a)-[:CAUSES|TREATED_BY*4..6]->(a)
    WHERE all(n IN nodes(path) WHERE NOT n:Drug OR n.id IN meds)
    RETURN [r IN relationships(path) | [startNode(r).id, type(r), endNode(r).id]] AS hops
    `,
  ),

  reasons: q(
    'alternative_reasons',
    'Check for other reasons',
    'For each of the patient’s drugs, diagnoses on record that the drug also treats. A second drug with its own diagnosis is less likely to be a cascade.',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[:TAKES]->(b:Drug)<-[tr:TREATED_BY]-(c:Effect)<-[h:HAS]-(p)
    RETURN b.id AS drug, collect({id: c.id, name: c.name, since: h.since, line: tr.line}) AS reasons
    `,
  ),

  // ─── Harm and burden ────────────────────────────────────────────────────────
  pileups: q(
    'pileups',
    'Find side-effect pile-ups',
    'Effects that two or more of the patient’s drugs cause at once.',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[:TAKES]->(d:Drug)-[c:CAUSES]->(e:Effect)
    WITH e, collect(DISTINCT {id: d.id, name: d.name, freq: c.freq}) AS drugs
    WHERE size(drugs) >= 2
    RETURN e.id AS id, e.name AS name, e.plain AS plain, e.kind AS kind, drugs
    ORDER BY size(drugs) DESC
    `,
  ),

  harms: q(
    'harm_paths',
    'Trace drugs to serious harms',
    'Drugs that reach falls, fractures or kidney injury, directly or through up to two RAISES steps (dizziness → falls → fracture).',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[:TAKES]->(d:Drug)-[:CAUSES]->(e:Effect)-[:RAISES*0..2]->(h:Effect)
    WHERE h.id IN $harms
    RETURN h.id AS harm, h.name AS harmName, d.id AS drug, d.name AS drugName, collect(DISTINCT e.name) AS via
    `,
  ),

  combos: q(
    'dangerous_combos',
    'Match dangerous combinations',
    'Named combinations (triple whammy, bleeding stack, sedation stack) completed by the patient’s drug classes.',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[:TAKES]->(d:Drug)-[:IN_CLASS]->(:DrugClass)<-[g:GROUP]-(combo:Combo)
    WITH combo, g.g AS grp, collect(DISTINCT d.name) AS drugs
    WITH combo, collect({grp: grp, drugs: drugs}) AS groups
    WHERE size(groups) = combo.groups
    MATCH (combo)-[:HARM]->(h:Effect)
    RETURN combo.id AS id, combo.title AS title, combo.why AS why, combo.refs AS refs, h.name AS harm, groups
    `,
  ),

  burden: q(
    'burden',
    'Anticholinergic burden and Beers flags',
    'Anticholinergic Cognitive Burden points and AGS Beers 2023 notes for each drug.',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[:TAKES]->(d:Drug)
    WHERE d.acb > 0 OR d.beers IS NOT NULL
    RETURN d.id AS id, d.name AS name, d.acb AS acb, d.beers AS beers
    `,
  ),

  // ─── Pharmacist tools ───────────────────────────────────────────────────────
  alternatives: q(
    'safer_alternatives',
    'Find safer alternatives',
    'Drugs that treat the same diagnosis as the root drug, do not cause the problem, and are checked against the patient’s conditions, current drugs and class conflicts.',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[ta:TAKES]->(a:Drug {id: $drug})
    MATCH (a)<-[:TREATED_BY]-(ind:Effect)
    WHERE (p)-[:HAS]->(ind) OR ta.indication = ind.id
    MATCH (ind)-[tr:TREATED_BY]->(alt:Drug)-[:IN_CLASS]->(ac:DrugClass)
    WHERE alt <> a AND NOT (p)-[:TAKES]->(alt) AND NOT (alt)-[:CAUSES]->(:Effect {id: $effect})
    OPTIONAL MATCH (p)-[:TAKES]->(cur:Drug)-[:IN_CLASS]->(:DrugClass)-[av:AVOID_WITH]-(ac)
    WHERE cur <> a
    OPTIONAL MATCH (alt)-[:CAUSES]->(worse:Effect)<-[:HAS]-(p)
    OPTIONAL MATCH (alt)-[:CAUSES]->(pile:Effect)<-[:CAUSES]-(other:Drug)<-[:TAKES]-(p)
    WHERE other <> a
    RETURN alt.id AS id, alt.name AS name, ac.name AS clsName, tr.line AS line, ind.name AS forCondition,
           alt.acb AS acb, alt.beers AS beers, collect(DISTINCT av.why) AS conflicts,
           collect(DISTINCT worse.name) AS worsens, collect(DISTINCT pile.name) AS adds
    `,
  ),

  gatekeeper: q(
    'prescriber_check',
    'Check a new prescription',
    'Before a new drug is added: is it treating a side effect of something the patient already takes?',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[ta:TAKES]->(a:Drug)-[c:CAUSES]->(e:Effect)-[tr:TREATED_BY]->(n:Drug {id: $drug})
    WHERE a <> n AND ta.start < $asOf AND NOT a.id IN $exclude
    OPTIONAL MATCH (a)-[:IN_CLASS]->(:DrugClass)<-[:INDEX]-(pt:Pattern)-[:VIA]->(e),
                   (pt)-[:MARKER]->(:DrugClass)<-[:IN_CLASS]-(n)
    OPTIONAL MATCH (p)-[h:HAS]->(e) WHERE h.since <= $asOf
    RETURN a.id AS from, a.name AS fromName, e.id AS effect, e.name AS effectName, e.plain AS effectPlain, c.freq AS freq,
           c.weight AS weight, c.onsetMin AS onsetMin, c.onsetMax AS onsetMax, tr.line AS line,
           ta.start AS fromStart, h IS NOT NULL AS diagnosed, collect(DISTINCT pt.id) AS patterns
    `,
  ),

  gatekeeperReasons: q(
    'prescriber_check_reasons',
    'Other reasons for a new drug',
    'Diagnoses on record (as of the check) that the new drug also treats: a second drug with its own reason is less likely to be a cascade.',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[h:HAS]->(c:Effect)-[:TREATED_BY]->(:Drug {id: $drug})
    WHERE h.since <= $asOf
    RETURN c.id AS id, c.name AS name, h.since AS since
    `,
  ),

  gatekeeperForward: q(
    'prescriber_check_forward',
    'What could the new drug start?',
    'Effects the new drug causes that the patient already has, or that their current drugs are treating, or already cause.',
    'read',
    `
    MATCH (n:Drug {id: $drug})-[c:CAUSES]->(e:Effect)
    MATCH (p:Patient {id: $pid})
    OPTIONAL MATCH (p)-[h:HAS]->(e) WHERE h.since <= $asOf
    OPTIONAL MATCH (e)-[:TREATED_BY]->(t:Drug)<-[tt:TAKES]-(p) WHERE tt.start < $asOf AND NOT t.id IN $exclude
    OPTIONAL MATCH (e)<-[:CAUSES]-(o:Drug)<-[tc:TAKES]-(p)
    WHERE o <> n AND tc.start < $asOf AND NOT o.id IN $exclude
    RETURN e.id AS id, e.name AS name, e.kind AS kind, c.freq AS freq, h IS NOT NULL AS diagnosed,
           collect(DISTINCT t.name) AS treatedBy, collect(DISTINCT o.name) AS alsoCausedBy
    `,
  ),

  gatekeeperConflicts: q(
    'prescriber_check_conflicts',
    'Class conflicts for a new drug',
    'AVOID_WITH edges between the new drug’s class and the classes the patient already takes.',
    'read',
    `
    MATCH (n:Drug {id: $drug})-[:IN_CLASS]->(nc:DrugClass)-[av:AVOID_WITH]-(cc:DrugClass)<-[:IN_CLASS]-(d:Drug)<-[td:TAKES]-(p:Patient {id: $pid})
    WHERE td.start < $asOf AND NOT d.id IN $exclude AND d <> n
    RETURN d.name AS drug, cc.name AS cls, av.why AS why
    `,
  ),

  drug: q(
    'drug_profile',
    'Drug profile',
    'One drug with its class, what it causes and what it treats.',
    'read',
    `
    MATCH (d:Drug {id: $drug})-[:IN_CLASS]->(k:DrugClass)
    OPTIONAL MATCH (d)-[c:CAUSES]->(e:Effect)
    WITH d, k, collect({id: e.id, name: e.name, freq: c.freq}) AS causes
    OPTIONAL MATCH (d)<-[tr:TREATED_BY]-(t:Effect)
    RETURN d.id AS id, d.name AS name, k.id AS cls, k.name AS clsName, d.acb AS acb, d.beers AS beers, causes,
           collect({id: t.id, name: t.name, line: tr.line}) AS treats
    `,
  ),

  drugList: q(
    'drug_list',
    'List drugs',
    'All drugs in the knowledge graph.',
    'read',
    `
    MATCH (d:Drug)-[:IN_CLASS]->(k:DrugClass)
    RETURN d.id AS id, d.name AS name, k.name AS clsName, d.acb AS acb, d.beers IS NOT NULL AS beers
    ORDER BY d.name
    `,
  ),

  // ─── Graph exploration ──────────────────────────────────────────────────────
  neighborhood: q(
    'neighbourhood',
    'Explore a node’s neighbourhood',
    'The drug or effect and everything within two CAUSES / TREATED_BY steps.',
    'read',
    `
    MATCH (s {id: $id})
    WHERE s:Drug OR s:Effect
    MATCH path = (s)-[:CAUSES|TREATED_BY*1..2]-(n)
    WITH relationships(path) AS rels
    UNWIND rels AS r
    WITH DISTINCT r
    RETURN startNode(r).id AS s, labels(startNode(r))[0] AS sl, startNode(r).name AS sn,
           type(r) AS t, endNode(r).id AS e, labels(endNode(r))[0] AS el, endNode(r).name AS en
    LIMIT 220
    `,
  ),

  shortest: q(
    'shortest_cascade',
    'Shortest cascade route between two drugs',
    'allShortestPaths over CAUSES and TREATED_BY: how could drug A lead to drug B?',
    'read',
    `
    MATCH (a:Drug {id: $from})
    MATCH (b:Drug {id: $to})
    WITH a, b
    MATCH path = allShortestPaths((a)-[:CAUSES|TREATED_BY*..10]->(b))
    RETURN [n IN nodes(path) | {id: n.id, name: n.name, label: labels(n)[0]}] AS nodes
    LIMIT 12
    `,
  ),

  chokepoints: q(
    'chokepoints',
    'Cascade chokepoints (betweenness centrality)',
    'FalkorDB’s betweenness centrality over the cascade subgraph: the drugs and effects most cascade routes pass through. FalkorDB estimates it from sampled source nodes, so the sample is large and its seed fixed: the same graph always ranks the same way. A review task whose cascade includes one of the top drug chokepoints is due in half the usual time.',
    'read',
    `
    CALL algo.betweenness({nodeLabels: ['Drug', 'Effect'], relationshipTypes: ['CAUSES', 'TREATED_BY'], samplingSize: 2000, samplingSeed: 20261015})
    YIELD node, score
    RETURN labels(node)[0] AS label, node.id AS id, node.name AS name, score
    ORDER BY score DESC
    LIMIT 40
    `,
  ),

  stats: q(
    'graph_stats',
    'Graph size',
    'Counts of nodes and edges by type.',
    'read',
    `
    MATCH (n)
    WITH labels(n)[0] AS label, count(n) AS c
    RETURN collect({label: label, count: c}) AS nodes
    `,
  ),

  edgeStats: q(
    'edge_stats',
    'Edge counts',
    'Counts of relationships by type.',
    'read',
    `
    MATCH ()-[r]->()
    WITH type(r) AS t, count(r) AS c
    RETURN collect({type: t, count: c}) AS edges
    `,
  ),

  // ─── Population ─────────────────────────────────────────────────────────────
  pssaPairs: q(
    'pssa_pairs',
    'Prescription sequence symmetry',
    'Across every patient: how often does class B first start after class A versus before it (first start per patient and class, within a window)? Joined to any mechanism path in the graph.',
    'read',
    `
    MATCH (p:Patient)-[t:TAKES]->(:Drug)-[:IN_CLASS]->(c:DrugClass)
    WHERE p.sandbox IS NULL
    WITH p, c, min(t.start) AS s
    WHERE s >= $from
    WITH p, collect({c: c.id, s: s}) AS starts
    UNWIND starts AS x
    UNWIND starts AS y
    WITH x, y
    WHERE x.c <> y.c AND x.s <> y.s AND abs(y.s - x.s) <= $window
    WITH x.c AS a, y.c AS b, sum(CASE WHEN y.s > x.s THEN 1 ELSE 0 END) AS fwd,
                             sum(CASE WHEN y.s < x.s THEN 1 ELSE 0 END) AS rev
    WHERE fwd + rev >= $minPairs
    MATCH (ca:DrugClass {id: a}), (cb:DrugClass {id: b})
    OPTIONAL MATCH (ca)<-[:IN_CLASS]-(:Drug)-[:CAUSES]->(e:Effect)-[:TREATED_BY]->(:Drug)-[:IN_CLASS]->(cb)
    RETURN ca.id AS a, ca.name AS aName, cb.id AS b, cb.name AS bName, fwd, rev, collect(DISTINCT e.name) AS via
    `,
  ),

  classStarts: q(
    'class_starts',
    'Incident start days by class',
    'First start day per patient for every class, used for the PSSA null-effect ratio.',
    'read',
    `
    MATCH (p:Patient)-[t:TAKES]->(:Drug)-[:IN_CLASS]->(c:DrugClass)
    WHERE p.sandbox IS NULL
    WITH p, c, min(t.start) AS s
    WHERE s >= $from
    RETURN c.id AS cls, collect(s) AS starts
    `,
  ),

  findingsByPattern: q(
    'findings_by_pattern',
    'Open findings by pattern',
    'What the population sweep found, grouped by cascade pattern.',
    'read',
    `
    MATCH (f:Finding {status: 'open'})-[:FOR]->(p:Patient)
    WHERE p.sandbox IS NULL
    WITH f.label AS label, f.pattern AS pattern, f.evidence AS evidence, count(DISTINCT p) AS patients, avg(f.score) AS avgScore
    RETURN label, pattern, evidence, patients, avgScore
    ORDER BY patients DESC
    LIMIT 25
    `,
  ),

  populationSummary: q(
    'population_summary',
    'Population summary',
    'Patients with at least one likely cascade, by age band.',
    'read',
    `
    MATCH (p:Patient)
    WHERE p.sandbox IS NULL
    WITH p, CASE WHEN p.age < 75 THEN '65-74' WHEN p.age < 85 THEN '75-84' ELSE '85+' END AS band
    RETURN band, count(p) AS patients, sum(CASE WHEN p.likely > 0 THEN 1 ELSE 0 END) AS withLikely,
           avg(p.acb) AS avgAcb, avg(p.medCount) AS avgMeds
    ORDER BY band
    `,
  ),

  rootDrugs: q(
    'root_drugs',
    'Most common root drugs',
    'Drugs that most often start a likely cascade across the population. Each link counts once per patient, even when an agent run and the sweep both recorded it.',
    'read',
    `
    MATCH (p:Patient)<-[:FOR]-(f:Finding {status: 'open'})-[:ROOT]->(d:Drug)
    WHERE f.score >= $min AND p.sandbox IS NULL
    RETURN d.id AS id, d.name AS name, count(DISTINCT p.id + '|' + f.key) AS findings
    ORDER BY findings DESC
    LIMIT 10
    `,
  ),

  sweepRun: q(
    'sweep_run',
    'Start a sweep run',
    'One Run node for a population sweep, so the tasks it proposes are signed and traceable.',
    'write',
    `
    CREATE (r:Run {id: $id, at: $at, mode: $mode, model: $model, trigger: $trigger})
    RETURN r.id AS id
    `,
  ),

  openTaskPatients: q(
    'open_task_patients',
    'Patients with open tasks',
    'Patients who already have a proposed or approved task, so the sweep does not pile on.',
    'read',
    `
    MATCH (t:Task)-[:FOR]->(p:Patient)
    WHERE t.status IN ['proposed', 'approved']
    RETURN collect(DISTINCT p.id) AS ids
    `,
  ),

  sweepClear: q(
    'sweep_clear',
    'Clear sweep findings',
    'Before a population sweep, supersede findings written by the previous sweep.',
    'write',
    `
    MATCH (f:Finding {status: 'open', source: 'sweep'})
    SET f.status = 'superseded'
    RETURN count(f) AS n
    `,
  ),

  sweepPatients: q(
    'sweep_patients',
    'Write sweep results to patients',
    'The sweep agent stores each patient’s summary on the Patient node so the population can be queried in Cypher.',
    'write',
    `
    UNWIND $rows AS r
    MATCH (p:Patient {id: r.pid})
    SET p.likely = r.likely, p.possible = r.possible, p.acb = r.acb, p.topScore = r.top, p.topLink = r.topLink, p.topLinkScore = r.topLinkScore,
        p.avoidable = r.avoidable, p.medCount = r.meds, p.reviewedAt = $at
    RETURN count(p) AS n
    `,
  ),

  sweepFindings: q(
    'sweep_findings',
    'Write sweep findings',
    'One Finding per likely or possible link, linked to the patient, both drugs, the effect and any documented pattern.',
    'write',
    `
    UNWIND $rows AS f
    MATCH (p:Patient {id: f.pid}), (root:Drug {id: f.from}), (to:Drug {id: f.to}), (e:Effect {id: f.effect})
    CREATE (n:Finding {id: f.id, key: f.key, from: f.from, to: f.to, effect: f.effect, label: f.label, chain: f.chain,
                       score: f.score, tier: f.tier, pattern: f.pattern, evidence: f.evidence, status: 'open',
                       source: 'sweep', at: $at})
    CREATE (n)-[:FOR]->(p), (n)-[:ROOT]->(root), (n)-[:TO]->(to), (n)-[:VIA]->(e)
    WITH n, f
    OPTIONAL MATCH (pt:Pattern {id: f.pattern})
    FOREACH (x IN CASE WHEN pt IS NULL THEN [] ELSE [pt] END | CREATE (n)-[:MATCHES]->(x))
    RETURN count(n) AS n
    `,
  ),

  // ─── Shared state: leases ────────────────────────────────────────────────────
  acquireLock: q(
    'acquire_lock',
    'Take a lease',
    'A lease stored in the graph, so two app instances (or a person and the nightly sweep) never run the same review at once. FalkorDB runs write queries one at a time per graph, so this check-and-set is atomic.',
    'write',
    `
    MERGE (l:Lock {key: $key})
    ON CREATE SET l.owner = $owner, l.until = $until, l.at = $now
    WITH l
    WHERE l.owner = $owner OR l.until < $now
    SET l.owner = $owner, l.until = $until, l.at = $now
    RETURN l.owner AS owner
    `,
  ),

  releaseLock: q(
    'release_lock',
    'Release a lease',
    'Only the owner can release its lease.',
    'write',
    `
    MATCH (l:Lock {key: $key})
    WHERE l.owner = $owner
    DELETE l
    RETURN count(l) AS n
    `,
  ),

  lockHolder: q(
    'lock_holder',
    'Who holds a lease',
    'An unexpired lease on a key, if any.',
    'read',
    `
    MATCH (l:Lock {key: $key})
    WHERE l.until >= $now
    RETURN l.owner AS owner, l.until AS until, l.at AS at
    `,
  ),

  // ─── Agent memory (writes are limited to these templates) ───────────────────
  memory: q(
    'recall_memory',
    'Recall past decisions',
    'Decisions the care team made about this patient in earlier sessions (episodic memory), plus how often each pattern has been judged intentional across all patients (semantic memory).',
    'read',
    `
    MATCH (p:Patient {id: $pid})
    OPTIONAL MATCH (d:Decision)-[:ABOUT]->(p)
    WITH p, collect(d {.id, .from, .to, .verdict, .reason, .by, .day, .at, .sig}) AS decisions
    OPTIONAL MATCH (r:Run)-[:REVIEWED]->(p)
    WITH decisions, r ORDER BY r.at DESC
    RETURN decisions, collect(r {.id, .at, .mode, .model, .summary, .likely, .changes, .trigger})[0..5] AS runs
    `,
  ),

  patternFeedback: q(
    'pattern_feedback',
    'Pattern feedback across patients',
    'How clinicians have judged each pattern across every patient (check-ups excluded).',
    'read',
    `
    MATCH (d:Decision)-[:ON_PATTERN]->(pt:Pattern)
    MATCH (d)-[:ABOUT]->(p:Patient) WHERE p.sandbox IS NULL
    RETURN pt.id AS pattern, d.verdict AS verdict, count(d) AS n
    `,
  ),

  createRun: q(
    'create_run',
    'Start a review run',
    'Episodic memory: one node per agent run.',
    'write',
    `
    MATCH (p:Patient {id: $pid})
    CREATE (r:Run {id: $id, at: $at, mode: $mode, model: $model, trigger: $trigger})-[:REVIEWED]->(p)
    RETURN r.id AS id
    `,
  ),

  addStep: q(
    'add_step',
    'Record an agent step',
    'Each tool call (with the catalog queries it ran), handoff and message is stored so the run can be replayed and audited.',
    'write',
    `
    MATCH (r:Run {id: $run})
    CREATE (r)-[:STEP]->(s:Step {i: $i, agent: $agent, kind: $kind, tool: $tool, args: $args, ok: $ok, text: $text, ms: $ms, at: $at})
    WITH s
    UNWIND $queries AS qid
    MATCH (q:Query {id: qid})
    MERGE (s)-[:RAN]->(q)
    RETURN count(q) AS n
    `,
  ),

  finishRun: q(
    'finish_run',
    'Close a review run',
    'Store the run summary on the run and on the patient, with what actually did the work (the models that answered, or the planner if the model failed).',
    'write',
    `
    MATCH (r:Run {id: $id})-[:REVIEWED]->(p:Patient)
    SET r.summary = $summary, r.likely = $likely, r.finishedAt = $at, r.mode = $mode, r.model = $model,
        p.likely = $likely, p.possible = $possible, p.acb = $acb, p.topScore = $top, p.topLink = $topLink, p.topLinkScore = $topLinkScore, p.reviewedAt = $at
    RETURN r.id AS id
    `,
  ),

  closeFindings: q(
    'close_findings',
    'Supersede old findings',
    'Mark a patient’s earlier open findings as superseded before recording new ones.',
    'write',
    `
    MATCH (f:Finding {status: 'open'})-[:FOR]->(:Patient {id: $pid})
    SET f.status = 'superseded'
    RETURN count(f) AS n
    `,
  ),

  recordFindings: q(
    'record_findings',
    'Record findings',
    'Write each detected cascade as a Finding linked to the patient, the run, both drugs, the effect, its pattern and any care-team decision it took into account (provenance).',
    'write',
    `
    MATCH (p:Patient {id: $pid})
    OPTIONAL MATCH (r:Run {id: $run})
    WITH p, r
    UNWIND $findings AS f
    MATCH (root:Drug {id: f.from}), (to:Drug {id: f.to}), (e:Effect {id: f.effect})
    CREATE (n:Finding {id: f.id, key: f.key, from: f.from, to: f.to, effect: f.effect, label: f.label, chain: f.chain,
                       score: f.score, tier: f.tier, pattern: f.pattern, evidence: f.evidence, factors: f.factors,
                       status: 'open', source: 'agent', step: $step, at: $at})
    CREATE (n)-[:FOR]->(p), (n)-[:ROOT]->(root), (n)-[:TO]->(to), (n)-[:VIA]->(e)
    FOREACH (x IN CASE WHEN r IS NULL THEN [] ELSE [r] END | CREATE (x)-[:FOUND]->(n))
    WITH n, f
    OPTIONAL MATCH (pt:Pattern {id: f.pattern})
    FOREACH (x IN CASE WHEN pt IS NULL THEN [] ELSE [pt] END | CREATE (n)-[:MATCHES]->(x))
    WITH n, f
    OPTIONAL MATCH (d:Decision {id: f.decision})
    FOREACH (x IN CASE WHEN d IS NULL THEN [] ELSE [d] END | CREATE (n)-[:CONSIDERED]->(x))
    RETURN count(n) AS n
    `,
  ),

  proposeTask: q(
    'propose_task',
    'Propose a task',
    'An action for a human: always created as "proposed" until a clinician approves it. Linked to the finding it is about, the procedure it followed and the prescriber who owns the root drug. Not created when the same question is already open for this patient (same link, or same title), so re-running a review never floods the inbox.',
    'write',
    `
    MATCH (p:Patient {id: $pid})
    OPTIONAL MATCH (dup:Task)-[:FOR]->(p)
    WHERE dup.status IN ['proposed', 'approved'] AND (dup.title = $title OR ($finding IS NOT NULL AND dup.finding = $finding))
    WITH p, count(dup) AS open
    WHERE open = 0
    OPTIONAL MATCH (f:Finding {key: $findingKey}) WHERE f.status = 'open'
    WITH p, collect(f) AS fs
    OPTIONAL MATCH (r:Run {id: $run})
    OPTIONAL MATCH (proc:Procedure {id: $procedure})
    OPTIONAL MATCH (owner:Prescriber {name: $owner})
    CREATE (t:Task {id: $id, title: $title, body: $body, role: $role, due: $due, status: 'proposed', at: $at,
                    finding: $finding, pattern: $pattern, owner: $owner, procedure: $procedure, step: $step,
                    sig: $sig, run: $run})-[:FOR]->(p)
    FOREACH (x IN CASE WHEN r IS NULL THEN [] ELSE [r] END | CREATE (x)-[:PROPOSED]->(t))
    FOREACH (x IN CASE WHEN proc IS NULL THEN [] ELSE [proc] END | CREATE (t)-[:FOLLOWED]->(x))
    FOREACH (x IN CASE WHEN owner IS NULL THEN [] ELSE [owner] END | CREATE (t)-[:ADDRESSED_TO]->(x))
    FOREACH (x IN fs | CREATE (t)-[:ABOUT]->(x))
    RETURN t.id AS id
    `,
  ),

  openTasksFor: q(
    'open_tasks_for',
    'Open tasks for a patient',
    'Proposed or approved tasks for one patient.',
    'read',
    `
    MATCH (t:Task)-[:FOR]->(:Patient {id: $pid})
    WHERE t.status IN ['proposed', 'approved']
    RETURN t.id AS id, t.title AS title, t.finding AS finding, t.status AS status
    `,
  ),

  openTask: q(
    'open_task',
    'Find the open task for a question',
    'The task already open for this patient and link (or title), when a new one would duplicate it.',
    'read',
    `
    MATCH (t:Task)-[:FOR]->(:Patient {id: $pid})
    WHERE t.status IN ['proposed', 'approved'] AND (t.title = $title OR ($finding IS NOT NULL AND t.finding = $finding))
    RETURN t.id AS id, t.status AS status, t.role AS role
    ORDER BY t.at DESC
    LIMIT 1
    `,
  ),

  saveNote: q(
    'save_note',
    'Save a drafted note',
    'A draft note for the prescriber or the patient, linked to the run.',
    'write',
    `
    MATCH (p:Patient {id: $pid})
    OPTIONAL MATCH (r:Run {id: $run})
    CREATE (n:Note {id: $id, kind: $kind, text: $text, at: $at, status: 'draft', step: $step})-[:FOR]->(p)
    FOREACH (_ IN CASE WHEN r IS NULL THEN [] ELSE [1] END | CREATE (r)-[:DRAFTED]->(n))
    RETURN n.id AS id
    `,
  ),

  handoff: q(
    'handoff',
    'Hand off between agents',
    'Shared state: a signed handoff message stored in the graph, linked to the findings it carries, read back by the next agent.',
    'write',
    `
    MATCH (r:Run {id: $run})
    CREATE (r)-[:HANDOFF]->(h:Handoff {id: $id, from: $from, to: $to, payload: $payload, sig: $sig, at: $at})
    WITH r, h
    OPTIONAL MATCH (r)-[:FOUND]->(f:Finding) WHERE f.key IN $focus
    FOREACH (x IN CASE WHEN f IS NULL THEN [] ELSE [f] END | CREATE (h)-[:CARRIED]->(x))
    RETURN DISTINCT h.id AS id
    `,
  ),

  readHandoff: q(
    'read_handoff',
    'Read a handoff',
    'The receiving agent reads and verifies the handoff from the graph.',
    'read',
    `
    MATCH (:Run {id: $run})-[:HANDOFF]->(h:Handoff {id: $id})
    RETURN h.from AS from, h.to AS to, h.payload AS payload, h.sig AS sig
    `,
  ),

  recordDecision: q(
    'record_decision',
    'Record a clinician decision',
    'Only humans write decisions. Each one becomes memory for future runs on this patient and feedback on the pattern.',
    'write',
    `
    MATCH (p:Patient {id: $pid})
    CREATE (d:Decision {id: $id, from: $from, to: $to, verdict: $verdict, reason: $reason, by: $by,
                        day: $day, at: $at, sig: $sig})-[:ABOUT]->(p)
    WITH d
    OPTIONAL MATCH (pt:Pattern {id: $pattern})
    FOREACH (_ IN CASE WHEN pt IS NULL THEN [] ELSE [1] END | CREATE (d)-[:ON_PATTERN]->(pt))
    RETURN d.id AS id
    `,
  ),

  runSteps: q(
    'run_steps',
    'Replay a run',
    'Every step of a stored agent run, in order.',
    'read',
    `
    MATCH (r:Run {id: $run})-[:STEP]->(s:Step)
    OPTIONAL MATCH (s)-[:RAN]->(q:Query)
    WITH s, collect(q.id) AS queries
    OPTIONAL MATCH (s)-[:PRODUCED]->(x)
    RETURN s.i AS i, s.agent AS agent, s.kind AS kind, s.tool AS tool, s.args AS args, s.ok AS ok, s.text AS text, s.ms AS ms,
           queries, collect(labels(x)[0]) AS produced
    ORDER BY i
    `,
  ),

  tasks: q(
    'tasks',
    'Care team inbox',
    'Tasks the agents proposed, with the cascade link each one is about: every open one first (so none is ever cut off), then decided ones, newest first.',
    'read',
    `
    MATCH (t:Task)-[:FOR]->(p:Patient)
    WHERE ($status = 'all' OR t.status = $status) AND p.sandbox IS NULL
    OPTIONAL MATCH (t)-[:FOLLOWED]->(proc:Procedure)
    OPTIONAL MATCH (r:Run)-[:PROPOSED]->(t)
    RETURN t.id AS id, t.title AS title, t.body AS body, t.role AS role, t.due AS due, t.status AS status,
           t.at AS at, t.sig AS sig, t.run AS run, t.decidedBy AS decidedBy, t.decidedAt AS decidedAt, t.doneBy AS doneBy, t.note AS note, t.pattern AS pattern,
           t.owner AS owner, proc.version AS procedureVersion, proc.reason AS procedureReason, r.trigger AS trigger, r.mode AS mode,
           p.id AS patientId, p.name AS patientName,
           [(t)-[:ABOUT]->(f:Finding)-[:ROOT]->(rd:Drug) |
             {root: rd.name, effect: [(f)-[:VIA]->(fe:Effect) | fe.plain][0], to: [(f)-[:TO]->(td:Drug) | td.name][0], score: f.score, tier: f.tier}][0] AS link,
           [(t)-[:FROM_NOTE]->(n:Doc) | {id: n.id, title: n.title, kind: n.kind, by: n.by}][0] AS fromNote,
           [(bd:Doc)-[:CORROBORATES]->(t) | {id: bd.id, title: bd.title, kind: bd.kind, by: bd.by}] AS backedBy,
           [(t)-[:FOLLOWS_UP]->(prev:Task) | {id: prev.id, title: prev.title, doneBy: prev.doneBy}][0] AS followsUp
    ORDER BY CASE WHEN t.status IN ['proposed', 'approved'] THEN 0 ELSE 1 END, t.at DESC
    LIMIT 500
    `,
  ),

  task: q(
    'task',
    'Load one task',
    'Used to verify a task’s signature before a person can approve it.',
    'read',
    `
    MATCH (t:Task {id: $id})-[:FOR]->(p:Patient)
    RETURN t.id AS id, t.title AS title, t.body AS body, t.role AS role, t.run AS run, t.sig AS sig, t.pattern AS pattern,
           t.status AS status, t.finding AS finding, p.id AS patientId, p.sandbox AS sandbox
    `,
  ),

  setTask: q(
    'set_task_status',
    'Update a task',
    'A human approves, completes or dismisses a task. Only from the status the person saw ($from), so two people deciding at once cannot both win; counted marks a task whose signature verified, the only kind procedural memory learns from. Completing keeps who approved it (decidedBy) and adds who did it (doneBy). A new note drops the task’s embedding, so search by meaning sees the note.',
    'write',
    `
    MATCH (t:Task {id: $id})
    WHERE t.status IN $from
    WITH t, $status = 'done' AND t.decidedBy IS NOT NULL AS keepApprover, $status = 'done' AS completing,
         $note IS NOT NULL AND $note <> coalesce(t.note, '') AS newNote
    FOREACH (_ IN CASE WHEN newNote THEN [1] ELSE [] END | SET t.embedding = null, t.embedModel = null)
    SET t.status = $status, t.counted = $counted, t.note = coalesce($note, t.note),
        t.decidedBy = CASE WHEN keepApprover THEN t.decidedBy ELSE $by END,
        t.decidedById = CASE WHEN keepApprover THEN t.decidedById ELSE $byId END,
        t.decidedAt = CASE WHEN keepApprover THEN t.decidedAt ELSE $at END,
        t.doneBy = CASE WHEN completing THEN $by ELSE t.doneBy END,
        t.doneAt = CASE WHEN completing THEN $at ELSE t.doneAt END
    RETURN t.id AS id, t.status AS status, t.pattern AS pattern
    `,
  ),

  notes: q(
    'notes',
    'Notes for a patient',
    'Drafted notes, newest first.',
    'read',
    `
    MATCH (n:Note)-[:FOR]->(:Patient {id: $pid})
    RETURN n.id AS id, n.kind AS kind, n.text AS text, n.at AS at, n.status AS status
    ORDER BY n.at DESC
    LIMIT 6
    `,
  ),

  addPrescription: q(
    'add_prescription',
    'Add a prescription',
    'Writes a new TAKES edge (demo only, after a prescriber check).',
    'write',
    `
    MATCH (p:Patient {id: $pid}), (d:Drug {id: $drug})
    WHERE NOT (p)-[:TAKES]->(d)
    CREATE (p)-[:TAKES {start: $start, dose: $dose, prescriber: $prescriber, indication: $indication, added: true}]->(d)
    RETURN d.id AS id
    `,
  ),

  removeAdded: q(
    'remove_added_prescriptions',
    'Undo demo prescriptions',
    'Removes prescriptions added through the demo for one patient.',
    'write',
    `
    MATCH (:Patient {id: $pid})-[t:TAKES {added: true}]->(:Drug)
    DELETE t
    RETURN count(t) AS n
    `,
  ),

  // ─── Provenance: the path behind every answer ───────────────────────────────
  linkProduced: q(
    'link_produced',
    'Link steps to what they produced',
    'After a run, connect each tool-call Step to the findings, tasks and notes it wrote, so any of them can be traced back to the exact step and queries.',
    'write',
    `
    MATCH (r:Run {id: $run})-[:STEP]->(s:Step {kind: 'tool'})
    MATCH (r)-[:FOUND|PROPOSED|DRAFTED]->(x)
    WHERE x.step = s.i
    MERGE (s)-[:PRODUCED]->(x)
    RETURN count(x) AS n
    `,
  ),

  traceFinding: q(
    'trace_finding',
    'Trace a finding',
    'Everything behind one finding: the run and step that wrote it, the drugs, effect, pattern and references it rests on, the care-team decisions it took into account, the handoffs that carried it, the tasks it led to and any team note that raised them.',
    'read',
    `
    MATCH (f:Finding {key: $key})-[:FOR]->(p:Patient {id: $pid})
    WITH f ORDER BY CASE WHEN f.status = 'open' THEN 1 ELSE 0 END DESC, CASE WHEN f.source = 'agent' THEN 1 ELSE 0 END DESC, f.at DESC
    LIMIT 1
    MATCH (f)-[:ROOT]->(a:Drug), (f)-[:TO]->(b:Drug), (f)-[:VIA]->(e:Effect)
    OPTIONAL MATCH (a)-[c:CAUSES]->(e)
    OPTIONAL MATCH (e)-[tr:TREATED_BY]->(b)
    OPTIONAL MATCH (f)-[:MATCHES]->(pt:Pattern)
    OPTIONAL MATCH (pt)-[:CITES]->(ref:Reference)
    WITH f, a, b, e, c, tr, pt, collect(DISTINCT ref {.id, .short, .url}) AS refs
    OPTIONAL MATCH (f)-[:CONSIDERED]->(d:Decision)
    WITH f, a, b, e, c, tr, pt, refs, collect(DISTINCT d {.id, .verdict, .by, .reason}) AS decisions
    OPTIONAL MATCH (run:Run)-[:FOUND]->(f)
    OPTIONAL MATCH (s:Step)-[:PRODUCED]->(f)
    OPTIONAL MATCH (h:Handoff)-[:CARRIED]->(f)
    WITH f, a, b, e, c, tr, pt, refs, decisions, run, s, collect(DISTINCT h {.id, .from, .to, .at}) AS handoffs
    OPTIONAL MATCH (t:Task)-[:ABOUT]->(f)
    OPTIONAL MATCH (t)-[:FOLLOWED]->(proc:Procedure)
    OPTIONAL MATCH (t)-[:ADDRESSED_TO]->(owner:Prescriber)
    OPTIONAL MATCH (t)-[:FROM_NOTE]->(note:Doc)
    RETURN f {.id, .key, .tier, .score, .label, .source, .status, .at, .factors} AS finding,
           a {.id, .name} AS from, b {.id, .name} AS to, e {.id, .name, .plain} AS effect,
           c {.freq, .onsetMin, .onsetMax} AS causes, tr.line AS line,
           pt {.id, .title, .evidence} AS pattern, refs, decisions,
           run {.id, .at, .mode, .model, .trigger} AS run, s.i AS step, s.agent AS agent, s.tool AS tool, handoffs,
           collect(DISTINCT t {.id, .title, .status, .role, .decidedBy, version: proc.version, procedureReason: proc.reason, owner: owner.name,
                                 note: note.title, noteKind: note.kind, noteBy: note.by}) AS tasks
    `,
  ),

  traceSteps: q(
    'trace_steps',
    'Steps that led to a finding',
    'The tool calls of a run up to and including the step that wrote the finding, with the catalog queries each one ran.',
    'read',
    `
    MATCH (:Run {id: $run})-[:STEP]->(s:Step {kind: 'tool'})
    WHERE s.i <= $upto
    OPTIONAL MATCH (s)-[:RAN]->(q:Query)
    RETURN s.i AS i, s.agent AS agent, s.tool AS tool, s.ok AS ok, s.ms AS ms, collect(q {.id, .title, .mode}) AS queries
    ORDER BY i
    `,
  ),

  previousRunFindings: q(
    'previous_run_findings',
    'What the last review found',
    'Findings recorded by the most recent earlier run for this patient, to say what changed since then.',
    'read',
    `
    MATCH (r:Run)-[:REVIEWED]->(:Patient {id: $pid})
    WHERE r.id <> $run AND r.finishedAt IS NOT NULL
    WITH r ORDER BY r.at DESC LIMIT 1
    OPTIONAL MATCH (r)-[:FOUND]->(f:Finding)
    RETURN r.id AS run, r.at AS at, collect(f {.key, .tier, .score, .chain}) AS findings
    `,
  ),

  recordChanges: q(
    'record_changes',
    'Store what changed',
    'The difference from the previous review, kept on the run.',
    'write',
    `
    MATCH (r:Run {id: $run})
    SET r.changes = $changes, r.previous = $previous
    WITH r
    OPTIONAL MATCH (prev:Run {id: $previous})
    FOREACH (x IN CASE WHEN prev IS NULL THEN [] ELSE [prev] END | MERGE (r)-[:FOLLOWS]->(x))
    RETURN r.id AS id
    `,
  ),

  // ─── Procedural memory: how to act, learned from outcomes ───────────────────
  procedures: q(
    'procedures',
    'Learned procedures',
    'The active procedure for each pattern (who a task goes to, how soon, for which tier), with the outcomes it was learned from.',
    'read',
    `
    MATCH (pr:Procedure {active: true})
    OPTIONAL MATCH (pr)-[:FOR_PATTERN]->(pt:Pattern)
    OPTIONAL MATCH (pr)-[:LEARNED_FROM]->(t:Task)
    RETURN pr {.id, .key, .version, .role, .dueLikely, .duePossible, .minTier, .reason, .at, .acted, .dismissed} AS procedure,
           pt.title AS pattern, count(t) AS learnedFrom
    ORDER BY procedure.version DESC, pattern
    `,
  ),

  procedureFor: q(
    'procedure_for',
    'Procedure for a pattern',
    'The active procedure for one pattern, or the default one.',
    'read',
    `
    MATCH (pr:Procedure {active: true})
    WHERE pr.key IN [$key, 'default']
    RETURN pr {.id, .key, .version, .role, .dueLikely, .duePossible, .minTier, .reason} AS procedure
    ORDER BY CASE WHEN pr.key = 'default' THEN 1 ELSE 0 END
    LIMIT 1
    `,
  ),

  procedureHistory: q(
    'procedure_history',
    'How a procedure changed',
    'Every version of a procedure, newest first, with the decided tasks each version learned from.',
    'read',
    `
    MATCH (pr:Procedure {key: $key})
    OPTIONAL MATCH (pr)-[:LEARNED_FROM]->(t:Task)
    RETURN pr {.id, .version, .role, .minTier, .reason, .at, .active, .acted, .dismissed} AS procedure,
           collect(t {.id, .role, .status, .decidedBy, .note}) AS tasks
    ORDER BY procedure.version DESC
    `,
  ),

  taskOutcomes: q(
    'task_outcomes',
    'Outcomes for a pattern',
    'Decided, signature-verified tasks for one pattern, by role: acted on (approved or done) or dismissed. Check-ups excluded.',
    'read',
    `
    MATCH (t:Task {pattern: $key})-[:FOR]->(p:Patient)
    WHERE t.status IN ['approved', 'done', 'dismissed'] AND t.counted = true AND p.sandbox IS NULL
    RETURN t.id AS id, t.role AS role, t.status AS status, t.note AS note
    `,
  ),

  createProcedure: q(
    'create_procedure',
    'Learn a new procedure version',
    'Retires the active version (only if it is still the one the learning read), writes the new one with the reason, and links it to the decided tasks it was learned from.',
    'write',
    `
    OPTIONAL MATCH (old:Procedure {key: $key, active: true})
    WITH old WHERE coalesce(old.version, 0) = $base
    FOREACH (x IN CASE WHEN old IS NULL THEN [] ELSE [old] END | SET x.active = false)
    CREATE (pr:Procedure {id: $id, key: $key, version: $version, role: $role, dueLikely: $dueLikely, duePossible: $duePossible,
                          minTier: $minTier, reason: $reason, at: $at, active: true, acted: $acted, dismissed: $dismissed})
    FOREACH (x IN CASE WHEN old IS NULL THEN [] ELSE [old] END | CREATE (pr)-[:SUPERSEDES]->(x))
    WITH pr
    OPTIONAL MATCH (pt:Pattern {id: $key})
    FOREACH (x IN CASE WHEN pt IS NULL THEN [] ELSE [pt] END | CREATE (pr)-[:FOR_PATTERN]->(x))
    WITH pr
    OPTIONAL MATCH (t:Task) WHERE t.id IN $tasks
    FOREACH (x IN CASE WHEN t IS NULL THEN [] ELSE [t] END | CREATE (pr)-[:LEARNED_FROM]->(x))
    RETURN DISTINCT pr.id AS id
    `,
  ),

  // ─── Conversations: persistent, per patient and per person ──────────────────
  conversations: q(
    'conversations',
    'Past conversations',
    'This person’s earlier conversations about this patient (or the clinic), newest first. Every person has their own.',
    'read',
    `
    MATCH (c:Conversation {user: $user, about: $about})
    RETURN c.id AS id, c.title AS title, c.at AS at, c.updatedAt AS updatedAt, c.messages AS messages
    ORDER BY updatedAt DESC
    LIMIT 20
    `,
  ),

  conversation: q(
    'conversation',
    'Read a conversation',
    'Every message of one conversation, in order. Scoped to the person and what it is about, so one person can never read another’s.',
    'read',
    `
    MATCH (c:Conversation {id: $cid, user: $user, about: $about})
    MATCH (c)-[:HAS]->(m:Message)
    RETURN m.i AS i, m.role AS role, m.text AS text, m.at AS at, m.sources AS sources, m.model AS model
    ORDER BY i
    `,
  ),

  startConversation: q(
    'start_conversation',
    'Start a conversation',
    'A conversation node for one person, about one patient or the whole clinic.',
    'write',
    `
    MATCH (t {id: $about})
    WHERE t:Patient OR t:Clinic
    CREATE (c:Conversation {id: $id, about: $about, user: $user, userName: $userName, title: $title, at: $at, updatedAt: $at, messages: 0})-[:ABOUT]->(t)
    RETURN c.id AS id
    `,
  ),

  addMessages: q(
    'add_messages',
    'Remember messages',
    'Appends a question and its answer, with the catalog queries the answer used.',
    'write',
    `
    MATCH (c:Conversation {id: $cid, user: $user})
    SET c.updatedAt = $at, c.messages = c.messages + size($rows)
    WITH c
    UNWIND $rows AS r
    CREATE (c)-[:HAS]->(m:Message {id: r.id, i: r.i, role: r.role, text: r.text, at: $at, sources: r.sources, model: r.model, user: $user})
    WITH m, r
    UNWIND r.queries AS qid
    MATCH (q:Query {id: qid})
    MERGE (m)-[:RAN]->(q)
    RETURN count(q) AS n
    `,
  ),

  // ─── Care-team brain ────────────────────────────────────────────────────────
  searchMemory: q(
    'search_memory',
    'Search what the team knows',
    'One full-text search (FalkorDB’s RediSearch index) over tasks, drafted notes, team notes (protocols, handovers, chats), care-team decisions, findings and the person’s own conversations, each tied back to its patient.',
    'read',
    `
    CALL db.idx.fulltext.queryNodes('Task', $q) YIELD node, score
    MATCH (node)-[:FOR]->(p:Patient) WHERE p.sandbox IS NULL
    RETURN 'task' AS kind, node.id AS id, node.title AS title, coalesce(node.note, node.body) AS text, node.status AS status, node.decidedBy AS by, p.id AS patientId, p.name AS patientName, node.at AS at, score
    UNION ALL
    CALL db.idx.fulltext.queryNodes('Note', $q) YIELD node, score
    MATCH (node)-[:FOR]->(p:Patient) WHERE p.sandbox IS NULL
    RETURN 'note' AS kind, node.id AS id, node.kind AS title, node.text AS text, node.status AS status, null AS by, p.id AS patientId, p.name AS patientName, node.at AS at, score
    UNION ALL
    CALL db.idx.fulltext.queryNodes('Decision', $q) YIELD node, score
    MATCH (node)-[:ABOUT]->(p:Patient) WHERE p.sandbox IS NULL
    RETURN 'decision' AS kind, node.id AS id, node.from + ' → ' + node.to AS title, node.reason AS text, node.verdict AS status, node.by AS by, p.id AS patientId, p.name AS patientName, node.at AS at, score
    UNION ALL
    CALL db.idx.fulltext.queryNodes('Finding', $q) YIELD node, score
    MATCH (node)-[:FOR]->(p:Patient) WHERE p.sandbox IS NULL AND node.status = 'open'
    RETURN 'finding' AS kind, node.id AS id, node.chain AS title, node.label AS text, node.tier AS status, null AS by, p.id AS patientId, p.name AS patientName, node.at AS at, score
    UNION ALL
    CALL db.idx.fulltext.queryNodes('Doc', $q) YIELD node, score
    OPTIONAL MATCH (node)-[:MENTIONS]->(p:Patient)
    WITH node, score, collect(p)[0] AS p
    RETURN 'doc' AS kind, node.id AS id, node.title AS title, node.text AS text, node.kind AS status, node.by AS by,
           p.id AS patientId, coalesce(p.name, 'Team note') AS patientName, node.at AS at, score
    UNION ALL
    CALL db.idx.fulltext.queryNodes('Message', $q) YIELD node, score
    MATCH (c:Conversation {user: $user})-[:HAS]->(node)
    MATCH (c)-[:ABOUT]->(p) WHERE p.sandbox IS NULL
    RETURN 'message' AS kind, node.id AS id, c.title AS title, node.text AS text, node.role AS status, c.userName AS by,
           CASE WHEN p:Clinic THEN null ELSE p.id END AS patientId, p.name AS patientName, node.at AS at, score
    `,
  ),

  createMemoryIndex: q(
    'create_memory_index',
    'Create the semantic memory index',
    'A FalkorDB vector index (768 dimensions, cosine) over every node labelled Memory: the notes, tasks, decisions and conversations that have been embedded. Created once; creating it again is refused by the database and ignored.',
    'write',
    `
    CREATE VECTOR INDEX FOR (n:Memory) ON (n.embedding) OPTIONS {dimension: 768, similarityFunction: 'cosine'}
    `,
  ),

  memoryToEmbed: q(
    'memory_to_embed',
    'What the team wrote that has no embedding yet',
    'Team notes, review tasks, drafted notes, signed decisions and conversation messages without an embedding from the current model, as the text to embed, newest first (so what was just written is findable on the next search; check-up patients excluded).',
    'read',
    `
    CALL {
      MATCH (n:Doc) WHERE n.embedding IS NULL OR n.embedModel <> $model
      RETURN ID(n) AS nid, n.id AS id, n.title AS title, n.text AS text, n.at AS at
      UNION ALL
      MATCH (n:Task)-[:FOR]->(p:Patient) WHERE p.sandbox IS NULL AND (n.embedding IS NULL OR n.embedModel <> $model)
      RETURN ID(n) AS nid, n.id AS id, n.title AS title, coalesce(n.body, '') + ' ' + coalesce(n.note, '') AS text, n.at AS at
      UNION ALL
      MATCH (n:Decision)-[:ABOUT]->(p:Patient) WHERE p.sandbox IS NULL AND (n.embedding IS NULL OR n.embedModel <> $model)
      OPTIONAL MATCH (a:Drug {id: n.from})
      OPTIONAL MATCH (b:Drug {id: n.to})
      RETURN ID(n) AS nid, n.id AS id, coalesce(a.name, n.from) + ' → ' + coalesce(b.name, n.to) AS title, n.verdict + ': ' + coalesce(n.reason, '') AS text, n.at AS at
      UNION ALL
      MATCH (n:Note)-[:FOR]->(p:Patient) WHERE p.sandbox IS NULL AND (n.embedding IS NULL OR n.embedModel <> $model)
      RETURN ID(n) AS nid, n.id AS id, n.kind AS title, n.text AS text, n.at AS at
      UNION ALL
      MATCH (c:Conversation)-[:HAS]->(n:Message) WHERE n.embedding IS NULL OR n.embedModel <> $model
      MATCH (c)-[:ABOUT]->(s) WHERE s:Clinic OR s.sandbox IS NULL
      RETURN ID(n) AS nid, n.id AS id, null AS title, n.text AS text, n.at AS at
    }
    RETURN nid, id, title, text
    ORDER BY at DESC
    LIMIT $limit
    `,
  ),

  setEmbeddings: q(
    'set_embeddings',
    'Store embeddings on the graph',
    'Puts each embedding on its own node as a 32-bit vector and labels the node Memory, so the vector index covers it. The node is matched by its internal id and its own id, so a vector never lands on a node that reused a deleted one’s id. The model is recorded so vectors from different models are never compared.',
    'write',
    `
    UNWIND $rows AS r
    MATCH (n) WHERE ID(n) = r.nid AND n.id = r.id
    SET n.embedding = vecf32(r.v), n.embedModel = $model, n:Memory
    RETURN count(n) AS n
    `,
  ),

  searchMeaning: q(
    'search_meaning',
    'Search what the team knows, by meaning',
    'Vector search (FalkorDB’s HNSW index) over embedded notes, tasks, decisions and the person’s own messages: many neighbours by cosine distance, then other people’s messages, check-up patients and other models filtered out, then the nearest $limit, each tied back to its patient.',
    'read',
    `
    CALL db.idx.vector.queryNodes('Memory', 'embedding', $k, vecf32($v)) YIELD node, score
    WITH node, score WHERE node.embedModel = $model
    OPTIONAL MATCH (node)-[:FOR]->(fp:Patient)
    OPTIONAL MATCH (node)-[:ABOUT]->(ap:Patient)
    OPTIONAL MATCH (node)-[:MENTIONS]->(mp:Patient)
    OPTIONAL MATCH (c:Conversation)-[:HAS]->(node)
    OPTIONAL MATCH (c)-[:ABOUT]->(cp)
    WITH node, score, coalesce(fp, ap) AS p, collect(mp)[0] AS mp, c, cp
    WHERE (p IS NULL OR p.sandbox IS NULL) AND (c IS NULL OR c.user = $user) AND (cp IS NULL OR cp.sandbox IS NULL)
    OPTIONAL MATCH (a:Drug {id: node.from})
    OPTIONAL MATCH (b:Drug {id: node.to})
    RETURN CASE WHEN node:Task THEN 'task' WHEN node:Note THEN 'note' WHEN node:Decision THEN 'decision' WHEN node:Doc THEN 'doc' ELSE 'message' END AS kind,
           node.id AS id,
           CASE WHEN node:Decision THEN coalesce(a.name, node.from) + ' → ' + coalesce(b.name, node.to) WHEN node:Note THEN node.kind WHEN node:Message THEN c.title ELSE node.title END AS title,
           CASE WHEN node:Task THEN coalesce(node.note, node.body) WHEN node:Decision THEN node.reason ELSE node.text END AS text,
           CASE WHEN node:Task OR node:Note THEN node.status WHEN node:Decision THEN node.verdict WHEN node:Doc THEN node.kind ELSE node.role END AS status,
           CASE WHEN node:Task THEN node.decidedBy WHEN node:Decision OR node:Doc THEN node.by WHEN node:Message THEN c.userName ELSE null END AS by,
           CASE WHEN cp IS NOT NULL AND cp:Clinic THEN null ELSE coalesce(p.id, mp.id, cp.id) END AS patientId,
           coalesce(p.name, mp.name, cp.name, 'Team note') AS patientName,
           node.at AS at, 1 - score AS score
    ORDER BY score DESC
    LIMIT $limit
    `,
  ),

  careTeamFlows: q(
    'care_team_flows',
    'Where cascades cross prescribers',
    'For every open likely or possible cascade link: who prescribed the first drug and who added the second. The handoffs between prescribers where cascades start.',
    'read',
    `
    MATCH (f:Finding {status: 'open'})-[:FOR]->(p:Patient)
    WHERE f.from IS NOT NULL AND p.sandbox IS NULL
    MATCH (p)-[ta:TAKES]->(:Drug {id: f.from})
    MATCH (p)-[tb:TAKES]->(:Drug {id: f.to})
    WITH ta.prescriber AS fromBy, tb.prescriber AS toBy, f.key AS key, max(f.score) AS score, max(CASE WHEN f.tier = 'likely' THEN 1 ELSE 0 END) AS likely
    RETURN fromBy, toBy, count(key) AS links, sum(likely) AS likely, avg(score) AS avgScore
    ORDER BY links DESC
    `,
  ),

  prescribers: q(
    'prescribers',
    'Who prescribes for whom',
    'Every prescriber with the patients they see and the prescriptions they wrote.',
    'read',
    `
    MATCH (pr:Prescriber)
    OPTIONAL MATCH (pr)<-[s:SEES]-(p:Patient)
    WHERE p.sandbox IS NULL
    RETURN pr.name AS name, pr.specialty AS specialty, pr.kind AS kind, count(p) AS patients, sum(s.prescriptions) AS prescriptions
    ORDER BY patients DESC
    `,
  ),

  whoKnows: q(
    'who_knows',
    'Who knows what',
    'Which people on the care team have decided on each kind of cascade: tasks they acted on or dismissed, and signed decisions they made.',
    'read',
    `
    MATCH (t:Task)-[:FOR]->(p:Patient)
    WHERE t.decidedBy IS NOT NULL AND t.pattern IS NOT NULL AND t.counted = true AND p.sandbox IS NULL
    RETURN t.decidedBy AS person, t.pattern AS pattern, count(t) AS n, 'task' AS kind
    UNION ALL
    MATCH (d:Decision)-[:ON_PATTERN]->(pt:Pattern)
    MATCH (d)-[:ABOUT]->(p:Patient) WHERE p.sandbox IS NULL
    RETURN d.by AS person, pt.id AS pattern, count(d) AS n, 'decision' AS kind
    `,
  ),

  // ─── Check-up: plain-language medication lists ──────────────────────────────
  findDrugs: q(
    'find_drugs',
    'Find drugs by name or brand',
    'Full-text search over drug names, brand names and plain aliases ("Lasix", "water pill"), with fuzzy matching for typos.',
    'read',
    `
    CALL db.idx.fulltext.queryNodes('Drug', $q) YIELD node, score
    MATCH (node)-[:IN_CLASS]->(k:DrugClass)
    RETURN node.id AS id, node.name AS name, k.name AS clsName, score
    ORDER BY score DESC
    LIMIT 5
    `,
  ),

  knowledgePatterns: q(
    'knowledge_patterns',
    'Documented cascade patterns',
    'Every documented prescribing-cascade pattern with its evidence, references, the question it suggests and whether it is usually deliberate. The engine reads these from the graph (cached for a few minutes per process); the graph is the one source of medical knowledge.',
    'read',
    `
    MATCH (pt:Pattern)
    RETURN pt.id AS id, pt.title AS title, pt.evidence AS evidence, pt.refs AS refs, pt.intentional AS intentional,
           pt.question AS question, pt.asr AS asr, pt.asrLo AS lo, pt.asrHi AS hi, pt.prevalence AS prevalence,
           pt.realWorldNote AS note, pt.realWorldNegative AS negative
    `,
  ),

  knowledgeCombos: q(
    'knowledge_combos',
    'Dangerous combination rules',
    'Each dangerous combination as groups of drug classes (one class from every group completes it), with the harm it leads to. Used for what-if lists the graph does not hold yet: a new prescription, an untangle simulation, the orders in an EHR request.',
    'read',
    `
    MATCH (k:Combo)-[g:GROUP]->(c:DrugClass)
    WITH k, g.g AS grp, collect(c.id) AS classes
    OPTIONAL MATCH (k)-[:HARM]->(h:Effect)
    RETURN k.id AS id, k.title AS title, k.why AS why, k.refs AS refs, h.name AS harm, collect(classes) AS groups
    `,
  ),

  knowledgeDrugs: q(
    'knowledge_drugs',
    'Drug cards',
    'Each drug with its class, anticholinergic burden, AGS Beers note and the class’s deprescribing (taper) caution.',
    'read',
    `
    MATCH (d:Drug)-[:IN_CLASS]->(k:DrugClass)
    RETURN d.id AS id, d.name AS name, k.id AS cls, k.name AS clsName, d.acb AS acb, d.beers AS beers, k.taper AS taper
    `,
  ),

  findEffects: q(
    'find_effects',
    'Find symptoms or diagnoses',
    'Full-text search over effect names and plain-language descriptions.',
    'read',
    `
    CALL db.idx.fulltext.queryNodes('Effect', $q) YIELD node, score
    RETURN node.id AS id, node.name AS name, node.plain AS plain, node.kind AS kind, score
    ORDER BY score DESC
    LIMIT 5
    `,
  ),

  createSandbox: q(
    'create_sandbox_patient',
    'Create a check-up patient',
    'A temporary patient built from a pasted medication list, created only while fewer than $cap are live (count and create in one write, so the cap holds under concurrency). It expires on its own and never appears in lists, the population or the inbox.',
    'write',
    `
    OPTIONAL MATCH (x:Patient {sandbox: true}) WHERE x.expiresAt >= $now
    WITH count(x) AS live
    WHERE live < $cap
    CREATE (p:Patient {id: $pid, name: $name, age: $age, sex: $sex, persona: false, sandbox: true, expiresAt: $expiresAt,
                       medCount: size($meds), headline: $headline, ehrKey: $ehrKey})
    WITH p
    UNWIND $meds AS m
    MATCH (d:Drug {id: m.drug})
    CREATE (p)-[:TAKES {start: m.start, dose: m.dose, prescriber: m.prescriber, indication: null, assumedDate: m.assumed}]->(d)
    WITH DISTINCT p
    UNWIND CASE WHEN size($conditions) = 0 THEN [null] ELSE $conditions END AS c
    OPTIONAL MATCH (e:Effect {id: c.id})
    FOREACH (_ IN CASE WHEN e IS NULL THEN [] ELSE [1] END | CREATE (p)-[:HAS {since: c.since}]->(e))
    RETURN DISTINCT p.id AS id
    `,
  ),

  purgeSandbox: q(
    'purge_sandbox_patients',
    'Delete expired check-ups',
    'Removes expired check-up patients and everything the agents wrote about them.',
    'write',
    `
    MATCH (p:Patient)
    WHERE p.sandbox = true AND p.expiresAt < $now
    OPTIONAL MATCH (p)<-[:REVIEWED]-(r:Run)
    OPTIONAL MATCH (r)-[:STEP|HANDOFF]->(s)
    OPTIONAL MATCH (p)<-[:FOR|ABOUT]-(x)
    OPTIONAL MATCH (x)-[:HAS]->(m:Message)
    DETACH DELETE m, s, x, r, p
    RETURN count(DISTINCT p) AS n
    `,
  ),

  // ─── Team notes (docs, handovers, chats) linked to what they mention ─────────
  findDrugsAny: q(
    'find_drugs_any',
    'Drugs a note might mention',
    'Full-text candidates for entity linking: any drug whose name, brand or alias shares a word with the note.',
    'read',
    `
    CALL db.idx.fulltext.queryNodes('Drug', $q) YIELD node
    RETURN node.id AS id
    LIMIT 60
    `,
  ),

  findEffectsAny: q(
    'find_effects_any',
    'Symptoms a note might mention',
    'Full-text candidates for entity linking: any effect whose name or plain words share a word with the note.',
    'read',
    `
    CALL db.idx.fulltext.queryNodes('Effect', $q) YIELD node
    RETURN node.id AS id
    LIMIT 60
    `,
  ),

  patientNames: q(
    'patient_names',
    'Patient names',
    'Names to recognise in a note (check-ups excluded).',
    'read',
    `
    MATCH (p:Patient) WHERE p.sandbox IS NULL
    RETURN p.id AS id, p.name AS name
    `,
  ),

  saveDoc: q(
    'save_doc',
    'Add a note to team memory',
    'A protocol, handover, chat message or minutes a person wrote, linked to the clinic and to every drug, symptom and patient it mentions.',
    'write',
    `
    MATCH (c:Clinic)
    CREATE (d:Doc {id: $id, kind: $kind, title: $title, text: $text, by: $by, byId: $byId, at: $at})-[:IN]->(c)
    WITH d
    OPTIONAL MATCH (x:Drug) WHERE x.id IN $drugs
    WITH d, collect(x) AS xs
    FOREACH (n IN xs | CREATE (d)-[:MENTIONS]->(n))
    WITH d
    OPTIONAL MATCH (e:Effect) WHERE e.id IN $effects
    WITH d, collect(e) AS es
    FOREACH (n IN es | CREATE (d)-[:MENTIONS]->(n))
    WITH d
    OPTIONAL MATCH (p:Patient) WHERE p.id IN $patients AND p.sandbox IS NULL
    WITH d, collect(p) AS ps
    FOREACH (n IN ps | CREATE (d)-[:MENTIONS]->(n))
    RETURN d.id AS id
    `,
  ),

  activity: q(
    'team_activity',
    'What the team and the agents did',
    'The clinic’s shared activity, newest first: tasks proposed, approved, dismissed and completed, notes written, verdicts signed, procedures re-learned, reviews finished, and order-entry checks from EHRs with what the prescriber did. Every open screen polls it, so one person’s decision shows up on everyone else’s.',
    'read',
    `
    CALL {
      MATCH (t:Task)-[:FOR]->(p:Patient) WHERE t.at > $since AND p.sandbox IS NULL
      OPTIONAL MATCH (t)-[:FROM_NOTE]->(n:Doc)
      WITH t, p, collect(n.by)[0] AS noteBy
      RETURN 'task' AS type, t.id AS id, t.at AS at, coalesce(noteBy, '') AS who, 'proposed' AS verb, t.title AS title, p.id AS pid, p.name AS patient, t.role AS detail
      UNION ALL
      MATCH (t:Task)-[:FOR]->(p:Patient) WHERE t.decidedAt > $since AND p.sandbox IS NULL
      RETURN 'decision' AS type, t.id AS id, t.decidedAt AS at, t.decidedBy AS who, CASE WHEN t.status = 'done' THEN 'approved' ELSE t.status END AS verb,
             t.title AS title, p.id AS pid, p.name AS patient, t.note AS detail
      UNION ALL
      MATCH (t:Task)-[:FOR]->(p:Patient) WHERE t.doneAt > $since AND p.sandbox IS NULL
      RETURN 'done' AS type, t.id AS id, t.doneAt AS at, t.doneBy AS who, 'completed' AS verb, t.title AS title, p.id AS pid, p.name AS patient, t.note AS detail
      UNION ALL
      MATCH (d:Doc) WHERE d.at > $since
      RETURN 'note' AS type, d.id AS id, d.at AS at, d.by AS who, d.kind AS verb, d.title AS title, null AS pid, null AS patient, null AS detail
      UNION ALL
      MATCH (pr:Procedure) WHERE pr.at > $since AND pr.key <> 'default'
      OPTIONAL MATCH (pr)-[:LEARNED_FROM]->(lt:Task)
      WITH pr, lt ORDER BY lt.decidedAt DESC
      WITH pr, collect(lt.decidedBy)[0] AS who
      OPTIONAL MATCH (pt:Pattern {id: pr.key})
      RETURN 'procedure' AS type, pr.key + '@' + toString(pr.version) AS id, pr.at AS at, coalesce(who, '') AS who, 'learned' AS verb, coalesce(pt.title, pr.key) AS title,
             null AS pid, null AS patient, pr.reason AS detail
      UNION ALL
      MATCH (d:Decision)-[:ABOUT]->(p:Patient) WHERE d.at > $since AND p.sandbox IS NULL
      OPTIONAL MATCH (a:Drug {id: d.from})
      OPTIONAL MATCH (b:Drug {id: d.to})
      RETURN 'verdict' AS type, d.id AS id, d.at AS at, d.by AS who, d.verdict AS verb, coalesce(a.name, d.from) + ' → ' + coalesce(b.name, d.to) AS title,
             p.id AS pid, p.name AS patient, d.reason AS detail
      UNION ALL
      MATCH (r:Run)-[:REVIEWED]->(p:Patient) WHERE r.finishedAt > $since AND p.sandbox IS NULL
      RETURN 'run' AS type, r.id AS id, r.finishedAt AS at, '' AS who, coalesce(r.trigger, 'manual') AS verb, r.summary AS title, p.id AS pid, p.name AS patient, r.mode AS detail
      UNION ALL
      MATCH (k:CdsCard)-[:ABOUT]->(p:Patient) WHERE k.at > $since AND p.sandbox IS NULL
      WITH k, p ORDER BY k.at DESC LIMIT 12
      RETURN 'cds' AS type, 'cds-' + toString(k.at) + '-' + k.drug AS id, k.at AS at, coalesce(k.client, 'An EHR') AS who, k.verdict AS verb, k.drugName AS title,
             p.id AS pid, p.name AS patient, k.summary AS detail
      UNION ALL
      MATCH (k:CdsCard)-[:ABOUT]->(p:Patient) WHERE k.outcomeAt > $since AND p.sandbox IS NULL
      WITH k, p ORDER BY k.outcomeAt DESC LIMIT 12
      RETURN 'cds_outcome' AS type, 'cdso-' + toString(k.at) + '-' + k.drug AS id, k.outcomeAt AS at, 'The prescriber' AS who, k.outcome AS verb, k.drugName AS title,
             p.id AS pid, p.name AS patient, k.outcomeReasonText AS detail
    }
    RETURN type, id, at, who, verb, title, pid, patient, detail
    ORDER BY at DESC
    LIMIT 60
    `,
  ),

  noteCulprits: q(
    'note_culprits',
    'What could cause a symptom a note reports',
    'For a patient a note names and a symptom it reports: the patient’s own drugs that CAUSE it, how often, the documented cascade pattern if there is one, and whether a drug the patient takes already treats it (a cascade in progress) or not yet (the moment to stop one).',
    'read',
    `
    MATCH (p:Patient {id: $pid})-[t:TAKES]->(d:Drug)-[c:CAUSES]->(e:Effect)
    WHERE e.id IN $effects AND p.sandbox IS NULL
    OPTIONAL MATCH (d)-[:IN_CLASS]->(:DrugClass)<-[:INDEX]-(pt:Pattern)-[:VIA]->(e)
    WITH p, t, d, c, e, collect(DISTINCT pt.id)[0] AS pattern
    OPTIONAL MATCH (e)-[:TREATED_BY]->(tx:Drug)<-[t2:TAKES]-(p)
    WHERE tx <> d
    RETURN p.id AS pid, p.name AS patient, d.id AS drug, d.name AS drugName, t.start AS drugStart, t.prescriber AS owner,
           e.id AS effect, e.name AS effectName, e.plain AS effectPlain, c.freq AS freq, c.weight AS weight, pattern,
           [x IN collect(DISTINCT {id: tx.id, name: tx.name, start: t2.start}) WHERE x.id IS NOT NULL] AS treatedWith
    ORDER BY c.weight DESC
    `,
  ),

  linkFollowUp: q(
    'link_follow_up',
    'Link a follow-up to the task it follows',
    'Episodic memory of an action: when a review task is completed, the follow-up the agents schedule points back at it, so the chain of what was done and what comes next is a path in the graph.',
    'write',
    `
    MATCH (n:Task {id: $task}), (prev:Task {id: $prev})
    MERGE (n)-[:FOLLOWS_UP]->(prev)
    RETURN n.id AS id
    `,
  ),

  findEhrSandbox: q(
    'find_ehr_sandbox',
    'Find the temporary patient for an EHR request',
    'CDS Hooks: an EHR patient Domino does not hold is checked as a temporary patient. Calls that share the same patient and medicine list reuse it (found by a hash, never by the EHR’s own id or name), so order-select then order-sign builds one, not two.',
    'read',
    `
    MATCH (p:Patient {ehrKey: $key})
    WHERE p.sandbox = true AND p.expiresAt >= $now
    RETURN p.id AS id
    LIMIT 1
    `,
  ),

  recordCdsCards: q(
    'record_cds_cards',
    'Remember the cards an EHR was shown',
    'CDS Hooks: every card Domino returns at order entry becomes a CdsCard linked to the patient (ABOUT), the drug being ordered (CHECKED) and the drug whose side effect it would treat (CULPRIT), so the care team sees order-entry checks live and the EHR’s answer can be recorded against it.',
    'write',
    `
    MATCH (p:Patient {id: $pid})
    UNWIND $cards AS c
    MATCH (d:Drug {id: c.drug})
    OPTIONAL MATCH (dup:CdsCard {hookInstance: c.hookInstance, slot: c.slot})-[:ABOUT]->(p)
    WITH p, d, c, dup WHERE dup IS NULL
    CREATE (k:CdsCard {uuid: c.uuid, service: c.service, hook: c.hook, hookInstance: c.hookInstance, slot: c.slot, drug: c.drug, drugName: c.drugName,
                       verdict: c.verdict, indicator: c.indicator, summary: c.summary, at: $at})
    SET k.client = c.client, k.pattern = c.pattern, k.issuer = c.issuer
    CREATE (k)-[:ABOUT]->(p), (k)-[:CHECKED]->(d)
    WITH k, c
    OPTIONAL MATCH (f:Drug {id: c.culprit})
    FOREACH (x IN CASE WHEN f IS NULL THEN [] ELSE [f] END | CREATE (k)-[:CULPRIT]->(x))
    RETURN count(k) AS n
    `,
  ),

  cdsCardsForCall: q(
    'cds_cards_for_call',
    'Cards already issued for this call',
    'A retried CDS Hooks call (same hookInstance) gets the cards it was given the first time, with the same ids, instead of new ones. Each card has a slot (the drug it is about, or the combination), so a retry matches card to card.',
    'read',
    `
    MATCH (k:CdsCard {hookInstance: $hookInstance})-[:ABOUT]->(:Patient {id: $pid})
    RETURN k.slot AS slot, k.uuid AS uuid
    `,
  ),

  trimCdsCards: q(
    'trim_cds_cards',
    'Keep the newest order-entry cards',
    'Bounded memory for an endpoint any EHR can call: cards a prescriber answered are kept; of the unanswered ones, only the newest $perPatient for this patient and the newest $keep overall.',
    'write',
    `
    CALL {
      MATCH (k:CdsCard)-[:ABOUT]->(:Patient {id: $pid}) WHERE k.outcome IS NULL
      WITH k ORDER BY k.at DESC SKIP $perPatient
      RETURN k
      UNION
      MATCH (k:CdsCard) WHERE k.outcome IS NULL
      WITH k ORDER BY k.at DESC SKIP $keep
      RETURN k
    }
    DETACH DELETE k
    RETURN count(*) AS n
    `,
  ),

  cdsFeedback: q(
    'cds_feedback',
    'Record what the prescriber did with a card',
    'CDS Hooks feedback: whether the prescriber accepted Domino’s suggestion (held the order) or overrode the card, and why. Only the first answer per card is kept, so an outcome can never be rewritten.',
    'write',
    `
    UNWIND $items AS f
    MATCH (k:CdsCard {uuid: f.card})
    WHERE k.service = $service AND k.outcome IS NULL AND ($anyIssuer OR coalesce(k.issuer, '') = $issuer)
    SET k.outcome = f.outcome, k.accepted = f.accepted, k.outcomeReason = f.reason, k.outcomeReasonText = f.reasonText,
        k.outcomeComment = f.comment, k.outcomeAt = $at
    RETURN count(k) AS n
    `,
  ),

  cdsRecent: q(
    'cds_recent',
    'Recent order-entry checks',
    'What EHRs asked Domino at order entry in this clinic, newest first, with what the prescriber did, and the totals: checks, cards, orders held, overrides.',
    'read',
    `
    MATCH (k:CdsCard)-[:ABOUT]->(p:Patient)
    WITH k, p ORDER BY k.at DESC
    WITH collect({at: k.at, hook: k.hook, drugName: k.drugName, verdict: k.verdict, indicator: k.indicator, summary: k.summary,
                  outcome: k.outcome, reason: k.outcomeReasonText, client: k.client,
                  patient: CASE WHEN p.sandbox IS NULL THEN p.name ELSE null END, pid: CASE WHEN p.sandbox IS NULL THEN p.id ELSE null END}) AS cards
    RETURN cards[0..8] AS recent, size(cards) AS total,
           size([c IN cards WHERE c.outcome = 'accepted']) AS held,
           size([c IN cards WHERE c.outcome = 'overridden']) AS overridden,
           size([c IN cards WHERE c.indicator <> 'info']) AS flagged
    `,
  ),

  linkTaskToNote: q(
    'link_task_to_note',
    'Link a task to the note it came from',
    'Provenance for an agent action triggered by a person’s note: the task points back at the handover, chat or protocol that raised it.',
    'write',
    `
    MATCH (t:Task {id: $task}), (d:Doc {id: $doc})
    MERGE (t)-[:FROM_NOTE]->(d)
    RETURN t.id AS id
    `,
  ),

  noteCorroborates: q(
    'note_corroborates',
    'Link a note to a task that was already open',
    'A note that reports what an open task already asks about is evidence for it, not its source: the task stays the agents’ (or the earlier note’s), and the new note CORROBORATES it.',
    'write',
    `
    MATCH (d:Doc {id: $doc}), (t:Task {id: $task})
    OPTIONAL MATCH (t)-[own:FROM_NOTE]->(d)
    WITH d, t, own WHERE own IS NULL
    MERGE (d)-[:CORROBORATES]->(t)
    RETURN t.id AS id
    `,
  ),

  docs: q(
    'team_docs',
    'Team notes',
    'Notes people wrote, newest first, with the drugs, symptoms and patients each one mentions, and the review tasks each one led to.',
    'read',
    `
    MATCH (d:Doc)
    OPTIONAL MATCH (d)-[:MENTIONS]->(x:Drug)
    WITH d, collect(DISTINCT {id: x.id, name: x.name}) AS drugs
    OPTIONAL MATCH (d)-[:MENTIONS]->(e:Effect)
    WITH d, drugs, collect(DISTINCT {id: e.id, name: e.name}) AS effects
    OPTIONAL MATCH (d)-[:MENTIONS]->(p:Patient)
    WITH d, drugs, effects, collect(DISTINCT {id: p.id, name: p.name}) AS patients
    RETURN d.id AS id, d.kind AS kind, d.title AS title, d.text AS text, d.by AS by, d.at AS at,
           [x IN drugs WHERE x.id IS NOT NULL] AS drugs, [x IN effects WHERE x.id IS NOT NULL] AS effects, [x IN patients WHERE x.id IS NOT NULL] AS patients,
           [(t:Task)-[:FROM_NOTE]->(d) | {id: t.id, title: t.title, status: t.status, role: t.role, how: 'raised'}] +
           [(d)-[:CORROBORATES]->(ct:Task) | {id: ct.id, title: ct.title, status: ct.status, role: ct.role, how: 'corroborates'}] AS tasks
    ORDER BY at DESC
    LIMIT 50
    `,
  ),

  patientDocs: q(
    'patient_docs',
    'Team notes about a patient',
    'Notes that name this patient, or (naming no other patient) mention one of their medicines together with a problem they have on record or are being treated for.',
    'read',
    `
    MATCH (p:Patient {id: $pid}), (d:Doc)
    OPTIONAL MATCH (d)-[m:MENTIONS]->(p)
    WITH p, d, count(m) AS direct
    OPTIONAL MATCH (d)-[:MENTIONS]->(other:Patient) WHERE other.id <> p.id
    WITH p, d, direct, count(other) AS others
    OPTIONAL MATCH (d)-[:MENTIONS]->(x:Drug)<-[:TAKES]-(p)
    WITH p, d, direct, others, count(DISTINCT x) AS drugs
    OPTIONAL MATCH (d)-[:MENTIONS]->(ef:Effect)
    WHERE (p)-[:HAS]->(ef) OR (p)-[:TAKES]->(:Drug)<-[:TREATED_BY]-(ef)
    WITH d, direct, others, drugs, count(DISTINCT ef) AS effects
    WHERE direct > 0 OR (others = 0 AND drugs > 0 AND effects > 0)
    RETURN d.id AS id, d.kind AS kind, d.title AS title, d.text AS text, d.by AS by, d.at AS at, direct > 0 AS direct,
           [(d)-[:MENTIONS]->(me:Effect) | me.id] AS effects
    ORDER BY direct DESC, at DESC
    LIMIT 8
    `,
  ),

  // ─── The whole knowledge graph, for the 3D view ──────────────────────────────
  knowledgeNodes: q(
    'knowledge_nodes',
    'Every drug and effect',
    'The nodes of the medication knowledge graph, with each drug’s class and each effect’s kind.',
    'read',
    `
    MATCH (d:Drug)-[:IN_CLASS]->(k:DrugClass)
    RETURN d.id AS id, d.name AS name, 'Drug' AS label, k.name AS group
    UNION ALL
    MATCH (e:Effect)
    RETURN e.id AS id, e.name AS name, 'Effect' AS label, e.kind AS group
    `,
  ),

  knowledgeEdges: q(
    'knowledge_edges',
    'Every CAUSES and TREATED_BY edge',
    'The relationships a cascade can walk: drug causes effect, effect is treated by drug.',
    'read',
    `
    MATCH (d:Drug)-[c:CAUSES]->(e:Effect)
    RETURN d.id AS s, e.id AS t, 'CAUSES' AS type, c.weight AS w
    UNION ALL
    MATCH (e:Effect)-[:TREATED_BY]->(d:Drug)
    RETURN e.id AS s, d.id AS t, 'TREATED_BY' AS type, 1.0 AS w
    `,
  ),

  meta: q(
    'meta',
    'Seed metadata',
    'When the graph was seeded, and with which knowledge version.',
    'read',
    `
    MATCH (m:Meta {id: 'domino'})
    RETURN m.seededAt AS seededAt, m.version AS version, m.patients AS patients, m.seed AS seed
    `,
  ),
} as const;

export type QueryId = keyof typeof Q;
export const QUERY_LIST: CypherQuery[] = Object.values(Q);
