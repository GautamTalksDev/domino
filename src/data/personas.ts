// Six hand-written synthetic patients used in the demo. Every name, prescriber and
// history here is invented. Each one is designed to exercise a different part of Domino.

export interface SynthMed {
  drug: string;
  start: number; // day number (see time.ts)
  dose: string;
  prescriber: string;
  indication?: string | null; // effect id recorded on the prescription, if charted
}

export interface SynthCondition {
  id: string;
  since: number;
}

export interface SynthPatient {
  id: string;
  name: string;
  age: number;
  sex: 'F' | 'M';
  persona?: boolean;
  headline?: string;
  story?: string;
  conditions: SynthCondition[];
  meds: SynthMed[];
}

export const PRESCRIBERS = {
  patel: 'Dr. A. Patel (family doctor)',
  nguyen: 'Dr. T. Nguyen (walk-in clinic)',
  fischer: 'Dr. M. Fischer (urology)',
  romero: 'Dr. L. Romero (geriatrics)',
  kim: 'Dr. S. Kim (neurology)',
  ahmed: 'Dr. R. Ahmed (walk-in clinic)',
  osei: 'Dr. K. Osei (cardiology)',
  laurent: 'Dr. C. Laurent (rheumatology)',
  okoro: 'Dr. E. Okoro (psychiatry)',
  martin: 'Dr. J. Martin (family doctor)',
  singh: 'Dr. H. Singh (family doctor)',
};

export const PERSONAS: SynthPatient[] = [
  {
    id: 'p-beatrice',
    name: 'Beatrice Hale',
    age: 84,
    sex: 'F',
    persona: true,
    headline: 'Nine medications. One of them started four of the others.',
    story:
      'Beatrice saw five prescribers in two years. Each new prescription made sense on its own. Her ankles swelled after amlodipine, a walk-in clinic added furosemide, then potassium, then a bladder pill for the leaking, and then a memory pill for the confusion that followed.',
    conditions: [
      { id: 'hypertension', since: -1800 },
      { id: 'osteoarthritis', since: -900 },
      { id: 'hyperlipidemia', since: -1500 },
    ],
    meds: [
      { drug: 'atorvastatin', start: -800, dose: '20 mg daily', prescriber: PRESCRIBERS.patel, indication: 'hyperlipidemia' },
      { drug: 'naproxen', start: 30, dose: '500 mg twice daily', prescriber: PRESCRIBERS.patel, indication: 'osteoarthritis' },
      { drug: 'omeprazole', start: 30, dose: '20 mg daily', prescriber: PRESCRIBERS.patel, indication: 'gi_bleed' },
      { drug: 'amlodipine', start: 120, dose: '10 mg daily', prescriber: PRESCRIBERS.patel, indication: 'hypertension' },
      { drug: 'furosemide', start: 168, dose: '40 mg daily', prescriber: PRESCRIBERS.nguyen, indication: 'peripheral_edema' },
      { drug: 'potassium_chloride', start: 196, dose: '20 mEq daily', prescriber: PRESCRIBERS.nguyen, indication: 'hypokalemia' },
      { drug: 'oxybutynin', start: 262, dose: '5 mg twice daily', prescriber: PRESCRIBERS.fischer, indication: 'urinary_incontinence' },
      { drug: 'lisinopril', start: 318, dose: '10 mg daily', prescriber: PRESCRIBERS.osei, indication: 'hypertension' },
      { drug: 'donepezil', start: 421, dose: '5 mg at bedtime', prescriber: PRESCRIBERS.romero, indication: 'cognitive_impairment' },
    ],
  },
  {
    id: 'p-walter',
    name: 'Walter Brooks',
    age: 79,
    sex: 'M',
    persona: true,
    headline: 'Four drugs pulling toward the same fall.',
    story:
      'Walter started tamsulosin for his prostate and began feeling dizzy when he stood up. A walk-in clinic prescribed meclizine for vertigo. Then his bladder got harder to empty. Separately, sertraline helped his mood but broke his sleep, and zolpidem followed.',
    conditions: [
      { id: 'bph', since: 150 },
      { id: 'depression', since: 380 },
      { id: 'hypertension', since: -1200 },
      { id: 'hyperlipidemia', since: -1000 },
    ],
    meds: [
      { drug: 'lisinopril', start: -700, dose: '20 mg daily', prescriber: PRESCRIBERS.patel, indication: 'hypertension' },
      { drug: 'atorvastatin', start: -900, dose: '40 mg daily', prescriber: PRESCRIBERS.patel, indication: 'hyperlipidemia' },
      { drug: 'tamsulosin', start: 200, dose: '0.4 mg daily', prescriber: PRESCRIBERS.fischer, indication: 'bph' },
      { drug: 'meclizine', start: 224, dose: '25 mg as needed', prescriber: PRESCRIBERS.ahmed, indication: 'dizziness' },
      { drug: 'finasteride', start: 268, dose: '5 mg daily', prescriber: PRESCRIBERS.fischer, indication: null },
      { drug: 'sertraline', start: 400, dose: '50 mg daily', prescriber: PRESCRIBERS.patel, indication: 'depression' },
      { drug: 'zolpidem', start: 431, dose: '5 mg at bedtime', prescriber: PRESCRIBERS.patel, indication: 'insomnia' },
      { drug: 'benzonatate', start: 640, dose: '100 mg three times daily', prescriber: PRESCRIBERS.ahmed, indication: 'dry_cough' },
    ],
  },
  {
    id: 'p-rosa',
    name: 'Rosa Alvarez',
    age: 88,
    sex: 'F',
    persona: true,
    headline: 'A four-drug chain that started with an anxiety pill.',
    story:
      'Rosa lives with dementia. Lorazepam was started for anxiety, and she became more agitated, not less. Risperidone followed, then stiffness and shuffling, then levodopa, then hallucinations and quetiapine.',
    conditions: [
      { id: 'dementia', since: -320 },
      { id: 'anxiety', since: 120 },
      { id: 'osteoporosis', since: -600 },
    ],
    meds: [
      { drug: 'donepezil', start: -280, dose: '10 mg at bedtime', prescriber: PRESCRIBERS.romero, indication: 'dementia' },
      { drug: 'alendronate', start: -120, dose: '70 mg weekly', prescriber: PRESCRIBERS.patel, indication: 'osteoporosis' },
      { drug: 'calcium_vitd', start: -120, dose: '500 mg + 800 IU daily', prescriber: PRESCRIBERS.patel, indication: 'osteoporosis' },
      { drug: 'pantoprazole', start: -86, dose: '40 mg daily', prescriber: PRESCRIBERS.nguyen, indication: 'gerd' },
      { drug: 'lorazepam', start: 150, dose: '0.5 mg twice daily', prescriber: PRESCRIBERS.nguyen, indication: 'anxiety' },
      { drug: 'risperidone', start: 171, dose: '0.5 mg twice daily', prescriber: PRESCRIBERS.romero, indication: 'agitation' },
      { drug: 'carbidopa_levodopa', start: 236, dose: '25/100 mg three times daily', prescriber: PRESCRIBERS.kim, indication: 'parkinsonism' },
      { drug: 'quetiapine', start: 402, dose: '25 mg at bedtime', prescriber: PRESCRIBERS.romero, indication: 'hallucinations' },
    ],
  },
  {
    id: 'p-henry',
    name: 'Henry Okafor',
    age: 91,
    sex: 'M',
    persona: true,
    headline: 'His painkiller raised his blood pressure. The fix gave him gout.',
    story:
      'Henry takes apixaban for atrial fibrillation. Naproxen for his knees pushed his blood pressure up, so hydrochlorothiazide was added. Gout followed, then colchicine, then diarrhoea, then loperamide.',
    conditions: [
      { id: 'atrial_fibrillation', since: -400 },
      { id: 'osteoarthritis', since: -300 },
    ],
    meds: [
      { drug: 'apixaban', start: -380, dose: '2.5 mg twice daily', prescriber: PRESCRIBERS.osei, indication: 'atrial_fibrillation' },
      { drug: 'metoprolol', start: -380, dose: '25 mg twice daily', prescriber: PRESCRIBERS.osei, indication: 'atrial_fibrillation' },
      { drug: 'naproxen', start: 100, dose: '500 mg twice daily', prescriber: PRESCRIBERS.laurent, indication: 'osteoarthritis' },
      { drug: 'omeprazole', start: 100, dose: '20 mg daily', prescriber: PRESCRIBERS.laurent, indication: 'gi_bleed' },
      { drug: 'hydrochlorothiazide', start: 163, dose: '25 mg daily', prescriber: PRESCRIBERS.patel, indication: 'hypertension' },
      { drug: 'colchicine', start: 377, dose: '0.6 mg daily', prescriber: PRESCRIBERS.nguyen, indication: 'gout' },
      { drug: 'allopurinol', start: 405, dose: '100 mg daily', prescriber: PRESCRIBERS.patel, indication: 'gout' },
      { drug: 'loperamide', start: 386, dose: '2 mg as needed', prescriber: PRESCRIBERS.nguyen, indication: 'diarrhea' },
    ],
  },
  {
    id: 'p-dorothy',
    name: 'Dorothy Chen',
    age: 76,
    sex: 'F',
    persona: true,
    headline: 'The control case: a list that looks like a cascade, and is not.',
    story:
      'Dorothy has heart failure and takes furosemide and amlodipine, the same pair as Beatrice. But her furosemide came first, for her heart. Domino should check, find the reasons, and stay quiet.',
    conditions: [
      { id: 'heart_failure', since: -420 },
      { id: 'hypertension', since: -1400 },
      { id: 'type2_diabetes', since: -900 },
    ],
    meds: [
      { drug: 'metformin', start: -600, dose: '500 mg twice daily', prescriber: PRESCRIBERS.patel, indication: 'type2_diabetes' },
      { drug: 'lisinopril', start: -400, dose: '10 mg daily', prescriber: PRESCRIBERS.osei, indication: 'heart_failure' },
      { drug: 'metoprolol', start: -400, dose: '50 mg daily', prescriber: PRESCRIBERS.osei, indication: 'heart_failure' },
      { drug: 'furosemide', start: -380, dose: '40 mg daily', prescriber: PRESCRIBERS.osei, indication: 'heart_failure' },
      { drug: 'amlodipine', start: 300, dose: '5 mg daily', prescriber: PRESCRIBERS.patel, indication: 'hypertension' },
    ],
  },
  {
    id: 'p-frank',
    name: 'Frank Russo',
    age: 82,
    sex: 'M',
    persona: true,
    headline: 'Some links are deliberate. Domino remembers which.',
    story:
      'Frank has taken lithium for decades. Gabapentin for nerve pain swelled his ankles, so furosemide and potassium followed. His B12 and thyroid supplements are planned, and his care team has already told Domino so.',
    conditions: [
      { id: 'bipolar', since: -6000 },
      { id: 'neuropathic_pain', since: 180 },
      { id: 'type2_diabetes', since: -1500 },
    ],
    meds: [
      { drug: 'lithium', start: -2000, dose: '300 mg twice daily', prescriber: PRESCRIBERS.okoro, indication: 'bipolar' },
      { drug: 'metformin', start: -900, dose: '1000 mg twice daily', prescriber: PRESCRIBERS.patel, indication: 'type2_diabetes' },
      { drug: 'levothyroxine', start: -300, dose: '75 mcg daily', prescriber: PRESCRIBERS.okoro, indication: 'hypothyroidism' },
      { drug: 'propranolol', start: 90, dose: '10 mg twice daily', prescriber: PRESCRIBERS.okoro, indication: 'tremor' },
      { drug: 'gabapentin', start: 200, dose: '300 mg three times daily', prescriber: PRESCRIBERS.patel, indication: 'neuropathic_pain' },
      { drug: 'furosemide', start: 246, dose: '20 mg daily', prescriber: PRESCRIBERS.nguyen, indication: 'peripheral_edema' },
      { drug: 'potassium_chloride', start: 274, dose: '20 mEq daily', prescriber: PRESCRIBERS.nguyen, indication: 'hypokalemia' },
      { drug: 'cyanocobalamin', start: 520, dose: '1000 mcg daily', prescriber: PRESCRIBERS.patel, indication: 'b12_deficiency' },
    ],
  },
];

// Decisions a care team made in an earlier session, so Domino has memory on first load.
export interface SeedDecision {
  patientId: string;
  from: string;
  to: string;
  verdict: 'intentional' | 'confirmed' | 'not_cascade';
  reason: string;
  by: string;
  day: number;
}

export const SEED_DECISIONS: SeedDecision[] = [
  {
    patientId: 'p-frank',
    from: 'metformin',
    to: 'cyanocobalamin',
    verdict: 'intentional',
    reason: 'Planned B12 replacement; metformin is working well. Recheck B12 yearly.',
    by: 'J. Morin, PharmD',
    day: 940,
  },
  {
    patientId: 'p-frank',
    from: 'lithium',
    to: 'levothyroxine',
    verdict: 'intentional',
    reason: 'Lithium-induced hypothyroidism, recognised in 2023. Lithium continues on psychiatry advice.',
    by: 'Dr. E. Okoro',
    day: 940,
  },
];
