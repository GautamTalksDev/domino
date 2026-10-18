'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, ExternalLink, Hand, Loader2, Plug, RotateCcw, Search, ShieldAlert, ShieldCheck, Signature } from 'lucide-react';
import { withUnlock } from '@/lib/client';
import { toast } from '@/lib/toast';
import { dayToShort, TODAY_DAY } from '@/data/time';
import type { CdsCard } from '@/lib/cds';

// A deliberately plain, fictional EHR order-entry screen that talks to Domino exactly the way a real EHR would: over
// CDS Hooks, with the same JSON. It is light-themed on purpose, so it reads as another application with Domino's
// card arriving inside it.

export interface EhrPatient {
  id: string;
  name: string;
  age: number;
  sex: 'F' | 'M';
  meds: { name: string; dose: string; start: number }[];
  /** Not a Domino patient: everything Domino knows comes from the request's prefetch. */
  outside?: boolean;
}

export interface CdsStats {
  recent: {
    at: number;
    hook: string;
    drugName: string;
    verdict: string;
    indicator: string;
    summary: string;
    outcome: string | null;
    reason: string | null;
    client: string | null;
    patient: string | null;
    pid: string | null;
  }[];
  total: number;
  held: number;
  overridden: number;
  flagged: number;
}

interface Exchange {
  id: number;
  label: string;
  path: string;
  status: number;
  ms: number;
  request: unknown;
  response: unknown;
}

interface Draft {
  id: string;
  drug: string;
  name: string;
  dose: string;
}

type Phase = 'idle' | 'selected' | 'signing' | 'interrupted' | 'signed' | 'held';

const OUTSIDE: EhrPatient = {
  id: 'ehr-demo-4471',
  name: 'Outside patient (not in Domino)',
  age: 82,
  sex: 'F',
  outside: true,
  meds: [
    { name: 'Norvasc (amlodipine)', dose: '10 mg once daily', start: TODAY_DAY - 113 },
    { name: 'Atorvastatin', dose: '40 mg at night', start: TODAY_DAY - 1365 },
    { name: 'Metformin', dose: '500 mg twice daily', start: TODAY_DAY - 1700 },
  ],
};

const OUTSIDE_CONDITIONS = ['Essential hypertension', 'Type 2 diabetes mellitus'];

const SUGGESTED: Record<string, { drug: string; label: string }> = {
  'p-rosa': { drug: 'benztropine', label: 'Benztropine' },
  'p-beatrice': { drug: 'meclizine', label: 'Meclizine' },
  'p-dorothy': { drug: 'dextromethorphan', label: 'Dextromethorphan' },
  'p-frank': { drug: 'oxycodone', label: 'Oxycodone' },
  'p-walter': { drug: 'oxybutynin', label: 'Oxybutynin' },
  'ehr-demo-4471': { drug: 'furosemide', label: 'Furosemide' },
};

const rid = () => Math.random().toString(36).slice(2, 10);

/** An EHR speaks in real dates: a day in Domino's calendar, as the real date the same number of days before today. */
const realISO = (day: number) => new Date(Date.now() - (TODAY_DAY - day) * 86_400_000).toISOString().slice(0, 10);

function prefetchFor(p: EhrPatient) {
  return {
    patient: { resourceType: 'Patient', id: p.id, gender: p.sex === 'M' ? 'male' : 'female', birthDate: `${2026 - p.age}-01-01` },
    medications: {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: p.meds.map((m, i) => ({
        resource: {
          resourceType: 'MedicationRequest',
          id: `active-${i + 1}`,
          status: 'active',
          intent: 'order',
          subject: { reference: `Patient/${p.id}` },
          authoredOn: realISO(m.start),
          medicationCodeableConcept: { text: `${m.name} ${m.dose}` },
        },
      })),
    },
    conditions: {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: OUTSIDE_CONDITIONS.map((c, i) => ({
        resource: { resourceType: 'Condition', id: `cond-${i + 1}`, subject: { reference: `Patient/${p.id}` }, code: { text: c } },
      })),
    },
  };
}

function draftResource(p: EhrPatient, d: Draft) {
  return {
    resourceType: 'MedicationRequest',
    id: d.id,
    status: 'draft',
    intent: 'order',
    subject: { reference: `Patient/${p.id}` },
    authoredOn: realISO(TODAY_DAY),
    medicationCodeableConcept: { text: `${d.name} ${d.dose}`.trim() },
  };
}

/** Pretty JSON with quiet syntax colour; React escapes every piece. */
function JsonView({ value, label }: { value: unknown; label: string }) {
  const text = JSON.stringify(value, null, 2) ?? '';
  const parts = text.split(/("(?:\\.|[^"\\])*"(?:\s*:)?|\b-?\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g);
  return (
    <pre tabIndex={0} aria-label={label} className="mono max-h-[420px] overflow-auto whitespace-pre-wrap break-words p-4 text-[11.5px] leading-[1.6] text-bone-2 outline-none focus-visible:ring-1 focus-visible:ring-vermilion/50">
      {parts.map((s, i) =>
        i % 2 === 0 ? (
          s
        ) : /:$/.test(s) ? (
          <span key={i} className="text-iris">
            {s}
          </span>
        ) : s.startsWith('"') ? (
          <span key={i} className="text-[#e8dcc4]">
            {s}
          </span>
        ) : (
          <span key={i} className="text-amber">
            {s}
          </span>
        ),
      )}
    </pre>
  );
}

/** The small markdown CDS detail uses: paragraphs, "- " bullets, indented *italic* follow-ups, **bold**. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') ? (
          <strong key={i} className="font-semibold">
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith('*') && p.length > 2 ? (
          <em key={i}>{p.slice(1, -1)}</em>
        ) : (
          p
        ),
      )}
    </>
  );
}

function CardDetail({ text }: { text: string }) {
  type Block = { kind: 'p' | 'q' | 'ul'; text?: string; items?: string[] };
  const blocks: Block[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('- ')) {
      const last = blocks.at(-1);
      if (last?.kind === 'ul') last.items!.push(line.slice(2));
      else blocks.push({ kind: 'ul', items: [line.slice(2)] });
    } else if (/^\*[^*].*\*$/.test(line)) blocks.push({ kind: 'q', text: line.slice(1, -1) });
    else blocks.push({ kind: 'p', text: line });
  }
  const lastP = blocks.map((b) => b.kind).lastIndexOf('p');
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-[#2a2730]">
      {blocks.map((b, i) =>
        b.kind === 'ul' ? (
          <ul key={i} className="space-y-1 pl-4">
            {b.items!.map((t, j) => (
              <li key={j} className="list-disc marker:text-[#8a8478]">
                <Inline text={t} />
              </li>
            ))}
          </ul>
        ) : b.kind === 'q' ? (
          <p key={i} className="border-l-2 border-[#d9d2c3] pl-3 italic text-[#3b3741]">
            {b.text}
          </p>
        ) : (
          <p key={i} className={i === lastP && i > 0 ? 'text-[12px] text-[#5d5866]' : ''}>
            <Inline text={b.text!} />
          </p>
        ),
      )}
    </div>
  );
}

const INDICATOR = {
  critical: { bar: 'bg-[#c2410c]', label: 'Critical', text: 'text-[#9a3412]', chip: 'border-[#c2410c]/40 bg-[#fff1ea]' },
  warning: { bar: 'bg-[#b45309]', label: 'Warning', text: 'text-[#92400e]', chip: 'border-[#b45309]/40 bg-[#fff6e5]' },
  info: { bar: 'bg-[#1d4ed8]', label: 'Info', text: 'text-[#1e3a8a]', chip: 'border-[#1d4ed8]/30 bg-[#eef3ff]' },
} as const;

function CdsCardView({
  card,
  hook,
  onAccept,
  busy,
}: {
  card: CdsCard;
  hook: 'order-select' | 'order-sign';
  onAccept?: (card: CdsCard, suggestion: string) => void;
  busy?: boolean;
}) {
  const ind = INDICATOR[card.indicator];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="relative overflow-hidden rounded-xl border border-[#d9d2c3] bg-white shadow-[0_10px_30px_-18px_rgba(30,20,10,0.45)]"
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${ind.bar}`} aria-hidden />
      <div className="py-3.5 pl-5 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${ind.text} ${ind.chip}`}>{ind.label}</span>
          <span className="mono text-[10.5px] text-[#6b6573]">{hook}</span>
        </div>
        <p className="mt-2 text-[14px] font-semibold leading-snug text-[#17151a]">{card.summary}</p>
        <div className="mt-2">
          <CardDetail text={card.detail} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {onAccept &&
            card.suggestions?.map((s) => (
              <button
                key={s.uuid}
                onClick={() => onAccept(card, s.uuid)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#17151a] px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-[#2c2930] disabled:opacity-50"
              >
                <Hand size={13} /> {s.label}
              </button>
            ))}
          {card.links?.map((l) => (
            <a key={l.url} href={l.url} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#1d4ed8] underline-offset-2 hover:underline">
              {l.label} <ExternalLink size={12} />
            </a>
          ))}
        </div>
        <p className="mt-3 border-t border-[#ece6da] pt-2 text-[11px] text-[#6b6573]">
          Source: <span className="font-medium text-[#3b3741]">{card.source.label}</span> · {card.source.topic.display}
        </p>
      </div>
    </motion.div>
  );
}

const fmtVerdict = (v: string) => (v === 'stop_and_check' ? 'stop and check' : v === 'caution' ? 'caution' : v);

export function EhrDemo({ patients, drugs, stats, discoveryUrl }: { patients: EhrPatient[]; drugs: { id: string; name: string; cls: string }[]; stats: CdsStats; discoveryUrl: string }) {
  const router = useRouter();
  const all = useMemo(() => [...patients, OUTSIDE], [patients]);
  const [pid, setPid] = useState(all.find((p) => p.id === 'p-rosa')?.id ?? all[0]?.id ?? OUTSIDE.id);
  const patient = all.find((p) => p.id === pid) ?? OUTSIDE;
  const [query, setQuery] = useState('');
  const [dose, setDose] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [selectCards, setSelectCards] = useState<CdsCard[]>([]);
  const [signCards, setSignCards] = useState<CdsCard[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'select' | 'sign' | 'feedback' | null>(null);
  const [wire, setWire] = useState<Exchange[]>([]);
  const [view, setView] = useState<{ id: number; tab: 'request' | 'response' } | null>(null);
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  // Every change of patient or order starts a new generation; a response from an older one is dropped, so a late answer
  // about one patient never lands on another.
  const gen = useRef(0);
  const pauseTitle = useRef<HTMLParagraphElement>(null);
  const newOrder = useRef<HTMLButtonElement>(null);
  const signBtn = useRef<HTMLButtonElement>(null);
  // When the order is signed or held, the button that was pressed is gone: keep focus on the next thing to do.
  useEffect(() => {
    if (phase === 'signed' || phase === 'held') newOrder.current?.focus({ preventScroll: true });
  }, [phase]);

  const matches = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s || draft?.name.toLowerCase() === s) return [];
    return drugs.filter((d) => d.name.toLowerCase().includes(s) || d.cls.toLowerCase().includes(s)).slice(0, 7);
  }, [query, drugs, draft]);

  const call = useCallback(async (label: string, path: string, body: unknown) => {
    const t0 = performance.now();
    const res = await withUnlock(() =>
      fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-domino-client': 'demo' }, body: JSON.stringify(body) }),
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const ex: Exchange = { id: ++seq.current, label, path, status: res.status, ms: Math.round(performance.now() - t0), request: body, response: json };
    setWire((w) => [ex, ...w].slice(0, 12));
    setView({ id: ex.id, tab: 'response' });
    if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `Request failed (${res.status})`);
    return json;
  }, []);

  const hookBody = useCallback(
    (hook: 'order-select' | 'order-sign', d: Draft, p: EhrPatient) => ({
      hook,
      hookInstance: crypto.randomUUID(),
      context: {
        userId: 'Practitioner/demo-prescriber',
        patientId: p.id,
        ...(hook === 'order-select' ? { selections: [`MedicationRequest/${d.id}`] } : {}),
        draftOrders: { resourceType: 'Bundle', type: 'collection', entry: [{ resource: draftResource(p, d) }] },
      },
      ...(p.outside ? { prefetch: prefetchFor(p) } : {}),
    }),
    [],
  );

  const reset = () => {
    gen.current++;
    setDraft(null);
    setQuery('');
    setDose('');
    setPhase('idle');
    setSelectCards([]);
    setSignCards([]);
    setReason('');
  };

  const choose = async (d: { id: string; name: string }, p = patient) => {
    const g = ++gen.current;
    const next: Draft = { id: `draft-${rid()}`, drug: d.id, name: d.name, dose: dose.trim() };
    setDraft(next);
    setQuery(d.name);
    setPhase('selected');
    setSignCards([]);
    setSelectCards([]);
    setBusy('select');
    try {
      const r = await call('order-select', '/cds-services/domino-order-select', hookBody('order-select', next, p));
      if (g === gen.current) setSelectCards((r.cards as CdsCard[]) ?? []);
    } catch (e) {
      if (g === gen.current) toast({ tone: 'error', title: 'Domino did not answer', body: e instanceof Error ? e.message : 'Request failed' });
    } finally {
      setBusy(null);
      // The search box was disabled while Domino answered: the next step is signing.
      if (g === gen.current) setTimeout(() => signBtn.current?.focus({ preventScroll: true }), 30);
    }
    return next;
  };

  const sign = async (d = draft, p = patient) => {
    if (!d) return;
    const g = gen.current;
    setBusy('sign');
    setPhase('signing');
    try {
      const r = await call('order-sign', '/cds-services/domino-order-sign', hookBody('order-sign', { ...d, dose: dose.trim() || d.dose }, p));
      if (g !== gen.current) return;
      const all = (r.cards as CdsCard[]) ?? [];
      const stopping = all.filter((c) => c.indicator !== 'info');
      setSignCards(all);
      setPhase(stopping.length ? 'interrupted' : 'signed');
      if (stopping.length) setTimeout(() => pauseTitle.current?.focus(), 80);
      else
        toast({
          tone: 'ok',
          title: 'Order signed',
          body: `${d.name} for ${p.outside ? 'the outside patient' : p.name}. ${all.length ? 'Domino added a note for the prescriber, below.' : 'Domino had nothing to stop it.'}`,
        });
      router.refresh();
    } catch (e) {
      if (g !== gen.current) return;
      setPhase('selected');
      toast({ tone: 'error', title: 'Domino did not answer', body: e instanceof Error ? e.message : 'Request failed' });
    } finally {
      setBusy(null);
    }
  };

  /** Accept one card's suggestion (hold the order), or override every card that paused the signature, with one reason. */
  const feedback = async (outcome: 'accepted' | 'overridden', accepted?: { card: CdsCard; suggestion: string }) => {
    setBusy('feedback');
    try {
      const at = new Date().toISOString();
      const items =
        outcome === 'accepted' && accepted
          ? [{ card: accepted.card.uuid, outcome, acceptedSuggestions: [{ id: accepted.suggestion }], outcomeTimestamp: at }]
          : interruption.map((c) => {
              const why = c.overrideReasons?.find((o) => o.code === reason);
              return { card: c.uuid, outcome, ...(why ? { overrideReason: { reason: why } } : {}), outcomeTimestamp: at };
            });
      const r = await call('feedback', '/cds-services/domino-order-sign/feedback', { feedback: items });
      const recorded = Number(r.recorded ?? 0) > 0;
      const why = interruption[0]?.overrideReasons?.find((o) => o.code === reason);
      if (outcome === 'accepted') {
        setPhase('held');
        toast({
          tone: recorded ? 'learn' : 'info',
          title: 'Order held',
          body: recorded
            ? 'The draft order was removed (the card’s delete action), and Domino recorded that a cascade was stopped at order entry.'
            : 'The draft order was removed. Domino had already recorded an answer for this card, so nothing new was stored.',
        });
      } else {
        setPhase('signed');
        toast({ tone: 'info', title: 'Signed with an override', body: recorded ? `Domino recorded the reason: ${why?.display ?? 'none given'}.` : 'Signed. Domino had already recorded an answer for this card.' });
      }
      router.refresh();
    } catch (e) {
      toast({ tone: 'error', title: 'Feedback not recorded', body: e instanceof Error ? e.message : 'Request failed' });
    } finally {
      setBusy(null);
    }
  };

  // The guided tour's action: pick the patient with a story here, choose the drug that would extend it, and sign.
  useEffect(() => {
    const onExample = async () => {
      if (busy) return;
      const p = all.find((x) => x.id === 'p-rosa') ?? OUTSIDE;
      const s = SUGGESTED[p.id];
      setPid(p.id);
      const d = drugs.find((x) => x.id === s?.drug);
      if (!d) return;
      const next = await choose(d, p);
      await sign(next, p);
    };
    window.addEventListener('domino:ehr-example', onExample);
    return () => window.removeEventListener('domino:ehr-example', onExample);
  });

  const interruption = signCards.filter((c) => c.indicator !== 'info');
  const notes = signCards.filter((c) => c.indicator === 'info');
  const shown = view ? wire.find((w) => w.id === view.id) : wire[0];
  const suggestion = SUGGESTED[patient.id];

  return (
    <div className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]" data-tour="ehr">
      {/* The fictional EHR */}
      <section aria-label="Demo EHR order entry" className="overflow-hidden rounded-2xl border border-white/10 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]">
        <div className="flex items-center justify-between gap-3 bg-[#e6e0d3] px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="flex gap-1.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-[#d4cbbb]" />
              <span className="size-2.5 rounded-full bg-[#d4cbbb]" />
              <span className="size-2.5 rounded-full bg-[#d4cbbb]" />
            </span>
            <p className="text-[12.5px] font-semibold text-[#2a2730]">Demo EHR · Medication order entry</p>
          </div>
          <p className="hidden text-[11px] text-[#5d5866] sm:block">Fictional EHR · speaks CDS Hooks 2.0 to Domino</p>
        </div>
        <div className="bg-[#f7f4ee] text-[#1c1a1f]">
          <div className="border-b border-[#e0d9cb] bg-[#efeadf] px-5 py-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <label htmlFor="ehr-patient" className="text-[10.5px] font-semibold uppercase tracking-wider text-[#5d5866]">
                  Patient
                </label>
                <select
                  id="ehr-patient"
                  value={pid}
                  disabled={busy !== null}
                  onChange={(e) => {
                    setPid(e.target.value);
                    reset();
                  }}
                  className="mt-1 block w-full max-w-[340px] rounded-lg border border-[#cfc7b8] bg-white px-2.5 py-1.5 text-[14px] font-semibold text-[#17151a] outline-none focus:border-[#1d4ed8]"
                >
                  {all.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.outside ? p.name : `${p.name}, ${p.age}`}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[12px] text-[#4a4550]">
                {patient.age} y · {patient.sex === 'F' ? 'female' : 'male'} ·{' '}
                {patient.outside ? <span>sent to Domino as FHIR prefetch, no name</span> : <span className="mono">{patient.id}</span>}
              </p>
            </div>
            <div className="mt-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#5d5866]">Active medications ({patient.meds.length})</p>
              <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
                {patient.meds.map((m) => (
                  <li key={m.name} className="flex items-baseline justify-between gap-3 border-b border-dashed border-[#ddd5c6] pb-1">
                    <span className="truncate">
                      <span className="font-medium">{m.name}</span> <span className="text-[#5d5866]">{m.dose}</span>
                    </span>
                    <span className="mono shrink-0 text-[11px] text-[#5d5866]">since {dayToShort(m.start)}</span>
                  </li>
                ))}
              </ul>
              {patient.outside && <p className="mt-2 text-[11.5px] text-[#5d5866]">Problems: {OUTSIDE_CONDITIONS.join(', ')}</p>}
            </div>
          </div>

          <div className="px-5 py-5">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#5d5866]">New medication order</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_170px]">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6b6573]" aria-hidden />
                <label htmlFor="ehr-drug" className="sr-only">
                  Medication
                </label>
                <input
                  id="ehr-drug"
                  role="combobox"
                  aria-expanded={matches.length > 0}
                  aria-controls="ehr-drug-list"
                  aria-autocomplete="list"
                  aria-activedescendant={matches[active] ? `ehr-opt-${matches[active].id}` : undefined}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                    if (draft && e.target.value !== draft.name) {
                      gen.current++;
                      setDraft(null);
                      setPhase('idle');
                      setSelectCards([]);
                      setSignCards([]);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!matches.length) return;
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      choose(matches[active] ?? matches[0]);
                    } else if (e.key === 'Escape') setQuery('');
                  }}
                  placeholder="Search medications"
                  autoComplete="off"
                  disabled={phase === 'interrupted' || busy !== null}
                  className="w-full rounded-lg border border-[#cfc7b8] bg-white py-2 pl-8 pr-3 text-[14px] text-[#17151a] outline-none placeholder:text-[#6b6573] focus:border-[#1d4ed8] disabled:opacity-60"
                />
                {matches.length > 0 && (
                  <ul
                    id="ehr-drug-list"
                    className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-[#cfc7b8] bg-white shadow-lg"
                    role="listbox"
                    aria-label="Medications"
                  >
                    {matches.map((d, i) => (
                      <li
                        key={d.id}
                        id={`ehr-opt-${d.id}`}
                        role="option"
                        aria-selected={i === active}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(d)}
                        className={`flex cursor-pointer items-center justify-between px-3 py-2 text-[13.5px] text-[#17151a] ${i === active ? 'bg-[#efe8da]' : ''}`}
                      >
                        <span>{d.name}</span>
                        <span className="text-[11.5px] text-[#5d5866]">{d.cls}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <label htmlFor="ehr-dose" className="sr-only">
                  Dose and frequency
                </label>
                <input
                  id="ehr-dose"
                  value={dose}
                  onChange={(e) => setDose(e.target.value)}
                  placeholder="Dose, e.g. 1 mg twice daily"
                  disabled={phase === 'interrupted' || busy !== null}
                  className="w-full rounded-lg border border-[#cfc7b8] bg-white px-3 py-2 text-[14px] text-[#17151a] outline-none placeholder:text-[#6b6573] focus:border-[#1d4ed8] disabled:opacity-60"
                />
              </div>
            </div>
            {!draft && suggestion && (
              <p className="mt-2.5 text-[12px] text-[#4a4550]">
                Try{' '}
                <button
                  onClick={() => {
                    const d = drugs.find((x) => x.id === suggestion.drug);
                    if (d) choose(d);
                  }}
                  className="font-semibold text-[#1d4ed8] underline-offset-2 hover:underline"
                >
                  {suggestion.label}
                </button>{' '}
                for this patient.
              </p>
            )}

            <AnimatePresence initial={false}>
              {draft && (
                <motion.div key={draft.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="mt-4 rounded-xl border border-[#ddd5c6] bg-white px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#5d5866]">Draft order · {draft.id}</p>
                        <p className={`mt-0.5 text-[15px] font-semibold ${phase === 'held' ? 'text-[#6b6573] line-through' : 'text-[#17151a]'}`}>
                          {draft.name} <span className="font-normal text-[#4a4550]">{dose || 'dose to be set'}</span>
                        </p>
                      </div>
                      {phase === 'signed' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#e7f5ec] px-3 py-1.5 text-[12.5px] font-semibold text-[#14532d]">
                          <Check size={14} /> Signed
                        </span>
                      ) : phase === 'held' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#efeadf] px-3 py-1.5 text-[12.5px] font-semibold text-[#3b3741]">
                          <Hand size={14} /> Held, not signed
                        </span>
                      ) : phase === 'interrupted' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#fff1dc] px-3 py-1.5 text-[12.5px] font-semibold text-[#7c2d12]">
                          <ShieldAlert size={14} /> Paused for review
                        </span>
                      ) : (
                        <button
                          ref={signBtn}
                          onClick={() => sign()}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#1d4ed8] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50"
                        >
                          {busy === 'sign' ? <Loader2 size={14} className="animate-spin" /> : <Signature size={14} />} Sign order
                        </button>
                      )}
                    </div>
                    {busy === 'select' && (
                      <p className="mt-3 flex items-center gap-2 text-[12px] text-[#4a4550]">
                        <Loader2 size={13} className="animate-spin" /> order-select: asking Domino…
                      </p>
                    )}
                    {phase !== 'interrupted' && selectCards.length > 0 && phase !== 'held' && (
                      <div className="mt-3 space-y-2">
                        {selectCards.map((c) => (
                          <CdsCardView key={c.uuid} card={c} hook="order-select" />
                        ))}
                      </div>
                    )}
                    {phase === 'selected' && busy === null && selectCards.length === 0 && (
                      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[#14532d]">
                        <ShieldCheck size={13} /> order-select: Domino returned no cards for this order.
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {phase === 'interrupted' && interruption.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  role="alertdialog"
                  aria-labelledby="ehr-interrupt-title"
                  className="mt-4 rounded-2xl border-2 border-[#b45309]/50 bg-[#fffaf0] p-4"
                >
                  <p
                    id="ehr-interrupt-title"
                    ref={pauseTitle}
                    tabIndex={-1}
                    className="flex items-center gap-2 text-[13.5px] font-semibold text-[#7c2d12] outline-none"
                  >
                    <ShieldAlert size={16} /> Signing paused: a decision support service has a concern
                  </p>
                  <div className="mt-3 space-y-3">
                    {interruption.map((c) => (
                      <CdsCardView key={c.uuid} card={c} hook="order-sign" onAccept={(card, suggestion) => feedback('accepted', { card, suggestion })} busy={busy !== null} />
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-end gap-2.5 border-t border-[#ecdcbc] pt-3.5">
                    <div className="min-w-[240px] flex-1">
                      <label htmlFor="ehr-override" className="text-[10.5px] font-semibold uppercase tracking-wider text-[#5d5866]">
                        Or sign anyway, with a reason
                      </label>
                      <select
                        id="ehr-override"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-[#cfc7b8] bg-white px-2.5 py-1.5 text-[13px] text-[#17151a] outline-none focus:border-[#1d4ed8]"
                      >
                        <option value="">Choose an override reason</option>
                        {interruption[0].overrideReasons?.map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.display}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => feedback('overridden')}
                      disabled={!reason || busy !== null}
                      className="rounded-lg border border-[#8a8478] bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[#2a2730] transition hover:bg-[#f1ece2] disabled:opacity-50"
                    >
                      Sign anyway
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {phase === 'signed' && notes.length > 0 && (
              <div className="mt-4 space-y-2">
                {notes.map((c) => (
                  <CdsCardView key={c.uuid} card={c} hook="order-sign" />
                ))}
              </div>
            )}
            {(phase === 'signed' || phase === 'held') && (
              <button ref={newOrder} onClick={reset} className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#1d4ed8] hover:underline">
                <RotateCcw size={13} /> New order
              </button>
            )}
          </div>
        </div>
      </section>

      {/* What crossed the wire */}
      <div className="space-y-6">
        <section aria-label="CDS Hooks traffic" className="card overflow-hidden">
          <div className="flex items-center justify-between border-b hairline px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Plug size={15} className="text-vermilion-2" /> On the wire
            </p>
            <span className="mono text-[10.5px] text-mute">CDS Hooks 2.0 · JSON</span>
          </div>
          {wire.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-dim">Choose a medication in the EHR. The exact requests the EHR sends and Domino’s answers appear here.</p>
          ) : (
            <>
              <ul className="flex gap-1.5 overflow-x-auto border-b hairline px-3 py-2.5">
                {wire.map((w) => {
                  const on = shown?.id === w.id;
                  return (
                    <li key={w.id}>
                      <button
                        onClick={() => setView({ id: w.id, tab: view?.tab ?? 'response' })}
                        aria-pressed={on}
                        className={`mono flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[11px] transition ${
                          on ? 'border-vermilion/40 bg-vermilion/10 text-bone' : 'hairline text-dim hover:text-bone'
                        }`}
                      >
                        <span className={w.status < 300 ? 'text-sage' : 'text-vermilion-2'}>{w.status}</span> {w.label} <span className="text-mute">{w.ms} ms</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {shown && (
                <div>
                  <div className="flex items-center justify-between gap-3 px-4 pt-3">
                    <p className="mono truncate text-[11.5px] text-dim">
                      POST <span className="text-bone-2">{shown.path}</span>
                    </p>
                    <div className="flex rounded-lg border hairline p-0.5" role="group" aria-label="Show request or response">
                      {(['request', 'response'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setView({ id: shown.id, tab: t })}
                          aria-pressed={(view?.tab ?? 'response') === t}
                          className={`rounded-md px-2.5 py-0.5 text-[11.5px] capitalize transition ${(view?.tab ?? 'response') === t ? 'bg-white/10 text-bone' : 'text-dim hover:text-bone'}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <JsonView
                    value={(view?.tab ?? 'response') === 'request' ? shown.request : shown.response}
                    label={`${shown.label} ${(view?.tab ?? 'response') === 'request' ? 'request' : 'response'} JSON`}
                  />
                </div>
              )}
            </>
          )}
        </section>

        <section aria-label="Connect an EHR" className="card p-5">
          <p className="text-sm font-semibold">Connect a real EHR or the CDS Hooks sandbox</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
            Point any CDS client at Domino’s discovery endpoint. It lists two services, <span className="mono text-bone-2">domino-order-select</span> and{' '}
            <span className="mono text-bone-2">domino-order-sign</span>, with the prefetch they need.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="mono min-w-0 flex-1 truncate rounded-lg border hairline bg-black/30 px-3 py-2 text-[12px] text-bone-2">{discoveryUrl}</code>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(discoveryUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                } catch {
                  /* clipboard blocked: the URL is selectable */
                }
              }}
              className="btn btn-ghost px-3"
              aria-label="Copy the discovery URL"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <a href="/cds-services" target="_blank" rel="noreferrer" className="btn btn-ghost px-3" aria-label="Open the discovery document">
              <ExternalLink size={14} />
            </a>
          </div>
        </section>

        <section aria-label="Order-entry checks in this clinic" className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">Order-entry checks in this clinic</p>
            <p className="mono text-[11px] text-mute">cards shown at signing · CdsCard nodes</p>
          </div>
          <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[
              ['Cards', stats.total],
              ['Warnings', stats.flagged],
              ['Held', stats.held],
              ['Overridden', stats.overridden],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border hairline bg-white/[0.02] px-2 py-2.5">
                <dd className="font-display text-2xl font-semibold tabular-nums">{Number(v)}</dd>
                <dt className="text-[11px] text-dim">{k}</dt>
              </div>
            ))}
          </dl>
          {stats.recent.length > 0 && (
            <ul className="mt-4 divide-y divide-white/[0.06]">
              {stats.recent.map((r, i) => (
                <li key={`${r.at}-${r.drugName}-${i}`} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0 truncate text-bone-2">
                    <span className="font-medium text-bone">{r.drugName}</span> for{' '}
                    {r.pid ? (
                      <Link href={`/patients/${r.pid}`} className="hover:text-vermilion-2">
                        {r.patient}
                      </Link>
                    ) : (
                      'an outside patient'
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`chip ${r.indicator === 'info' ? '' : 'border-amber/40 text-amber'}`}>{fmtVerdict(r.verdict)}</span>
                    {r.outcome && <span className={`chip ${r.outcome === 'accepted' ? 'border-sage/40 text-sage' : 'text-dim'}`}>{r.outcome === 'accepted' ? 'held' : 'overridden'}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
