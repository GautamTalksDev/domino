// A review as a FHIR R4 Bundle, so it can leave Domino in the format EHRs and clinical decision support already speak:
//   Patient, MedicationStatement (one per medicine), Condition (one per diagnosis),
//   DetectedIssue (one per likely or possible cascade link and per dangerous combination, implicating the medicines),
//   Task (one per open review task, focused on the issue it is about), and a Provenance that says the issues came from
//   Domino's agents and the FalkorDB graph. Codes are Domino's own (a CodeSystem under the deployment's URL): the
//   knowledge graph has no RxNorm or SNOMED mapping yet, so every coding also carries display text.

import type { Analysis } from './engine/types';
import { dayToISO, TODAY_DAY } from '../data/time';
import { REF } from '../data/references';

type Json = Record<string, unknown>;

const sys = (base: string, kind: string) => `${base}/fhir/CodeSystem/${kind}`;

/**
 * A FHIR logical id: [A-Za-z0-9\-\.]{1,64}. Domino's ids use underscores and run long (p-beatrice-issue-…), so every id
 * is mapped here, the same way everywhere, so references still resolve to their resources.
 */
export function fhirId(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9.-]/g, '-').replace(/-{2,}/g, '-');
  if (clean.length <= 64) return clean || 'x';
  // Too long: keep a readable prefix and a short hash of the whole so two long ids never collide.
  let h = 0;
  for (const c of raw) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return `${clean.slice(0, 55)}-${(h >>> 0).toString(36)}`.slice(0, 64);
}

export function reviewBundle(
  a: Analysis,
  tasks: { id: string; title: string; status: string; finding: string | null; role?: string }[],
  base: string,
): Json {
  const p = a.patient;
  const pid = fhirId(p.id);
  // Every id goes through fhirId, here and in references, so a reference always names an id that is in the bundle.
  const ref = (type: string, id: string) => ({ reference: `${type}/${fhirId(id)}` });
  const entries: Json[] = [];
  const add = (resource: Json) => {
    resource.id = fhirId(String(resource.id));
    entries.push({ fullUrl: `${base}/fhir/${resource.resourceType}/${resource.id}`, resource });
  };
  const medId = (drug: string) => `${pid}-med-${drug}`;

  add({
    resourceType: 'Patient',
    id: pid,
    meta: { tag: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HTEST', display: 'test health data' }] },
    name: [{ text: p.name }],
    gender: p.sex === 'F' ? 'female' : 'male',
    birthDate: String(new Date(Date.UTC(2026, 9, 1)).getUTCFullYear() - p.age),
  });

  for (const c of p.conditions) {
    add({
      resourceType: 'Condition',
      id: `${pid}-cond-${c.id}`,
      subject: ref('Patient', pid),
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      code: { coding: [{ system: sys(base, 'effect'), code: c.id, display: c.name }], text: c.name },
      onsetDateTime: c.since != null ? dayToISO(c.since) : undefined,
    });
  }

  for (const m of p.meds) {
    add({
      resourceType: 'MedicationStatement',
      id: medId(m.id),
      status: 'active',
      subject: ref('Patient', pid),
      medicationCodeableConcept: { coding: [{ system: sys(base, 'drug'), code: m.id, display: m.name }], text: m.name },
      effectivePeriod: { start: dayToISO(m.start) },
      dosage: m.dose ? [{ text: m.dose }] : undefined,
      informationSource: m.prescriber ? { display: m.prescriber } : undefined,
      reasonCode: m.indication ? [{ coding: [{ system: sys(base, 'effect'), code: m.indication }] }] : undefined,
    });
  }

  const issueIds: string[] = [];
  for (const l of a.links.filter((x) => x.tier === 'likely' || x.tier === 'possible')) {
    const id = fhirId(`${pid}-issue-${l.from}-${l.to}`);
    issueIds.push(id);
    const pat = l.patterns[0];
    add({
      resourceType: 'DetectedIssue',
      id,
      status: 'preliminary',
      code: {
        coding: [{ system: sys(base, 'issue'), code: 'prescribing-cascade', display: 'Possible prescribing cascade' }],
        text: 'Possible prescribing cascade',
      },
      severity: l.tier === 'likely' ? 'moderate' : 'low',
      patient: ref('Patient', pid),
      identifiedDateTime: dayToISO(TODAY_DAY),
      author: { display: 'Domino agents (FalkorDB graph review)' },
      implicated: [ref('MedicationStatement', medId(l.from)), ref('MedicationStatement', medId(l.to))],
      evidence: [
        {
          code: [{ coding: [{ system: sys(base, 'effect'), code: l.effect, display: l.effectName }], text: l.effectName }],
          detail: pat ? [{ display: `Documented pattern: ${pat.title} (${pat.evidence})` }] : undefined,
        },
      ],
      detail: `${l.headline} Score ${l.score.toFixed(2)} (${l.tier}). ${l.factors.map((f) => f.note).join(' ')}`.slice(0, 2000),
      reference: pat?.refs.map((r) => REF[r]?.url).find(Boolean),
      extension: [
        { url: `${base}/fhir/StructureDefinition/cascade-score`, valueDecimal: Math.round(l.score * 100) / 100 },
        { url: `${base}/fhir/StructureDefinition/cascade-link`, valueString: l.key },
      ],
    });
  }

  for (const c of a.combos) {
    const id = fhirId(`${pid}-combo-${c.id}`);
    issueIds.push(id);
    add({
      resourceType: 'DetectedIssue',
      id,
      status: 'preliminary',
      code: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'DRG', display: 'Drug Interaction Alert' }], text: c.title },
      severity: 'high',
      patient: ref('Patient', pid),
      identifiedDateTime: dayToISO(TODAY_DAY),
      author: { display: 'Domino agents (FalkorDB graph review)' },
      implicated: c.drugs
        .map((name) => p.meds.find((m) => m.name === name || m.id === name))
        .filter((m): m is NonNullable<typeof m> => !!m)
        .map((m) => ref('MedicationStatement', medId(m.id))),
      detail: `${c.title}: ${c.why} ${c.harm}`.slice(0, 2000),
    });
  }

  for (const t of tasks) {
    const focus = t.finding ? fhirId(`${pid}-issue-${t.finding.replace('>', '-')}`) : null;
    add({
      resourceType: 'Task',
      id: t.id,
      status: t.status === 'approved' ? 'accepted' : 'requested',
      intent: 'proposal',
      description: t.title,
      for: ref('Patient', pid),
      focus: focus && issueIds.includes(focus) ? ref('DetectedIssue', focus) : undefined,
      owner: t.role ? { display: t.role } : undefined,
      authoredOn: dayToISO(TODAY_DAY),
    });
  }

  if (issueIds.length) {
    add({
      resourceType: 'Provenance',
      id: `${pid}-provenance`,
      target: issueIds.map((id) => ref('DetectedIssue', id)),
      recorded: new Date().toISOString(),
      agent: [{ type: { text: 'Author' }, who: { display: 'Domino: Detective, Pharmacist and Scribe agents over a FalkorDB graph' } }],
      entity: [{ role: 'source', what: { display: `${a.queries.length} FalkorDB queries; every finding is traceable in Domino’s provenance graph` } }],
    });
  }

  return {
    resourceType: 'Bundle',
    id: fhirId(`${pid}-review`),
    type: 'collection',
    timestamp: new Date().toISOString(),
    meta: { tag: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HTEST', display: 'test health data' }] },
    entry: JSON.parse(JSON.stringify(entries)),
  };
}
