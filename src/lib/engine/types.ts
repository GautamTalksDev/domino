export type Tier = 'likely' | 'possible' | 'unlikely' | 'intentional' | 'dismissed' | 'excluded';

export interface Med {
  id: string;
  name: string;
  cls: string;
  clsName: string;
  acb: number;
  beers: string | null;
  start: number;
  dose: string;
  prescriber: string;
  indication: string | null;
  /** Check-up only: the start date was assumed from the order of the pasted list. */
  assumedDate?: boolean | null;
}

export interface Condition {
  id: string;
  name: string;
  plain: string;
  since: number;
}

export interface PatientCore {
  id: string;
  name: string;
  age: number;
  sex: 'F' | 'M';
  persona: boolean;
  headline: string | null;
  story: string | null;
  /** A temporary check-up patient built from a pasted list; expires at expiresAt. */
  sandbox?: { expiresAt: number } | null;
  conditions: Condition[];
  meds: Med[];
}

export interface PatternInfo {
  id: string;
  title: string;
  evidence: 'consensus' | 'study' | 'label';
  refs: string[];
  intentional?: string;
  question: string;
  realWorld?: { asr: number; lo: number; hi: number; prevalence: number; note: string };
  realWorldNegative?: string;
}

export interface Factor {
  name: 'cause' | 'timing' | 'indication' | 'history' | 'pattern' | 'memory';
  value: number;
  note: string;
}

export interface DecisionRecord {
  id: string;
  from: string;
  to: string;
  verdict: 'intentional' | 'confirmed' | 'not_cascade';
  reason: string;
  by: string;
  day: number;
  at: number;
  verified: boolean;
}

export interface Link {
  key: string; // from>to
  from: string;
  fromName: string;
  to: string;
  toName: string;
  effect: string;
  effectName: string;
  effectPlain: string;
  freq: string;
  weight: number;
  onsetMin: number;
  onsetMax: number;
  fromStart: number;
  toStart: number;
  gap: number;
  toIndication: string | null;
  patterns: PatternInfo[];
  factors: Factor[];
  score: number;
  tier: Tier;
  headline: string;
  decision?: DecisionRecord;
}

export interface Chain {
  id: string;
  root: string;
  drugs: string[];
  links: Link[];
  score: number;
  tier: Tier;
}

export interface CascadeTree {
  root: string;
  rootName: string;
  chains: Chain[];
  downstream: string[];
  score: number;
  tier: Tier;
  untangle: UntangleResult;
  contributors: { root: string; rootName: string; to: string; toName: string; effect: string; score: number }[];
}

export interface Loop {
  id: string;
  drugs: string[];
  steps: { from: string; fromName: string; effect: string; effectName: string; to: string; toName: string }[];
}

export interface Pileup {
  id: string;
  name: string;
  plain: string;
  kind: string;
  drugs: { id: string; name: string; freq: string }[];
}

export interface HarmPath {
  harm: string;
  harmName: string;
  drugs: { id: string; name: string; via: string[] }[];
}

export interface ComboHit {
  id: string;
  title: string;
  why: string;
  harm: string;
  refs: string[];
  drugs: string[];
}

export interface UntangleResult {
  removed: string;
  removedName: string;
  unnecessary: { id: string; name: string; via: string; planned: boolean; taper: string | null }[];
  /** Deprescribing safety for the root itself, if its class needs a gradual taper or specialist input. */
  rootTaper: string | null;
  pillsBefore: number;
  pillsAfter: number;
  acbBefore: number;
  acbAfter: number;
  fallDrugsBefore: number;
  fallDrugsAfter: number;
  combosResolved: string[];
  alsoContributing: { from: string; fromName: string; to: string; toName: string; effect: string; score: number }[];
}

export interface Analysis {
  patient: PatientCore;
  links: Link[];
  chains: Chain[];
  trees: CascadeTree[];
  loops: Loop[];
  pileups: Pileup[];
  harms: HarmPath[];
  combos: ComboHit[];
  acb: { total: number; drugs: { id: string; name: string; acb: number }[] };
  beers: { id: string; name: string; note: string }[];
  decisions: DecisionRecord[];
  memoryWarnings: string[];
  summary: {
    likely: number;
    possible: number;
    intentional: number;
    topScore: number;
    /** Where the main cascade starts (the first link of the tree that would untangle the most), as "Amlodipine → Furosemide". */
    topLink: string | null;
    /** That link's own score. */
    topLinkScore: number | null;
    avoidable: number;
    medCount: number;
  };
  queries: { id: string; title: string; ms: number; rows: number }[];
  ms: number;
}
