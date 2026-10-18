'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KEdge, KNode, Preset } from './KnowledgeGraph3D';
import { detectGpu } from './gpu';

const Placeholder = ({ children }: { children: React.ReactNode }) => (
  <div className="grid h-[460px] place-items-center rounded-2xl border hairline bg-[#0b0a0e] px-6 text-center sm:h-[600px]">{children}</div>
);

const KnowledgeGraph3D = dynamic(() => import('./KnowledgeGraph3D'), {
  ssr: false,
  loading: () => (
    <Placeholder>
      <span className="mono text-xs text-dim">Laying out the graph in 3D…</span>
    </Placeholder>
  ),
});

export function GraphStage(props: { nodes: KNode[]; edges: KEdge[]; presets: Preset[] }) {
  const [gl, setGl] = useState<boolean | null>(null);
  const [near, setNear] = useState(false);
  const fail = useCallback(() => setGl(false), []);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    detectGpu().then((tier) => live && setGl(tier !== 'none'));
    return () => {
      live = false;
    };
  }, []);
  // three.js and the layout only load when the graph is about to scroll into view.
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near, gl]);
  if (gl === false)
    return (
      <Placeholder>
        <p className="max-w-md text-sm text-dim">
          The 3D view needs WebGL 2, which this browser has turned off or doesn’t support. The explorer below walks the same graph in 2D, one
          neighbourhood at a time.
        </p>
      </Placeholder>
    );
  if (!gl || !near)
    return (
      <div ref={box}>
        <Placeholder>
          <span className="mono text-xs text-dim">Laying out the graph in 3D…</span>
        </Placeholder>
      </div>
    );
  return <KnowledgeGraph3D {...props} onFail={fail} />;
}
