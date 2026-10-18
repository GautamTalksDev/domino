// A tiny toast bus: any client component can say "done" without owning UI for it.

export type ToastTone = 'ok' | 'info' | 'learn' | 'error';
export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: ToastTone;
  href?: string;
  hrefLabel?: string;
}

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();
let next = 0;

export function toast(t: Omit<Toast, 'id'>) {
  const item = { ...t, id: ++next };
  for (const l of listeners) l(item);
}

export function onToast(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
