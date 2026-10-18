'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BadgeCheck,
  Brain,
  ChevronDown,
  CircleAlert,
  FileSignature,
  GitBranch,
  History,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Play,
  Send,
  ShieldAlert,
  Stethoscope,
} from 'lucide-react';
import { postJson, RequestError, streamPost } from '@/lib/client';
import type { QueryMap } from './Workspace';
import { msToLabel } from '@/data/time';

type Ev = Record<string, unknown> & { type: string };

export const AGENTS: Record<string, { name: string; icon: typeof GitBranch; color: string }> = {
  detective: { name: 'Detective', icon: GitBranch, color: 'text-vermilion' },
  pharmacist: { name: 'Pharmacist', icon: Stethoscope, color: 'text-amber' },
  scribe: { name: 'Scribe', icon: FileSignature, color: 'text-iris' },
  domino: { name: 'Domino', icon: MessageSquare, color: 'text-sky' },
  brain: { name: 'Care-team brain', icon: Brain, color: 'text-sage' },
};

export interface SourceRef {
  tool: string;
  queries: string[];
  summary: string;
  via?: string;
}

interface Step {
  id: string;
  agent: string;
  name: string;
  args: unknown;
  via?: string;
  result?: { ok: boolean; summary: string; ms: number; queries: { id: string; title: string; ms: number; rows: number }[] };
}

export type Item =
  | { kind: 'agent'; agent: string; status: string; text?: string }
  | { kind: 'thought'; agent: string; text: string }
  | { kind: 'question'; text: string; who?: string }
  | { kind: 'memory'; text: string }
  | { kind: 'step'; step: Step }
  | { kind: 'handoff'; from: string; to: string; verified: boolean; text: string }
  | { kind: 'finding'; label: string; tier: string; score: number }
  | { kind: 'task'; title: string; role: string; owner?: string; memory?: string }
  | { kind: 'note'; noteKind: string; text: string }
  | { kind: 'warning'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'answer'; text: string; sources?: SourceRef[] }
  | { kind: 'done'; summary: string; findings: number; tasks: number; notes: number; ms: number };

/** Turns a stream event into console items (shared by the patient console and the care-team chat). */

/** Model text arrives as markdown; the console shows plain text, so drop the markers ("### Handoff", **bold**, `code`). */
function plain(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1');
}

export function reduceEvent(
  prev: Item[],
  e: Ev,
  onMeta?: (m: { mode: string; model: string }) => void,
  onConversation?: (id: string, resumed: boolean, turns: number) => void,
): Item[] {
  const next = [...prev];
  switch (e.type) {
    case 'run':
      onMeta?.({ mode: String(e.mode), model: String(e.model) });
      break;
    case 'conversation':
      onConversation?.(String(e.id), !!e.resumed, Number(e.turns));
      if (e.resumed)
        next.splice(next.length - 1, 0, {
          kind: 'memory',
          text: `Continuing your conversation: ${Number(e.turns) / 2} earlier question${Number(e.turns) === 2 ? '' : 's'} remembered in the graph.`,
        });
      break;
    case 'agent':
      next.push({ kind: 'agent', agent: String(e.agent), status: String(e.status), text: e.text as string | undefined });
      break;
    case 'thought':
      next.push({ kind: 'thought', agent: String(e.agent), text: String(e.text) });
      break;
    case 'tool':
      next.push({ kind: 'step', step: { id: String(e.id), agent: String(e.agent), name: String(e.name), args: e.args, via: e.via as string | undefined } });
      break;
    case 'result': {
      const i = next.findLastIndex((x) => x.kind === 'step' && x.step.id === e.id && !x.step.result);
      if (i >= 0) {
        const s = (next[i] as { kind: 'step'; step: Step }).step;
        next[i] = {
          kind: 'step',
          step: {
            ...s,
            result: { ok: !!e.ok, summary: String(e.summary), ms: Number(e.ms), queries: (e.queries as NonNullable<Step['result']>['queries']) ?? [] },
          },
        };
      }
      break;
    }
    case 'handoff':
      next.push({ kind: 'handoff', from: String(e.from), to: String(e.to), verified: !!e.verified, text: String(e.text) });
      break;
    case 'finding':
      next.push({ kind: 'finding', label: String(e.label), tier: String(e.tier), score: Number(e.score) });
      break;
    case 'task':
      next.push({ kind: 'task', title: String(e.title), role: String(e.role), owner: e.owner as string | undefined, memory: e.memory as string | undefined });
      break;
    case 'note':
      next.push({ kind: 'note', noteKind: String(e.kind), text: String(e.text) });
      break;
    case 'warning':
      next.push({ kind: 'warning', text: String(e.text) });
      break;
    case 'error':
      next.push({ kind: 'error', text: String(e.message) });
      break;
    case 'answer':
      next.push({ kind: 'answer', text: String(e.text), sources: (e.sources as SourceRef[]) ?? [] });
      break;
    case 'done':
      next.push({ kind: 'done', summary: String(e.summary), findings: Number(e.findings), tasks: Number(e.tasks), notes: Number(e.notes), ms: Number(e.ms) });
      break;
  }
  return next;
}

/** Earlier messages, as console items. */
export function messagesToItems(messages: { role: string; text: string; sources: SourceRef[] }[]): Item[] {
  return messages.map((m) => (m.role === 'user' ? { kind: 'question' as const, text: m.text } : { kind: 'answer' as const, text: m.text, sources: m.sources }));
}

export function AgentConsole({
  patientId,
  patientName,
  agentLabel,
  queries,
  autorun,
  onFinished,
  userName,
  askHint,
  sandbox = false,
}: {
  patientId: string;
  patientName: string;
  askHint?: string;
  /** A check-up patient: its tasks never reach the clinic inbox. */
  sandbox?: boolean;
  agentLabel: string;
  queries: QueryMap;
  autorun: boolean;
  onFinished: () => void;
  userName: string;
}) {
  const [mode, setMode] = useState<'review' | 'ask'>('review');
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [meta, setMeta] = useState<{ mode: string; model: string } | null>(null);
  const [question, setQuestion] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [past, setPast] = useState<{ id: string; title: string; updatedAt: number; messages: number }[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const llm = !agentLabel.startsWith('Graph planner');

  const handle = (e: Ev) => setItems((prev) => reduceEvent(prev, e, setMeta, (id) => setConversationId(id)));

  const runReview = async () => {
    if (running) return;
    setMode('review');
    setItems([]);
    setRunning(true);
    try {
      // One review per patient at a time (a lease in the graph). If someone else's is running, say so and start this
      // one when theirs ends, rather than failing: on a shared demo two people often open the same patient.
      const until = Date.now() + 150_000;
      for (let told = false; ; ) {
        try {
          // A lease taken between the server's check and the run arrives as a stream event instead of a 409.
          let busy = '';
          await streamPost(`/api/patients/${patientId}/review`, { mode: 'auto' }, (e) => {
            if (e.type === 'error' && e.status === 409) busy = String(e.message);
            else handle(e as Ev);
          });
          if (busy) throw new RequestError(busy, 409);
          break;
        } catch (err) {
          if (!(err instanceof RequestError && err.status === 409) || Date.now() > until || !alive.current) throw err;
          if (!told) {
            handle({
              type: 'warning',
              text: `Someone else is running ${patientName}’s review right now. The graph holds one review per patient at a time, so this one starts when theirs ends.`,
            });
            told = true;
          }
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
      onFinished();
    } catch (err) {
      handle({ type: 'error', message: err instanceof Error ? err.message : 'The run failed.' });
    } finally {
      setRunning(false);
    }
  };

  const ask = async (q: string) => {
    if (running || q.trim().length < 3) return;
    // A new question continues the open conversation; switching from a review starts a fresh thread.
    const continuing = mode === 'ask' && !!conversationId;
    setMode('ask');
    setItems((prev) => [...(continuing ? prev : []), { kind: 'question', text: q, who: userName }]);
    setQuestion('');
    setRunning(true);
    try {
      await streamPost(
        `/api/patients/${patientId}/ask`,
        { question: q, conversationId: continuing ? conversationId : null },
        handle as (e: Record<string, unknown>) => void,
      );
    } catch (err) {
      handle({ type: 'error', message: err instanceof Error ? err.message : 'The question failed.' });
    } finally {
      setRunning(false);
    }
  };

  const newConversation = () => {
    setConversationId(null);
    setItems([]);
    setMode('ask');
    setPast(null);
  };

  const showPast = async () => {
    if (past) return setPast(null);
    const res = await fetch(`/api/patients/${patientId}/conversations`);
    if (res.ok) setPast((await res.json()).conversations);
  };

  const openPast = async (id: string) => {
    const res = await fetch(`/api/patients/${patientId}/conversations?id=${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const j = await res.json();
    setMode('ask');
    setConversationId(id);
    setItems([{ kind: 'memory', text: 'Loaded from the graph. Ask a follow-up to continue this conversation.' }, ...messagesToItems(j.messages)]);
    setPast(null);
  };

  useEffect(() => {
    if (autorun && !started.current) {
      // Mark as started only when the timer fires, so React Strict Mode's double effect still runs once.
      const t = setTimeout(() => {
        if (started.current) return;
        started.current = true;
        runReview();
      }, 900);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [items]);

  // The guided tour drives the console: ask a question, or run the review, sign a decision and run it again.
  const latest = useRef({ ask, runReview, patientId });
  latest.current = { ask, runReview, patientId };
  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      if (q) latest.current.ask(q);
    };
    const onTwice = async (e: Event) => {
      const d = (e as CustomEvent<{ from: string; to: string; verdict: string; reason: string }>).detail;
      if (!d) return;
      await latest.current.runReview();
      try {
        await postJson(`/api/patients/${latest.current.patientId}/decisions`, d);
      } catch {
        return;
      }
      await latest.current.runReview();
    };
    window.addEventListener('domino:ask', onAsk);
    window.addEventListener('domino:review-twice', onTwice);
    return () => {
      window.removeEventListener('domino:ask', onAsk);
      window.removeEventListener('domino:review-twice', onTwice);
    };
  }, []);

  return (
    <div data-tour="agents" className="card overflow-hidden">
      <div className="flex items-center justify-between border-b hairline px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Agent team</p>
          <p className="mono text-[11px] text-dim">
            {meta ? `${meta.mode === 'llm' ? meta.model : 'graph planner'}` : llm ? agentLabel : 'graph planner · no LLM key'}
          </p>
        </div>
        <button className="btn btn-hot" onClick={runReview} disabled={running}>
          {running && mode === 'review' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{' '}
          {running && mode === 'review' ? 'Reviewing' : 'Run review'}
        </button>
      </div>

      {mode === 'review' && items.length > 0 && <Stepper items={items} running={running} />}

      <div ref={scroller} className="max-h-[62vh] min-h-[280px] overflow-y-auto px-4 py-4" aria-live="polite">
        {items.length === 0 && (
          <div className="py-6 text-sm text-dim">
            <p>
              Run the Detective, Pharmacist and Scribe on {patientName.split(' ')[0]}’s record. Every step is a FalkorDB query you can open, and every action
              waits for a person to approve it.
            </p>
            <div className="mt-4 space-y-2">
              {(['detective', 'pharmacist', 'scribe'] as const).map((k) => {
                const A = AGENTS[k];
                return (
                  <div key={k} className="flex items-center gap-2">
                    <A.icon size={14} className={A.color} />
                    <span className="text-bone-2">{A.name}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs">Or ask a question below. Your conversations are kept in the graph, per person, so you can pick them up later.</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {items.map((it, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
              <Row item={it} queries={queries} sandbox={sandbox} />
            </motion.div>
          ))}
        </AnimatePresence>
        {running && (
          <div className="mt-2 flex items-center gap-2 text-xs text-dim">
            <Loader2 size={13} className="animate-spin" /> working
          </div>
        )}
      </div>

      {past && (
        <div className="border-t hairline px-3 py-2">
          <p className="kicker px-1">Your conversations about {patientName.split(' ')[0]}</p>
          <ul className="mt-1 max-h-48 overflow-y-auto">
            {past.length === 0 && <li className="px-1 py-2 text-xs text-dim">None yet.</li>}
            {past.map((c) => (
              <li key={c.id}>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-[12.5px] hover:bg-white/5"
                  onClick={() => openPast(c.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-bone-2">{c.title}</span>
                  <span className="mono shrink-0 text-[10.5px] text-dim">
                    {Math.round(c.messages / 2)} q · {msToLabel(c.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="flex gap-2 border-t hairline p-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <button
          type="button"
          className="btn btn-ghost px-2.5"
          onClick={showPast}
          aria-label="Your past conversations"
          aria-expanded={!!past}
          title="Your past conversations"
        >
          <History size={15} />
        </button>
        {mode === 'ask' && conversationId && (
          <button type="button" className="btn btn-ghost px-2.5" onClick={newConversation} aria-label="New conversation" title="New conversation">
            <MessageSquarePlus size={15} />
          </button>
        )}
        <label className="sr-only" htmlFor="ask">
          Ask Domino about this patient
        </label>
        <input
          id="ask"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder={
            mode === 'ask' && conversationId
              ? 'Ask a follow-up… e.g. what could replace it?'
              : `Ask about ${patientName.split(' ')[0]}… e.g. ${askHint ?? 'why furosemide?'}`
          }
          className="field min-w-0 flex-1 px-3 py-2 text-sm"
        />
        <button className="btn btn-ghost px-3" disabled={running || question.trim().length < 3} aria-label="Ask">
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}

function queriesLabel(sources: SourceRef[]) {
  const n = new Set(sources.flatMap((s) => s.queries)).size;
  return `${n} graph quer${n === 1 ? 'y' : 'ies'}`;
}

/** Detective → Pharmacist → Scribe, with where the run is now. */
function Stepper({ items, running }: { items: Item[]; running: boolean }) {
  const state = (agent: string) => {
    const done = items.some((i) => i.kind === 'agent' && i.agent === agent && i.status === 'done');
    const started = items.some((i) => i.kind === 'agent' && i.agent === agent && i.status === 'start');
    return done ? 'done' : started ? (running ? 'active' : 'stopped') : running ? 'waiting' : 'skipped';
  };
  const steps = (['detective', 'pharmacist', 'scribe'] as const).map((k) => ({ k, s: state(k), A: AGENTS[k] }));
  const tools = items.filter((i) => i.kind === 'step').length;
  const queries = items.reduce((n, i) => n + (i.kind === 'step' ? (i.step.result?.queries?.length ?? 0) : 0), 0);
  return (
    <div className="border-b hairline px-4 py-2.5">
      <div className="flex items-center gap-1.5">
        {steps.map(({ k, s, A }, idx) => (
          <div key={k} className="flex min-w-0 flex-1 items-center gap-1.5">
            <div
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] transition-colors ${
                s === 'active'
                  ? 'border-white/20 bg-white/[0.06] text-bone'
                  : s === 'done'
                    ? 'border-sage/25 bg-sage/[0.05] text-bone-2'
                    : s === 'skipped'
                      ? 'border-dashed border-white/10 text-mute'
                      : 'border-transparent text-mute'
              }`}
            >
              {s === 'done' ? (
                <BadgeCheck size={12} className="shrink-0 text-sage" />
              ) : s === 'active' ? (
                <Loader2 size={12} className={`shrink-0 animate-spin ${A.color}`} />
              ) : (
                <A.icon size={12} className="shrink-0" />
              )}
              <span className="truncate">{A.name}</span>
              {s === 'skipped' && <span className="ml-auto shrink-0 text-[10px] text-mute">not needed</span>}
            </div>
            {idx < 2 && <span className={`h-px w-2 shrink-0 ${s === 'done' ? 'bg-sage/50' : 'bg-white/10'}`} />}
          </div>
        ))}
      </div>
      <p className="mono mt-1.5 text-[10.5px] text-mute">
        {tools} tool call{tools === 1 ? '' : 's'} · {queries} graph quer{queries === 1 ? 'y' : 'ies'}
      </p>
    </div>
  );
}

export function Row({ item, queries, sandbox = false }: { item: Item; queries: QueryMap; sandbox?: boolean }) {
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case 'agent': {
      const A = AGENTS[item.agent] ?? AGENTS.domino;
      if (item.status === 'start')
        return (
          <div className="mb-2 mt-4 flex items-center gap-2 first:mt-0">
            <span className={`flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.06] ${A.color}`}>
              <A.icon size={13} />
            </span>
            <span className="text-sm font-semibold">{A.name}</span>
            <span className="h-px flex-1 bg-white/[0.06]" />
          </div>
        );
      return item.text ? <p className="mb-3 ml-8 whitespace-pre-line border-l-2 border-white/10 pl-3 text-[13px] leading-relaxed text-bone-2">{plain(item.text)}</p> : null;
    }
    case 'thought':
      return <p className="mb-2 ml-8 text-[13px] italic text-dim">{plain(item.text)}</p>;
    case 'question':
      return (
        <div className="mb-2 mt-3 flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.07] px-3 py-2 text-[13.5px] text-bone">{item.text}</p>
        </div>
      );
    case 'memory':
      return (
        <p className="mb-2 flex items-center gap-1.5 text-[11.5px] text-iris">
          <History size={12} /> {item.text}
        </p>
      );
    case 'step': {
      const s = item.step;
      const args = s.args && typeof s.args === 'object' && Object.keys(s.args as object).length ? JSON.stringify(s.args) : '';
      return (
        <div className="mb-2 ml-8 rounded-xl border hairline bg-white/[0.02]">
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
            {!s.result ? (
              <Loader2 size={13} className="shrink-0 animate-spin text-dim" />
            ) : s.result.ok ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sage" />
            ) : (
              <CircleAlert size={13} className="shrink-0 text-vermilion" />
            )}
            {s.via === 'mcp' && <span className="mono rounded bg-sky/15 px-1 text-[9.5px] uppercase text-sky">mcp</span>}
            <span className="mono text-[12px] text-bone">{s.name}</span>
            {args && <span className="mono truncate text-[11px] text-mute">{args}</span>}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {s.result && (
                <span className="mono text-[10.5px] text-dim">
                  {s.result.queries.length
                    ? `${s.result.queries.length} quer${s.result.queries.length === 1 ? 'y' : 'ies'} · `
                    : s.via === 'mcp'
                      ? 'tools/call · '
                      : 'cached · '}
                  {s.result.ms} ms
                </span>
              )}
              <ChevronDown size={13} className={`text-dim transition ${open ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {s.result && !open && (
            <div className="px-3 pb-2">
              <p className="line-clamp-2 text-[12px] leading-snug text-dim">{s.result.summary.split('\n')[0]}</p>
            </div>
          )}
          {s.result && open && (
            <div className="border-t hairline px-3 py-2">
              <pre tabIndex={0} className="mono max-h-56 overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-bone-2">
                {s.result.summary}
              </pre>
              {s.result.queries.map((q, i) => (
                <details key={i} className="mt-2">
                  <summary className="mono cursor-pointer text-[11px] text-sky">
                    {q.title} · {q.rows} rows · {q.ms} ms
                  </summary>
                  <pre tabIndex={0} className="mono mt-1 overflow-x-auto rounded-lg bg-black/40 p-2 text-[11px] leading-relaxed text-bone-2">
                    {queries[q.id]?.cypher}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      );
    }
    case 'handoff':
      return (
        <div
          className={`mb-2 ml-8 flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] ${item.verified ? 'border-sage/25 bg-sage/[0.05]' : 'border-vermilion/40 bg-vermilion/10'}`}
        >
          {item.verified ? (
            <BadgeCheck size={14} className="mt-0.5 shrink-0 text-sage" />
          ) : (
            <ShieldAlert size={14} className="mt-0.5 shrink-0 text-vermilion" />
          )}
          <span className="text-bone-2">
            Handoff {AGENTS[item.from]?.name} → {AGENTS[item.to]?.name} stored in FalkorDB, read back, signature {item.verified ? 'verified' : 'FAILED'}.
          </span>
        </div>
      );
    case 'finding':
      return (
        <div className="mb-1.5 ml-8 flex items-center gap-2 text-[12.5px]">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${item.tier === 'likely' ? 'bg-vermilion/15 text-vermilion-2' : 'bg-amber/15 text-amber'}`}
          >
            finding
          </span>
          <span className="text-bone-2">{item.label}</span>
          <span className="mono ml-auto text-[11px] text-dim">{item.score.toFixed(2)}</span>
        </div>
      );
    case 'task':
      return (
        <div className="mb-1.5 ml-8 rounded-xl border border-iris/25 bg-iris/[0.06] px-3 py-2 text-[12.5px]">
          <span className="mono mr-2 text-[10px] uppercase text-iris">task · {item.role} · proposed</span>
          <span className="text-bone">{item.title}</span>
          {item.owner && <span className="mt-1 block text-[11px] text-dim">Root drug prescribed by {item.owner}</span>}
          {item.memory && (
            <span className="mt-1.5 flex items-start gap-1.5 text-[11px] text-iris">
              <Brain size={12} className="mt-0.5 shrink-0" /> Procedural memory {item.memory}
            </span>
          )}
        </div>
      );
    case 'note':
      return (
        <details className="mb-1.5 ml-8 rounded-xl border hairline px-3 py-2 text-[12.5px]">
          <summary className="cursor-pointer text-bone-2">
            <span className="mono mr-2 text-[10px] uppercase text-iris">draft note</span>
            {item.noteKind === 'patient' ? 'For the patient and family' : 'For the prescriber (SBAR)'}
          </summary>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed text-bone-2">{plain(item.text)}</p>
        </details>
      );
    case 'warning':
      return <p className="mb-2 ml-8 rounded-lg bg-amber/10 px-3 py-2 text-[12px] text-amber">{item.text}</p>;
    case 'error':
      return <p className="mb-2 rounded-lg bg-vermilion/10 px-3 py-2 text-[12.5px] text-vermilion-2">{item.text}</p>;
    case 'answer':
      return (
        <div className="mb-2 mt-2 rounded-xl border border-sky/20 bg-sky/[0.05] p-3">
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-bone">{plain(item.text)}</p>
          {!!item.sources?.length && (
            <div className="mt-2.5 border-t border-sky/10 pt-2">
              <button
                className="mono flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-sky"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
              >
                Sources · {item.sources.length} tool call{item.sources.length === 1 ? '' : 's'} · {queriesLabel(item.sources)}
                <ChevronDown size={12} className={`transition ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <ol className="mt-2 space-y-1.5">
                  {item.sources.map((s, i) => (
                    <li key={i} className="text-[11.5px]">
                      <span className="mono text-bone-2">
                        [{i + 1}] {s.tool}
                      </span>
                      {s.via === 'mcp' && <span className="mono ml-1 rounded bg-sky/15 px-1 text-[9.5px] uppercase text-sky">mcp</span>}
                      <span className="text-dim"> {s.summary}</span>
                      {s.queries.length > 0 && (
                        <span className="mono block text-[10.5px] text-mute">{s.queries.map((q) => queries[q]?.title ?? q).join(' · ')}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      );
    case 'done':
      return (
        <div className="mt-4 rounded-xl border border-sage/30 bg-sage/[0.06] p-3">
          <p className="text-sm font-semibold text-sage">Review stored in the graph</p>
          <p className="mt-1 text-[13px] text-bone-2">{item.summary}</p>
          <p className="mono mt-2 text-[11px] text-dim">
            {item.findings} findings · {item.tasks} tasks proposed · {item.notes} notes drafted · {(item.ms / 1000).toFixed(1)} s
          </p>
          {sandbox ? (
            <p className="mt-3 text-[11.5px] text-dim">
              This is a check-up, so its tasks stay here and never reach the clinic’s inbox. Select a link on the left and open “How Domino got here”, or take
              the questions to a pharmacist.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/inbox" className="btn btn-ghost px-3 py-1.5 text-xs">
                Open the inbox <ArrowRight size={13} />
              </Link>
              <span className="self-center text-[11.5px] text-dim">or select a link on the left and open “How Domino got here”.</span>
            </div>
          )}
        </div>
      );
  }
}
