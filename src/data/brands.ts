// Common brand names and plain aliases for the drugs in the knowledge graph (US and Canada).
// They go on each Drug node as search terms for FalkorDB's full-text index, so a person can type
// "Norvasc, Lasix, Ditropan" or "water pill" and Domino finds the right node.
// Combination products are left out on purpose: they would map one name to two drugs.

export const BRANDS: Record<string, string[]> = {
  amlodipine: ['Norvasc'],
  nifedipine: ['Procardia', 'Adalat'],
  felodipine: ['Plendil'],
  diltiazem: ['Cardizem', 'Tiazac'],
  verapamil: ['Calan', 'Isoptin'],
  furosemide: ['Lasix', 'water pill'],
  torsemide: ['Demadex', 'Soaanz'],
  hydrochlorothiazide: ['Microzide', 'HCTZ'],
  chlorthalidone: ['Thalitone', 'Hygroton'],
  spironolactone: ['Aldactone'],
  lisinopril: ['Prinivil', 'Zestril'],
  ramipril: ['Altace'],
  enalapril: ['Vasotec'],
  losartan: ['Cozaar'],
  valsartan: ['Diovan'],
  candesartan: ['Atacand'],
  metoprolol: ['Lopressor', 'Toprol'],
  atenolol: ['Tenormin'],
  bisoprolol: ['Zebeta', 'Monocor'],
  propranolol: ['Inderal'],
  tamsulosin: ['Flomax'],
  doxazosin: ['Cardura'],
  terazosin: ['Hytrin'],
  finasteride: ['Proscar'],
  midodrine: ['ProAmatine'],
  atorvastatin: ['Lipitor'],
  simvastatin: ['Zocor'],
  rosuvastatin: ['Crestor'],
  digoxin: ['Lanoxin'],
  amiodarone: ['Cordarone', 'Pacerone'],
  apixaban: ['Eliquis'],
  warfarin: ['Coumadin', 'Jantoven'],
  aspirin: ['ASA', 'baby aspirin'],
  clopidogrel: ['Plavix'],
  ibuprofen: ['Advil', 'Motrin'],
  naproxen: ['Aleve', 'Naprosyn'],
  diclofenac: ['Voltaren'],
  celecoxib: ['Celebrex'],
  acetaminophen: ['Tylenol', 'paracetamol'],
  oxycodone: ['OxyContin', 'Roxicodone'],
  morphine: ['MS Contin'],
  tramadol: ['Ultram'],
  codeine: [],
  gabapentin: ['Neurontin'],
  pregabalin: ['Lyrica'],
  cyclobenzaprine: ['Flexeril'],
  senna: ['Senokot'],
  polyethylene_glycol: ['MiraLAX', 'Lax-A-Day', 'PEG'],
  docusate: ['Colace'],
  lactulose: ['Kristalose'],
  loperamide: ['Imodium'],
  metoclopramide: ['Reglan'],
  ondansetron: ['Zofran'],
  omeprazole: ['Prilosec', 'Losec'],
  pantoprazole: ['Protonix', 'Pantoloc'],
  famotidine: ['Pepcid'],
  meclizine: ['Antivert', 'Bonine'],
  dimenhydrinate: ['Dramamine', 'Gravol'],
  betahistine: ['Serc'],
  donepezil: ['Aricept'],
  rivastigmine: ['Exelon'],
  galantamine: ['Razadyne', 'Reminyl'],
  memantine: ['Namenda', 'Ebixa'],
  oxybutynin: ['Ditropan'],
  tolterodine: ['Detrol'],
  solifenacin: ['Vesicare'],
  trospium: ['Sanctura', 'Trosec'],
  mirabegron: ['Myrbetriq', 'Betmiga'],
  vibegron: ['Gemtesa'],
  lorazepam: ['Ativan'],
  alprazolam: ['Xanax'],
  diazepam: ['Valium'],
  clonazepam: ['Klonopin', 'Rivotril'],
  temazepam: ['Restoril'],
  zolpidem: ['Ambien'],
  zopiclone: ['Imovane'],
  trazodone: ['Desyrel'],
  mirtazapine: ['Remeron'],
  melatonin: [],
  sertraline: ['Zoloft'],
  citalopram: ['Celexa'],
  escitalopram: ['Lexapro', 'Cipralex'],
  fluoxetine: ['Prozac'],
  paroxetine: ['Paxil'],
  venlafaxine: ['Effexor'],
  duloxetine: ['Cymbalta'],
  amitriptyline: ['Elavil'],
  nortriptyline: ['Pamelor', 'Aventyl'],
  haloperidol: ['Haldol'],
  risperidone: ['Risperdal'],
  quetiapine: ['Seroquel'],
  olanzapine: ['Zyprexa'],
  lithium: ['Lithobid', 'Carbolith'],
  carbidopa_levodopa: ['Sinemet', 'levodopa', 'carbidopa'],
  amantadine: ['Symmetrel', 'Gocovri'],
  benztropine: ['Cogentin'],
  diphenhydramine: ['Benadryl'],
  hydroxyzine: ['Atarax', 'Vistaril'],
  dextromethorphan: ['Delsym'],
  benzonatate: ['Tessalon'],
  allopurinol: ['Zyloprim'],
  febuxostat: ['Uloric'],
  colchicine: ['Colcrys', 'Mitigare'],
  potassium_chloride: ['Klor-Con', 'K-Dur', 'KCl'],
  levothyroxine: ['Synthroid', 'Levoxyl', 'Eltroxin'],
  metformin: ['Glucophage'],
  glipizide: ['Glucotrol'],
  glyburide: ['DiaBeta', 'Micronase'],
  insulin_glargine: ['Lantus', 'Basaglar'],
  sitagliptin: ['Januvia'],
  empagliflozin: ['Jardiance'],
  cyanocobalamin: ['B12', 'vitamin B12'],
  prednisone: ['Deltasone'],
  alendronate: ['Fosamax'],
  calcium_vitd: ['Caltrate', 'calcium', 'vitamin D'],
  ferrous_sulfate: ['Feosol', 'iron pill'],
};

/** Lower-case search terms for a drug: its id, its name, and its brands and aliases. */
export function searchTerms(id: string, name: string): string {
  const words = [id.replace(/_/g, ' '), name, ...(BRANDS[id] ?? [])];
  return [
    ...new Set(
      words
        .map((w) =>
          w
            .toLowerCase()
            .replace(/[^a-z0-9 ]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .filter(Boolean),
    ),
  ].join(' | ');
}

// Plain words people use for symptoms and diagnoses, added to each Effect node's search terms.
export const EFFECT_SYNONYMS: Record<string, string[]> = {
  peripheral_edema: ['swollen ankles', 'swelling', 'puffy feet', 'fluid in legs', 'edema', 'oedema'],
  urinary_incontinence: ['bladder leaks', 'incontinence', 'urgency', 'leaking'],
  urinary_retention: ['cannot pee', 'trouble urinating', 'retention'],
  cognitive_impairment: ['confusion', 'confused', 'memory loss', 'forgetful', 'foggy'],
  dementia: ['alzheimers', 'alzheimer', 'dementia'],
  dry_cough: ['cough', 'coughing'],
  hypertension: ['high blood pressure', 'blood pressure', 'bp'],
  dizziness: ['dizzy', 'vertigo', 'spinning'],
  orthostatic_hypotension: ['lightheaded', 'light headed', 'faint', 'fainting', 'low blood pressure'],
  insomnia: ['cannot sleep', 'sleeplessness', 'sleep problems'],
  parkinsonism: ['stiffness', 'shuffling', 'rigidity'],
  parkinsons_disease: ['parkinsons', 'parkinson'],
  agitation: ['restless', 'agitated', 'delirium'],
  hallucinations: ['seeing things', 'hearing things', 'hallucinating'],
  gerd: ['heartburn', 'acid reflux', 'reflux', 'indigestion'],
  osteoarthritis: ['arthritis', 'joint pain', 'knee pain', 'hip pain', 'back pain'],
  neuropathic_pain: ['nerve pain', 'neuropathy', 'tingling', 'burning feet'],
  atrial_fibrillation: ['afib', 'irregular heartbeat', 'palpitations'],
  coronary_disease: ['angina', 'heart disease', 'chest pain'],
  heart_failure: ['chf', 'weak heart'],
  hyperlipidemia: ['cholesterol', 'high cholesterol', 'lipids'],
  bph: ['prostate', 'enlarged prostate'],
  osteoporosis: ['thin bones', 'osteopenia', 'brittle bones'],
  anemia: ['anaemia', 'low iron', 'low blood count'],
  type2_diabetes: ['diabetes', 'diabetic', 'sugar'],
  depression: ['depressed', 'low mood'],
  anxiety: ['anxious', 'worry', 'nerves', 'panic'],
  constipation: ['constipated'],
  diarrhea: ['diarrhea', 'loose stools'],
  falls: ['falling', 'fell', 'fall'],
  sedation: ['drowsy', 'sleepy', 'tired'],
  tremor: ['shaky hands', 'shaking', 'shakes'],
  hypokalemia: ['low potassium'],
  hyperkalemia: ['high potassium'],
  polymyalgia: ['pmr'],
  myalgia: ['muscle pain', 'muscle aches', 'sore muscles'],
  gout: ['gout', 'uric acid'],
};

export function effectTerms(id: string, name: string, plain: string): string {
  const words = [id.replace(/_/g, ' '), name, plain, ...(EFFECT_SYNONYMS[id] ?? [])];
  return [
    ...new Set(
      words
        .map((w) =>
          w
            .toLowerCase()
            .replace(/[^a-z0-9 ]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .filter(Boolean),
    ),
  ].join(' | ');
}
