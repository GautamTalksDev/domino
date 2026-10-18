// CDS Hooks: Domino answering an EHR at order entry.
import { afterAll, describe, expect, it } from 'vitest';
import { dbAvailable } from './setup-db';
import { adminQuery, closeDb, run } from '../src/lib/db';
import { Q } from '../src/lib/cypher';
import { CdsError, CdsRequest, discovery, isoDay, matchMedications, medicationNames, recordFeedback, runService, type CdsRequestBody } from '../src/lib/cds';
import { CdsAuthError, verifyCdsToken } from '../src/lib/cdsAuth';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

afterAll(async () => closeDb());

const BASE = 'https://domino.test';
const OPEN = { issuer: null, anyIssuer: false };

const order = (id: string, text: string) => ({ resource: { resourceType: 'MedicationRequest', id, status: 'draft', medicationCodeableConcept: { text } } });

const request = (hook: 'order-select' | 'order-sign', patientId: string, drafts: ReturnType<typeof order>[], extra: Partial<CdsRequestBody> = {}) =>
  CdsRequest.parse({
    hook,
    hookInstance: `test-${Date.now()}`,
    context: { userId: 'Practitioner/1', patientId, draftOrders: { resourceType: 'Bundle', entry: drafts } },
    ...extra,
  });

describe('CDS Hooks, without the graph', () => {
  it('describes its services for discovery', () => {
    const d = discovery();
    expect(d.services.map((s) => [s.id, s.hook])).toEqual([
      ['domino-order-select', 'order-select'],
      ['domino-order-sign', 'order-sign'],
    ]);
    for (const s of d.services) expect(s.prefetch.medications).toContain('{{context.patientId}}');
  });

  it('reads medicine names from R4 and R5 shapes, and ignores junk', () => {
    expect(medicationNames({ medicationCodeableConcept: { text: 'Norvasc 10 mg', coding: [{ display: 'amlodipine 10 MG Oral Tablet' }] } })).toEqual([
      'Norvasc 10 mg',
      'amlodipine 10 MG Oral Tablet',
    ]);
    expect(medicationNames({ medication: { concept: { text: 'Lasix' } } })).toEqual(['Lasix']);
    expect(medicationNames({ medicationCodeableConcept: { text: 42, coding: 'x' } })).toEqual([]);
  });

  it('reads any year of an ISO date, not only this century', () => {
    expect(isoDay('2024-01-01')).toBe(0);
    expect(isoDay('1998-03-01')).toBeLessThan(-9000);
    expect(isoDay('2025-02')).toBe(isoDay('2025-02-15'));
    expect(isoDay('March 2025')).toBeNull();
    expect(isoDay('2025-13-01')).toBeNull();
  });

  it('rejects requests that are not CDS Hooks calls', () => {
    expect(CdsRequest.safeParse({ hook: 'patient-view', hookInstance: 'x', context: { patientId: 'p', draftOrders: { resourceType: 'Bundle' } } }).success).toBe(false);
    expect(CdsRequest.safeParse({ hook: 'order-sign', hookInstance: 'x', context: { patientId: 'p' } }).success).toBe(false);
  });
});

describe('trusting CDS clients (signed EHR tokens)', () => {
  const ISS = 'https://ehr.example';
  const AUD = 'https://domino.test/cds-services/domino-order-sign';
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES384' };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (claims: Record<string, unknown>, key = privateKey, kid = 'k1') => {
    const now = Math.floor(Date.now() / 1000);
    const body = `${b64({ alg: 'ES384', typ: 'JWT', kid })}.${b64({ iss: ISS, aud: AUD, iat: now, exp: now + 120, jti: randomUUID(), ...claims })}`;
    return `Bearer ${body}.${sign('sha384', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  };
  const withIssuers = async (fn: () => Promise<void>, value = JSON.stringify({ [ISS]: { keys: [jwk] } })) => {
    process.env.DOMINO_CDS_ISSUERS = value;
    process.env.DOMINO_SITE_URL = 'https://domino.test';
    try {
      await fn();
    } finally {
      delete process.env.DOMINO_CDS_ISSUERS;
      delete process.env.DOMINO_SITE_URL;
    }
  };

  it('refuses every call when the trusted-issuer setting is malformed, rather than turning checks off', async () => {
    for (const bad of ['null', '[]', '{}', 'not json', '"x"'])
      await withIssuers(async () => {
        await expect(verifyCdsToken(token({}), [AUD])).rejects.toBeInstanceOf(CdsAuthError);
      }, bad);
  });

  it('is open (demo mode) until trusted issuers are configured', async () => {
    expect(await verifyCdsToken(null, [AUD])).toBeNull();
  });

  it('accepts a valid ES384 token once, and refuses everything else', async () => {
    await withIssuers(async () => {
      const t = token({});
      expect(await verifyCdsToken(t, [AUD])).toBe(ISS);
      await expect(verifyCdsToken(t, [AUD])).rejects.toThrow(/already used/);
      await expect(verifyCdsToken(null, [AUD])).rejects.toBeInstanceOf(CdsAuthError);
      await expect(verifyCdsToken(token({ aud: 'https://elsewhere/cds-services/x' }), [AUD])).rejects.toThrow(/different service/);
      await expect(verifyCdsToken(token({ iss: 'https://evil.example' }), [AUD])).rejects.toThrow(/not trusted/);
      const old = Math.floor(Date.now() / 1000) - 3600;
      await expect(verifyCdsToken(token({ iat: old, exp: old + 120 }), [AUD])).rejects.toThrow(/expired/);
      await expect(verifyCdsToken(token({ exp: Math.floor(Date.now() / 1000) + 3600 }), [AUD])).rejects.toThrow(/lifetime/);
      const other = generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey;
      await expect(verifyCdsToken(token({}, other), [AUD])).rejects.toThrow(/signature/);
      await expect(verifyCdsToken(token({}, privateKey, 'nope'), [AUD])).rejects.toThrow(/No matching key/);
      await expect(verifyCdsToken(token({ jti: undefined }), [AUD])).rejects.toThrow(/jti/);
    });
  });
});

describe.runIf(await dbAvailable())('CDS Hooks against the graph', () => {
  it('warns at order-sign when Rosa’s benztropine would treat a side effect of her risperidone', async () => {
    const r = await runService('domino-order-sign', request('order-sign', 'p-rosa', [order('draft-1', 'Benztropine 1 mg tablet'), order('draft-2', 'Acetaminophen 500 mg')]), {
      base: BASE,
      canWrite: true,
    });
    expect(r.extension.domino.patient).toMatchObject({ id: 'p-rosa', known: true });
    expect(r.cards).toHaveLength(1);
    const c = r.cards[0];
    expect(c.indicator).toBe('warning');
    expect(c.summary.length).toBeLessThanOrEqual(140);
    expect(c.summary).toMatch(/Benztropine.*Risperidone/);
    expect(c.detail).toMatch(/FalkorDB queries/);
    expect(c.suggestions?.[0].actions[0]).toMatchObject({ type: 'delete', resourceId: 'MedicationRequest/draft-1' });
    expect(c.selectionBehavior).toBe('at-most-one');
    expect(c.overrideReasons?.map((o) => o.code)).toEqual(['intentional', 'not-a-cascade', 'will-review']);
    expect(c.links?.[0].url).toBe(`${BASE}/patients/p-rosa`);
    // The card is now memory: linked to Rosa, the drug ordered and the drug whose side effect it treats.
    const stored = (await adminQuery(
      `MATCH (k:CdsCard {uuid: $u})-[:ABOUT]->(p:Patient), (k)-[:CHECKED]->(d:Drug), (k)-[:CULPRIT]->(f:Drug) RETURN p.id AS p, d.id AS d, f.id AS f`,
      { u: c.uuid },
    )) as { data?: { p: string; d: string; f: string }[] };
    expect(stored.data?.[0]).toEqual({ p: 'p-rosa', d: 'benztropine', f: 'risperidone' });

    // Feedback: the prescriber held the order. The first answer sticks; a later one cannot rewrite it.
    const fb = (outcome: 'accepted' | 'overridden') => ({
      feedback: [
        {
          card: c.uuid,
          outcome,
          acceptedSuggestions: outcome === 'accepted' ? [{ id: c.suggestions![0].uuid }] : undefined,
          overrideReason: outcome === 'overridden' ? { reason: { code: 'intentional', display: 'Intentional' } } : undefined,
          outcomeTimestamp: new Date().toISOString(),
        },
      ],
    });
    expect(await recordFeedback('domino-order-sign', fb('accepted'), OPEN)).toBe(1);
    expect(await recordFeedback('domino-order-sign', fb('overridden'), OPEN)).toBe(0);
    // ...and from another service, nothing.
    expect(await recordFeedback('domino-order-select', fb('overridden'), OPEN)).toBe(0);
    const events = await run<{ type: string; id: string; verb: string; title: string; pid: string; detail: string }>(Q.activity, { since: Date.now() - 60_000 });
    // The feed names the check, not the card's id (ids would let anyone answer someone else's card).
    expect(events.some((e) => e.id === c.uuid)).toBe(false);
    expect(events.find((e) => e.type === 'cds' && e.pid === 'p-rosa' && e.title === 'Benztropine')?.verb).toBe('stop_and_check');
    expect(events.find((e) => e.type === 'cds_outcome' && e.pid === 'p-rosa' && e.title === 'Benztropine')?.verb).toBe('accepted');
    const [stats] = await run<{ total: number; held: number }>(Q.cdsRecent);
    expect(Number(stats.held)).toBeGreaterThanOrEqual(1);
  });

  it('checks only the selected order at order-select', async () => {
    const body = request('order-select', 'p-rosa', [order('a', 'Benztropine'), order('b', 'Acetaminophen')], {});
    body.context.selections = ['MedicationRequest/b'];
    const r = await runService('domino-order-select', body, { base: BASE, canWrite: false });
    expect(r.extension.domino.orders.map((o) => o.id)).toEqual(['b']);
    expect(r.cards).toEqual([]);
  });

  it('checks a patient Domino does not hold from the prefetch alone, and keeps no name', async () => {
    const body = request('order-sign', 'ehr-8f2c1e', [order('draft-7', 'Furosemide 20 MG Oral Tablet')], {
      prefetch: {
        patient: { resourceType: 'Patient', id: 'ehr-8f2c1e', gender: 'female', birthDate: '1944-05-02', name: [{ text: 'Should Not Be Kept' }] },
        medications: {
          resourceType: 'Bundle',
          entry: [
            { resource: { resourceType: 'MedicationRequest', id: 'm1', status: 'active', authoredOn: '2026-06-10', medicationCodeableConcept: { text: 'Norvasc 10 mg' } } },
            { resource: { resourceType: 'MedicationRequest', id: 'm3', status: 'stopped', medicationCodeableConcept: { text: 'Lisinopril 10 mg' } } },
            { resource: { resourceType: 'MedicationRequest', id: 'm4', status: 'active', medicationCodeableConcept: { text: 'Qelvorin 5 mg' } } },
          ],
        },
      },
    });
    const r = await runService('domino-order-sign', body, { base: BASE, canWrite: true });
    expect(r.extension.domino.patient.known).toBe(false);
    // A medicine on the shared list that Domino cannot match is named on the card: nothing was checked against it.
    expect(r.extension.domino.unrecognised).toEqual(['Qelvorin 5 mg']);
    expect(r.cards[0]?.detail).toMatch(/Not in Domino’s graph, so not checked against: Qelvorin 5 mg\./);
    expect(r.extension.domino.patient.id).toMatch(/^p-ck-/);
    expect(r.cards[0]?.summary).toMatch(/Furosemide.*Amlodipine/);
    const p = (await adminQuery(`MATCH (p:Patient {id: $id})-[:TAKES]->(d:Drug) RETURN p.name AS name, p.sandbox AS sandbox, collect(d.id) AS meds`, {
      id: r.extension.domino.patient.id,
    })) as { data?: { name: string; sandbox: boolean; meds: string[] }[] };
    // A stopped medicine is not on the list; the name the EHR sent is not stored.
    expect(p.data?.[0]).toMatchObject({ name: 'EHR order check', sandbox: true, meds: ['amlodipine'] });
    // A deployment locked with a write key does not build temporary patients for outside callers.
    await expect(runService('domino-order-sign', body, { base: BASE, canWrite: false })).rejects.toBeInstanceOf(CdsError);
    await adminQuery(`MATCH (p:Patient {id: $id}) OPTIONAL MATCH (p)<-[:ABOUT]-(k:CdsCard) DETACH DELETE p, k`, { id: r.extension.domino.patient.id });
  });

  it('says so when it could check an order against only part of the shared list, or none of it', async () => {
    const outside = (id: string, list: string[]) =>
      request('order-sign', id, [order('draft-a', 'Atorvastatin 20 MG Oral Tablet')], {
        prefetch: {
          patient: { resourceType: 'Patient', id, gender: 'male', birthDate: '1945-01-01' },
          medications: {
            resourceType: 'Bundle',
            entry: list.map((text, i) => ({ resource: { resourceType: 'MedicationRequest', id: `m${i}`, status: 'active', medicationCodeableConcept: { text } } })),
          },
        },
      });
    // A clean result over a list with an unknown medicine is a partial check, said on a card.
    const part = await runService('domino-order-sign', outside('ehr-part', ['Norvasc 10 mg', 'Qelvorin 5 mg']), { base: BASE, canWrite: true });
    expect(part.cards.map((c) => c.source.topic.code)).toEqual(['partly-checked']);
    expect(part.cards[0].summary).toMatch(/checked Atorvastatin against 1 of the listed medicines; not in its graph: Qelvorin 5 mg/);
    // Nothing on the list is known: not silence, a card that says there was nothing to check against.
    const none = await runService('domino-order-sign', outside('ehr-none', ['Qelvorin 5 mg']), { base: BASE, canWrite: true });
    expect(none.cards).toHaveLength(1);
    expect(none.cards[0].summary).toMatch(/could not check Atorvastatin: none of the listed medicines are in its graph/);
    await adminQuery(`MATCH (p:Patient) WHERE p.name = 'EHR order check' OPTIONAL MATCH (p)<-[:ABOUT]-(k:CdsCard) DETACH DELETE p, k`);
  });

  it('names medicines from RxNorm-style text, salts and combination products included', async () => {
    const ids = async (t: string) => (await matchMedications([t])).map((m) => m.id).sort();
    expect(await ids('amLODIPine 5 MG Oral Tablet')).toEqual(['amlodipine']);
    expect(await ids('Furosemide 40 MG Oral Tablet [Lasix]')).toEqual(['furosemide']);
    expect(await ids('carbidopa 25 MG / levodopa 100 MG Oral Tablet')).toEqual(['carbidopa_levodopa']);
    expect(await ids('lisinopril 20 MG / hydrochlorothiazide 12.5 MG Oral Tablet')).toEqual(['hydrochlorothiazide', 'lisinopril']);
    // "atorvastatin calcium" is atorvastatin, not calcium; "Calcium carbonate" is calcium.
    expect(await ids('atorvastatin calcium 40 MG')).toEqual(['atorvastatin']);
    expect(await ids('losartan potassium 50 MG')).toEqual(['losartan']);
    expect(await ids('Calcium carbonate 500 MG')).toEqual(['calcium_vitd']);
  });

  it('flags a dangerous combination the orders only complete together', async () => {
    const body = request('order-sign', 'ehr-combo-1', [order('a', 'Oxycodone 5 MG Oral Tablet'), order('b', 'Lorazepam 0.5 MG Oral Tablet')], {
      prefetch: {
        medications: {
          resourceType: 'Bundle',
          entry: [{ resource: { resourceType: 'MedicationRequest', id: 'm1', status: 'active', authoredOn: '2020-05-01', medicationCodeableConcept: { text: 'Metformin 500 MG' } } }],
        },
      },
    });
    const r = await runService('domino-order-sign', body, { base: BASE, canWrite: true });
    const together = r.cards.find((c) => /Ordered together/.test(c.summary));
    expect(together?.indicator).toBe('critical');
    expect(together?.summary.length).toBeLessThan(140);
    expect(together?.suggestions?.map((x) => x.actions[0].resourceId).sort()).toEqual(['MedicationRequest/a', 'MedicationRequest/b']);
    // The same patient and list again reuse the temporary patient; a retry of the same call returns the same card ids
    // and stores nothing twice.
    const again = await runService('domino-order-sign', body, { base: BASE, canWrite: true });
    expect(again.extension.domino.patient.id).toBe(r.extension.domino.patient.id);
    // Card for card, not just the same set of ids.
    expect(Object.fromEntries(again.cards.map((c) => [c.summary, c.uuid]))).toEqual(Object.fromEntries(r.cards.map((c) => [c.summary, c.uuid])));
    const n = (await adminQuery(`MATCH (k:CdsCard {hookInstance: $h}) RETURN count(k) AS n`, { h: body.hookInstance })) as { data?: { n: number }[] };
    expect(n.data?.[0]?.n).toBe(r.cards.length);
    // Old dates stay old: metformin started in 2020, not "3 weeks ago".
    const stored = (await adminQuery(`MATCH (:Patient {id: $id})-[t:TAKES]->(:Drug {id: 'metformin'}) RETURN t.start AS start`, { id: r.extension.domino.patient.id })) as {
      data?: { start: number }[];
    };
    expect(stored.data?.[0]?.start).toBeLessThan(0);
    await adminQuery(`MATCH (p:Patient {id: $id}) OPTIONAL MATCH (p)<-[:ABOUT]-(k:CdsCard) DETACH DELETE p, k`, { id: r.extension.domino.patient.id });
  });

  it('does not call renewals a new combination, and treats a combination product as one order', async () => {
    // Beatrice already takes lisinopril and potassium chloride: renewing both is not "ordered together".
    const renew = await runService(
      'domino-order-sign',
      request('order-sign', 'p-beatrice', [order('r1', 'Lisinopril 10 MG Oral Tablet'), order('r2', 'Potassium Chloride 20 MEQ')]),
      { base: BASE, canWrite: false },
    );
    expect(renew.cards.some((c) => /together/i.test(c.summary))).toBe(false);
    // One order of lisinopril / HCTZ for someone on ibuprofen: the product completes the triple whammy, as one order
    // with one suggestion.
    const body = request('order-sign', 'ehr-combo-2', [order('one', 'lisinopril 20 MG / hydrochlorothiazide 12.5 MG Oral Tablet')], {
      prefetch: {
        medications: {
          resourceType: 'Bundle',
          entry: [{ resource: { resourceType: 'MedicationRequest', id: 'm1', status: 'active', authoredOn: '2026-01-10', medicationCodeableConcept: { text: 'Ibuprofen 400 MG' } } }],
        },
      },
    });
    const r = await runService('domino-order-sign', body, { base: BASE, canWrite: true });
    const product = r.cards.find((c) => /completes a dangerous combination/.test(c.summary));
    expect(product?.summary).toMatch(/Triple whammy/);
    expect(product?.summary).not.toMatch(/together/i);
    expect(product?.suggestions?.map((x) => x.actions[0].resourceId)).toEqual(['MedicationRequest/one']);
    await adminQuery(`MATCH (p:Patient {id: $id}) OPTIONAL MATCH (p)<-[:ABOUT]-(k:CdsCard) DETACH DELETE p, k`, { id: r.extension.domino.patient.id });
  });

  it('asks for the prefetch it needs (412), and keeps one answer per card, from the caller it was issued to', async () => {
    await expect(runService('domino-order-sign', request('order-sign', 'ehr-none', [order('x', 'Furosemide 40 MG')]), { base: BASE, canWrite: true })).rejects.toMatchObject({
      status: 412,
    });
    const body = request('order-sign', 'p-rosa', [order('d1', 'Benztropine 1 mg'), order('d1', 'Benztropine 1 mg')]);
    const r = await runService('domino-order-sign', body, { base: BASE, canWrite: true, issuer: 'https://ehr.example' });
    expect(r.extension.domino.orders.filter((o) => o.drug === 'benztropine')).toHaveLength(1);
    const card = r.cards[0];
    const at = new Date().toISOString();
    const fb = { feedback: [{ card: card.uuid, outcome: 'accepted' as const, acceptedSuggestions: [{ id: 's' }], outcomeTimestamp: at }, { card: card.uuid, outcome: 'overridden' as const, outcomeTimestamp: at }] };
    // Not the issuer it was given to: nothing recorded.
    expect(await recordFeedback('domino-order-sign', fb, OPEN)).toBe(0);
    expect(await recordFeedback('domino-order-sign', fb, { issuer: 'https://ehr.example', anyIssuer: false })).toBe(1);
    const k = (await adminQuery(`MATCH (k:CdsCard {uuid: $u}) RETURN k.outcome AS o`, { u: card.uuid })) as { data?: { o: string }[] };
    expect(k.data?.[0]?.o).toBe('accepted');
  });

  it('trims unanswered cards per patient and overall, and never an answered one', async () => {
    await adminQuery(
      `MATCH (p:Patient {id: 'p-walter'})
       UNWIND range(1, 4) AS i
       CREATE (k:CdsCard {uuid: 'trim-' + toString(i), hookInstance: 'trim', drug: 'x' + toString(i), at: i})-[:ABOUT]->(p)
       SET k.outcome = CASE WHEN i = 1 THEN 'accepted' ELSE null END`,
    );
    try {
      await run(Q.trimCdsCards, { pid: 'p-walter', keep: 2000, perPatient: 1 });
      const left = (await adminQuery(`MATCH (k:CdsCard {hookInstance: 'trim'}) RETURN k.uuid AS u ORDER BY u`)) as { data?: { u: string }[] };
      // The answered card (oldest) stays; of the unanswered, only the newest.
      expect(left.data?.map((r) => r.u)).toEqual(['trim-1', 'trim-4']);
    } finally {
      await adminQuery(`MATCH (k:CdsCard {hookInstance: 'trim'}) DETACH DELETE k`);
    }
  });

  it('never guesses a medicine it cannot name with confidence, and refuses the wrong hook', async () => {
    const r = await runService('domino-order-sign', request('order-sign', 'p-rosa', [order('x', 'Zzqx 10 mg'), order('y', 'Benztropinum compositum')]), {
      base: BASE,
      canWrite: false,
    });
    expect(r.extension.domino.orders.map((o) => o.drug)).toEqual([null, null]);
    // Not silence: each unmatched order gets an info card saying Domino did not check it (not in the graph is not safe).
    expect(r.cards).toHaveLength(2);
    for (const c of r.cards) {
      expect(c.indicator).toBe('info');
      expect(c.source.topic.code).toBe('not-checked');
      expect(c.suggestions).toBeUndefined();
      expect(c.summary.length).toBeLessThan(140);
      expect(c.detail).toMatch(/does not mean safe/);
    }
    expect(r.cards[0].summary).toMatch(/did not check Zzqx/);
    expect(r.extension.domino.stored).toBe(false);
    // A real warning comes first; the not-checked note after it; a nameless order is said to be unreadable.
    const mixed = await runService(
      'domino-order-select',
      request('order-select', 'p-rosa', [order('a', 'Zzqx 10 mg'), order('b', 'Benztropine 1 mg'), { resource: { resourceType: 'MedicationRequest', id: 'c', status: 'draft' } } as never]),
      { base: BASE, canWrite: false },
    );
    expect(mixed.cards.map((c) => c.indicator)).toEqual(['warning', 'info', 'info']);
    expect(mixed.cards[2].summary).toMatch(/could not read the medicine name/);
    await expect(runService('domino-order-select', request('order-sign', 'p-rosa', []), { base: BASE, canWrite: false })).rejects.toThrow(/order-select/);
    await expect(runService('nope', request('order-sign', 'p-rosa', []), { base: BASE, canWrite: false })).rejects.toBeInstanceOf(CdsError);
  });
});
