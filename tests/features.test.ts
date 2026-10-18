// Prevention replay, the prescriber check's scoring, check-ups and taper safety.
import { afterAll, describe, expect, it } from 'vitest';
import { dbAvailable } from './setup-db';
import { closeDb, run } from '../src/lib/db';
import { Q } from '../src/lib/cypher';
import { replayPatient } from '../src/lib/engine/replay';
import { checkPrescription } from '../src/lib/engine/gatekeeper';
import { analyzePatient, NotFoundError } from '../src/lib/engine/analyze';
import { createCheckup, nameWords, parseList, parseStart } from '../src/lib/checkup';
import { TODAY_DAY } from '../src/data/time';
import { affirmedEffects } from '../src/lib/docs';

afterAll(async () => closeDb());

describe('check-up text handling', () => {
  it('reads rough start dates', () => {
    expect(parseStart('Norvasc since March 2025')?.text).toBe('march 2025');
    expect(parseStart('Lasix 2024-06')?.day).toBe(Math.round((Date.UTC(2024, 5, 15) - Date.UTC(2024, 0, 1)) / 86_400_000));
    expect(parseStart('Aricept 6 months ago')?.day).toBe(Math.round(TODAY_DAY - 6 * 30.4));
    expect(parseStart('Tylenol as needed')).toBeNull();
  });
  it('keeps only plain words for the search index', () => {
    expect(nameWords('Klor-Con 20 mEq daily since 2024')).toEqual(['klor', 'con']);
  });
});

describe('what a note reports', () => {
  // A symptom named in a note counts only if the note reports it: negations, lists, contrasts and "resolved" as people
  // write them in handovers and chats, including every case a review found wrong in an earlier version.
  const cases: [string, string, boolean][] = [
    ['dry_cough', 'Beatrice Hale has had a dry, tickly cough for three weeks.', true],
    ['dry_cough', 'No cough today.', false],
    ['dry_cough', 'Seen today: no sign of a cough.', false],
    ['dry_cough', 'She hasn’t been coughing.', false],
    ['dry_cough', 'Denies cough.', false],
    ['dry_cough', 'Cough: none.', false],
    ['dry_cough', 'Free of cough.', false],
    ['dry_cough', 'Cough has now resolved.', false],
    ['dry_cough', 'Cough not resolved.', true],
    ['dry_cough', 'No fever. Cough worse at night.', true],
    ['dry_cough', 'No fever, cough worse at night.', true],
    ['dry_cough', 'No fever, chills, or cough.', false],
    ['dry_cough', 'Not sleeping well, coughing all night.', true],
    ['dry_cough', 'No change in her cough.', true],
    ['dry_cough', 'No fever but a cough since Tuesday.', true],
    ['dry_cough', 'Negative for cough.', false],
    ['dry_cough', 'Couldn’t sleep for coughing.', true],
    ['dry_cough', 'Can’t stop coughing.', true],
    ['dry_cough', 'Coughing stopped her sleeping.', true],
    ['cognitive_impairment', 'No UTI, still confused.', true],
    ['cognitive_impairment', 'Not eating, confused.', true],
    ['cognitive_impairment', 'Confusion ruled out.', false],
    ['constipation', 'No BM for 4 days, constipated.', true],
    ['dizziness', 'Rosa has no appetite and is dizzy on standing.', true],
    ['dizziness', 'Denies chest pain, shortness of breath, palpitations, nausea, dizziness.', false],
    ['dizziness', 'No chest pain, shortness of breath, palpitations, nausea, vomiting or dizziness.', false],
    ['dizziness', 'Dizziness denied.', false],
    ['dizziness', 'Dizziness: no.', false],
    ['dizziness', 'Dizziness no better.', true],
    ['dizziness', 'She was dizzy, which has now settled.', false],
    ['dizziness', 'Denies chest pain. Dizzy on standing.', true],
    ['dizziness', 'Dizzy when standing, no falls.', true],
    ['peripheral_edema', 'Swelling is not completely resolved.', true],
    ['peripheral_edema', 'Swelling never fully resolved.', true],
    ['peripheral_edema', 'No reduction in swelling.', true],
    ['peripheral_edema', 'Not much change in her swelling.', true],
    ['peripheral_edema', 'Swelling: nil.', false],
    ['peripheral_edema', 'Nil swelling.', false],
    ['peripheral_edema', 'No ankle or leg swelling.', false],
    ['sedation', 'No falls overnight, drowsy this morning.', true],
    ['nausea', 'No appetite, nausea all day.', true],
    ['nausea', 'Nil by mouth, nausea overnight.', true],
    ['cognitive_impairment', 'Not sleeping and confused at night.', true],
    ['peripheral_edema', 'Ankle swelling has gone up since the amlodipine was increased.', true],
    ['peripheral_edema', 'No real change in her ankle swelling.', true],
    ['constipation', 'No problems with constipation since starting the laxative.', false],
    ['nausea', 'Rosa denies headache, nausea or dizziness.', false],
    ['dizziness', 'Rosa denies headache, nausea or dizziness.', false],
    ['dizziness', 'she hasnt been dizzy today', false],
    ['dizziness', 'Neither dizzy nor confused today.', false],
    ['neuropathic_pain', 'Denies pain, neuropathy.', false],
    ['nausea', 'No nausea and vomiting.', false],
    ['dizziness', 'Pt has no fever, dizziness.', false],
    ['dizziness', 'Cant stand up without feeling dizzy.', true],
  ];
  it.each(cases)('%s in “%s” → reported: %s', (effect, text, reported) => {
    expect(affirmedEffects(text, [effect]).length > 0).toBe(reported);
  });
});

describe.runIf(await dbAvailable())('prevention, the prescriber check and check-ups', () => {
  it('replays Beatrice with Domino at the prescriber’s desk', async () => {
    const r = await replayPatient('p-beatrice');
    expect(r.firstCatch?.drug).toBe('furosemide');
    expect(r.avoidable.map((a) => a.id).sort()).toEqual(['donepezil', 'furosemide', 'oxybutynin', 'potassium_chloride']);
    // Lisinopril would not have completed the triple whammy in a record without furosemide.
    expect(r.events.find((e) => e.drug === 'lisinopril')?.reasons).not.toContain('combo');
  });

  it('scores the prescriber check with the review engine, and never stops a deliberate companion as a cascade', async () => {
    const r = await checkPrescription('p-rosa', 'benztropine');
    expect(r.verdict).toBe('stop_and_check');
    expect(r.treatsSideEffectOf[0].score).toBeGreaterThan(0);
    const ppi = await checkPrescription('p-beatrice', 'pantoprazole');
    expect(ppi.reasons).not.toContain('cascade');
    expect(ppi.treatsSideEffectOf.some((t) => t.deliberate)).toBe(true);
  });

  it('follows the engine’s tiers: an unlikely documented link never stops, a charted side effect still counts', async () => {
    // p0023: amlodipine with no swelling on record. A thiazide for hypertension is not a swelling cascade.
    const thiazide = await checkPrescription('p0023', 'hydrochlorothiazide', undefined, { indication: 'hypertension' });
    expect(thiazide.treatsSideEffectOf.find((t) => t.from === 'amlodipine')?.tier).toBe('unlikely');
    expect(thiazide.headline).not.toMatch(/swelling/i);
    // Ibuprofen for a year, then hypertension charted: an antihypertensive is at least a caution, never "clear".
    const arb = await checkPrescription('p0023', 'losartan');
    expect(arb.verdict).not.toBe('clear');
    expect(arb.headline).toMatch(/Ibuprofen/);
  });

  it('builds a temporary check-up from brand names and typos, hidden from the clinic', async () => {
    const parsed = await parseList('Norvasc since Apr 2024\nLasix June 2024\nDitropan Sept 2024\nAricpet Feb 2025', 'high blood pressure, swollen ankles');
    expect(parsed.meds.map((m) => m.match?.id)).toEqual(['amlodipine', 'furosemide', 'oxybutynin', 'donepezil']);
    expect(parsed.conditions.map((c) => c.match?.id)).toEqual(['hypertension', 'peripheral_edema']);
    const { pid } = await createCheckup({
      meds: parsed.meds.map((m) => ({ drug: m.match!.id, start: m.start })),
      conditions: ['hypertension'],
      age: 81,
      sex: 'F',
      unchecked: ['Qelvorin 5mg [daily]'],
    });
    const a = await analyzePatient(pid);
    expect(a.patient.sandbox).toBeTruthy();
    expect(a.trees[0]?.root).toBe('amlodipine');
    // A line Domino could not match stays on the record, named, so nobody reads the review as covering it.
    expect(a.patient.headline).toMatch(/Not in Domino’s graph, so not checked: Qelvorin 5mg daily\./);
    const list = await run<{ id: string }>(Q.patientList);
    expect(list.some((p) => p.id === pid)).toBe(false);
    await run(Q.purgeSandbox, { now: Date.now() + 3 * 60 * 60_000 });
    expect((await run(Q.patient, { pid })).length).toBe(0);
  });

  it('treats an expired check-up as gone before it is purged, and holds the cap in one write', async () => {
    const { pid } = await createCheckup({
      meds: [
        { drug: 'amlodipine', start: TODAY_DAY - 200 },
        { drug: 'furosemide', start: TODAY_DAY - 100 },
      ],
      conditions: [],
      age: 80,
      sex: 'M',
    });
    await run(Q.patient, { pid });
    const { adminQuery } = await import('../src/lib/db');
    await adminQuery('MATCH (p:Patient {id: $pid}) SET p.expiresAt = 1', { pid });
    await expect(analyzePatient(pid)).rejects.toBeInstanceOf(NotFoundError);
    const none = await run(Q.createSandbox, {
      now: Date.now(),
      cap: 0,
      pid: 'p-ck-capped',
      name: 'x',
      age: 80,
      sex: 'F',
      expiresAt: Date.now() + 1000,
      headline: '',
      meds: [{ drug: 'amlodipine', start: 0, dose: '', prescriber: '', assumed: false }],
      conditions: [],
    });
    expect(none.length).toBe(0);
    await run(Q.purgeSandbox, { now: Date.now() });
  });

  it('serves the whole knowledge graph to the 3D view, once per node', async () => {
    const nodes = await run<{ id: string; label: string }>(Q.knowledgeNodes);
    const edges = await run<{ s: string; t: string; type: string }>(Q.knowledgeEdges);
    const { DRUGS, EFFECTS } = await import('../src/data/knowledge');
    expect(nodes.length).toBe(DRUGS.length + EFFECTS.length);
    expect(new Set(nodes.map((n) => `${n.label}:${n.id}`)).size).toBe(nodes.length);
    const ids = new Set(nodes.map((n) => n.id));
    expect(edges.every((e) => ids.has(e.s) && ids.has(e.t))).toBe(true);
    expect(new Set(edges.map((e) => e.type))).toEqual(new Set(['CAUSES', 'TREATED_BY']));
  });

  it('exports a review as a FHIR R4 bundle that references itself consistently', async () => {
    const { reviewBundle } = await import('../src/lib/fhir');
    const a = await analyzePatient('p-beatrice');
    const b = reviewBundle(a, [{ id: 't-x', title: 'Review Amlodipine', status: 'proposed', finding: 'amlodipine>furosemide' }], 'https://domino.test') as {
      resourceType: string;
      entry: { fullUrl: string; resource: { resourceType: string; id: string; [k: string]: unknown } }[];
    };
    expect(b.resourceType).toBe('Bundle');
    const types = b.entry.map((e) => e.resource.resourceType);
    for (const t of ['Patient', 'MedicationStatement', 'Condition', 'DetectedIssue', 'Task', 'Provenance']) expect(types).toContain(t);
    expect(types.filter((t) => t === 'MedicationStatement').length).toBe(a.patient.meds.length);
    // Every reference points at a resource in the bundle.
    const ids = new Set(b.entry.map((e) => `${e.resource.resourceType}/${e.resource.id}`));
    const refs = JSON.stringify(b).match(/"reference":"([A-Za-z]+\/[^"]+)"/g) ?? [];
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) expect(ids.has(r.slice(13, -1)), r).toBe(true);
    // The cascade the task is about is the issue it focuses on.
    const task = b.entry.find((e) => e.resource.resourceType === 'Task')!.resource as { focus?: { reference: string } };
    expect(task.focus?.reference).toBe('DetectedIssue/p-beatrice-issue-amlodipine-furosemide');
  });

  it('gives every FHIR resource a valid id, even for drug ids with underscores', async () => {
    const { reviewBundle, fhirId } = await import('../src/lib/fhir');
    const a = await analyzePatient('p-rosa');
    expect(a.patient.meds.some((m) => m.id.includes('_'))).toBe(true);
    const b = reviewBundle(a, [{ id: 't_long_' + 'x'.repeat(80), title: 'Review', status: 'proposed', finding: null }], 'https://domino.test') as {
      id: string;
      entry: { resource: { resourceType: string; id: string } }[];
    };
    const VALID = /^[A-Za-z0-9\-.]{1,64}$/;
    expect(b.id).toMatch(VALID);
    for (const e of b.entry) expect(e.resource.id, e.resource.id).toMatch(VALID);
    const ids = new Set(b.entry.map((e) => `${e.resource.resourceType}/${e.resource.id}`));
    expect(ids.size).toBe(b.entry.length);
    const refs = JSON.stringify(b).match(/"reference":"([A-Za-z]+\/[^"]+)"/g) ?? [];
    for (const r of refs) expect(ids.has(r.slice(13, -1)), r).toBe(true);
    // Long ids stay unique after shortening.
    expect(fhirId('a'.repeat(70) + '1')).not.toBe(fhirId('a'.repeat(70) + '2'));
  });

  it('says which medicines need a taper in the what-if', async () => {
    const a = await analyzePatient('p-rosa');
    const t = a.trees.find((x) => x.root === 'lorazepam')!;
    expect(t.untangle.rootTaper).toMatch(/Taper/);
    expect(t.untangle.unnecessary.find((u) => u.id === 'carbidopa_levodopa')?.taper).toMatch(/Never stop suddenly/);
  });
});
