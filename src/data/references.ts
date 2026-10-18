// Literature and reference sources used to label evidence in the knowledge graph.
// Every documented cascade pattern points at one or more of these ids.

export interface Reference {
  id: string;
  short: string;
  citation: string;
  url?: string;
}

export const REFERENCES: Reference[] = [
  {
    id: 'thinkcascades',
    short: 'ThinkCascades, Drugs Aging 2022',
    citation:
      'McCarthy LM, et al. ThinkCascades: A Tool for Identifying Clinically Important Prescribing Cascades Affecting Older People. Drugs Aging. 2022;39(10):829-840.',
    url: 'https://doi.org/10.1007/s40266-022-00964-9',
  },
  {
    id: 'doherty2025',
    short: 'Doherty et al., Ann Fam Med 2025',
    citation:
      'Doherty AS, Lund LC, Moriarty F, et al. Prescribing Cascades Among Older Community-Dwelling Adults: Application of Prescription Sequence Symmetry Analysis to a National Database in Ireland. Ann Fam Med. 2025;23(4):315-324.',
    url: 'https://doi.org/10.1370/afm.240383',
  },
  {
    id: 'savage2020',
    short: 'Savage et al., JAMA Intern Med 2020',
    citation:
      'Savage RD, et al. Evaluation of a Common Prescribing Cascade of Calcium Channel Blockers and Diuretics in Older Adults With Hypertension. JAMA Intern Med. 2020;180(5):643-651.',
  },
  {
    id: 'gill2005',
    short: 'Gill et al., Arch Intern Med 2005',
    citation: 'Gill SS, et al. A prescribing cascade involving cholinesterase inhibitors and anticholinergic drugs. Arch Intern Med. 2005;165(7):808-813.',
  },
  {
    id: 'avorn1995',
    short: 'Avorn et al., JAMA 1995',
    citation: 'Avorn J, et al. Increased incidence of levodopa therapy following metoclopramide use. JAMA. 1995;274(22):1780-1782.',
  },
  {
    id: 'gurwitz1994',
    short: 'Gurwitz et al., JAMA 1994',
    citation: 'Gurwitz JH, et al. Initiation of antihypertensive treatment during nonsteroidal anti-inflammatory drug therapy. JAMA. 1994;272(10):781-786.',
  },
  {
    id: 'vegter2010',
    short: 'Vegter & de Jong-van den Berg, Br J Clin Pharmacol 2010',
    citation:
      'Vegter S, de Jong-van den Berg LTW. Misdiagnosis and mistreatment of a common side-effect: angiotensin-converting enzyme inhibitor-induced cough. Br J Clin Pharmacol. 2010;69(2):200-203.',
  },
  {
    id: 'read2021',
    short: 'Read et al., J Am Geriatr Soc 2021',
    citation:
      'Read SH, et al. Evidence of a gabapentinoid and diuretic prescribing cascade among older adults with lower back pain. J Am Geriatr Soc. 2021;69(10):2842-2850.',
  },
  {
    id: 'rochon1997',
    short: 'Rochon & Gurwitz, BMJ 1997',
    citation: 'Rochon PA, Gurwitz JH. Optimising drug treatment for elderly people: the prescribing cascade. BMJ. 1997;315(7115):1096-1099.',
  },
  {
    id: 'rochon2017',
    short: 'Rochon & Gurwitz, Lancet 2017',
    citation: 'Rochon PA, Gurwitz JH. The prescribing cascade revisited. Lancet. 2017;389(10081):1778-1780.',
  },
  {
    id: 'beers2023',
    short: 'AGS Beers Criteria 2023',
    citation:
      'American Geriatrics Society Beers Criteria Update Expert Panel. American Geriatrics Society 2023 updated AGS Beers Criteria for potentially inappropriate medication use in older adults. J Am Geriatr Soc. 2023;71(7):2052-2081.',
  },
  {
    id: 'acb',
    short: 'Anticholinergic Cognitive Burden scale',
    citation:
      'Boustani M, et al. Impact of anticholinergics on the aging brain: a review and practical application. Aging Health. 2008;4(3):311-320 (ACB scale, with later updates).',
  },
  {
    id: 'hallas1996',
    short: 'Hallas, Epidemiology 1996 (PSSA)',
    citation:
      'Hallas J. Evidence of depression provoked by cardiovascular medication: a prescription sequence symmetry analysis. Epidemiology. 1996;7(5):478-484.',
  },
  {
    id: 'lapi2013',
    short: 'Lapi et al., BMJ 2013 (triple whammy)',
    citation:
      'Lapi F, et al. Concurrent use of diuretics, angiotensin converting enzyme inhibitors, and angiotensin receptor blockers with non-steroidal anti-inflammatory drugs and risk of acute kidney injury: nested case-control study. BMJ. 2013;346:e8525.',
  },
  {
    id: 'label',
    short: 'Product labelling',
    citation:
      'Product monographs and prescribing information (adverse reaction sections), curated by hand for this prototype. Frequencies are approximate bands, not exact rates.',
  },
];

// Null-prototype lookup: an id like "constructor" never resolves to an inherited property.
export const REF: Readonly<Record<string, Reference | undefined>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, Reference | undefined>, Object.fromEntries(REFERENCES.map((r) => [r.id, r]))),
);
