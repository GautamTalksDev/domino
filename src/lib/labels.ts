// Matching CAUSES edges against FDA label text (used by scripts/verify-labels.ts).

export const EFFECT_TERMS: Record<string, string[]> = {
  peripheral_edema: ['edema', 'oedema', 'swelling'],
  hypokalemia: ['hypokalemia', 'hypokalaemia', 'low potassium', 'potassium depletion', 'serum potassium'],
  hyperkalemia: ['hyperkalemia', 'hyperkalaemia', 'elevated potassium', 'serum potassium'],
  hyponatremia: ['hyponatremia', 'hyponatraemia', 'siadh', 'low sodium'],
  gout: ['gout', 'uric acid', 'hyperuricemia'],
  urinary_incontinence: ['incontinence', 'urinary frequency', 'urgency', 'polyuria', 'pollakiuria', 'frequent urination'],
  urinary_retention: ['urinary retention', 'retention of urine', 'difficulty urinating', 'urinary hesitancy'],
  cognitive_impairment: ['confusion', 'cognitive', 'memory', 'delirium', 'disorientation'],
  dry_cough: ['cough'],
  hypertension: ['hypertension', 'blood pressure increase', 'increased blood pressure', 'elevation of blood pressure'],
  dizziness: ['dizziness', 'vertigo'],
  orthostatic_hypotension: ['orthostatic', 'postural hypotension', 'hypotension', 'syncope'],
  insomnia: ['insomnia', 'sleep disturbance', 'abnormal dreams'],
  parkinsonism: ['extrapyramidal', 'parkinsonism', 'tardive', 'dystonia', 'akathisia'],
  agitation: ['agitation', 'paradoxical', 'excitement', 'aggression', 'delirium'],
  hallucinations: ['hallucination'],
  constipation: ['constipation'],
  diarrhea: ['diarrhea', 'diarrhoea'],
  nausea: ['nausea'],
  gerd: ['dyspepsia', 'esophag', 'heartburn', 'reflux', 'gastritis'],
  gi_bleed: ['bleeding', 'hemorrhage', 'haemorrhage', 'ulcer'],
  hypothyroidism: ['hypothyroidism', 'thyroid'],
  tremor: ['tremor'],
  hyperglycemia: ['hyperglycemia', 'hyperglycaemia', 'glucose', 'diabetes'],
  hypoglycemia: ['hypoglycemia', 'hypoglycaemia'],
  sedation: ['somnolence', 'sedation', 'drowsiness'],
  falls: ['fall'],
  fracture: ['fracture'],
  myalgia: ['myalgia', 'muscle pain', 'myopathy', 'muscle'],
  b12_deficiency: ['vitamin b12', 'b12', 'cyanocobalamin'],
  bradycardia: ['bradycardia', 'slow heart'],
  kidney_injury: ['renal', 'kidney'],
  angioedema: ['angioedema'],
  osteoporosis: ['osteoporosis', 'bone loss', 'bone mineral density'],
};

const FIELDS = ['adverse_reactions', 'warnings_and_cautions', 'warnings', 'boxed_warning', 'precautions', 'adverse_reactions_table'];

export function labelText(result: Record<string, unknown> | undefined): string {
  if (!result) return '';
  return FIELDS.flatMap((f) => (Array.isArray(result[f]) ? (result[f] as string[]) : []))
    .join(' ')
    .toLowerCase();
}

export function mentions(text: string, effect: string): string | null {
  for (const term of EFFECT_TERMS[effect] ?? []) {
    if (text.includes(term)) return term;
  }
  return null;
}
