import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { analyzePatient, NotFoundError } from '@/lib/engine/analyze';
import { run } from '@/lib/db';
import { Q, QUERY_LIST } from '@/lib/cypher';
import { DbError } from '@/components/DbError';
import { Workspace } from '@/components/workspace/Workspace';
import { getProvider } from '@/lib/agent/providers';
import { CLINICS, clinicById, currentScope, currentUser } from '@/lib/tenant';
import { PERSONAS } from '@/data/personas';
import { LogoMark } from '@/components/Logo';
import { SwitchClinic } from '@/components/SwitchClinic';
import Link from 'next/link';
import { learnedProcedures } from '@/lib/careteam';
import { patientDocs } from '@/lib/docs';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  // The tab reads "Beatrice Hale · Domino"; an unknown id (or another clinic's patient) just says "Review".
  try {
    const [p] = /^p-?[a-z0-9-]{2,40}$/.test(id) ? await run<{ name: string; sandbox: unknown }>(Q.patient, { pid: id }) : [];
    return { title: p?.name ? (p.sandbox ? 'Check-up' : p.name) : 'Review' };
  } catch {
    return { title: 'Review' };
  }
}

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autorun?: string; tour?: string }>;
}) {
  const { id } = await params;
  const { autorun, tour } = await searchParams;
  if (!/^p-?[a-z0-9-]{2,40}$/.test(id)) notFound();
  try {
    const [analysis, notes, mem, user, procedures, docs] = await Promise.all([
      analyzePatient(id),
      run(Q.notes, { pid: id }),
      run<{ runs: unknown[] }>(Q.memory, { pid: id }),
      currentUser(),
      learnedProcedures(),
      patientDocs(id),
    ]);
    const queries = Object.fromEntries(QUERY_LIST.map((q) => [q.id, { title: q.title, cypher: q.cypher, purpose: q.purpose }]));
    return (
      <Workspace
        initial={{
          analysis,
          notes: notes as never,
          runs: ((mem[0]?.runs ?? []) as never[]).filter(Boolean),
          procedures: procedures as never,
          docs: docs as never,
        }}
        queries={queries}
        agentLabel={getProvider().label}
        autorun={autorun === '1' || tour === '1'}
        tour={tour === '1'}
        user={{ name: user.name, title: user.title }}
      />
    );
  } catch (err) {
    if (err instanceof NotFoundError) {
      // A story patient opened from another clinic: each clinic is its own graph, so say where she lives instead of a bare 404.
      const persona = PERSONAS.find((p) => p.id === id);
      const here = clinicById((await currentScope()).clinic);
      const home = CLINICS.find((c) => c.personas);
      if (persona && here && home && here.id !== home.id) {
        return (
          <div className="mx-auto mt-20 max-w-xl text-center">
            <LogoMark size={52} className="mx-auto" />
            <p className="kicker mt-8">Each clinic is its own FalkorDB graph</p>
            <h1 className="font-display mt-3 text-4xl font-semibold leading-tight">{persona.name} is a {home.short} patient</h1>
            <p className="mt-4 leading-relaxed text-bone-2">
              You’re working in {here.name}. Its graph has no record of {persona.sex === 'M' ? 'him' : 'her'}, by design: a query can only see the graph it
              is sent to, and the graph comes from your session, never from the link you followed.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <SwitchClinic clinic={home.id} name={home.short} />
              <Link href="/patients" className="btn btn-ghost">
                {here.short}’s patients
              </Link>
            </div>
          </div>
        );
      }
      notFound();
    }
    return <DbError message={err instanceof Error ? err.message : undefined} />;
  }
}
