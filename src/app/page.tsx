import Link from 'next/link';
import { GraphVsPlain } from '@/components/GraphVsPlain';
import { ArrowRight, BookOpenCheck, Brain, FileSignature, GitBranch, ShieldCheck, Stethoscope } from 'lucide-react';
import { PaletteHint } from '@/components/PaletteHint';
import { TourButton } from '@/components/TourButton';
import { TiltLink } from '@/components/TiltLink';
import { HeroStage } from '@/components/three/HeroStage';
import { Cypher } from '@/components/Cypher';
import { Q } from '@/lib/cypher';
import { TOOLS } from '@/lib/agent/tools';
import { PERSONAS } from '@/data/personas';
import evalResult from '@/data/generated/eval.json';
import { CLINICS, clinicById, currentScope } from '@/lib/tenant';

const TRACKS = [
  {
    n: 'Track 01',
    title: 'Agents that act on connected data',
    tone: 'text-vermilion-2',
    items: [
      { ask: 'Multi-hop reasoning', answer: 'Variable-length cascade paths, loops and harm chains', href: '/patients/p-beatrice' },
      { ask: 'Graph queries and algorithms as tools', answer: `${TOOLS.length} agent tools; betweenness centrality sets task priority`, href: '/how' },
      { ask: 'Tool selection through MCP', answer: 'Ask Domino and the care-team brain call their tools over MCP', href: '/patients/p-rosa' },
      {
        ask: 'Actions based on what the graph shows',
        answer: 'Routed tasks and notes, and a prescriber check that stops cascades, inside any EHR over CDS Hooks',
        href: '/ehr',
      },
      { ask: 'Explainable results', answer: 'A provenance graph behind every finding', href: '/patients/p-beatrice' },
    ],
  },
  {
    n: 'Track 02',
    title: 'Agent memory and coordination',
    tone: 'text-iris',
    items: [
      { ask: 'Episodic, semantic and procedural memory', answer: 'Runs and decisions, pattern feedback, procedures learned from outcomes', href: '/team' },
      { ask: 'Persistent conversation history', answer: 'Every question and answer is stored, per person, and resumable', href: '/patients/p-beatrice' },
      { ask: 'Shared state and handoffs', answer: 'Signed handoffs read back from the graph, linked to what they carry', href: '/how' },
      { ask: 'High-concurrency reads and writes', answer: 'Graph leases per patient, benchmarked with parallel agent runs', href: '/how' },
      { ask: 'Separate memory per user or tenant', answer: 'One FalkorDB graph per clinic; conversations per person', href: '/team' },
    ],
  },
  {
    n: 'Track 03',
    title: 'Care-team brain',
    tone: 'text-sage',
    items: [
      { ask: 'Docs, tickets and chats in one graph', answer: 'Team notes linked to what they name; one search by words, meaning (vector index) and the graph', href: '/team' },
      { ask: 'Who owns what, who knows what', answer: 'Prescribers behind every drug; who has decided on each cascade', href: '/team' },
      { ask: 'Tracing decisions back to their source', answer: 'Task → procedure → the decided tasks it learned from', href: '/team' },
      { ask: 'Keeping knowledge current', answer: '“What changed since the last review” on every run', href: '/patients/p-beatrice' },
      { ask: 'Answers with clear sources', answer: 'Every answer cites its tool calls and graph queries', href: '/team' },
    ],
  },
];

export default async function Home() {
  const here = clinicById((await currentScope()).clinic);
  const storyClinic = CLINICS.find((c) => c.personas);
  const away = here && storyClinic && here.id !== storyClinic.id ? { here, home: storyClinic } : null;
  const full = evalResult.variants.find((v) => v.id === 'full')!;
  const base = evalResult.variants.find((v) => v.id === 'graph')!;
  return (
    <div className="pt-10 sm:pt-16">
      {/* Hero */}
      <section className="relative">
        {/* A full-bleed band, so the glow is never cut off at the page gutter. */}
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[680px] w-screen -translate-x-1/2 overflow-hidden">
          <div className="absolute left-[max(-200px,calc(50%-880px))] top-0 h-[560px] w-[860px] max-w-[150vw] rounded-full bg-[radial-gradient(closest-side,rgba(255,91,58,0.13),transparent)] blur-2xl" />
        </div>
        <p className="kicker">Graph Hacks 2026 · Agents on connected data · Memory and coordination · Care-team brain</p>
        <div className="mt-5 grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-center">
          <h1 className="font-display text-[44px] font-semibold leading-[1.02] sm:text-[66px] lg:text-[80px]">
            Some pills are treating <span className="italic text-vermilion">other pills.</span>
          </h1>
          <div>
            <p className="text-lg leading-relaxed text-bone-2">
              A side effect gets mistaken for a new illness, so a second drug is prescribed to treat it. Then a third. Domino is a team of AI agents that walk a
              FalkorDB medication graph, find these <em>prescribing cascades</em> in older adults, prove every link, and hand a pharmacist the one question
              worth asking.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <TourButton />
              <Link href="/patients/p-beatrice?tour=1" className="btn btn-ghost">
                Watch Beatrice’s review <ArrowRight size={16} />
              </Link>
            </div>
            <Link href="/checkup" className="mt-4 inline-flex items-center gap-1.5 text-sm text-bone-2 underline-offset-4 transition-colors hover:text-bone hover:underline">
              Or paste your own medicine list <ArrowRight size={14} />
            </Link>
            <br />
            <PaletteHint />
          </div>
        </div>
        <div data-tour="hero" className="card card-glow dot-grid relative mt-10 grid gap-8 overflow-hidden p-6 sm:p-8 xl:grid-cols-[1fr_300px] xl:items-center">
          <div className="min-w-0">
            <p className="kicker">Beatrice, 84 · five prescribers · eighteen months</p>
            <div className="mt-4">
              <HeroStage />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 border-t hairline pt-6 xl:grid-cols-1 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
            <div>
              <div className="font-display text-3xl font-semibold">9 → 4</div>
              <div className="mt-1 text-xs text-dim">medicines, if amlodipine is reviewed</div>
            </div>
            <div>
              <div className="font-display text-3xl font-semibold">4 → 0</div>
              <div className="mt-1 text-xs text-dim">anticholinergic burden</div>
            </div>
            <div>
              <div className="font-display text-3xl font-semibold">5 → 1</div>
              <div className="mt-1 text-xs text-dim">drugs pushing her toward a fall</div>
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm text-mute">Synthetic patients only. Domino raises questions for clinicians; it never tells anyone to stop a medicine.</p>
      </section>

      {/* Evidence band */}
      <GraphVsPlain />

      <section className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { n: '9', t: 'clinically important cascades agreed by 38 clinicians in six countries', s: 'ThinkCascades, Drugs & Aging 2022' },
          {
            n: '1.93×',
            t: 'more likely: a diuretic started after a calcium channel blocker than before it',
            s: 'Ireland, 533,464 adults 65+, Ann Fam Med 2025',
          },
          {
            n: `${(full.precision / base.precision).toFixed(1)}×`,
            t: `the precision of raw graph links (${full.precision.toFixed(2)} vs ${base.precision.toFixed(2)}), at ${Math.round(full.recall * 100)}% recall, with zero deliberate pairs flagged`,
            s: `${evalResult.truthCascades} hidden cascades · ${evalResult.patients} synthetic patients`,
          },
          {
            n: `${evalResult.prevention.caught}`,
            t: `cascades stopped at the first downstream prescription when the record is replayed with Domino at the prescriber’s desk`,
            s: `${evalResult.prevention.prescriptionsAvoided} prescriptions spared · ${Math.round(evalResult.prevention.cascadeStopPpv * 100)}% of stops were real`,
          },
        ].map((x) => (
          <div key={x.t} className="card p-5">
            <div className="font-display num text-4xl font-semibold text-bone">{x.n}</div>
            <p className="mt-2 text-sm leading-snug text-bone-2">{x.t}</p>
            <p className="mono mt-3 text-[11px] text-mute">{x.s}</p>
          </div>
        ))}
      </section>

      {/* Agents */}
      <section className="mt-24">
        <p className="kicker">The agent team</p>
        <h2 className="font-display mt-3 max-w-3xl text-4xl font-semibold leading-tight">Three agents, one graph, and a human who approves every action.</h2>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {[
            {
              icon: GitBranch,
              name: 'Detective',
              color: 'text-vermilion',
              body: 'Walks the patient’s medication subgraph: multi-hop cascade paths, feedback loops, side-effect pile-ups, the triple whammy. Records findings in the graph.',
              tools: 'find_cascades · check_harms · recall_memory · record_findings',
            },
            {
              icon: Stethoscope,
              name: 'Pharmacist',
              color: 'text-amber',
              body: 'Checks each root: timing, other reasons, published evidence, population signal. Finds safer options that don’t clash with anything else she takes, and simulates the untangle.',
              tools: 'explain_link · find_safer_alternatives · simulate_untangle · population_signal',
            },
            {
              icon: FileSignature,
              name: 'Scribe',
              color: 'text-iris',
              body: 'Turns the evidence into review tasks for the pharmacist and prescriber, an SBAR note, and a plain-language note for the family. Everything waits for human approval.',
              tools: 'propose_task · draft_note',
            },
          ].map((a) => (
            <div key={a.name} className="card p-6">
              <a.icon className={a.color} size={22} />
              <h3 className="font-display mt-4 text-2xl font-semibold">{a.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-bone-2">{a.body}</p>
              <p className="mono mt-4 text-[11px] leading-relaxed text-dim">{a.tools}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-dim">
          Agents hand off through signed messages stored in FalkorDB and share one graph lease per patient. Clinician decisions become memory; what the team
          does with each task becomes a learned procedure; every question and answer is a conversation that person can pick up tomorrow; and every finding links
          back to the exact steps, queries and evidence behind it.
        </p>
      </section>

      {/* Why graph */}
      <section className="mt-24 grid gap-8 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <p className="kicker">Why it needs a graph</p>
          <h2 className="font-display mt-3 text-4xl font-semibold leading-tight">A prescribing cascade is a path.</h2>
          <p className="mt-4 leading-relaxed text-bone-2">
            Drug → side effect → drug → side effect → drug. In SQL that is a pile of self-joins that breaks at every extra hop. In FalkorDB it is one
            variable-length pattern, constrained to the patient’s own medicines, that returns every chain in milliseconds. The same graph answers the
            follow-ups: what else treats this diagnosis without that side effect, which drugs converge on a fall, which pairs complete a dangerous combination.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-bone-2">
            <li className="flex gap-2">
              <Brain size={16} className="mt-0.5 shrink-0 text-iris" /> Agents choose graph queries as tools; every answer carries the path it came from.
            </li>
            <li className="flex gap-2">
              <BookOpenCheck size={16} className="mt-0.5 shrink-0 text-sage" /> 27 documented patterns from ThinkCascades and published studies sit in the graph
              as nodes.
            </li>
            <li className="flex gap-2">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-sky" /> Read tools run as GRAPH.RO_QUERY, so the database itself refuses writes.
            </li>
          </ul>
        </div>
        <div>
          <Cypher code={Q.paths.cypher} />
          <div className="mt-3 rounded-xl border hairline bg-black/30 p-4">
            <p className="kicker">Returns for Beatrice · ~0.1 s</p>
            <ul className="mono mt-3 space-y-1.5 text-[12px] text-bone-2">
              <li>
                <span className="text-vermilion-2">amlodipine</span> → edema → <span className="text-vermilion-2">furosemide</span> → low potassium → potassium
              </li>
              <li>
                <span className="text-vermilion-2">amlodipine</span> → edema → furosemide → incontinence → <span className="text-vermilion-2">oxybutynin</span>{' '}
                → confusion → <span className="text-vermilion-2">donepezil</span>
              </li>
              <li className="text-mute">… 38 more paths, scored and pruned by timing, other reasons and evidence</li>
            </ul>
          </div>
        </div>
      </section>

      {/* FalkorDB features in use */}
      <section className="mt-16">
        <p className="kicker">What Domino asks of FalkorDB</p>
        <div className="mt-5 grid gap-px overflow-hidden rounded-2xl border hairline bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
          {[
            { k: 'Variable-length paths', v: 'Every cascade chain, up to four drugs long, inside one patient’s medicines' },
            { k: 'algo.betweenness', v: 'The drugs and effects most cascade routes pass through' },
            { k: 'allShortestPaths', v: 'How any drug reaches any harm, for the Pharmacist' },
            { k: 'Full-text indexes', v: 'Brand names with typos, and one search over everything the team wrote' },
            { k: 'A graph per clinic', v: 'Tenants kept apart at the database, chosen from the session' },
            { k: 'GRAPH.RO_QUERY', v: 'Read tools the database itself refuses to let write' },
            { k: 'Serialised writes', v: 'A lease check-and-set that two app instances cannot both win' },
            { k: 'Queries as nodes', v: 'Each step links to the exact Cypher it ran: provenance you can traverse' },
          ].map((f) => (
            <div key={f.k} className="bg-ink-2/90 p-5 transition-colors hover:bg-ink-3/90">
              <p className="mono text-[12px] text-vermilion-2">{f.k}</p>
              <p className="mt-1.5 text-sm leading-snug text-bone-2">{f.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tracks */}
      <section className="mt-24">
        <p className="kicker">What the organisers asked for, and where to see it</p>
        <h2 className="font-display mt-3 max-w-3xl text-4xl font-semibold leading-tight">
          An agent that acts on connected data, remembers what it learns, and shows how it got there.
        </h2>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {TRACKS.map((t) => (
            <div key={t.title} className="card p-6">
              <p className={`mono text-xs ${t.tone}`}>{t.n}</p>
              <h3 className="font-display mt-2 text-2xl font-semibold">{t.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {t.items.map((i) => (
                  <li key={i.ask} className="text-sm">
                    <span className="text-dim">{i.ask}</span>
                    <Link href={i.href} className="mt-0.5 flex items-start gap-1.5 text-bone-2 hover:text-bone">
                      <ArrowRight size={13} className={`mt-1 shrink-0 ${t.tone}`} /> {i.answer}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Tour */}
      <section className="mt-24">
        <p className="kicker">Three minutes, six clicks</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-display mt-3 text-4xl font-semibold">Try it like a judge</h2>
          <TourButton className="btn btn-ghost" label="Or let the tour drive" />
        </div>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              n: 1,
              href: '/patients/p-beatrice?tour=1',
              title: 'Watch the agents',
              body: 'Story mode: the team reviews Beatrice, then her chain untangles. Open “How Domino got here”.',
            },
            {
              n: 2,
              href: '/patients/p-beatrice',
              title: 'Replay the past',
              body: 'Timeline tab, “Play the replay”: Domino at the prescriber’s desk, back in 2024.',
            },
            { n: 3, href: '/ehr', title: 'Sign an order in an EHR', body: 'A fictional EHR calls Domino over CDS Hooks. Sign benztropine for Rosa and watch the card.' },
            { n: 4, href: '/team', title: 'Ask the care team', body: 'Who knows what, where prescribers hand off, what the agents learned.' },
            { n: 5, href: '/inbox', title: 'Teach it', body: 'Approve or dismiss tasks and watch a procedure change. Switch clinic to compare.' },
            { n: 6, href: '/evaluation', title: 'Check the numbers', body: 'Ablation of every graph signal and the prevention replay, re-runnable live.' },
          ].map((s) => (
            <li key={s.n}>
              <TiltLink href={s.href} className="card group flex h-full flex-col p-6">
                <span className="flex items-center justify-between">
                  <span className="mono text-xs text-vermilion-2">0{s.n}</span>
                  <ArrowRight size={16} className="text-mute transition duration-300 group-hover:translate-x-0.5 group-hover:text-bone" />
                </span>
                <span className="font-display mt-3 text-xl font-semibold">{s.title}</span>
                <span className="mt-1.5 text-sm leading-relaxed text-dim">{s.body}</span>
              </TiltLink>
            </li>
          ))}
        </ol>
      </section>

      {/* Patients */}
      <section className="mt-24">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="kicker">Try it</p>
            <h2 className="font-display mt-3 text-4xl font-semibold">Six patients, six stories</h2>
            {away && (
              <p className="mt-3 max-w-xl text-sm text-dim">
                These six live in {away.home.short}’s graph. You’re in {away.here.short}, which can’t see them; opening one offers to switch.
              </p>
            )}
          </div>
          <Link href="/patients" className="btn btn-ghost hidden sm:inline-flex">
            All patients <ArrowRight size={15} />
          </Link>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PERSONAS.map((p) => (
            <TiltLink key={p.id} href={`/patients/${p.id}`} className="card group flex flex-col p-6">
              <div className="flex items-center justify-between">
                <span className="font-display text-xl font-semibold">{p.name}</span>
                <span className="mono text-xs text-dim">
                  {p.age} · {p.meds.length} meds
                </span>
              </div>
              <p className="mt-3 text-[15px] leading-snug text-bone-2">{p.headline}</p>
              <span className="mt-auto inline-flex items-center gap-1 pt-5 text-sm text-vermilion-2 opacity-80 transition group-hover:opacity-100">
                Open review <ArrowRight size={14} className="transition duration-300 group-hover:translate-x-0.5" />
              </span>
            </TiltLink>
          ))}
        </div>
      </section>
    </div>
  );
}
