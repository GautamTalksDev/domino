'use client';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Brain, History, Loader2, MessageSquarePlus, Send } from 'lucide-react';
import { streamPost } from '@/lib/client';
import { messagesToItems, reduceEvent, Row, type Item } from '../workspace/AgentConsole';
import type { QueryMap } from '../workspace/Workspace';

const SUGGESTIONS = [
  'Who on the team knows calcium channel blocker swelling cascades?',
  'Where do cascades cross between prescribers?',
  'What have the agents learned from our decisions?',
  'Why were cough tasks dismissed?',
];

export function TeamChat({ queries, userName, clinicName, agentLabel }: { queries: QueryMap; userName: string; clinicName: string; agentLabel: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [question, setQuestion] = useState('');
  const [running, setRunning] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [past, setPast] = useState<{ id: string; title: string; updatedAt: number; messages: number }[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [items]);

  const ask = async (q: string) => {
    if (running || q.trim().length < 3) return;
    setItems((prev) => [...prev, { kind: 'question', text: q, who: userName }]);
    setQuestion('');
    setRunning(true);
    try {
      await streamPost('/api/team/ask', { question: q, conversationId }, (e) =>
        setItems((prev) => reduceEvent(prev, e as Record<string, unknown> & { type: string }, undefined, (id) => setConversationId(id))),
      );
    } catch (err) {
      setItems((prev) => [...prev, { kind: 'error', text: err instanceof Error ? err.message : 'The question failed.' }]);
    } finally {
      setRunning(false);
    }
  };

  const showPast = async () => {
    if (past) return setPast(null);
    const res = await fetch('/api/team/conversations');
    if (res.ok) setPast((await res.json()).conversations);
  };

  const openPast = async (id: string) => {
    const res = await fetch(`/api/team/conversations?id=${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const j = await res.json();
    setConversationId(id);
    setItems([{ kind: 'memory', text: 'Loaded from the graph. Ask a follow-up to continue.' }, ...messagesToItems(j.messages)]);
    setPast(null);
  };

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b hairline px-4 py-3">
        <Brain size={16} className="text-sage" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Ask the care-team brain</p>
          <p className="mono truncate text-[11px] text-dim">
            {agentLabel} · tools via MCP · {clinicName} only
          </p>
        </div>
      </div>
      <div ref={scroller} className="min-h-[300px] flex-1 overflow-y-auto px-4 py-4" aria-live="polite" style={{ maxHeight: 520 }}>
        {items.length === 0 && (
          <div className="text-sm text-dim">
            <p>
              Questions about the whole clinic: what the team decided and why, who has handled a kind of cascade, where prescribers hand off. Every answer cites
              the graph queries behind it, and your conversations are remembered.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="rounded-xl border hairline px-3 py-2 text-left text-[13px] text-bone-2 hover:border-white/20 hover:text-bone"
                  onClick={() => ask(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <AnimatePresence initial={false}>
          {items.map((it, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
              <Row item={it} queries={queries} />
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
          <p className="kicker px-1">Your conversations</p>
          <ul className="mt-1 max-h-48 overflow-y-auto">
            {past.length === 0 && <li className="px-1 py-2 text-xs text-dim">None yet.</li>}
            {past.map((c) => (
              <li key={c.id}>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-[12.5px] hover:bg-white/5"
                  onClick={() => openPast(c.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-bone-2">{c.title}</span>
                  <span className="mono shrink-0 text-[10.5px] text-dim">{Math.round(c.messages / 2)} q</span>
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
        <button type="button" className="btn btn-ghost px-2.5" onClick={showPast} aria-label="Your past conversations" aria-expanded={!!past}>
          <History size={15} />
        </button>
        {conversationId && (
          <button
            type="button"
            className="btn btn-ghost px-2.5"
            onClick={() => {
              setConversationId(null);
              setItems([]);
            }}
            aria-label="New conversation"
          >
            <MessageSquarePlus size={15} />
          </button>
        )}
        <label className="sr-only" htmlFor="team-ask">
          Ask the care-team brain
        </label>
        <input
          id="team-ask"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder={conversationId ? 'Ask a follow-up…' : 'Ask about the clinic…'}
          className="field min-w-0 flex-1 px-3 py-2 text-sm"
        />
        <button className="btn btn-ghost px-3" disabled={running || question.trim().length < 3} aria-label="Ask">
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
