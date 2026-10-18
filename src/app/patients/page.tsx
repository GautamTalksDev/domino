import type { Metadata } from 'next';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { DbError, withDb } from '@/components/DbError';
import { PatientTable, type PatientRow } from '@/components/PatientTable';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Patients' };

export default async function PatientsPage() {
  const res = await withDb(() => run<PatientRow>(Q.patientList));
  if (!res.ok) return <DbError message={res.error} />;
  const rows = res.data;
  const reviewed = rows.filter((r) => r.reviewedAt).length;
  const withLikely = rows.filter((r) => Number(r.likely) > 0).length;
  const personas = rows.filter((r) => r.persona).length;
  return (
    <div className="pt-10">
      <p className="kicker">Synthetic cohort · {rows.length} older adults</p>
      <h1 className="font-display mt-3 text-5xl font-semibold">Patients</h1>
      <p className="mt-3 max-w-2xl text-bone-2">
        The population sweep agent reviewed {reviewed} patients and found a likely cascade in {withLikely}.{' '}
        {personas > 0
          ? `The ${personas === 6 ? 'six' : personas} demo patients at the top each tell a different story.`
          : 'This clinic has no hand-written demo patients: every record here was generated, so open any one with a likely cascade.'}
      </p>
      <PatientTable rows={rows} />
    </div>
  );
}
