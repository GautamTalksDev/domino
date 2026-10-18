// Synthetic outcome history for procedural memory: decided review tasks from the months before the demo.
// It gives each clinic something to have learned from, so the agents visibly act differently per clinic.
// Like the rest of the data it is invented; the learning rule that reads it is real (src/lib/memory/procedures.ts).

export interface SeedOutcome {
  role: 'pharmacist' | 'prescriber';
  status: 'approved' | 'done' | 'dismissed';
  note?: string;
}

export interface SeedScenario {
  pattern: string;
  outcomes: SeedOutcome[];
}

const repeat = (n: number, o: SeedOutcome): SeedOutcome[] => Array.from({ length: n }, () => ({ ...o }));

export const SEED_HISTORY: Record<string, SeedScenario[]> = {
  riverside: [
    {
      // Pharmacists kept passing these on: the fix is a blood-pressure decision, so prescribers act on them.
      pattern: 'ccb_edema_diuretic',
      outcomes: [
        { role: 'pharmacist', status: 'dismissed', note: 'Needs the prescriber who manages blood pressure.' },
        { role: 'pharmacist', status: 'dismissed', note: 'Passed to the family doctor: an antihypertensive change.' },
        { role: 'pharmacist', status: 'done', note: 'Discussed at the pharmacy visit.' },
        { role: 'pharmacist', status: 'dismissed', note: 'Prescriber decision, not a pharmacy one.' },
        { role: 'prescriber', status: 'done', note: 'Amlodipine dose lowered; swelling settled; furosemide stopped.' },
        { role: 'prescriber', status: 'approved' },
        { role: 'prescriber', status: 'done', note: 'Switched antihypertensive.' },
        { role: 'prescriber', status: 'approved' },
      ],
    },
    {
      // Most of these turned out to have another cause, so only likely links get a task.
      pattern: 'acei_cough_antitussive',
      outcomes: [
        { role: 'pharmacist', status: 'dismissed', note: 'Cough started with a cold.' },
        { role: 'pharmacist', status: 'dismissed', note: 'Asthma flare, not the ACE inhibitor.' },
        { role: 'pharmacist', status: 'dismissed', note: 'Cough predates the ACE inhibitor.' },
        { role: 'pharmacist', status: 'done', note: 'Switched to an ARB; cough resolved.' },
        { role: 'pharmacist', status: 'dismissed', note: 'Reflux-related cough.' },
      ],
    },
    {
      // One decision away from a change: three of four dismissed so far. Dismiss one more NSAID blood-pressure task in
      // the inbox and the fifth outcome tips the threshold rule (live procedural learning in the demo).
      pattern: 'nsaid_bp_antihypertensive',
      outcomes: [
        { role: 'pharmacist', status: 'done', note: 'NSAID swapped for paracetamol; blood pressure settled.' },
        { role: 'pharmacist', status: 'dismissed', note: 'Blood pressure was high before the NSAID.' },
        { role: 'pharmacist', status: 'dismissed', note: 'Short NSAID course, already finished.' },
        { role: 'pharmacist', status: 'dismissed', note: 'Long-standing hypertension, not NSAID-driven.' },
      ],
    },
  ],
  lakeview: [
    {
      // At this clinic the consultant pharmacist acts on CCB swelling cascades: no change to routing.
      pattern: 'ccb_edema_diuretic',
      outcomes: [
        ...repeat(4, { role: 'pharmacist', status: 'done', note: 'Recommendation accepted by the geriatrician.' }),
        { role: 'pharmacist', status: 'dismissed', note: 'Heart failure: diuretic needed.' },
      ],
    },
    {
      // Sleep-medication cascades need the prescriber of the antidepressant.
      pattern: 'ssri_insomnia_hypnotic',
      outcomes: [
        ...repeat(3, { role: 'pharmacist', status: 'dismissed', note: 'Needs the prescriber of the antidepressant.' }),
        ...repeat(3, { role: 'prescriber', status: 'done', note: 'Dose moved to the morning; hypnotic tapered.' }),
      ],
    },
  ],
};

// Notes people wrote: a protocol, a handover, a chat message. Domino links each one to the drugs, symptoms and
// patients it mentions (MENTIONS edges), so the care-team brain can find them and the agents see them in memory.
export interface SeedDoc {
  kind: 'protocol' | 'handover' | 'chat' | 'minutes';
  title: string;
  text: string;
  by: string;
  daysAgo: number;
}

export const SEED_DOCS: Record<string, SeedDoc[]> = {
  riverside: [
    {
      kind: 'protocol',
      title: 'Falls clinic: what to review before treating dizziness',
      text: 'Before adding meclizine or another vestibular sedative for dizziness in anyone over 70, review alpha blockers such as tamsulosin and doxazosin first, and check a lying and standing blood pressure for orthostatic hypotension. Vestibular sedatives add anticholinergic load and raise the risk of falls.',
      by: 'okafor',
      daysAgo: 120,
    },
    {
      kind: 'handover',
      title: 'Beatrice Hale, swollen ankles again',
      text: 'Beatrice Hale says her ankles are swollen again despite the Lasix, and the water pill has her rushing to the bathroom at night. She has started the Ditropan the walk-in clinic gave her. Worth asking whether the amlodipine is behind the swelling before anything else is added.',
      by: 'brandt',
      daysAgo: 9,
    },
    {
      kind: 'chat',
      title: 'Coughs on lisinopril this week',
      text: 'Two patients on lisinopril came in with a dry cough this week. One had a cold and the cough settled; the other had a cough that started a month after the lisinopril and is on dextromethorphan now. Flagging for the next review.',
      by: 'lee',
      daysAgo: 4,
    },
  ],
  lakeview: [
    {
      kind: 'protocol',
      title: 'Sleep medicines in the over-75s',
      text: 'Do not start zolpidem or zopiclone for insomnia that began after an SSRI. Ask the prescriber of the sertraline or escitalopram to move the dose to the morning first. Hypnotics raise the risk of falls and confusion.',
      by: 'ellis',
      daysAgo: 60,
    },
  ],
};
