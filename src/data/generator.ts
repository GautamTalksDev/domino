// Seeded synthetic cohort generator.
//
// It produces older adults with realistic chronic conditions and first-line medicines,
// then injects prescribing cascades by sampling real CAUSES and TREATED_BY edges from the
// knowledge graph. It also injects confounders the engine has to see through:
//   - marker drugs prescribed for a genuine condition (furosemide for heart failure)
//   - deliberate pairs started together (an NSAID with a PPI, an opioid with a laxative)
//   - drugs started in the reverse order
// The ground truth (which links were generated as cascades) never enters the graph.
// It is only used by the evaluation.

import { CAUSES, DRUG, FREQ_WEIGHT, PATTERNS, TREATS, type Freq } from './knowledge';
import { PRESCRIBERS, type SynthMed, type SynthPatient } from './personas';
import { TODAY_DAY } from './time';

export interface TruthLink {
  patientId: string;
  from: string;
  effect: string;
  to: string;
  intentional: boolean;
}

export interface Cohort {
  patients: SynthPatient[];
  truth: TruthLink[];
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function pickWeighted<T>(rng: Rng, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1][0];
}

function uniformInt(rng: Rng, lo: number, hi: number): number {
  return Math.floor(lo + rng() * (hi - lo + 1));
}

interface ConditionRx {
  cond: string;
  p: number;
  sex?: 'F' | 'M';
  drugs: [string, number][];
  extra?: [string, number][];
}

const CONDITION_RX: ConditionRx[] = [
  {
    cond: 'hypertension',
    p: 0.62,
    drugs: [
      ['amlodipine', 3],
      ['lisinopril', 3],
      ['losartan', 2],
      ['hydrochlorothiazide', 2],
      ['ramipril', 1],
      ['chlorthalidone', 1],
      ['nifedipine', 1],
    ],
  },
  {
    cond: 'hyperlipidemia',
    p: 0.5,
    drugs: [
      ['atorvastatin', 4],
      ['rosuvastatin', 2],
      ['simvastatin', 1],
    ],
  },
  {
    cond: 'osteoarthritis',
    p: 0.38,
    drugs: [
      ['acetaminophen', 4],
      ['naproxen', 2],
      ['ibuprofen', 2],
      ['celecoxib', 1],
      ['diclofenac', 1],
      ['tramadol', 1],
      ['oxycodone', 0.5],
    ],
  },
  {
    cond: 'type2_diabetes',
    p: 0.24,
    drugs: [
      ['metformin', 5],
      ['glipizide', 1],
      ['sitagliptin', 1],
      ['empagliflozin', 1],
    ],
  },
  {
    cond: 'gerd',
    p: 0.16,
    drugs: [
      ['omeprazole', 3],
      ['pantoprazole', 2],
      ['famotidine', 1],
    ],
  },
  {
    cond: 'depression',
    p: 0.14,
    drugs: [
      ['sertraline', 3],
      ['citalopram', 2],
      ['escitalopram', 2],
      ['mirtazapine', 1],
      ['venlafaxine', 1],
      ['duloxetine', 1],
      ['paroxetine', 0.5],
    ],
  },
  {
    cond: 'anxiety',
    p: 0.08,
    drugs: [
      ['lorazepam', 2],
      ['alprazolam', 1],
      ['sertraline', 2],
      ['escitalopram', 1],
    ],
  },
  {
    cond: 'atrial_fibrillation',
    p: 0.1,
    drugs: [
      ['apixaban', 3],
      ['warfarin', 1],
    ],
    extra: [
      ['metoprolol', 0.6],
      ['diltiazem', 0.2],
      ['amiodarone', 0.1],
      ['digoxin', 0.1],
    ],
  },
  {
    cond: 'heart_failure',
    p: 0.09,
    drugs: [
      ['furosemide', 3],
      ['torsemide', 1],
    ],
    extra: [
      ['lisinopril', 0.5],
      ['metoprolol', 0.5],
      ['spironolactone', 0.3],
      ['empagliflozin', 0.2],
    ],
  },
  {
    cond: 'coronary_disease',
    p: 0.14,
    drugs: [
      ['aspirin', 3],
      ['clopidogrel', 1],
    ],
  },
  {
    cond: 'bph',
    p: 0.35,
    sex: 'M',
    drugs: [
      ['tamsulosin', 4],
      ['finasteride', 1],
      ['doxazosin', 1],
    ],
  },
  {
    cond: 'osteoporosis',
    p: 0.22,
    sex: 'F',
    drugs: [
      ['alendronate', 3],
      ['calcium_vitd', 2],
    ],
  },
  {
    cond: 'dementia',
    p: 0.09,
    drugs: [
      ['donepezil', 3],
      ['rivastigmine', 1],
      ['galantamine', 1],
      ['memantine', 1],
    ],
  },
  {
    cond: 'insomnia',
    p: 0.07,
    drugs: [
      ['zolpidem', 2],
      ['trazodone', 2],
      ['melatonin', 2],
      ['zopiclone', 1],
    ],
  },
  {
    cond: 'neuropathic_pain',
    p: 0.1,
    drugs: [
      ['gabapentin', 3],
      ['pregabalin', 2],
      ['duloxetine', 1],
      ['amitriptyline', 1],
    ],
  },
  { cond: 'hypothyroidism', p: 0.1, drugs: [['levothyroxine', 1]] },
  {
    cond: 'urinary_incontinence',
    p: 0.07,
    drugs: [
      ['oxybutynin', 2],
      ['solifenacin', 2],
      ['mirabegron', 1],
      ['tolterodine', 1],
    ],
  },
  { cond: 'parkinsons_disease', p: 0.025, drugs: [['carbidopa_levodopa', 1]] },
  {
    cond: 'bipolar',
    p: 0.02,
    drugs: [
      ['lithium', 2],
      ['quetiapine', 1],
    ],
  },
  { cond: 'anemia', p: 0.07, drugs: [['ferrous_sulfate', 1]] },
  {
    cond: 'gout',
    p: 0.04,
    drugs: [
      ['allopurinol', 2],
      ['colchicine', 1],
    ],
  },
  { cond: 'polymyalgia', p: 0.02, drugs: [['prednisone', 1]] },
  {
    cond: 'dry_cough',
    p: 0.03,
    drugs: [
      ['dextromethorphan', 1],
      ['benzonatate', 1],
    ],
  },
  {
    cond: 'dizziness',
    p: 0.03,
    drugs: [
      ['meclizine', 2],
      ['betahistine', 1],
    ],
  },
];

const FIRST_F = [
  'Mabel',
  'Joan',
  'Helen',
  'Ruth',
  'Irene',
  'Doris',
  'Elaine',
  'Gloria',
  'Agnes',
  'Louise',
  'Marie',
  'Priya',
  'Mei',
  'Fatima',
  'Aiko',
  'Rosa',
  'Ingrid',
  'Olga',
  'Grace',
  'Nora',
  'Evelyn',
  'Shirley',
  'Lucille',
  'Esther',
  'Carmen',
  'Hana',
  'Amara',
  'Sunita',
  'Yvonne',
  'Claire',
];
const FIRST_M = [
  'Walter',
  'Harold',
  'Frank',
  'George',
  'Arthur',
  'Raymond',
  'Albert',
  'Ernest',
  'Henry',
  'Stanley',
  'Joseph',
  'Rajesh',
  'Wei',
  'Omar',
  'Kenji',
  'Luis',
  'Lars',
  'Ivan',
  'Samuel',
  'Edward',
  'Gerald',
  'Norman',
  'Leonard',
  'Victor',
  'Bernard',
  'Kwame',
  'Tariq',
  'Andre',
  'Pierre',
  'Hugh',
];
const LAST = [
  'Thompson',
  'Gagnon',
  'Roy',
  'Wong',
  'Singh',
  'MacDonald',
  'Tremblay',
  'Martin',
  'Campbell',
  'Nguyen',
  'Kowalski',
  'Haddad',
  'Fraser',
  'Bouchard',
  'Patel',
  'Morrison',
  'Li',
  'Côté',
  'Ibrahim',
  'Sato',
  'Hughes',
  'Novak',
  'Reid',
  'Mensah',
  'Pelletier',
  'Chowdhury',
  'Russo',
  'Andersen',
  'Murphy',
  'Kaur',
  'Ferreira',
  'Dubois',
  'Bergeron',
  'Yamamoto',
  'Ortiz',
  'Lindqvist',
];

// Who prescribes what. Each patient has one family doctor; a specialist or a walk-in clinic writes some of
// the rest. This is an assumption of the generator (care spread across prescribers), stated so the
// care-team view is read for what it is: a demonstration on synthetic data.
const FAMILY = [PRESCRIBERS.patel, PRESCRIBERS.martin, PRESCRIBERS.singh];
const WALK_IN = [PRESCRIBERS.nguyen, PRESCRIBERS.ahmed];
const SPECIALIST_FOR_CONDITION: Record<string, string> = {
  atrial_fibrillation: PRESCRIBERS.osei,
  heart_failure: PRESCRIBERS.osei,
  coronary_disease: PRESCRIBERS.osei,
  depression: PRESCRIBERS.okoro,
  anxiety: PRESCRIBERS.okoro,
  bipolar: PRESCRIBERS.okoro,
  parkinsons_disease: PRESCRIBERS.kim,
  neuropathic_pain: PRESCRIBERS.kim,
  dementia: PRESCRIBERS.romero,
  bph: PRESCRIBERS.fischer,
  urinary_incontinence: PRESCRIBERS.fischer,
  gout: PRESCRIBERS.laurent,
  polymyalgia: PRESCRIBERS.laurent,
  osteoarthritis: PRESCRIBERS.laurent,
};
const SPECIALIST_FOR_CLASS: Record<string, string> = {
  urinary_antimuscarinic: PRESCRIBERS.fischer,
  beta3_agonist: PRESCRIBERS.fischer,
  alpha_blocker: PRESCRIBERS.fischer,
  cholinesterase_inhibitor: PRESCRIBERS.romero,
  nmda_antagonist: PRESCRIBERS.romero,
  antiparkinsonian: PRESCRIBERS.kim,
  antiparkinsonian_anticholinergic: PRESCRIBERS.kim,
  antipsychotic: PRESCRIBERS.okoro,
  benzodiazepine: PRESCRIBERS.okoro,
  z_drug: PRESCRIBERS.okoro,
  ssri: PRESCRIBERS.okoro,
  snri: PRESCRIBERS.okoro,
  sedating_antidepressant: PRESCRIBERS.okoro,
  loop_diuretic: PRESCRIBERS.osei,
  beta_blocker: PRESCRIBERS.osei,
  antiarrhythmic: PRESCRIBERS.osei,
  urate_lowering: PRESCRIBERS.laurent,
  gout_acute: PRESCRIBERS.laurent,
};

const treatedBy = new Map<string, [string, number][]>();
for (const [effect, drug, line] of TREATS) {
  const w = line === 'first' ? 3 : line === 'second' ? 1 : 0.4;
  if (!treatedBy.has(effect)) treatedBy.set(effect, []);
  treatedBy.get(effect)!.push([drug, w]);
}

const causesOf = new Map<string, { effect: string; freq: Freq; onset: [number, number] }[]>();
for (const [drug, effect, freq, onset] of CAUSES) {
  if (!causesOf.has(drug)) causesOf.set(drug, []);
  causesOf.get(drug)!.push({ effect, freq, onset: onset ?? [1, 180] });
}

function isIntentional(from: string, effect: string, to: string): boolean {
  const a = DRUG[from]?.cls;
  const b = DRUG[to]?.cls;
  return PATTERNS.some((p) => p.intentional && p.effect === effect && !!a && !!b && p.index.includes(a) && p.marker.includes(b));
}

const CASCADE_RATE = 0.24; // probability scale for "side effect noticed, misattributed and treated"

export function generateCohort(size = 600, seed = 20261015, prefix = 'p'): Cohort {
  const rng = mulberry32(seed);
  const patients: SynthPatient[] = [];
  const truth: TruthLink[] = [];

  for (let i = 0; i < size; i++) {
    const sex: 'F' | 'M' = rng() < 0.56 ? 'F' : 'M';
    const age = Math.min(99, 65 + Math.floor(Math.pow(rng(), 1.3) * 32));
    const first = sex === 'F' ? FIRST_F[uniformInt(rng, 0, FIRST_F.length - 1)] : FIRST_M[uniformInt(rng, 0, FIRST_M.length - 1)];
    const last = LAST[uniformInt(rng, 0, LAST.length - 1)];
    const id = `${prefix}${String(i + 1).padStart(4, '0')}`;
    const p: SynthPatient = { id, name: `${first} ${last}`, age, sex, conditions: [], meds: [] };
    const gp = FAMILY[uniformInt(rng, 0, FAMILY.length - 1)];
    const baseBy = (cond: string) => (rng() < 0.75 ? gp : (SPECIALIST_FOR_CONDITION[cond] ?? gp));
    const markerBy = (drug: string) => {
      const r = rng();
      if (r < 0.4) return gp;
      if (r < 0.75) return WALK_IN[uniformInt(rng, 0, WALK_IN.length - 1)];
      return SPECIALIST_FOR_CLASS[DRUG[drug]!.cls] ?? WALK_IN[uniformInt(rng, 0, WALK_IN.length - 1)];
    };
    const taken = new Set<string>();
    const ageBoost = 1 + (age - 75) / 60;

    const addMed = (m: SynthMed) => {
      if (taken.has(m.drug)) return false;
      if (m.start > TODAY_DAY) return false;
      taken.add(m.drug);
      p.meds.push(m);
      return true;
    };

    const injectCascades = (fromDrug: string, fromStart: number, depth: number) => {
      if (depth > 2) return;
      for (const c of causesOf.get(fromDrug) ?? []) {
        const markers = (treatedBy.get(c.effect) ?? []).filter(([d]) => !taken.has(d) && DRUG[d]!.cls !== DRUG[fromDrug]!.cls);
        if (markers.length === 0) continue;
        const chance = FREQ_WEIGHT[c.freq] * CASCADE_RATE * ageBoost * (depth === 0 ? 1 : 0.8);
        if (rng() >= chance) continue;
        const marker = pickWeighted(rng, markers);
        const lo = Math.max(2, c.onset[0]);
        const start = fromStart + uniformInt(rng, lo, c.onset[1]);
        if (start > TODAY_DAY) continue;
        const ok = addMed({
          drug: marker,
          start,
          dose: 'as prescribed',
          prescriber: markerBy(marker),
          indication: rng() < 0.45 ? c.effect : null,
        });
        if (!ok) continue;
        truth.push({ patientId: id, from: fromDrug, effect: c.effect, to: marker, intentional: isIntentional(fromDrug, c.effect, marker) });
        injectCascades(marker, start, depth + 1);
      }
    };

    // 1. Chronic conditions and their first-line medicines
    const base: SynthMed[] = [];
    for (const rx of CONDITION_RX) {
      if (rx.sex && rx.sex !== sex) {
        if (!(rx.cond === 'osteoporosis' && rng() < 0.06)) continue;
      }
      if (rng() >= rx.p) continue;
      const start = uniformInt(rng, -500, 860);
      p.conditions.push({ id: rx.cond, since: start - uniformInt(rng, 0, 150) });
      const drug = pickWeighted(rng, rx.drugs);
      const med: SynthMed = {
        drug,
        start,
        dose: 'as prescribed',
        prescriber: baseBy(rx.cond),
        indication: rng() < 0.8 ? rx.cond : null,
      };
      if (addMed(med)) base.push(med);
      for (const [extra, prob] of rx.extra ?? []) {
        if (rng() < prob) {
          const m2: SynthMed = { ...med, drug: extra, start: start + uniformInt(rng, 0, 60), indication: rng() < 0.8 ? rx.cond : null };
          if (addMed(m2)) base.push(m2);
        }
      }
    }

    // 2. Deliberate companion prescriptions (confounders that look like cascades)
    for (const m of [...base]) {
      const cls = DRUG[m.drug]!.cls;
      if (['nsaid', 'anticoagulant', 'antiplatelet'].includes(cls) && age >= 72 && rng() < 0.45) {
        const ppi = rng() < 0.6 ? 'omeprazole' : 'pantoprazole';
        if (addMed({ drug: ppi, start: m.start + uniformInt(rng, 0, 3), dose: 'as prescribed', prescriber: m.prescriber, indication: 'gi_bleed' })) {
          truth.push({ patientId: id, from: m.drug, effect: 'gi_bleed', to: ppi, intentional: true });
        }
      }
      if (cls === 'opioid' && rng() < 0.6) {
        const lax = rng() < 0.5 ? 'senna' : 'polyethylene_glycol';
        if (addMed({ drug: lax, start: m.start + uniformInt(rng, 0, 2), dose: 'as prescribed', prescriber: m.prescriber, indication: 'constipation' })) {
          truth.push({ patientId: id, from: m.drug, effect: 'constipation', to: lax, intentional: true });
        }
      }
      if (cls === 'loop_diuretic' && rng() < 0.3) {
        if (
          addMed({
            drug: 'potassium_chloride',
            start: m.start + uniformInt(rng, 0, 10),
            dose: 'as prescribed',
            prescriber: m.prescriber,
            indication: 'hypokalemia',
          })
        ) {
          truth.push({ patientId: id, from: m.drug, effect: 'hypokalemia', to: 'potassium_chloride', intentional: true });
        }
      }
    }

    // 3. Cascades grow from every base medicine
    for (const m of base) injectCascades(m.drug, m.start, 0);

    p.meds.sort((a, b) => a.start - b.start);
    patients.push(p);
  }

  return { patients, truth };
}
