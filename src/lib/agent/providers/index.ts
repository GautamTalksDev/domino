// LLM providers for the agents. Keys are read from the server environment only and are
// never sent to the browser. If no key is set, Domino runs its deterministic planner instead.

import { randomUUID } from 'node:crypto';
import { AbortedError, llmTimeoutMs, postJson, ProviderError, type ChatMessage, type ChatResult, type Provider, type ToolDecl } from './types';

function safeParse(text: string | undefined): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export const geminiBase = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');

// Gemini expects OpenAPI-style upper-case type names.
function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'additionalProperties') continue;
    out[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : geminiSchema(v);
  }
  return out;
}

// ─── Google Gemini ─────────────────────────────────────────────────────────────
// Current models (Gemini API changelog, October 2026): 3.8 Flash is the recommended GA Flash model, 3.6 Flash and
// 3.5 Flash-Lite are GA too, and 2.5 Flash is only served to keys that used it before September 2026. A call falls
// through this list when a model is over quota, unavailable or not open to this key.
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
export const GEMINI_FALLBACKS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

/**
 * Generation settings per model family. Gemini 3 and later ignore sampling parameters and think by default; a low
 * thinking level keeps each agent turn fast (GEMINI_THINKING can raise it). Gemini 2.x takes a temperature.
 */
export function geminiGenerationConfig(model: string): Record<string, unknown> {
  if (/^gemini-(1|2)(\.|-)/.test(model)) return { temperature: 0.2, maxOutputTokens: 4096 };
  const level = ['low', 'medium', 'high'].includes(process.env.GEMINI_THINKING ?? '') ? process.env.GEMINI_THINKING : 'low';
  return { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: level } };
}

const GEMINI_COOLDOWN = new Map<string, number>();

/** Forget which models were cooling down (tests, or an operator who just fixed the key). */
export function clearGeminiCooldown() {
  GEMINI_COOLDOWN.clear();
}

/** Gemini models skipped right now after an error, for /api/health. */
export function geminiCooling(): string[] {
  const now = Date.now();
  return [...GEMINI_COOLDOWN].filter(([, until]) => until > now).map(([m]) => m);
}

/** Over quota, unavailable, unknown, not open to this key, or too slow: worth trying the next model. */
const NEXT_MODEL = (status?: number) => status === 403 || status === 404 || status === 408 || status === 429 || (status ?? 0) >= 500;
class GeminiProvider implements Provider {
  id = 'gemini' as const;
  constructor(
    private key: string,
    public model: string,
    private fallbacks: string[],
  ) {}

  private contents(messages: ChatMessage[]) {
    const out: { role: string; parts: unknown[] }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'user') out.push({ role: 'user', parts: [{ text: m.content }] });
      else if (m.role === 'assistant') {
        if (m.raw) out.push(m.raw as { role: string; parts: unknown[] });
        else out.push({ role: 'model', parts: [{ text: m.content || '…' }] });
      } else {
        const parts: unknown[] = [];
        while (i < messages.length && messages[i].role === 'tool') {
          parts.push({ functionResponse: { name: messages[i].toolName, response: { content: messages[i].content } } });
          i++;
        }
        i--;
        out.push({ role: 'user', parts });
      }
    }
    return out;
  }

  async chat(system: string, messages: ChatMessage[], tools: ToolDecl[], signal?: AbortSignal): Promise<ChatResult> {
    const decls = tools.map((t) =>
      Object.keys(t.parameters.properties).length
        ? { name: t.name, description: t.description, parameters: geminiSchema(t.parameters) }
        : { name: t.name, description: t.description },
    );
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: this.contents(messages),
      tools: decls.length ? [{ functionDeclarations: decls }] : undefined,
    };
    let lastErr: unknown;
    const now = Date.now();
    // One time budget for the whole call, across fallbacks: a hanging endpoint cannot multiply it by four.
    const deadline = now + llmTimeoutMs();
    const ready = [this.model, ...this.fallbacks].filter((m) => (GEMINI_COOLDOWN.get(m) ?? 0) < now);
    if (!ready.length) throw new ProviderError('Every Gemini model is cooling down after errors.', 503);
    for (const model of ready) {
      if (signal?.aborted) throw new AbortedError();
      const left = deadline - Date.now();
      if (left < 500) break;
      try {
        const json = (await postJson(
          `${geminiBase()}/models/${encodeURIComponent(model)}:generateContent`,
          { 'x-goog-api-key': this.key },
          { ...body, generationConfig: geminiGenerationConfig(model) },
          signal,
          left,
        )) as { candidates?: { content?: { role: string; parts?: { text?: string; functionCall?: { name: string; args?: unknown; id?: string } }[] } }[] };
        const content = json.candidates?.[0]?.content;
        const parts = content?.parts ?? [];
        const text = parts
          .map((p) => p.text ?? '')
          .join('')
          .trim();
        const toolCalls = parts
          .filter((p) => p.functionCall)
          .map((p) => ({ id: p.functionCall!.id ?? randomUUID(), name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
        return { text, toolCalls, raw: content ? { role: 'model', parts } : undefined, model };
      } catch (err) {
        if (err instanceof AbortedError) throw err;
        lastErr = err;
        const status = (err as ProviderError).status;
        if (NEXT_MODEL(status)) {
          // Skip that model for a while: ten minutes if this key cannot use it, a minute otherwise.
          GEMINI_COOLDOWN.set(model, Date.now() + (status === 404 || status === 403 ? 10 * 60_000 : 60_000));
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new ProviderError('The Gemini call ran out of time.', 408);
  }
}

// ─── OpenAI and OpenAI-compatible (Groq, OpenRouter, Together, Ollama) ─────────
class OpenAIProvider implements Provider {
  id = 'openai' as const;
  constructor(
    private key: string,
    public model: string,
    private base: string,
  ) {}

  async chat(system: string, messages: ChatMessage[], tools: ToolDecl[], signal?: AbortSignal): Promise<ChatResult> {
    const msgs: unknown[] = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'user') msgs.push({ role: 'user', content: m.content });
      else if (m.role === 'assistant')
        msgs.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls?.length
            ? m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } }))
            : undefined,
        });
      else msgs.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
    const json = (await postJson(
      `${this.base.replace(/\/$/, '')}/chat/completions`,
      this.key ? { authorization: `Bearer ${this.key}` } : {},
      {
        model: this.model,
        messages: msgs,
        tools: tools.length
          ? tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
          : undefined,
        temperature: 0.2,
      },
      signal,
    )) as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
    const msg = json.choices?.[0]?.message;
    return {
      text: (msg?.content ?? '').trim(),
      toolCalls: (msg?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: safeParse(c.function.arguments) })),
      model: this.model,
    };
  }
}

// ─── Anthropic Claude ──────────────────────────────────────────────────────────
class AnthropicProvider implements Provider {
  id = 'anthropic' as const;
  constructor(
    private key: string,
    public model: string,
  ) {}

  async chat(system: string, messages: ChatMessage[], tools: ToolDecl[], signal?: AbortSignal): Promise<ChatResult> {
    const msgs: { role: string; content: unknown }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'user') msgs.push({ role: 'user', content: m.content });
      else if (m.role === 'assistant') msgs.push({ role: 'assistant', content: (m.raw as unknown[]) ?? [{ type: 'text', text: m.content || '…' }] });
      else {
        const blocks: unknown[] = [];
        while (i < messages.length && messages[i].role === 'tool') {
          blocks.push({ type: 'tool_result', tool_use_id: messages[i].toolCallId, content: messages[i].content });
          i++;
        }
        i--;
        msgs.push({ role: 'user', content: blocks });
      }
    }
    const json = (await postJson(
      `${(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/$/, '')}/messages`,
      { 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        max_tokens: 2048,
        temperature: 0.2,
        system,
        messages: msgs,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      },
      signal,
    )) as { content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] };
    const content = json.content ?? [];
    return {
      text: content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('')
        .trim(),
      toolCalls: content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id!, name: c.name!, args: c.input ?? {} })),
      raw: content,
      model: this.model,
    };
  }
}

export interface ProviderInfo {
  provider: Provider | null;
  label: string;
}

// After the model fails outright (every Gemini model over quota, the provider down, a timeout), Domino stops asking it
// for a minute: reviews and answers go straight to the graph planner instead of waiting on calls that will fail.
const g = globalThis as unknown as { __domino_llm_pause?: { until: number; reason: string } };
export function pauseModel(reason: string, ms = 60_000) {
  g.__domino_llm_pause = { until: Date.now() + ms, reason: reason.slice(0, 160) };
}
export function modelPause(): { until: number; reason: string } | null {
  const p = g.__domino_llm_pause;
  return p && p.until > Date.now() ? p : null;
}

export function getProvider(): ProviderInfo {
  const choice = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  const gemini = process.env.GEMINI_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL;

  const make = (id: string): Provider | null => {
    if (id === 'gemini' && gemini)
      return new GeminiProvider(gemini, model || GEMINI_DEFAULT_MODEL, GEMINI_FALLBACKS.filter((m) => m !== (model || GEMINI_DEFAULT_MODEL)));
    if (id === 'anthropic' && anthropic) return new AnthropicProvider(anthropic, model || 'claude-haiku-4-5-20251001');
    if (id === 'openai' && (openai || process.env.OPENAI_BASE_URL)) {
      if (!/^https?:\/\//.test(base)) return null;
      return new OpenAIProvider(openai || '', model || 'gpt-4.1-mini', base);
    }
    return null;
  };

  if (choice === 'none' || choice === 'planner') return { provider: null, label: 'Graph planner (no LLM)' };
  if (modelPause()) return { provider: null, label: 'Graph planner (model paused after an error)' };
  const order = choice === 'auto' ? ['anthropic', 'gemini', 'openai'] : [choice];
  for (const id of order) {
    const p = make(id);
    if (p) return { provider: p, label: `${p.id}:${p.model}` };
  }
  return { provider: null, label: 'Graph planner (no LLM)' };
}
