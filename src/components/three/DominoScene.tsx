'use client';

// The landing hero in real 3D: Beatrice's four medicines as lacquered dominoes that knock each other over,
// with the side effect between each pair lighting up as it happens. Plain three.js (no scene-graph library),
// paused when off screen, static under prefers-reduced-motion, and the lightweight HTML version stays where 3D can't run well.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { whenIdle } from './gpu';

export const HERO_CHAIN = [
  { name: 'Amlodipine', sub: 'blood pressure', effect: 'ankle swelling' },
  { name: 'Furosemide', sub: 'for the swelling', effect: 'leaking urine' },
  { name: 'Oxybutynin', sub: 'for the bladder', effect: 'confusion' },
  { name: 'Donepezil', sub: 'for the memory', effect: '' },
];

const PIPS = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8]];
const W = 1.05; // tile width
const H = 1.9; // tile height
const T = 0.34; // tile thickness
const GAP = 1.78; // distance between tile centres along the chain
const REST = (55 * Math.PI) / 180; // a tile leaning on the next one (it would pass through it any further)
const FLAT = (89.5 * Math.PI) / 180; // the last tile, on the floor
const CONTACT = Math.asin((GAP - W) / H); // the angle at which a falling tile touches the next

function faceTexture(i: number, sans: string) {
  const c = document.createElement('canvas');
  const scale = 512 / W;
  c.width = 512;
  c.height = Math.round(H * scale);
  const g = c.getContext('2d')!;
  const d = HERO_CHAIN[i];
  const ink = '#17151a';
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.font = `600 ${i === 0 ? 76 : 72}px "Fraunces Variable", Fraunces, Georgia, serif`;
  g.fillText(d.name, c.width / 2, 170);
  g.fillStyle = '#6f6b64';
  g.font = `400 38px ${sans}`;
  g.fillText(d.sub, c.width / 2, 228);
  g.fillStyle = ink;
  g.globalAlpha = 0.85;
  g.fillRect(60, 300, c.width - 120, 7);
  g.globalAlpha = 1;
  // Pips on a 3 × 3 grid in the lower half.
  const top = 370;
  const cell = (c.height - top - 60) / 3;
  for (const p of PIPS[i]) {
    const x = c.width / 2 + ((p % 3) - 1) * cell * 1.05;
    const y = top + cell / 2 + Math.floor(p / 3) * cell;
    g.beginPath();
    g.arc(x, y, 30, 0, Math.PI * 2);
    g.fillStyle = i === 0 ? '#ff5b3a' : ink;
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function labelTexture(text: string, sans: string) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = `500 52px ${sans}`;
  const w = Math.min(600, g.measureText(text).width + 64);
  const x = (c.width - w) / 2;
  g.fillStyle = 'rgba(255, 91, 58, 0.14)';
  g.strokeStyle = 'rgba(255, 138, 111, 0.55)';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(x, 20, w, 88, 44);
  g.fill();
  g.stroke();
  g.fillStyle = '#ff8a6f';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function floorAlpha() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  // A soft pool that is gone well before the far edge, where the receding floor would squeeze the fade into a hard line.
  const grad = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.3, '#8c8c8c');
  grad.addColorStop(0.6, '#262626');
  grad.addColorStop(0.85, '#000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export default function DominoScene({ onFail, onReady, className = '' }: { onFail?: () => void; onReady?: () => void; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    let cancelIdle = () => {};
    // Build once the fonts the face textures use are ready (next/font gives Geist a generated family name), and only
    // when the browser is idle, so the page is painted and interactive before any 3D work starts.
    Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => {
      if (cancelled) return;
      cancelIdle = whenIdle(() => {
        if (!cancelled) dispose = build(el, getComputedStyle(document.body).fontFamily || 'ui-sans-serif, system-ui, sans-serif', onFail, onReady);
      });
    });
    return () => {
      cancelled = true;
      cancelIdle();
      dispose?.();
    };
  }, [onFail, onReady]);

  return <div ref={host} className={`relative h-full w-full cursor-pointer ${className}`} />;
}

function build(el: HTMLDivElement, sans: string, onFail?: () => void, onReady?: () => void): (() => void) | null {
  {
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      onFail?.();
      return null;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // soft via shadow.radius (PCFSoftShadowMap is deprecated)
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.display = 'block';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    // If the GPU drops the context (driver reset, too many tabs), go back to the lightweight version.
    const onLost = () => onFail?.();
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envTex = pmrem.fromScene(room, 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.32;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const target = new THREE.Vector3(0.45, 0.72, 0);
    const camBase = new THREE.Vector3(-0.7, 2.35, 8.4);
    camera.position.copy(camBase);
    camera.lookAt(target);

    // Lights: a warm key with soft shadows, a vermilion rim from behind, a cool fill.
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(3.5, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff5b3a, 1.7);
    rim.position.set(-2, 3, -6);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xa596ff, 0.55);
    fill.position.set(-6, 2, 3);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xffffff, 0.12));

    // Floor that fades into the page.
    const floorAlphaTex = floorAlpha();
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x15131a, roughness: 0.86, metalness: 0, transparent: true, alphaMap: floorAlphaTex });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0.6, 0, 1.2);
    floor.receiveShadow = true;
    scene.add(floor);

    // Faces to the camera, like the tiles on the rest of the site; each one tips sideways onto the next.
    // The whole run is turned a little, so it recedes to the right and reads as a space, not a strip.
    const run = new THREE.Group();
    run.rotation.y = -0.2;
    scene.add(run);
    const tileGeo = new RoundedBoxGeometry(W, H, T, 5, 0.075);
    const faceGeo = new THREE.PlaneGeometry(W * 0.94, H * 0.95);
    const disposables: { dispose: () => void }[] = [tileGeo, faceGeo, floorMat, floorAlphaTex, floor.geometry, envTex, pmrem, room];

    interface Tile {
      fall: THREE.Group;
      theta: number;
      omega: number;
      started: boolean;
      label?: THREE.Sprite;
      labelOn: number;
    }
    const tiles: Tile[] = [];
    const pointLight = new THREE.PointLight(0xff5b3a, 0, 3.2, 1.6);

    HERO_CHAIN.forEach((d, i) => {
      const x = (i - 1.5) * GAP;
      const fall = new THREE.Group();
      // The pivot is the tile's bottom right edge.
      fall.position.set(x + W / 2, 0, 0);
      run.add(fall);
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0xf6efe2,
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.18,
        sheen: 0.4,
        sheenColor: new THREE.Color(0xfff6e8),
      });
      const tile = new THREE.Mesh(tileGeo, mat);
      tile.position.set(-W / 2, H / 2, 0);
      tile.castShadow = true;
      tile.receiveShadow = true;
      fall.add(tile);
      const tex = faceTexture(i, sans);
      const faceMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -1 });
      const face = new THREE.Mesh(faceGeo, faceMat);
      face.position.set(-W / 2, H / 2, T / 2 + 0.004);
      fall.add(face);
      disposables.push(mat, tex, faceMat);
      if (i === 0) {
        // The root: a vermilion halo and a little light of its own.
        const haloMat = new THREE.MeshBasicMaterial({ color: 0xff5b3a, side: THREE.BackSide, transparent: true, opacity: 0.9 });
        const halo = new THREE.Mesh(tileGeo, haloMat);
        halo.position.copy(tile.position);
        halo.scale.set(1.05, 1.03, 1.16);
        fall.add(halo);
        disposables.push(haloMat);
        pointLight.position.set(-W / 2, H * 0.6, T + 0.9);
        fall.add(pointLight);
      }
      const t: Tile = { fall, theta: 0, omega: 0, started: false, labelOn: 0 };
      if (d.effect) {
        const ltex = labelTexture(d.effect, sans);
        const lmat = new THREE.SpriteMaterial({ map: ltex, transparent: true, opacity: 0, depthWrite: false });
        const sprite = new THREE.Sprite(lmat);
        sprite.scale.set(1.8, 0.36, 1);
        sprite.position.set(x + GAP / 2, H + 0.45, 0);
        run.add(sprite);
        t.label = sprite;
        disposables.push(ltex, lmat);
      }
      tiles.push(t);
    });

    // Size to the host.
    let dolly = 1;
    let drawn = false;
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      // Keep the whole chain (about 4.7 units either side of the target, fallen) in frame at any aspect:
      // widen the lens up to 48°, then step the camera back.
      const half = 4.7;
      const d0 = camBase.distanceTo(target);
      const want = (2 * Math.atan(half / d0 / camera.aspect) * 180) / Math.PI;
      camera.fov = Math.min(48, Math.max(28, want));
      const fits = half / (camera.aspect * Math.tan((camera.fov * Math.PI) / 360));
      dolly = Math.max(1, fits / d0);
      camera.updateProjectionMatrix();
      // Resizing clears the canvas; with no animation loop (reduced motion), draw the still frame again.
      if (reduce && drawn) render(0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Pointer parallax.
    const pointer = new THREE.Vector2(0, 0);
    const smooth = new THREE.Vector2(0, 0);
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    };
    el.addEventListener('pointermove', onMove);

    // The fall, as a tiny bit of physics: a tile tips with gravity until it touches the next one,
    // then leans on it as that one falls; the last one lands flat with a small bounce.
    let phase: 'wait' | 'fall' | 'hold' | 'reset' = 'wait';
    let phaseT = 0;
    const restart = () => {
      for (const t of tiles) {
        t.theta = 0;
        t.omega = 0;
        t.started = false;
      }
      phase = 'wait';
      phaseT = 0;
    };
    const onClick = () => {
      if (phase === 'hold' || phase === 'wait') {
        phase = 'fall';
        phaseT = 0;
        tiles[0].started = true;
        tiles[0].omega = 0.9;
      }
    };
    el.addEventListener('click', onClick);

    const step = (dt: number) => {
      phaseT += dt;
      if (phase === 'wait' && phaseT > 1.1) {
        phase = 'fall';
        phaseT = 0;
        tiles[0].started = true;
        tiles[0].omega = 0.75;
      }
      if (phase === 'fall') {
        const n = tiles.length;
        for (let i = 0; i < n; i++) {
          const t = tiles[i];
          if (!t.started) continue;
          const next = tiles[i + 1];
          if (next && next.started) {
            // Leaning on the next tile: follow its progress.
            const k = Math.min(1, next.theta / (i + 1 === n - 1 ? FLAT : REST));
            t.theta = Math.max(t.theta, CONTACT + (REST - CONTACT) * k);
            continue;
          }
          t.omega += 9.5 * Math.sin(Math.max(t.theta, 0.04)) * dt;
          t.theta += t.omega * dt;
          if (next && t.theta >= CONTACT) {
            next.started = true;
            next.omega = t.omega * 0.85;
            t.theta = CONTACT;
            t.labelOn = 1;
          }
          if (!next && t.theta >= FLAT) {
            t.theta = FLAT;
            t.omega = -t.omega * 0.18;
            if (Math.abs(t.omega) < 0.05) {
              t.omega = 0;
              phase = 'hold';
              phaseT = 0;
            }
          }
        }
      } else if (phase === 'hold' && phaseT > 3.2) {
        phase = 'reset';
        phaseT = 0;
      } else if (phase === 'reset') {
        const k = Math.min(1, phaseT / 1.3);
        const ease = 1 - Math.pow(1 - k, 3);
        for (const t of tiles) {
          t.theta *= 1 - ease * 0.35;
          t.labelOn = 0;
        }
        if (k >= 1) restart();
      }
      for (const t of tiles) {
        t.fall.rotation.z = -t.theta;
        if (t.label) {
          const m = t.label.material as THREE.SpriteMaterial;
          m.opacity += ((t.labelOn ? 1 : 0) - m.opacity) * Math.min(1, dt * 5);
          t.label.position.y = H + 0.3 + m.opacity * 0.15;
        }
      }
      pointLight.intensity = 2.4 + Math.sin(performance.now() * 0.003) * 0.6;
    };

    const render = (dt: number) => {
      smooth.lerp(pointer, Math.min(1, dt * 3));
      camera.position.copy(camBase).sub(target).multiplyScalar(dolly).add(target);
      camera.position.x += smooth.x * 0.7;
      camera.position.y -= smooth.y * 0.35;
      camera.lookAt(target);
      renderer.render(scene, camera);
    };

    let raf = 0;
    let last = performance.now();
    let visible = true;
    // Nothing renders until the shaders are compiled (in parallel, off the main thread where the browser supports it).
    let ready = false;
    let disposed = false;
    let shown = false;
    const firstFrame = () => {
      if (shown) return;
      shown = true;
      onReady?.();
    };
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      // Fixed physics substeps, so the fall keeps real time even when frames are slow.
      if (!reduce) for (let left = dt; left > 1e-6; left -= 1 / 120) step(Math.min(left, 1 / 120));
      render(dt);
      firstFrame();
      raf = visible && !document.hidden && !reduce ? requestAnimationFrame(loop) : 0;
    };
    const wake = () => {
      if (ready && !raf && visible && !document.hidden && !reduce) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      wake();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', wake);

    // ?heroT=3.6 starts the scene 3.6 seconds in (for screenshots). Under reduced motion there is no animation, so the
    // still frame is the story's end: every tile down and every side effect labelled, rather than four standing tiles.
    const seek = Number(new URLSearchParams(window.location.search).get('heroT') ?? 0);
    const begin = () => {
      if (disposed) return;
      ready = true;
      const start = seek > 0 ? Math.min(seek, 30) : reduce ? 4.2 : 0;
      for (let left = start; left > 1e-6; left -= 1 / 120) step(Math.min(left, 1 / 120));
      if (reduce) {
        render(0.016);
        drawn = true;
        firstFrame();
      } else wake();
    };
    renderer.compileAsync(scene, camera).then(begin, begin);

    // With ?heroT set (screenshots and the README animation only), a page can also jump to any moment.
    const onSeek = (e: Event) => {
      restart();
      for (const t of tiles) {
        t.labelOn = 0;
        if (t.label) (t.label.material as THREE.SpriteMaterial).opacity = 0;
      }
      for (let left = Math.min(Number((e as CustomEvent<number>).detail) || 0, 30); left > 1e-6; left -= 1 / 120) step(Math.min(left, 1 / 120));
      render(0.016);
    };
    if (seek > 0) window.addEventListener('domino:hero-seek', onSeek);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('domino:hero-seek', onSeek);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', wake);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('click', onClick);
      for (const d of disposables) d.dispose();
      key.shadow.map?.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.dispose();
      // Give the GPU context back now rather than whenever the garbage collector runs.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }
}
