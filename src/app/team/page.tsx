import type { Metadata } from 'next';
import Link from 'next/link';
import { Brain, GitFork, Search, UsersRound } from 'lucide-react';
import { careTeam, learnedProcedures, whoKnows } from '@/lib/careteam';
import { QUERY_LIST } from '@/lib/cypher';
import { getProvider } from '@/lib/agent/providers';
import { currentClinic, currentUser } from '@/lib/tenant';
import { DbError } from '@/components/DbError';
import { FlowMap } from '@/components/team/FlowMap';
import { TeamChat } from '@/components/team/TeamChat';
import { MemorySearch } from '@/components/team/MemorySearch';
import { TeamNotes } from '@/components/team/TeamNotes';
import { msToLabel } from '@/data/time';

export const metadata: Metadata = { title: 'Care team' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = { family: 'Family doctor', walk_in: 'Walk-in clinic', specialist: 'Specialist' };
const KIND_DOT: Record<string, string> = { family: 'bg-sage', walk_in: 'bg-amber', specialist: 'bg-iris' };

export default async function TeamPage() {
  try {
    const [team, experts, procedures, user, clinic] = await Promise.all([careTeam(), whoKnows(), learnedProcedures(), currentUser(), currentClinic()]);
    const queries = Object.fromEntries(QUERY_LIST.map((q) => [q.id, { title: q.title, cypher: q.cypher, purpose: q.purpose }]));
    const kinds = Object.fromEntries(team.prescribers.map((p) => [p.name, p.kind]));
    const learned = procedures.filter((p) => p.procedure.key !== 'default');
    const decided = experts.reduce((s, e) => s + e.total, 0);
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    return (
      <div className="pt-10">
        <p className="kicker">Care-team brain · {clinic.name}</p>
        <h1 className="font-display mt-3 text-5xl font-semibold">What the whole team knows</h1>
        <p className="mt-3 max-w-3xl text-bone-2">
          Prescriptions, findings, review tasks, notes, signed decisions and conversations live in one FalkorDB graph per clinic. That makes the clinic
          queryable as a team: who prescribed what, where cascades cross from one prescriber to another, who has handled each kind of cascade, what the agents
          learned from the team, and one search over everything written down. Every answer below is a Cypher query; the chat cites them.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat value={team.totals.links} label="open cascade links" />
          <Stat value={pct(team.totals.crossingShare)} label="cross from one prescriber to another" tone="text-amber" />
          <Stat value={team.totals.addedByWalkIn} label="downstream drugs added at walk-in clinics" tone="text-vermilion" />
          <Stat value={decided} label="tasks and decisions by people" tone="text-sage" />
          <Stat value={learned.length} label="procedures learned from the team" tone="text-iris" />
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
          <section className="card p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <GitFork size={16} className="text-amber" />
              <h2 className="font-semibold">Where cascades cross prescribers</h2>
            </div>
            <p className="mt-1 text-sm text-dim">
              Each ribbon is a set of open cascade links: the first drug written by the prescriber on the left, the drug that treats its side effect added by
              the one on the right. Colour is the kind of prescriber who added it.
            </p>
            {/* Scrolls sideways on a phone instead of shrinking the prescriber names below reading size. */}
            <div className="scroll-row -mx-5 mt-4 overflow-x-auto px-5 sm:mx-0 sm:px-0">
              <div className="min-w-[620px]">
                <FlowMap flows={team.flows} kinds={kinds} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-dim">
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${KIND_DOT[k]}`} /> {v}
                </span>
              ))}
              <span className="ml-auto">{team.totals.links - team.totals.crossing} links stay with one prescriber</span>
            </div>
            <p className="mono mt-3 text-[11px] text-mute">
              Synthetic data: the generator assumes each patient has one family doctor and some drugs are added elsewhere.
            </p>
          </section>
          <TeamChat queries={queries} userName={user.name} clinicName={clinic.short} agentLabel={getProvider().label} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="card p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <UsersRound size={16} className="text-sage" />
              <h2 className="font-semibold">Who knows what</h2>
            </div>
            <p className="mt-1 text-sm text-dim">
              People who have decided on each kind of cascade: tasks they acted on or dismissed, and decisions they signed.
            </p>
            <ul className="mt-4 space-y-3">
              {experts.map((e) => (
                <li key={e.person} className="rounded-xl border hairline p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{e.person}</span>
                    <span className="mono text-xs text-dim">{e.total} decision{e.total === 1 ? '' : 's'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {e.patterns.map((p) => (
                      <span key={p.id} className="chip max-w-full whitespace-normal leading-snug" title={p.kinds.join(', ')}>
                        {p.title} · {p.n}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
              {experts.length === 0 && <li className="text-sm text-dim">No decisions yet.</li>}
            </ul>
          </section>

          <section className="card p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Brain size={16} className="text-iris" />
              <h2 className="font-semibold">What the agents learned here</h2>
            </div>
            <p className="mt-1 text-sm text-dim">
              Procedural memory. A decided task is an outcome; when the outcomes say a different routing works better, a new procedure version supersedes the
              old one and links to the tasks it learned from. Switch clinic to see different lessons.
            </p>
            <ul className="mt-4 space-y-3">
              {procedures.map((p) => (
                <li key={p.procedure.id} className={`rounded-xl border p-3 ${p.procedure.key === 'default' ? 'hairline' : 'border-iris/35 bg-iris/[0.05]'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.pattern ?? 'Default procedure'}</span>
                    <span className="chip">v{p.procedure.version}</span>
                    <span className="chip">to the {p.procedure.role}</span>
                    {p.procedure.minTier === 'likely' && <span className="chip">likely links only</span>}
                  </div>
                  <p className="mt-1.5 text-sm text-bone-2">{p.procedure.reason}</p>
                  {p.learnedFrom > 0 && (
                    <p className="mono mt-1 text-[11px] text-dim">
                      learned from {p.learnedFrom} decided tasks ({p.procedure.acted} acted on, {p.procedure.dismissed} dismissed) ·{' '}
                      {msToLabel(p.procedure.at)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-dim">
              Try it: approve or dismiss tasks in the{' '}
              <Link href="/inbox" className="link-u text-bone-2">
                inbox
              </Link>
              . Three outcomes for a role are enough to change routing.
            </p>
          </section>
        </div>

        <div className="mt-6">
          <TeamNotes userName={user.name} />
        </div>

        <section className="card mt-6 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-sky" />
            <h2 className="font-semibold">Search everything the team wrote down</h2>
          </div>
          <p className="mt-1 text-sm text-dim">
            Review tasks, drafted notes, team notes, signed decisions, findings and your own conversations, each tied back to its patient. Found by words
            (FalkorDB’s full-text index), by meaning (embeddings stored on the same nodes, in FalkorDB’s vector index) and through the graph, in one ranking.
          </p>
          <div className="mt-4">
            <MemorySearch />
          </div>
        </section>

        <section className="card mt-6 overflow-x-auto p-5 sm:p-6">
          <h2 className="font-semibold">Who owns what</h2>
          <p className="mt-1 text-sm text-dim">
            Every prescriber in this clinic’s graph, the patients they see, and how many cascade links start or end with a drug they wrote.
          </p>
          <table className="mt-4 w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-dim">
                <th className="pb-2 font-normal">Prescriber</th>
                <th className="pb-2 font-normal">Kind</th>
                <th className="pb-2 text-right font-normal">Patients</th>
                <th className="pb-2 text-right font-normal">Prescriptions</th>
                <th className="pb-2 text-right font-normal">Cascades started</th>
                <th className="pb-2 text-right font-normal">Downstream drugs added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {team.prescribers.map((p) => (
                <tr key={p.name}>
                  <td className="py-2 text-bone">{p.name}</td>
                  <td className="py-2">
                    <span className="flex items-center gap-1.5 text-bone-2">
                      <span className={`h-2 w-2 rounded-full ${KIND_DOT[p.kind]}`} /> {KIND_LABEL[p.kind]}
                    </span>
                  </td>
                  <td className="mono py-2 text-right">{p.patients}</td>
                  <td className="mono py-2 text-right">{p.prescriptions}</td>
                  <td className="mono py-2 text-right">{p.started}</td>
                  <td className="mono py-2 text-right">{p.added}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    );
  } catch (err) {
    return <DbError message={err instanceof Error ? err.message : undefined} />;
  }
}

function Stat({ value, label, tone = 'text-bone' }: { value: number | string; label: string; tone?: string }) {
  return (
    <div className="card p-4">
      <div className={`font-display text-3xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-dim">{label}</div>
    </div>
  );
}
