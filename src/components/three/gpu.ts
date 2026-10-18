// What the browser can draw. "software" means WebGL runs on the CPU (SwiftShader, llvmpipe, Microsoft Basic Render,
// remote desktops, some VMs): it works, but a lit 3D scene there costs seconds of main-thread time, so the landing
// page keeps its lightweight version instead.
//
// Detection never blocks the page: WebGPU's adapter query is asynchronous and answers on most current browsers. Only
// when it can't is a WebGL context created to read the renderer's name, and then only while the browser is idle,
// because the first WebGL context of a page can take a long, blocking moment to start.

export type GpuTier = 'none' | 'software' | 'hardware';

let known: GpuTier | null = null;
let pending: Promise<GpuTier> | null = null;

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** The tier if it has been detected already (synchronous, for code that runs after detection). */
export function knownGpuTier(): GpuTier | null {
  return known;
}

function probeWebGL(): GpuTier {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'none';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    // three.js needs WebGL 2; a WebGL 1 only browser gets the non-3D versions.
    const two = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (!two) return 'none';
    return classify(name);
  } catch {
    return 'none';
  }
}

interface Adapter {
  isFallbackAdapter?: boolean;
  info?: { isFallbackAdapter?: boolean; description?: string; vendor?: string };
}

const classify = (name: string): GpuTier => (SOFTWARE.test(name) ? 'software' : 'hardware');

/**
 * The same probe in a Web Worker on an OffscreenCanvas, so the main thread never waits for the GPU to start (on a
 * machine without one, the first WebGL context can take over a second). Resolves null where workers can't do WebGL.
 */
function probeInWorker(): Promise<GpuTier | null> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve(null);
  const src = `onmessage = () => {
    try {
      const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
      if (!gl) return postMessage('');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      postMessage(String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || 'unknown');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { postMessage(null); }
  };`;
  return new Promise((resolve) => {
    let url = '';
    let worker: Worker | null = null;
    const done = (v: GpuTier | null) => {
      clearTimeout(timer);
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 5000);
    try {
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      // '' means no WebGL 2 at all; null means the worker couldn't tell (fall back to the main-thread probe).
      worker.onmessage = (e: MessageEvent<string | null>) => done(e.data === null ? null : e.data === '' ? 'none' : classify(e.data));
      worker.onerror = () => done(null);
      worker.postMessage(0);
    } catch {
      done(null);
    }
  });
}

export function detectGpu(): Promise<GpuTier> {
  if (known) return Promise.resolve(known);
  pending ??= (async () => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<Adapter | null> } };
    try {
      const adapter = nav.gpu ? await nav.gpu.requestAdapter() : null;
      if (adapter && typeof WebGL2RenderingContext !== 'undefined') {
        const fallback = adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false;
        const desc = `${adapter.info?.description ?? ''} ${adapter.info?.vendor ?? ''}`;
        return (known = fallback || SOFTWARE.test(desc) ? 'software' : 'hardware');
      }
    } catch {
      /* fall through to the WebGL probe */
    }
    const fromWorker = await probeInWorker();
    if (fromWorker) return (known = fromWorker);
    return (known = await new Promise<GpuTier>((resolve) => whenIdle(() => resolve(probeWebGL()), 2500)));
  })();
  return pending;
}

/** Run when the browser is idle (after first paint and hydration), so 3D setup never delays the page. */
export function whenIdle(fn: () => void, timeout = 1200): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
}
