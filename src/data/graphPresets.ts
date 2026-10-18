// The cascades the 3D graph on /graph can light up. Each path alternates drug, effect, drug…, and every step must be
// a real CAUSES or TREATED_BY edge in the knowledge graph (tests/knowledge.test.ts checks that).

export const GRAPH_PRESETS = [
  {
    id: 'beatrice',
    label: 'Beatrice: amlodipine → donepezil',
    path: ['amlodipine', 'peripheral_edema', 'furosemide', 'urinary_incontinence', 'oxybutynin', 'cognitive_impairment', 'donepezil'],
  },
  {
    id: 'rosa',
    label: 'Rosa: lorazepam → quetiapine',
    path: ['lorazepam', 'agitation', 'risperidone', 'parkinsonism', 'carbidopa_levodopa', 'hallucinations', 'quetiapine'],
  },
  {
    id: 'henry',
    label: 'Henry: naproxen → loperamide',
    path: ['naproxen', 'hypertension', 'hydrochlorothiazide', 'gout', 'colchicine', 'diarrhea', 'loperamide'],
  },
  { id: 'walter', label: 'Walter: tamsulosin → meclizine', path: ['tamsulosin', 'dizziness', 'meclizine'] },
];
