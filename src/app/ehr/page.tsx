import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { DRUGS, CLASS } from '@/data/knowledge';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { siteUrl } from '@/lib/siteUrl';
import { DbError, withDb } from '@/components/DbError';
import { EhrDemo, type EhrPatient, type CdsStats } from '@/components/EhrDemo';
import type { PatientRow } from '@/components/PatientTable';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Inside the EHR',
  description: 'Domino as a CDS Hooks service: the prescribing-cascade check, answered inside any EHR at the moment an order is chosen or signed.',
};

export default async function EhrPage() {
  const res = await withDb(() => run<PatientRow>(Q.patientList));
  if (!res.ok) return <DbError message={res.error} />;
  const stories = res.data.filter((r) => r.persona);
  const swept = res.data.filter((r) => Number(r.likely) > 0).sort((a, b) => Number(b.topScore) - Number(a.topScore));
  const pick = (stories.length ? stories : swept.slice(0, 8)).slice(0, 8);
  const patients: EhrPatient[] = [];
  for (const p of pick) {
    const row = (
      await run<{ id: string; name: string; age: number; sex: string; meds: { id: string | null; name: string; start: number; dose: string }[] }>(Q.patient, {
        pid: p.id,
      })
    )[0];
    if (!row?.id) continue;
    patients.push({
      id: row.id,
      name: row.name,
      age: Number(row.age),
      sex: row.sex === 'M' ? 'M' : 'F',
      meds: row.meds.filter((m) => m.id).map((m) => ({ name: m.name, dose: m.dose, start: Number(m.start) })),
    });
  }
  const [stats] = await run<CdsStats>(Q.cdsRecent);
  const base = await siteUrl();
  return (
    <div className="pt-10">
      <p className="kicker">CDS Hooks 2.0 · order-select and order-sign</p>
      <h1 className="font-display mt-3 text-5xl font-semibold">Inside the EHR</h1>
      <p className="mt-3 max-w-3xl text-bone-2">
        Prescribers don’t open another app before they sign an order, so Domino goes where they already are. EHRs call outside services at the moment of
        prescribing through <span className="text-bone">CDS Hooks</span>, the HL7 standard behind order-entry alerts. Domino answers with the same graph
        check as the <Link href="/check" className="text-vermilion-2 underline-offset-4 hover:underline">prescriber check</Link>, as standard cards with a
        one-click way to hold the order, and the prescriber’s answer comes back into the care team’s memory.
      </p>
      <EhrDemo
        patients={patients}
        drugs={DRUGS.map((d) => ({ id: d.id, name: d.name, cls: CLASS[d.cls]?.name ?? d.cls }))}
        stats={stats ?? { recent: [], total: 0, held: 0, overridden: 0, flagged: 0 }}
        discoveryUrl={`${base}/cds-services`}
      />
      <section className="mt-14 grid gap-4 md:grid-cols-3">
        {[
          {
            t: 'Any patient, not just Domino’s',
            b: 'A patient Domino holds is checked against their record in the graph. Anyone else is checked from what the EHR shares (prefetch): their active medicines and conditions become a temporary check-up patient that expires in two hours. No name is kept.',
          },
          {
            t: 'Overrides become memory',
            b: 'The override reasons mirror Domino’s signed decisions: intentional, not a cascade, or going ahead and reviewing later. Every card and the prescriber’s answer is a CdsCard node linked to the patient, the drug ordered and the drug whose side effect it would treat.',
          },
          {
            t: 'Careful by design',
            b: 'Medicines are matched by name through FalkorDB’s full-text index, and only when the generic or brand name is really there: no card is better than a card about the wrong drug. Calls are rate-limited, stored cards are capped, and an EHR cannot name itself in the team’s feed.',
          },
        ].map((x) => (
          <div key={x.t} className="card p-5">
            <p className="font-display text-lg font-semibold">{x.t}</p>
            <p className="mt-2 text-sm leading-relaxed text-dim">{x.b}</p>
          </div>
        ))}
      </section>
      <p className="mt-8 text-sm text-dim">
        The protocol details, the graph model and the limits are in{' '}
        <Link href="/how#cds-hooks" className="inline-flex items-center gap-1 text-vermilion-2 underline-offset-4 hover:underline">
          How it works <ArrowRight size={13} />
        </Link>
      </p>
    </div>
  );
}
