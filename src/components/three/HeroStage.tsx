'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { HeroDominoes } from '../HeroDominoes';
import { detectGpu } from './gpu';

// three.js is only downloaded on pages that show a 3D scene, after the page is interactive.
const DominoScene = dynamic(() => import('./DominoScene'), { ssr: false });

/**
 * The landing hero. The lightweight version (HTML tiles) is what the server renders, so the page is complete at first
 * paint. On a real GPU the 3D scene is built when the browser is idle and cross-fades in over it once its first frame
 * is drawn; on a software renderer, or without WebGL, the lightweight version simply stays. Both share one box, so
 * nothing on the page moves.
 */
export function HeroStage() {
  // 'pending' until the browser says what it can draw (the server can't know).
  const [mode, setMode] = useState<'pending' | 'svg' | '3d'>('pending');
  const [ready, setReady] = useState(false);
  const [svgGone, setSvgGone] = useState(false);
  useEffect(() => {
    let live = true;
    // ?heroT (screenshots) forces 3D wherever WebGL 2 exists.
    const forced = new URLSearchParams(window.location.search).has('heroT');
    detectGpu().then((tier) => live && setMode(tier === 'hardware' || (forced && tier !== 'none') ? '3d' : 'svg'));
    return () => {
      live = false;
    };
  }, []);
  const fail = useCallback(() => {
    setMode('svg');
    setReady(false);
    setSvgGone(false);
  }, []);
  const shown = useCallback(() => setReady(true), []);
  // Once the 3D has faded in, stop animating the hidden tiles underneath.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setSvgGone(true), 900);
    return () => clearTimeout(t);
  }, [ready]);

  const show3d = mode === '3d' && ready;
  return (
    <div className="relative -mx-2 h-[250px] sm:h-[340px]">
      {!svgGone && (
        <div
          // On a phone the tile row is wider than the screen, so it only shows when it is the final version (no usable GPU);
          // otherwise the phone waits the moment for the 3D scene instead of showing a cut-off row.
          className={`absolute inset-0 items-center overflow-hidden px-2 transition-opacity duration-700 ${mode === 'svg' ? 'flex' : 'hidden sm:flex'} ${show3d ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
          aria-hidden={show3d}
        >
          {/* Zoomed to fit the width, so the whole chain is always visible and nothing scrolls sideways. */}
          <div className="mx-auto pt-6 [zoom:0.36] min-[420px]:[zoom:0.42] min-[480px]:[zoom:0.52] sm:[zoom:0.72] lg:[zoom:1]">
            <HeroDominoes />
          </div>
        </div>
      )}
      {mode === '3d' && (
        <div
          className={`absolute inset-0 transition-opacity duration-700 ${show3d ? 'opacity-100' : 'opacity-0'}`}
          role="img"
          aria-label="Four dominoes in 3D: amlodipine causes ankle swelling, treated with furosemide, which causes leaking urine, treated with oxybutynin, which causes confusion, treated with donepezil. Each one knocks over the next."
        >
          <div className="stage-fade absolute inset-0">
            <DominoScene onFail={fail} onReady={shown} />
          </div>
          <p className="pointer-events-none absolute bottom-1 right-2 text-[11px] text-mute motion-reduce:hidden">
            <span className="hidden [@media(hover:hover)]:inline">Click</span>
            <span className="[@media(hover:hover)]:hidden">Tap</span> to knock them over again
          </p>
        </div>
      )}
    </div>
  );
}
