// Persistent conversation history. Every question and answer is a Message in the graph, inside a
// Conversation that belongs to one person and is about one patient (or the whole clinic). The next
// question in the same conversation sees the earlier turns, tomorrow as well as today, and nobody
// else's conversations are reachable: every read is scoped to the person in the session.

import { randomUUID } from 'node:crypto';
import { run } from '../db';
import { Q } from '../cypher';
import { cleanText } from '../agent/guard';

export interface ConversationSummary {
  id: string;
  title: string;
  at: number;
  updatedAt: number;
  messages: number;
}

export interface Source {
  tool: string;
  queries: string[];
  summary: string;
  via?: 'mcp';
}

export interface StoredMessage {
  i: number;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  sources: Source[];
  model: string | null;
}

/** How many earlier messages are sent back to the model (bounded context, OWASP LLM10). */
export const HISTORY_TURNS = 8;

export async function listConversations(about: string, user: string): Promise<ConversationSummary[]> {
  return run<ConversationSummary>(Q.conversations, { about, user });
}

export async function readConversation(about: string, user: string, cid: string): Promise<StoredMessage[]> {
  const rows = await run<{ i: number; role: 'user' | 'assistant'; text: string; at: number; sources: string | null; model: string | null }>(Q.conversation, {
    about,
    user,
    cid,
  });
  return rows.map((r) => ({ ...r, sources: parseSources(r.sources) }));
}

function parseSources(s: string | null): Source[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Returns the conversation to append to: the given one if it belongs to this person and subject, else a new one. */
export async function openConversation(
  about: string,
  user: { id: string; name: string },
  cid: string | null | undefined,
  firstQuestion: string,
): Promise<{ id: string; history: StoredMessage[]; resumed: boolean }> {
  if (cid) {
    const history = await readConversation(about, user.id, cid);
    if (history.length) return { id: cid, history, resumed: true };
  }
  const id = `c-${randomUUID()}`;
  await run(Q.startConversation, { about, id, user: user.id, userName: user.name, title: cleanText(firstQuestion, 80), at: Date.now() });
  return { id, history: [], resumed: false };
}

export async function remember(cid: string, user: string, startIndex: number, question: string, answer: string, sources: Source[], model: string) {
  const queries = [...new Set(sources.flatMap((s) => s.queries))];
  await run(Q.addMessages, {
    cid,
    user,
    at: Date.now(),
    rows: [
      { id: `m-${randomUUID()}`, i: startIndex, role: 'user', text: cleanText(question, 500), sources: null, model: null, queries: [] },
      {
        id: `m-${randomUUID()}`,
        i: startIndex + 1,
        role: 'assistant',
        text: cleanText(answer, 2500),
        sources: JSON.stringify(sources).slice(0, 6000),
        model,
        queries,
      },
    ],
  });
}
