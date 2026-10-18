import type { JsonSchema } from '../tools';

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  /** Provider-native content to replay verbatim (e.g. Gemini thought signatures). */
  raw?: unknown;
}

export interface ToolDecl {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  raw?: unknown;
  model: string;
}

export interface Provider {
  id: 'gemini' | 'openai' | 'anthropic';
  model: string;
  chat(system: string, messages: ChatMessage[], tools: ToolDecl[], signal?: AbortSignal): Promise<ChatResult>;
}

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

/** The person (or the server) cancelled: not a model failure, never retried, never a reason to pause the model. */
export class AbortedError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AbortedError';
  }
}

/** Per-call limit for a model request, unless the caller passes a shorter one. */
export const llmTimeoutMs = () => Number(process.env.LLM_TIMEOUT_MS || 45_000);

export async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal, timeoutMs?: number): Promise<unknown> {
  if (signal?.aborted) throw new AbortedError();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(1, timeoutMs ?? llmTimeoutMs()),
  );
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await res.text();
    if (!res.ok) {
      // Never echo request headers (keys) back; keep the provider's message short.
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        msg = j?.error?.message ?? j?.message ?? msg;
      } catch {
        /* not JSON */
      }
      throw new ProviderError(`LLM request failed (${res.status}): ${String(msg).slice(0, 300)}`, res.status);
    }
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      if (!timedOut) throw new AbortedError();
      throw new ProviderError('LLM request timed out', 408);
    }
    throw new ProviderError(`LLM request failed: ${(err as Error)?.message ?? 'network error'}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
