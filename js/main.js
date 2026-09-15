// Boot, render loop and wiring between the 3D view, the mini-map and the caption.

import * as THREE from 'three';
import { createLayout } from './gen/layout.js';
import { WorkerPool } from './render/worker-pool.js';
import { createSharedUniforms, createMaterials } from './render/materials.js';
import { CityRenderer } from './render/chunks.js';
import { Atmosphere } from './render/atmosphere.js';
import { Viewer } from './ui/viewer.js';
import { Minimap } from './ui/minimap.js';
import { setCaption, formatDistance, showHint, hideHint, bindSettings, bindAbout } from './ui/caption.js';

window.__sigilBooted = true;
THREE.ColorManagement.enabled = false; // colours in data/shaders are display values; no sRGB round-trip

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const QUALITY = {
  high: { farT: 60, nearRadius: 450, nearCache: 48, groundSegU: 32, groundSegV: 128, pixelRatio: 1.5, antialias: true },
  low: { farT: 95, nearRadius: 250, nearCache: 20, groundSegU: 16, groundSegV: 64, pixelRatio: 1, antialias: false },
};
const BIRD_H = 300;

function pickQuality() {
  const q = params.get('q') || store.get('sigil.quality');
  if (q === 'low' || q === 'high') return q;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
  return coarse || cores <= 4 || mem <= 4 ? 'low' : 'high';
}

function fail(message) {
  const e = $('#loading-error');
  $('#loading').classList.remove('done');
  e.hidden = false;
  e.textContent = message;
}

async function boot() {
  const qName = pickQuality(), Q = QUALITY[qName];
  const data = await fetch('data/sigil.json').then((r) => r.json());
  const layout = createLayout(data, { farT: Q.farT });

  const canvas = $('#view');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  } catch (err) {
    fail('WebGL 2 is not available in this browser, so the 3D view cannot run.');
    throw err;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio));
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fail('The graphics context was lost. Reload the page to continue.'); });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.25, 16000);
  const shared = createSharedUniforms();
  if (params.get('fog') === '0') shared.uFogEnabled.value = 0;
  const materials = createMaterials(shared);
  const atmosphere = new Atmosphere(shared, scene, layout.wards);
  const workers = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
  const pool = new WorkerPool(workers, { type: 'init', data, farT: Q.farT });
  const city = new CityRenderer({ scene, pool, layout, materials, quality: Q });

  let heightMode = store.get('sigil.height') || 'street';
  if (!['street', 'rooftop', 'bird'].includes(heightMode)) heightMode = 'street';
  let markerDirty = true;
  let current = null;
  const veil = $('#veil');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const viewer = new Viewer(camera, canvas, { onChange: () => { markerDirty = true; }, onInteract: hideHint });
  const minimap = new Minimap($('#minimap-wrap'), layout, { onPick: (pick) => travel(pick) });

  const eyeHeight = (p, streetH) => (heightMode === 'street' ? streetH : heightMode === 'rooftop' ? layout.rooftopHeight(p.u, p.v) : BIRD_H);

  function resolve(pick) {
    if (pick.landmark) {
      const vp = layout.viewpointOf(pick.landmark);
      return { ...vp, h: eyeHeight(vp, pick.landmark.view.h), fov: 70, landmark: pick.landmark };
    }
    const sp = layout.findStandpoint(pick.u, pick.v);
    return { ...sp, h: eyeHeight(sp, 1.7), fov: 70 };
  }

  function caption(target) {
    if (target.landmark) {
      const lm = target.landmark;
      return { name: lm.name, ward: layout.wards[lm.wardIndex].name, blurb: lm.blurb };
    }
    const w = layout.wards[layout.wardIndexAt(target.u, target.v)];
    const { landmark, distance } = layout.nearestLandmark(target.u, target.v);
    return { name: w.name, ward: '', blurb: w.blurb, extra: `Nearest landmark: ${landmark.name}, ${formatDistance(distance)}.` };
  }

  function writeHash(target) {
    const hash = target.landmark ? `#lm=${target.landmark.id}` : `#at=${target.u.toFixed(5)},${target.v.toFixed(5)}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function arrive(t) {
    city.setFocus(t.u, t.v);
    atmosphere.setWard(layout.wardIndexAt(t.u, t.v));
  }

  async function travel(pick, { instant = false } = {}) {
    const target = resolve(pick);
    current = target;
    writeHash(target);
    setCaption(caption(target));
    if (instant) {
      viewer.set(target);
      arrive(target);
      atmosphere.setWard(layout.wardIndexAt(target.u, target.v), true);
      return true;
    }
    return viewer.flyTo(target, { veil, onCut: arrive, waitReady: () => city.whenNearReady(), reducedMotion });
  }

  function pickFromHash() {
    const lm = /#lm=([\w-]+)/.exec(location.hash);
    if (lm) { const found = layout.landmarks.find((l) => l.id === lm[1]); if (found) return { landmark: found }; }
    const at = /#at=(-?[\d.]+),(-?[\d.]+)/.exec(location.hash);
    if (at) return { u: Number(at[1]), v: Number(at[2]) };
    return null;
  }

  window.addEventListener('hashchange', () => { const p = pickFromHash(); if (p) travel(p); });

  bindSettings({
    atmosphere, heightMode, quality: qName,
    onHeight(mode) {
      heightMode = mode;
      store.set('sigil.height', mode);
      const s = viewer.state;
      viewer.animateHeight(mode === 'street' ? (current?.landmark ? current.landmark.view.h : 1.7) : mode === 'rooftop' ? layout.rooftopHeight(s.u, s.v) : BIRD_H);
    },
    onQuality(q) {
      store.set('sigil.quality', q);
      const url = new URL(location.href);
      url.searchParams.set('q', q);
      location.replace(url);
    },
  });
  bindAbout();

  const capEl = $('#caption');
  new ResizeObserver(() => document.documentElement.style.setProperty('--cap-h', `${capEl.offsetHeight}px`)).observe(capEl);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    markerDirty = true;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- initial view, then load in priority order: near chunks, landmarks, ground, far sectors --------
  const startPick = pickFromHash() || { landmark: layout.landmarks.find((l) => l.id === 'city-court') };
  await travel(startPick, { instant: true });
  const startU = viewer.state.u;

  const loadingBar = $('#loading-bar');
  const nearDone = city.whenNearReady();
  const groundDone = city.loadGround(startU);
  const landmarksDone = city.loadLandmarks();
  let farFraction = 0;
  const farDone = city.loadFar(startU, (f) => { farFraction = f; });
  await pool.ready;
  const initialBusy = Math.max(1, pool.busy);
  const loadTick = setInterval(() => { loadingBar.style.width = `${Math.round(100 * (1 - pool.busy / initialBusy))}%`; }, 120);

  let running = true;
  const fpsEl = $('#fps'), showFps = params.get('fps') === '1';
  fpsEl.hidden = !showFps;
  const frameMs = [];
  let last = performance.now(), statTimer = 0, veilTimer = 0, slowSince = 0;

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    frameMs.push(now - last);
    if (frameMs.length > 120) frameMs.shift();
    last = now;
    viewer.update(dt);
    atmosphere.update(dt);
    city.updateSmoke(dt);
    viewer.apply();
    materials.smoke.uniforms.uScale.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan((camera.fov * Math.PI) / 360));
    renderer.render(scene, camera);
    if (markerDirty) { minimap.setState(viewer.state, camera.aspect); markerDirty = false; }

    if ((veilTimer += dt) > 0.25) {
      veilTimer = 0;
      veil.style.setProperty('--veil', `#${shared.uFogColor.value.getHexString()}`);
    }
    if ((statTimer += dt) > 0.5) {
      statTimer = 0;
      const sorted = [...frameMs].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0, p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
      if (showFps) {
        const i = renderer.info;
        fpsEl.textContent = `p50 ${p50.toFixed(1)} ms  p95 ${p95.toFixed(1)} ms\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\ngeoms ${i.memory.geometries}  near ${city.near.size}  far ${Math.round(farFraction * 100)}%\npool ${pool.mode} busy ${pool.busy}  q ${qName}`;
      }
      // Adaptive fallback: sustained slow frames drop the pixel ratio before anything else.
      if (p50 > 40 && renderer.getPixelRatio() > 1) {
        if (!slowSince) slowSince = now;
        else if (now - slowSince > 3000) { renderer.setPixelRatio(1); resize(); slowSince = 0; }
      } else slowSince = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  await Promise.all([groundDone, landmarksDone, Promise.race([nearDone, sleep(10000)]), Promise.race([
    new Promise((r) => { const t = setInterval(() => { if (farFraction >= 0.2) { clearInterval(t); r(); } }, 100); }), sleep(12000),
  ])]);
  clearInterval(loadTick);
  loadingBar.style.width = '100%';
  $('#loading').classList.add('done');
  window.__sigil.ready = true;
  if (!store.get('sigil.hinted')) { showHint('Drag to look around · look up to see the far side of the ring · click the map to travel', 7000); store.set('sigil.hinted', '1'); }

  const progress = $('#progress'), progressBar = progress.querySelector('i');
  if (farFraction < 1) {
    progress.hidden = false;
    const t = setInterval(() => { progressBar.style.width = `${Math.round(farFraction * 100)}%`; }, 200);
    farDone.then(() => { clearInterval(t); progress.hidden = true; });
  }

  Object.assign(window.__sigil, { layout, city, viewer, renderer, scene, camera, atmosphere, minimap, pool, travel, quality: qName });
}

window.__sigil = { ready: false, get state() { return this.viewer ? { ...this.viewer.state } : null; } };
boot().catch((err) => {
  console.error(err);
  if ($('#loading-error').hidden) fail(`Something went wrong while building the city: ${err.message}`);
});
