'use client';

// The whole medication knowledge graph in 3D: every drug and effect, every CAUSES and TREATED_BY edge, laid out
// with a small 3D force simulation. Hover a node to see what it touches; pick a patient's cascade and watch the
// path light up inside the full graph. Plain three.js; the glow is additive halos (cheap, and true to the palette);
// paused off screen; orbit controls.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { knownGpuTier } from './gpu';

export interface KNode {
  id: string;
  name: string;
  label: 'Drug' | 'Effect';
  group: string;
}
export interface KEdge {
  s: string;
  t: string;
  type: 'CAUSES' | 'TREATED_BY';
}

export interface Preset {
  id: string;
  label: string;
  path: string[];
}

const C = {
  drug: new THREE.Color('#e9e2d4'),
  effect: new THREE.Color('#f2b544'),
  hot: new THREE.Color('#ff5b3a'),
  causes: new THREE.Color('#ff5b3a'),
  treated: new THREE.Color('#7fd6a4'),
  dim: new THREE.Color('#2a2730'),
};

/** A small 3D force layout: repulsion between all nodes, springs along edges, a pull to the centre. */
function layout(nodes: KNode[], edges: KEdge[]) {
  const n = nodes.length;
  const index = new Map(nodes.map((x, i) => [x.id, i]));
  const pos = new Float32Array(n * 3);
  // Deterministic start on two shells: effects inside, drugs outside.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  nodes.forEach((x, i) => {
    const r = x.label === 'Effect' ? 14 : 26;
    const v = new THREE.Vector3(rnd(), rnd(), rnd()).normalize().multiplyScalar(r);
    pos.set([v.x, v.y, v.z], i * 3);
  });
  const kept = edges.filter((e) => index.has(e.s) && index.has(e.t));
  const links = kept.map((e) => [index.get(e.s)!, index.get(e.t)!] as const);
  const types = kept.map((e) => e.type);
  const vel = new Float32Array(n * 3);
  for (let it = 0; it < 260; it++) {
    const alpha = 1 - it / 260;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i * 3] - pos[j * 3];
        const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
        const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const f = (60 / d2) * alpha;
        vel[i * 3] += dx * f;
        vel[i * 3 + 1] += dy * f;
        vel[i * 3 + 2] += dz * f;
        vel[j * 3] -= dx * f;
        vel[j * 3 + 1] -= dy * f;
        vel[j * 3 + 2] -= dz * f;
      }
    }
    for (const [a, b] of links) {
      const dx = pos[b * 3] - pos[a * 3];
      const dy = pos[b * 3 + 1] - pos[a * 3 + 1];
      const dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
      const f = ((d - 7) / d) * 0.06 * alpha;
      vel[a * 3] += dx * f;
      vel[a * 3 + 1] += dy * f;
      vel[a * 3 + 2] += dz * f;
      vel[b * 3] -= dx * f;
      vel[b * 3 + 1] -= dy * f;
      vel[b * 3 + 2] -= dz * f;
    }
    for (let i = 0; i < n * 3; i++) {
      vel[i] -= pos[i] * 0.004 * alpha;
      pos[i] += vel[i];
      vel[i] *= 0.6;
    }
  }
  // Centre it and scale it so the bulk of the graph sits within a radius of 30.
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += pos[i * 3 + k] / n;
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) pos[i * 3 + k] -= c[k];
    radii.push(Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  }
  radii.sort((a, b) => a - b);
  const r95 = radii[Math.floor(n * 0.95)] || 1;
  for (let i = 0; i < n * 3; i++) pos[i] *= 30 / r95;
  return { pos, index, links, types };
}

export default function KnowledgeGraph3D({
  nodes,
  edges,
  presets,
  onFail,
}: {
  nodes: KNode[];
  edges: KEdge[];
  presets: Preset[];
  /** WebGL could not start, or the GPU dropped the context: the parent shows its non-3D version. */
  onFail?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<{ highlight: (path: string[] | null) => void } | null>(null);
  const [preset, setPreset] = useState<string | null>(presets[0]?.id ?? null);
  const [hovered, setHovered] = useState<KNode | null>(null);
  const [stats, setStats] = useState<{ causes: number; treated: number } | null>(null);
  // The lit cascade, readable when the scene is rebuilt (a clinic switch gives new node and edge arrays).
  const litPath = useRef<string[] | null>(null);
  litPath.current = presets.find((x) => x.id === preset)?.path ?? null;

  useEffect(() => {
    const el = host.current;
    const labelLayer = labels.current;
    if (!el || !labelLayer) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      onFail?.();
      return;
    }
    // If the GPU drops the context (driver reset, too many tabs), hand over to the non-3D version instead of a dead box.
    const onLost = () => onFail?.();
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Fewer pixels on a software renderer, where every one costs main-thread time.
    renderer.setPixelRatio(knownGpuTier() === 'software' ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor(0x0b0a0e, 1);
    renderer.domElement.style.display = 'block';
    el.appendChild(renderer.domElement);

    // Render loop state, declared first: resize and hover call wake() before the loop starts.
    let raf = 0;
    let visible = true;
    let last = performance.now();
    let needs = 2;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b0a0e, 85, 190);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    camera.position.set(0, 12, 58);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 18;
    controls.maxDistance = 140;
    // On a software renderer every frame costs main-thread time, so the graph holds still and draws only when touched.
    const still = reduce || knownGpuTier() === 'software';
    controls.autoRotate = !still;
    controls.autoRotateSpeed = 0.55;
    // On touch screens one finger scrolls the page (so the graph never traps you), two fingers orbit and zoom.
    controls.touches = { ONE: -1 as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
    renderer.domElement.style.touchAction = 'pan-y';

    const { pos, index, links, types: edgeType } = layout(nodes, edges);
    const n = nodes.length;
    const degree = new Array(n).fill(0);
    for (const [a, b] of links) {
      degree[a]++;
      degree[b]++;
    }

    // Nodes: drugs as small lacquered spheres, effects as glowing amber ones.
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4();
    const baseScale = (i: number) => (nodes[i].label === 'Effect' ? 0.42 : 0.32) + Math.min(0.75, degree[i] * 0.045);
    for (let i = 0; i < n; i++) {
      const s = baseScale(i);
      m4.makeScale(s, s, s).setPosition(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      mesh.setMatrixAt(i, m4);
    }
    scene.add(mesh);

    // Edges: one line segment buffer with per-vertex colours.
    const lineGeo = new THREE.BufferGeometry();
    const lp = new Float32Array(links.length * 6);
    const lc = new Float32Array(links.length * 6);
    links.forEach(([a, b], k) => {
      lp.set([pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], k * 6);
    });
    lineGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lines);

    // The highlighted path: glowing tubes, rebuilt on demand.
    const pathGroup = new THREE.Group();
    scene.add(pathGroup);
    const pathMat = new THREE.MeshBasicMaterial({ color: C.hot, toneMapped: false });

    // Stars of dust for depth.
    const dustGeo = new THREE.BufferGeometry();
    const dust = new Float32Array(900 * 3);
    let sd = 3;
    const r2 = () => ((sd = (sd * 48271) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < dust.length; i++) dust[i] = r2() * 120;
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    const dustMat = new THREE.PointsMaterial({ color: 0x6f6b64, size: 0.35, transparent: true, opacity: 0.5, depthWrite: false });
    scene.add(new THREE.Points(dustGeo, dustMat));

    // Glow: a soft additive halo behind every node, brighter and larger on the highlighted path.
    const haloTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const haloGeo = new THREE.BufferGeometry();
    const haloCol = new Float32Array(n * 3);
    haloGeo.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
    haloGeo.setAttribute('color', new THREE.BufferAttribute(haloCol, 3));
    const haloMat = new THREE.PointsMaterial({ size: 4.2, map: haloTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 });
    scene.add(new THREE.Points(haloGeo, haloMat));
    const hotHaloMat = new THREE.SpriteMaterial({ map: haloTex, color: C.hot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 });

    // Colouring: normal, dimmed around a hover, or a highlighted path.
    let pathSet: Set<number> | null = null;
    const pathOrder = new Map<number, number>();
    let hover = -1;
    const neighbours = (i: number) => {
      const s = new Set<number>([i]);
      for (const [a, b] of links) {
        if (a === i) s.add(b);
        if (b === i) s.add(a);
      }
      return s;
    };
    const paint = () => {
      const focus = hover >= 0 ? neighbours(hover) : pathSet;
      const col = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const base = nodes[i].label === 'Effect' ? C.effect : C.drug;
        if (pathSet?.has(i)) col.copy(C.hot).multiplyScalar(1.6);
        else if (focus && !focus.has(i)) col.copy(base).lerp(C.dim, 0.82);
        else col.copy(base).multiplyScalar(nodes[i].label === 'Effect' ? 1.25 : 1);
        mesh.setColorAt(i, col);
        const glow = pathSet?.has(i) ? 0 : focus && !focus.has(i) ? 0.02 : nodes[i].label === 'Effect' ? 0.22 : 0.1;
        haloCol.set([col.r * glow, col.g * glow, col.b * glow], i * 3);
      }
      mesh.instanceColor!.needsUpdate = true;
      (haloGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      links.forEach(([a, b], k) => {
        const on = !focus || (focus.has(a) && focus.has(b));
        const base = edgeType[k] === 'CAUSES' ? C.causes : C.treated;
        col.copy(base).multiplyScalar(on ? (focus ? 1 : 0.42) : 0.04);
        lc.set([col.r, col.g, col.b, col.r, col.g, col.b], k * 6);
      });
      (lineGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    };

    const fly = { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1 };
    const highlight = (path: string[] | null) => {
      for (const c of pathGroup.children) if (c instanceof THREE.Mesh) c.geometry.dispose();
      pathGroup.clear();
      pathSet = null;
      if (path?.length) {
        const ids = path.map((p) => index.get(p)).filter((x): x is number => x != null);
        pathSet = new Set(ids);
        pathOrder.clear();
        ids.forEach((id, k) => pathOrder.set(id, k));
        const pts = ids.map((i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
        for (let k = 0; k < pts.length - 1; k++) {
          const mid = pts[k].clone().lerp(pts[k + 1], 0.5).multiplyScalar(1.04);
          const curve = new THREE.QuadraticBezierCurve3(pts[k], mid, pts[k + 1]);
          pathGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.14, 8, false), pathMat));
        }
        for (const p of pts) {
          const h = new THREE.Sprite(hotHaloMat);
          h.position.copy(p);
          h.scale.setScalar(6);
          pathGroup.add(h);
        }
        const centre = pts.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / pts.length);
        fly.from.copy(controls.target);
        fly.to.copy(centre);
        fly.t = 0;
      } else {
        fly.from.copy(controls.target);
        fly.to.set(0, 0, 0);
        fly.t = 0;
      }
      paint();
      wake();
    };
    api.current = { highlight };
    setStats({ causes: edges.filter((e) => e.type === 'CAUSES').length, treated: edges.filter((e) => e.type === 'TREATED_BY').length });

    // Labels for the path and the hovered node, as HTML over the canvas.
    const labelEls = new Map<number, HTMLDivElement>();
    const labelFor = (i: number) => {
      let d = labelEls.get(i);
      if (!d) {
        d = document.createElement('div');
        d.className = 'pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm';
        d.textContent = nodes[i].name;
        labelLayer.appendChild(d);
        labelEls.set(i, d);
      }
      return d;
    };
    const v = new THREE.Vector3();
    const sizes = new WeakMap<HTMLDivElement, [number, number]>();
    const placeLabels = () => {
      const want = new Set<number>(pathSet ?? []);
      if (hover >= 0) want.add(hover);
      for (const [i, d] of labelEls) if (!want.has(i)) d.style.display = 'none';
      const w = el.clientWidth;
      const h = el.clientHeight;
      const boxes: { d: HTMLDivElement; x: number; y: number; bw: number; bh: number }[] = [];
      for (const i of want) {
        const d = labelFor(i);
        v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).project(camera);
        if (v.z > 1) {
          d.style.display = 'none';
          continue;
        }
        d.style.display = 'block';
        const hot = pathSet?.has(i);
        d.style.borderColor = hot ? 'rgba(255,91,58,0.55)' : nodes[i].label === 'Effect' ? 'rgba(242,181,68,0.5)' : 'rgba(244,239,228,0.3)';
        d.style.color = hot ? '#ffb4a3' : '#f4efe4';
        d.style.background = 'rgba(13,12,16,0.72)';
        d.style.zIndex = i === hover ? '2' : '1';
        // Path labels alternate sides, so neighbours on the path don't sit on top of each other.
        const order = pathOrder.get(i) ?? 0;
        const left = hot && order % 2 === 1;
        // Measured once per label (the text never changes), so placing labels doesn't force a layout every frame.
        let size = sizes.get(d);
        if (!size || !size[0]) sizes.set(d, (size = [d.offsetWidth, d.offsetHeight]));
        const [bw, bh] = size;
        const sx = ((v.x + 1) / 2) * w;
        boxes.push({ d, x: left ? sx - 10 - bw : sx + 10, y: ((1 - v.y) / 2) * h - 10, bw, bh });
      }
      // Then nudge any label that still overlaps one placed before it down, top to bottom.
      boxes.sort((a, b) => a.y - b.y);
      for (let k = 0; k < boxes.length; k++) {
        const a = boxes[k];
        for (let j = 0; j < k; j++) {
          const b = boxes[j];
          if (a.x < b.x + b.bw + 4 && b.x < a.x + a.bw + 4 && a.y < b.y + b.bh + 3 && b.y < a.y + a.bh + 3) a.y = b.y + b.bh + 3;
        }
        a.d.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`;
      }
    };

    // Hover.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let pointerDown = false;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      // Hover is for a mouse or pen; a finger picks with a tap (onUp).
      if (e.pointerType === 'touch' || (pointerDown && e.pointerType === 'mouse')) return;
      pick();
    };
    const pick = () => {
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(mesh)[0];
      const next = hit?.instanceId ?? -1;
      if (next !== hover) {
        hover = next;
        el.style.cursor = hover >= 0 ? 'pointer' : 'grab';
        setHovered(hover >= 0 ? nodes[hover] : null);
        paint();
        wake();
      }
    };
    const onLeave = () => {
      if (hover !== -1) {
        hover = -1;
        setHovered(null);
        paint();
        wake();
      }
    };
    // Auto-rotate pauses while someone handles the graph and resumes six seconds after they let go.
    let resume: ReturnType<typeof setTimeout> | undefined;
    let tap: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      pointerDown = true;
      controls.autoRotate = false;
      clearTimeout(resume);
      tap = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const release = () => {
      pointerDown = false;
      clearTimeout(resume);
      if (!still)
        resume = setTimeout(() => {
          controls.autoRotate = true;
          wake();
        }, 6000);
    };
    const onUp = (e: PointerEvent) => {
      // A touch has no hover: a quick tap that didn't move picks the node under the finger.
      if (tap && e.pointerType !== 'mouse' && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10 && performance.now() - tap.t < 450) {
        const r = el.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        pick();
      }
      tap = null;
      release();
    };
    // A one-finger scroll that starts on the canvas ends in pointercancel (the page took the gesture), not pointerup.
    const onCancel = () => {
      tap = null;
      release();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    controls.addEventListener('change', () => wake());

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      wake();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    function frame(now: number) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (fly.t < 1) {
        fly.t = Math.min(1, fly.t + dt / 1.4);
        const e = 1 - Math.pow(1 - fly.t, 3);
        controls.target.lerpVectors(fly.from, fly.to, e);
      }
      controls.update(dt);
      renderer.render(scene, camera);
      placeLabels();
      const busy = controls.autoRotate || fly.t < 1 || pointerDown;
      raf = visible && !document.hidden && (busy || needs > 0) ? requestAnimationFrame(frame) : 0;
      if (needs > 0) needs--;
    }
    function wake() {
      needs = Math.max(needs, 30);
      if (!raf && visible && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      wake();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', wake);
    paint();
    // Re-light the chosen cascade when the scene is rebuilt.
    if (litPath.current) highlight(litPath.current);
    wake();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', wake);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      clearTimeout(resume);
      controls.dispose();
      for (const c of pathGroup.children) if (c instanceof THREE.Mesh) c.geometry.dispose();
      [geo, mat, lineGeo, lineMat, pathMat, dustGeo, dustMat, haloTex, haloGeo, haloMat, hotHaloMat].forEach((x) => x.dispose());
      mesh.dispose();
      renderer.dispose();
      // Give the GPU context back now rather than whenever the garbage collector runs.
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labelLayer.replaceChildren();
      api.current = null;
    };
  }, [nodes, edges, onFail]);

  // Apply the chosen preset once the scene exists (and whenever it changes).
  useEffect(() => {
    const p = presets.find((x) => x.id === preset);
    const t = setTimeout(() => api.current?.highlight(p?.path ?? null), 60);
    return () => clearTimeout(t);
  }, [preset, presets]);

  return (
    <div className="relative overflow-hidden rounded-2xl border hairline">
      <div ref={host} className="h-[460px] w-full cursor-grab touch-pan-y sm:h-[600px]" aria-hidden />
      <div ref={labels} className="pointer-events-none absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:flex-wrap sm:p-4">
        <div
          className="scroll-row pointer-events-auto -mx-3 flex min-w-0 gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
          role="group"
          aria-label="Light up a cascade"
        >
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(preset === p.id ? null : p.id)}
              aria-pressed={preset === p.id}
              className={`chip shrink-0 backdrop-blur-md transition-colors ${preset === p.id ? 'border-vermilion/50 bg-vermilion/15 text-vermilion-2' : 'bg-ink/60 hover:text-bone'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mono hidden rounded-lg bg-ink/60 px-2 py-1 text-[10.5px] text-dim backdrop-blur-md sm:block">
          {nodes.filter((x) => x.label === 'Drug').length} drugs · {nodes.filter((x) => x.label === 'Effect').length} effects
          {stats ? ` · ${stats.causes} CAUSES · ${stats.treated} TREATED_BY` : ''}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 p-3 text-[11px] sm:gap-3 sm:p-4 sm:text-xs">
        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-ink/60 px-2.5 py-1.5 text-dim backdrop-blur-md">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-bone" /> drug
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber" />
            <span>
              side effect<span className="hidden sm:inline"> or diagnosis</span>
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-vermilion" /> CAUSES
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-sage" /> TREATED_BY
          </span>
        </div>
        <div className="max-w-sm rounded-lg bg-ink/70 px-2.5 py-1.5 text-dim backdrop-blur-md">
          {hovered ? (
            <span>
              <span className="text-bone">{hovered.name}</span> · {hovered.label === 'Drug' ? hovered.group : `${hovered.group}`}
            </span>
          ) : (
            <>
              <span className="hidden [@media(hover:hover)]:inline">Drag to orbit, scroll to zoom, hover a node to see what it touches.</span>
              <span className="[@media(hover:hover)]:hidden">Two fingers to orbit and zoom. Tap a node to see what it touches.</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
