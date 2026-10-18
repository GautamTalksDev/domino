// Browser helpers for talking to the Domino API.

/**
 * When a deployment sets DOMINO_WRITE_KEY, writes answer 401 until the visitor unlocks. The app mounts
 * one <UnlockDialog/>, which registers here; any request that hits the lock asks once and retries.
 */
type Unlocker = () => Promise<boolean>;
let unlocker: Unlocker | null = null;
export function registerUnlocker(fn: Unlocker | null) {
  unlocker = fn;
}

export async function withUnlock(doFetch: () => Promise<Response>): Promise<Response> {
  const res = await doFetch();
  if (res.status !== 401 || !unlocker) return res;
  const body = (await res
    .clone()
    .json()
    .catch(() => ({}))) as { error?: string };
  if (!/access key/i.test(body.error ?? '')) return res;
  return (await unlocker()) ? doFetch() : res;
}

/** A request the server refused, with its HTTP status (409: someone else holds the lease). */
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

async function failure(res: Response): Promise<never> {
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  throw new RequestError(json.error ?? `Request failed (${res.status})`, res.status);
}

export async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await withUnlock(() => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  if (!res.ok) await failure(res);
  return (await res.json().catch(() => ({}))) as T;
}

export async function sendDelete<T = unknown>(url: string): Promise<T> {
  const res = await withUnlock(() => fetch(url, { method: 'DELETE' }));
  if (!res.ok) await failure(res);
  return (await res.json().catch(() => ({}))) as T;
}

/** POST and read a server-sent event stream, calling onEvent for every `data:` line. */
export async function streamPost(url: string, body: unknown, onEvent: (e: Record<string, unknown>) => void, signal?: AbortSignal) {
  const res = await withUnlock(() => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }));
  if (!res.ok || !res.body) await failure(res);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* ignore malformed event */
          }
        }
      }
    }
  }
}
