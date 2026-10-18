import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PrescriberCheck } from '@/components/PrescriberCheck';
import { DRUGS, CLASS, EFFECTS } from '@/data/knowledge';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';
import { DbError, withDb } from '@/components/DbError';
import type { PatientRow } from '@/components/PatientTable';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Prescriber check' };

export default async function CheckPage({ searchParams }: { searchParams: Promise<{ patient?: string }> }) {
  const { patient } = await searchParams;
  // The patients come from this clinic's own graph: its story patients if it has them, otherwise the generated patients
  // the sweep found the strongest cascades in.
  const res = await withDb(() => run<PatientRow>(Q.patientList));
  if (!res.ok) return <DbError message={res.error} />;
  const stories = res.data.filter((r) => r.persona);
  const swept = res.data.filter((r) => Number(r.likely) > 0).sort((a, b) => Number(b.topScore) - Number(a.topScore));
  const pick = (stories.length ? stories : swept.length ? swept.slice(0, 12) : res.data.slice(0, 12)).map((p) => ({
    id: p.id,
    name: p.name,
    age: Number(p.age),
  }));
  // A patient opened from their own record (any patient in this clinic, a check-up included) leads the list. An id this
  // clinic's graph doesn't have is never swapped silently for someone else: the page says so and nothing is selected.
  let current: { id: string; name: string; age: number } | null = null;
  let unknown = false;
  if (patient) {
    const row = /^p-?[a-z0-9-]{2,40}$/.test(patient) ? (await run<{ id: string; name: string; age: number; sandbox: unknown }>(Q.patient, { pid: patient }))[0] : undefined;
    if (row?.id) current = { id: row.id, name: row.sandbox ? 'Your check-up' : row.name, age: Number(row.age) };
    else unknown = true;
  }
  const list = current ? [current, ...pick.filter((p) => p.id !== current.id)] : pick;
  const pid = current?.id ?? (unknown ? '' : stories.length ? 'p-rosa' : (list[0]?.id ?? ''));
  return (
    <div className="pt-10">
      <p className="kicker">Event-driven agent</p>
      <h1 className="font-display mt-3 text-5xl font-semibold">Before you prescribe</h1>
      <p className="mt-3 max-w-2xl text-bone-2">
        Type the drug you are about to add. Domino asks the graph whether it would treat a side effect of something the patient already takes, pile onto an
        existing problem, or complete a dangerous combination. Add it anyway, and the Detective re-runs on its own and proposes a review task.
      </p>
      {unknown && (
        <p className="mt-5 max-w-2xl rounded-2xl border border-amber/30 bg-amber/[0.06] px-4 py-3 text-sm text-bone-2">
          That patient isn’t in {'this clinic’s'} graph (each clinic is its own). Pick one below.
        </p>
      )}
      <PrescriberCheck
        initialPatient={pid}
        patients={list}
        examples={stories.length > 0}
        drugs={DRUGS.map((d) => ({ id: d.id, name: d.name, cls: CLASS[d.cls]?.name ?? d.cls }))}
        effects={EFFECTS.filter((e) => e.kind !== 'harm').map((e) => ({ id: e.id, name: e.name }))}
      />
      <Link href="/ehr" className="card card-hover mt-8 flex flex-wrap items-center justify-between gap-4 p-5">
        <span>
          <span className="kicker text-vermilion-2">CDS Hooks</span>
          <span className="font-display mt-1 block text-xl font-semibold">The same check, inside the prescriber’s EHR</span>
          <span className="mt-1 block max-w-2xl text-sm text-dim">
            Domino is also a CDS Hooks service: an EHR asks it as an order is chosen or signed, and gets standard cards back. Try it in a demo EHR.
          </span>
        </span>
        <ArrowRight size={18} className="text-vermilion-2" />
      </Link>
    </div>
  );
}
