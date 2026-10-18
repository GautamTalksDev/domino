// Builds the Domino graph in FalkorDB: knowledge graph, patients and seed memory.

import { adminQuery, deleteGraph } from './db';
import { AVOID_WITH, CAUSES, CLASSES, COMBOS, DRUGS, EFFECTS, FREQ_WEIGHT, PATTERNS, RAISES, TREATS } from '../data/knowledge';
import { PERSONAS, SEED_DECISIONS } from '../data/personas';
import { generateCohort } from '../data/generator';
import { decisionPayload, signPayload } from './agent/sign';
import { currentClinic } from './tenant';
import { REFERENCES } from '../data/references';
import { effectTerms, searchTerms } from '../data/brands';
import { Q, QUERY_LIST } from './cypher';
import { run } from './db';
import { USERS } from './tenant';
import { SEED_DOCS, SEED_HISTORY } from '../data/history';
import { saveDoc } from './docs';
import { DRUG, PATTERN } from '../data/knowledge';
import { proposeTask } from './agent/actions';
import { learnProcedure, seedDefaultProcedure } from './memory/procedures';
import { forgetKnowledge } from './engine/knowledge';

export const KG_VERSION = '1.0.0';

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export interface SeedReport {
  clinic: string;
  ms: number;
  drugs: number;
  effects: number;
  causes: number;
  treats: number;
  patterns: number;
  patients: number;
  prescriptions: number;
}

export async function seedGraph(log: (msg: string) => void = () => {}): Promise<SeedReport> {
  const t0 = Date.now();
  const clinic = await currentClinic();
  log(`Clearing the ${clinic.short} graph`);
  await deleteGraph();
  forgetKnowledge();

  log('Creating indexes');
  for (const label of [
    'Drug',
    'Effect',
    'DrugClass',
    'Patient',
    'Pattern',
    'Combo',
    'Finding',
    'Task',
    'Run',
    'Decision',
    'Note',
    'Meta',
    'Reference',
    'Query',
    'Conversation',
    'Message',
    'Doc',
    'Procedure',
    'Handoff',
    'Clinic',
  ]) {
    await adminQuery(`CREATE INDEX FOR (n:${label}) ON (n.id)`);
  }
  await adminQuery(`CREATE INDEX FOR (n:Lock) ON (n.key)`);
  await adminQuery(`CREATE INDEX FOR (n:Prescriber) ON (n.name)`);
  await adminQuery(`CREATE INDEX FOR (n:Finding) ON (n.key)`);
  await adminQuery(`CREATE INDEX FOR (n:CdsCard) ON (n.uuid)`);
  // Semantic memory: one vector index over everything embedded (src/lib/semantic.ts), ready before any vector exists.
  await adminQuery(`CREATE VECTOR INDEX FOR (n:Memory) ON (n.embedding) OPTIONS {dimension: 768, similarityFunction: 'cosine'}`);
  // Full-text indexes (RediSearch inside FalkorDB): plain-language drug lookup, and one search over
  // everything the care team wrote down: tasks, notes, decisions, findings and conversations.
  for (const [label, fields] of [
    ['Drug', ['name', 'terms']],
    ['Effect', ['name', 'plain', 'terms']],
    ['Task', ['title', 'body', 'note']],
    ['Note', ['text']],
    ['Decision', ['reason']],
    ['Finding', ['label']],
    ['Message', ['text']],
    ['Doc', ['title', 'text']],
  ] as const) {
    await adminQuery(`CALL db.idx.fulltext.createNodeIndex('${label}', ${fields.map((f) => `'${f}'`).join(', ')})`);
  }

  log('Loading knowledge graph');
  await adminQuery(`UNWIND $rows AS r CREATE (k:DrugClass {id: r.id, name: r.name}) SET k.taper = r.taper`, {
    rows: CLASSES.map((c) => ({ id: c.id, name: c.name, taper: c.taper ?? null })),
  });
  await adminQuery(
    `UNWIND $rows AS r MATCH (k:DrugClass {id: r.cls})
     CREATE (d:Drug {id: r.id, name: r.name, acb: r.acb, terms: r.terms})-[:IN_CLASS]->(k)
     SET d.beers = r.beers`,
    { rows: DRUGS.map((d) => ({ id: d.id, name: d.name, cls: d.cls, acb: d.acb ?? 0, beers: d.beers ?? null, terms: searchTerms(d.id, d.name) })) },
  );
  await adminQuery(`UNWIND $rows AS r CREATE (:Effect {id: r.id, name: r.name, plain: r.plain, kind: r.kind, terms: r.terms})`, {
    rows: EFFECTS.map((e) => ({ ...e, terms: effectTerms(e.id, e.name, e.plain) })),
  });
  await adminQuery(
    `UNWIND $rows AS r MATCH (d:Drug {id: r.d}), (e:Effect {id: r.e})
     CREATE (d)-[:CAUSES {freq: r.freq, weight: r.w, onsetMin: r.lo, onsetMax: r.hi, source: 'label'}]->(e)`,
    {
      rows: CAUSES.map(([d, e, freq, onset]) => ({
        d,
        e,
        freq,
        w: FREQ_WEIGHT[freq],
        lo: onset?.[0] ?? 1,
        hi: onset?.[1] ?? 180,
      })),
    },
  );
  await adminQuery(
    `UNWIND $rows AS r MATCH (e:Effect {id: r.e}), (d:Drug {id: r.d})
     CREATE (e)-[:TREATED_BY {line: r.line}]->(d)`,
    { rows: TREATS.map(([e, d, line]) => ({ e, d, line: line ?? 'first' })) },
  );
  await adminQuery(`UNWIND $rows AS r MATCH (a:Effect {id: r.a}), (b:Effect {id: r.b}) CREATE (a)-[:RAISES {weight: r.w}]->(b)`, {
    rows: RAISES.map(([a, b, w]) => ({ a, b, w })),
  });
  await adminQuery(`UNWIND $rows AS r MATCH (a:DrugClass {id: r.a}), (b:DrugClass {id: r.b}) CREATE (a)-[:AVOID_WITH {why: r.why}]->(b)`, {
    rows: AVOID_WITH.map(([a, b, why]) => ({ a, b, why })),
  });

  await adminQuery(`CREATE (:Clinic {id: $id, name: $name})`, { id: clinic.id, name: clinic.name });
  log('Loading references and the query catalog');
  await adminQuery(`UNWIND $rows AS r CREATE (x:Reference {id: r.id, short: r.short, citation: r.citation}) SET x.url = r.url`, {
    rows: REFERENCES.map((r) => ({ id: r.id, short: r.short, citation: r.citation, url: r.url ?? null })),
  });
  // The catalog of every Cypher query Domino runs lives in the graph too, so provenance can point at it.
  await adminQuery(`UNWIND $rows AS r CREATE (:Query {id: r.id, title: r.title, purpose: r.purpose, mode: r.mode, cypher: r.cypher})`, {
    rows: QUERY_LIST.map((q) => ({ id: q.id, title: q.title, purpose: q.purpose, mode: q.mode, cypher: q.cypher })),
  });

  log('Loading documented cascade patterns');
  for (const p of PATTERNS) {
    await adminQuery(
      `CREATE (pt:Pattern {id: $id, title: $title, evidence: $evidence, refs: $refs, question: $question})
       SET pt.intentional = $intentional, pt.asr = $asr, pt.asrLo = $lo, pt.asrHi = $hi, pt.prevalence = $prev,
           pt.realWorldNote = $note, pt.realWorldNegative = $neg
       WITH pt
       MATCH (e:Effect {id: $effect}) CREATE (pt)-[:VIA]->(e)
       WITH pt
       UNWIND $index AS ic MATCH (c:DrugClass {id: ic}) CREATE (pt)-[:INDEX]->(c)
       WITH DISTINCT pt
       UNWIND $marker AS mc MATCH (c:DrugClass {id: mc}) CREATE (pt)-[:MARKER]->(c)`,
      {
        id: p.id,
        title: p.title,
        evidence: p.evidence,
        refs: p.refs,
        question: p.question,
        intentional: p.intentional ?? null,
        asr: p.realWorld?.asr ?? null,
        lo: p.realWorld?.lo ?? null,
        hi: p.realWorld?.hi ?? null,
        prev: p.realWorld?.prevalence ?? null,
        note: p.realWorld?.note ?? null,
        neg: p.realWorldNegative ?? null,
        effect: p.effect,
        index: p.index,
        marker: p.marker,
      },
    );
  }
  await adminQuery(`MATCH (pt:Pattern) UNWIND pt.refs AS ref MATCH (r:Reference {id: ref}) CREATE (pt)-[:CITES]->(r)`);
  for (const c of COMBOS) {
    await adminQuery(
      `CREATE (k:Combo {id: $id, title: $title, why: $why, refs: $refs, groups: $n})
       WITH k MATCH (h:Effect {id: $harm}) CREATE (k)-[:HARM]->(h)`,
      { id: c.id, title: c.title, why: c.why, refs: c.refs, n: c.groups.length, harm: c.harm },
    );
    const rows = c.groups.flatMap((grp, i) => grp.map((cls) => ({ cls, g: i })));
    await adminQuery(`MATCH (k:Combo {id: $id}) UNWIND $rows AS r MATCH (c:DrugClass {id: r.cls}) CREATE (k)-[:GROUP {g: r.g}]->(c)`, { id: c.id, rows });
  }

  log(`Generating synthetic cohort (${clinic.cohortSize} patients, seed ${clinic.cohortSeed})`);
  const cohort = generateCohort(clinic.cohortSize, clinic.cohortSeed, clinic.idPrefix);
  const patients = [...(clinic.personas ? PERSONAS : []), ...cohort.patients];
  let prescriptions = 0;
  for (const batch of chunk(patients, 150)) {
    await adminQuery(
      `UNWIND $rows AS r
       CREATE (p:Patient {id: r.id, name: r.name, age: r.age, sex: r.sex, persona: r.persona, medCount: r.medCount})
       SET p.headline = r.headline, p.story = r.story`,
      {
        rows: batch.map((p) => ({
          id: p.id,
          name: p.name,
          age: p.age,
          sex: p.sex,
          persona: !!p.persona,
          medCount: p.meds.length,
          headline: p.headline ?? null,
          story: p.story ?? null,
        })),
      },
    );
    const conds = batch.flatMap((p) => p.conditions.map((c) => ({ pid: p.id, c: c.id, since: c.since })));
    if (conds.length)
      await adminQuery(`UNWIND $rows AS r MATCH (p:Patient {id: r.pid}), (e:Effect {id: r.c}) CREATE (p)-[:HAS {since: r.since}]->(e)`, { rows: conds });
    const meds = batch.flatMap((p) => p.meds.map((m) => ({ pid: p.id, d: m.drug, start: m.start, dose: m.dose, by: m.prescriber, ind: m.indication ?? null })));
    prescriptions += meds.length;
    for (const mb of chunk(meds, 400)) {
      await adminQuery(
        `UNWIND $rows AS r MATCH (p:Patient {id: r.pid}), (d:Drug {id: r.d})
         CREATE (p)-[t:TAKES {start: r.start, dose: r.dose, prescriber: r.by}]->(d)
         SET t.indication = r.ind`,
        { rows: mb },
      );
    }
  }

  log('Linking prescribers');
  const prescribers = new Map<string, Map<string, { first: number; n: number }>>();
  for (const p of patients)
    for (const m of p.meds) {
      if (!prescribers.has(m.prescriber)) prescribers.set(m.prescriber, new Map());
      const byPatient = prescribers.get(m.prescriber)!;
      const cur = byPatient.get(p.id);
      byPatient.set(p.id, { first: Math.min(cur?.first ?? Infinity, m.start), n: (cur?.n ?? 0) + 1 });
    }
  await adminQuery(`UNWIND $rows AS r CREATE (:Prescriber {name: r.name, specialty: r.specialty, kind: r.kind})`, {
    rows: [...prescribers.keys()].map((name) => {
      const specialty = /\(([^)]+)\)/.exec(name)?.[1] ?? 'unknown';
      return { name, specialty, kind: specialty === 'family doctor' ? 'family' : specialty === 'walk-in clinic' ? 'walk_in' : 'specialist' };
    }),
  });
  const sees = [...prescribers.entries()].flatMap(([name, m]) => [...m.entries()].map(([pid, v]) => ({ name, pid, first: v.first, n: v.n })));
  for (const rows of chunk(sees, 500)) {
    await adminQuery(
      `UNWIND $rows AS r MATCH (p:Patient {id: r.pid}), (pr:Prescriber {name: r.name}) CREATE (p)-[:SEES {first: r.first, prescriptions: r.n}]->(pr)`,
      { rows },
    );
  }

  log('Seeding care-team memory');
  for (const d of clinic.personas ? SEED_DECISIONS : []) {
    const id = `dec-seed-${d.patientId}-${d.from}-${d.to}`;
    const payload = decisionPayload({ id, patientId: d.patientId, from: d.from, to: d.to, verdict: d.verdict, by: d.by, reason: d.reason });
    const pattern = PATTERNS.find(
      (p) => p.intentional && (d.to === 'cyanocobalamin' ? p.id === 'metformin_b12' : p.id === 'lithium_hypothyroid_levothyroxine'),
    );
    await adminQuery(
      `MATCH (p:Patient {id: $pid})
       CREATE (d:Decision {id: $id, from: $from, to: $to, verdict: $verdict, reason: $reason, by: $by, day: $day, at: $at, sig: $sig})-[:ABOUT]->(p)
       WITH d OPTIONAL MATCH (pt:Pattern {id: $pattern})
       FOREACH (_ IN CASE WHEN pt IS NULL THEN [] ELSE [1] END | CREATE (d)-[:ON_PATTERN]->(pt))`,
      {
        pid: d.patientId,
        id,
        from: d.from,
        to: d.to,
        verdict: d.verdict,
        reason: d.reason,
        by: d.by,
        day: d.day,
        at: Date.UTC(2026, 8, 1),
        sig: signPayload(payload),
        pattern: pattern?.id ?? '',
      },
    );
  }

  log('Seeding procedural memory (synthetic task outcomes)');
  await seedDefaultProcedure();
  let learned = 0;
  for (const scenario of SEED_HISTORY[clinic.id] ?? []) {
    const pat = PATTERN[scenario.pattern];
    if (!pat) continue;
    // Patients in this clinic whose record actually shows the pattern: an index drug, then a marker drug.
    const candidates = cohort.patients.flatMap((p) => {
      const idx = p.meds.find((m) => pat.index.includes(DRUG[m.drug]!.cls));
      const mk = idx && p.meds.find((m) => pat.marker.includes(DRUG[m.drug]!.cls) && m.start > idx.start);
      return idx && mk ? [{ p, from: idx, to: mk }] : [];
    });
    for (const [k, o] of scenario.outcomes.entries()) {
      const c = candidates[k % Math.max(1, candidates.length)];
      if (!c) break;
      const fromName = DRUG[c.from.drug]!.name;
      const at = Date.UTC(2026, 5, 1) + k * 6 * 86_400_000;
      const res = await proposeTask({
        pid: c.p.id,
        runId: null,
        title: `Review ${fromName}: is ${DRUG[c.to.drug]!.name} treating a side effect of it?`,
        body: pat.question,
        role: o.role,
        link: `${c.from.drug}>${c.to.drug}`,
        pattern: pat.id,
        tier: 'likely',
        owner: c.from.prescriber,
        at,
      });
      if (!res.proposed) continue;
      const user = USERS.find((u) => u.clinic === clinic.id && u.role === o.role) ?? USERS.find((u) => u.clinic === clinic.id)!;
      await run(Q.setTask, {
        id: res.id,
        from: ['proposed'],
        status: o.status,
        by: user.name,
        byId: user.id,
        at: at + 3 * 86_400_000,
        note: o.note ?? null,
        counted: true,
      });
    }
    const r = await learnProcedure(pat.id);
    if (r.changed) {
      learned++;
      log(`  learned: ${r.reason}`);
    }
  }

  log('Seeding team notes (protocols, handovers, chats)');
  for (const d of SEED_DOCS[clinic.id] ?? []) {
    const u = USERS.find((x) => x.id === d.by) ?? USERS.find((x) => x.clinic === clinic.id)!;
    const res = await saveDoc({ kind: d.kind, title: d.title, text: d.text, at: Date.now() - d.daysAgo * 86_400_000, by: u });
    log(`  "${d.title}": ${res.drugs.length} drugs, ${res.effects.length} effects, ${res.patients.length} patients linked`);
  }

  await adminQuery(`CREATE (:Meta {id: 'domino', seededAt: $at, version: $v, patients: $n, seed: $seed, clinic: $clinic})`, {
    at: Date.now(),
    v: KG_VERSION,
    n: patients.length,
    seed: clinic.cohortSeed,
    clinic: clinic.id,
  });

  const report: SeedReport = {
    clinic: clinic.id,
    ms: Date.now() - t0,
    drugs: DRUGS.length,
    effects: EFFECTS.length,
    causes: CAUSES.length,
    treats: TREATS.length,
    patterns: PATTERNS.length,
    patients: patients.length,
    prescriptions,
  };
  log(`Done in ${report.ms} ms`);
  return report;
}
