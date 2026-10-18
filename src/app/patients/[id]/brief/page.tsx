import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { analyzePatient, NotFoundError } from '@/lib/engine/analyze';
import { DbError } from '@/components/DbError';
import { PrintButton } from '@/components/PrintButton';
import { LogoMark } from '@/components/Logo';
import { REF } from '@/data/references';
import { EFFECT } from '@/data/knowledge';
import { dayToLabel, TODAY_DAY } from '@/data/time';
import { run } from '@/lib/db';
import { Q } from '@/lib/cypher';

export const dynamic = 'force-dynamic';
// The tab, and the file name when it is saved as a PDF: "Beatrice Hale, pharmacist brief · Domino".
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const [p] = /^p-?[a-z0-9-]{2,40}$/.test(id) ? await run<{ name: string; sandbox: unknown }>(Q.patient, { pid: id }) : [];
    return { title: p?.name && !p.sandbox ? `${p.name}, pharmacist brief` : 'Pharmacist brief' };
  } catch {
    return { title: 'Pharmacist brief' };
  }
}

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^p-?[a-z0-9-]{2,40}$/.test(id)) notFound();
  let a;
  try {
    a = await analyzePatient(id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    return <DbError message={err instanceof Error ? err.message : undefined} />;
  }
  const p = a.patient;
  const role = new Map<string, string>();
  for (const t of a.trees) {
    role.set(t.root, 'Root of a cascade');
    for (const d of t.downstream)
      role.set(d, t.untangle.unnecessary.find((u) => u.id === d)?.planned ? 'Planned companion' : 'Possibly treating a side effect');
  }
  const refs = new Set(a.trees.flatMap((t) => t.chains.flatMap((c) => c.links.flatMap((l) => l.patterns.flatMap((x) => x.refs)))));
  for (const c of a.combos) c.refs.forEach((r) => refs.add(r));

  return (
    <div className="print-page mx-auto max-w-[860px] pt-8">
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href={`/patients/${p.id}`} className="text-sm text-dim hover:text-bone">
          ← Back to the review
        </Link>
        <PrintButton />
      </div>
      <article className="card p-8 sm:p-10">
        <header className="flex items-start justify-between gap-6 border-b hairline pb-6">
          <div>
            <p className="kicker">Medication review brief · for the pharmacist</p>
            <h1 className="font-display mt-2 text-4xl font-semibold">{p.name}</h1>
            <p className="mt-1 text-bone-2">
              {p.age} · {p.sex === 'F' ? 'female' : 'male'} · {p.conditions.map((c) => c.name).join(', ')}
            </p>
          </div>
          <div className="text-right">
            <LogoMark size={40} className="ml-auto" />
            <p className="mono mt-2 text-[11px] text-dim">Prepared by Domino · {dayToLabel(TODAY_DAY)}</p>
          </div>
        </header>

        <section className="mt-6">
          <h2 className="kicker">Summary</h2>
          <p className="mt-2 text-lg leading-relaxed">
            {a.trees.length
              ? `${a.summary.likely} likely prescribing cascade link${a.summary.likely === 1 ? '' : 's'}. If ${a.trees[0].rootName} were reviewed, up to ${a.trees[0].untangle.unnecessary.length} downstream medicine${a.trees[0].untangle.unnecessary.length === 1 ? '' : 's'} might no longer be needed (${a.trees[0].untangle.pillsBefore} → ${a.trees[0].untangle.pillsAfter}).`
              : 'No likely prescribing cascades were found.'}
            {a.combos.length > 0 && ` Dangerous combination${a.combos.length > 1 ? 's' : ''}: ${a.combos.map((c) => c.title.toLowerCase()).join(', ')}.`}
            {a.acb.total >= 3 && ` Anticholinergic burden is ${a.acb.total}.`}
          </p>
        </section>

        {a.trees.map((t, i) => {
          const first = t.chains[0].links[0];
          const pat = first.patterns[0];
          return (
            <section key={t.root} className="mt-8 rounded-2xl border hairline p-5">
              <p className="kicker">Question {i + 1}</p>
              <h3 className="font-display mt-1 text-2xl font-semibold">{pat?.question ?? `Could ${first.effectPlain.toLowerCase()} be from ${t.rootName}?`}</h3>
              <ol className="mt-4 space-y-2">
                {t.chains
                  .flatMap((c) => c.links)
                  .filter((l, k, arr) => arr.findIndex((x) => x.key === l.key) === k)
                  .map((l) => (
                    <li key={l.key} className="text-sm">
                      <span className="font-medium">{l.fromName}</span> ({dayToLabel(l.fromStart)}) → {l.effectPlain.toLowerCase()} →{' '}
                      <span className="font-medium">{l.toName}</span> ({dayToLabel(l.toStart)}){' '}
                      <span className="mono text-xs text-dim">
                        · {l.tier} {l.score.toFixed(2)}
                        {l.patterns[0] ? ` · ${l.patterns[0].evidence}` : ' · graph-inferred'}
                      </span>
                    </li>
                  ))}
              </ol>
              <p className="mt-4 text-sm text-bone-2">
                <strong>If reviewed:</strong>{' '}
                {t.untangle.unnecessary.map((u) => `${u.name}${u.planned ? ' (planned companion)' : ''}`).join(', ') || 'no downstream change'}; medicines{' '}
                {t.untangle.pillsBefore} → {t.untangle.pillsAfter}; anticholinergic burden {t.untangle.acbBefore} → {t.untangle.acbAfter}; fall-risk drugs{' '}
                {t.untangle.fallDrugsBefore} → {t.untangle.fallDrugsAfter}.
              </p>
              {(t.untangle.rootTaper || t.untangle.unnecessary.some((u) => u.taper)) && (
                <div className="mt-3 rounded-lg border border-amber/30 bg-amber/[0.05] p-3 text-sm">
                  <p className="font-medium text-amber">Do not stop abruptly</p>
                  <ul className="mt-1 space-y-1 text-bone-2">
                    {t.untangle.rootTaper && (
                      <li>
                        <strong>{t.rootName}:</strong> {t.untangle.rootTaper}
                      </li>
                    )}
                    {t.untangle.unnecessary
                      .filter((u) => u.taper)
                      .map((u) => (
                        <li key={u.id}>
                          <strong>{u.name}:</strong> {u.taper}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}

        {a.combos.length > 0 && (
          <section className="mt-8">
            <h2 className="kicker">Combinations</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {a.combos.map((c) => (
                <li key={c.id}>
                  <strong>{c.title}</strong> ({c.drugs.join(' + ')}): {c.why}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8">
          <h2 className="kicker">Medicines</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs text-dim">
              <tr className="border-b hairline">
                <th className="py-2 font-medium">Medicine</th>
                <th className="py-2 font-medium">Started</th>
                <th className="hidden py-2 font-medium sm:table-cell">Charted for</th>
                <th className="py-2 font-medium">Domino</th>
              </tr>
            </thead>
            <tbody>
              {p.meds.map((m) => (
                <tr key={m.id} className="border-b hairline last:border-0 align-top">
                  <td className="py-2">
                    <span className="font-medium">{m.name}</span> <span className="text-dim">{m.dose}</span>
                    <div className="text-xs text-mute">{m.prescriber}</div>
                  </td>
                  <td className="py-2 text-bone-2">{dayToLabel(m.start)}</td>
                  <td className="hidden py-2 text-bone-2 sm:table-cell">{m.indication ? (EFFECT[m.indication]?.name ?? m.indication) : '—'}</td>
                  <td className="py-2 text-xs">
                    <span className={role.get(m.id)?.startsWith('Root') ? 'text-vermilion-2' : role.get(m.id) ? 'text-amber' : 'text-mute'}>
                      {role.get(m.id) ?? ''}
                    </span>
                    {m.acb > 0 && <div className="text-dim">ACB +{m.acb}</div>}
                    {m.beers && <div className="text-dim">Beers-listed</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {a.decisions.length > 0 && (
          <section className="mt-8">
            <h2 className="kicker">Care team decisions already on record</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {a.decisions.map((d) => (
                <li key={d.id}>
                  {d.from} → {d.to}: <strong>{d.verdict.replace('_', ' ')}</strong> ({d.by}, {dayToLabel(d.day)}): {d.reason}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8 border-t hairline pt-6">
          <h2 className="kicker">Evidence</h2>
          <ul className="mt-2 space-y-1 text-xs text-dim">{[...refs].map((r) => REF[r] && <li key={r}>{REF[r].citation}</li>)}</ul>
          <p className="mt-6 text-xs text-mute">
            Decision support only. Domino flags patterns in a synthetic record for a clinician to review; it does not diagnose, and it never recommends stopping
            or changing a medicine. Synthetic data; no real patient.
          </p>
        </section>
      </article>
    </div>
  );
}
