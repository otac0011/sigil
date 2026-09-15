// Scene assembly: ground band sectors, far-LOD instanced sectors (whole city), near-LOD chunks streamed
// around the viewer, landmarks and chimney smoke. A chunk is drawn by exactly one LOD: when its near
// mesh is on screen, its byte in the near-mask texture is 255 and the far shader collapses its boxes.

import * as THREE from 'three';
import { N_U, N_V, CHUNK_DU, CHUNK_DV } from '../gen/layout.js';
import { surface, upAt, eUAt, wrapU, TAU, VMAX } from '../math/torus.js';

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angDist = (a, b) => { const d = Math.abs(wrapU(a) - wrapU(b)); return Math.min(d, TAU - d); };

function geometryFrom(g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  geo.setAttribute('aCol', new THREE.BufferAttribute(g.color, 3));
  geo.setAttribute('aWin', new THREE.BufferAttribute(g.win, 2));
  geo.computeBoundingSphere();
  return geo;
}

function placed(mesh, origin) {
  mesh.position.set(origin[0], origin[1], origin[2]);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** Unit box without a bottom: x, z in [-0.5, 0.5], y in [0, 1]. Shared vertex buffers, per-sector instance data. */
function unitBoxAttributes() {
  const P = [], N = [], I = [];
  const face = (pts, n) => {
    const b = P.length / 3;
    for (const p of pts) { P.push(...p); N.push(...n); }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const x0 = -0.5, x1 = 0.5, z0 = -0.5, z1 = 0.5;
  face([[x0, 0, z1], [x1, 0, z1], [x1, 1, z1], [x0, 1, z1]], [0, 0, 1]);
  face([[x1, 0, z1], [x1, 0, z0], [x1, 1, z0], [x1, 1, z1]], [1, 0, 0]);
  face([[x1, 0, z0], [x0, 0, z0], [x0, 1, z0], [x1, 1, z0]], [0, 0, -1]);
  face([[x0, 0, z0], [x0, 0, z1], [x0, 1, z1], [x0, 1, z0]], [-1, 0, 0]);
  face([[x0, 1, z1], [x1, 1, z1], [x1, 1, z0], [x0, 1, z0]], [0, 1, 0]);
  return {
    position: new THREE.Float32BufferAttribute(P, 3),
    normal: new THREE.Float32BufferAttribute(N, 3),
    index: new THREE.Uint16BufferAttribute(I, 1),
  };
}

export class CityRenderer {
  constructor({ scene, pool, layout, materials, quality }) {
    this.scene = scene;
    this.pool = pool;
    this.layout = layout;
    this.mat = materials;
    this.q = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.box = unitBoxAttributes();
    this.near = new Map();      // chunk key -> { mesh | null, used }
    this.requested = new Set();
    this.needed = new Set();
    this.readyWaiters = [];
    this.mask = materials.nearMask.image.data;
    this.farLoaded = 0;
    this.smoke = null;
  }

  key(i, j) { return i + j * N_U; }

  // ---- static content -------------------------------------------------------------------------------

  loadGround(focusU) {
    const sectors = 32, jobs = [];
    const order = [...Array(sectors).keys()].sort((a, b) => angDist(((a + 0.5) / sectors) * TAU, focusU) - angDist(((b + 0.5) / sectors) * TAU, focusU));
    for (const s of order) {
      jobs.push(this.pool.run({ type: 'ground', sector: s, sectors, segU: this.q.groundSegU, segV: this.q.groundSegV }, 1)
        .then((g) => this.group.add(placed(new THREE.Mesh(geometryFrom(g), this.mat.city), g.origin))));
    }
    return Promise.all(jobs);
  }

  loadLandmarks() {
    return this.pool.run({ type: 'landmarks' }, 0).then((list) => {
      const emitters = [];
      for (const g of list) {
        this.group.add(placed(new THREE.Mesh(geometryFrom(g), this.mat.city), g.origin));
        for (let e = 0; e < g.emitters.length; e += 3) {
          emitters.push({ pos: [g.origin[0] + g.emitters[e], g.origin[1] + g.emitters[e + 1], g.origin[2] + g.emitters[e + 2]], up: g.up });
        }
      }
      if (emitters.length) this._addSmoke(emitters);
    });
  }

  loadFar(focusU, onSector) {
    const order = [...Array(N_U).keys()].sort((a, b) => angDist((a + 0.5) * CHUNK_DU, focusU) - angDist((b + 0.5) * CHUNK_DU, focusU));
    return Promise.all(order.map((i, rank) => this.pool.run({ type: 'far', sector: i }, 2 + rank * 1e-3).then((f) => {
      if (f.count) {
        const geo = new THREE.BufferGeometry();
        geo.setIndex(this.box.index);
        geo.setAttribute('position', this.box.position);
        geo.setAttribute('normal', this.box.normal);
        geo.setAttribute('aInstCol', new THREE.InstancedBufferAttribute(f.colors, 3));
        geo.setAttribute('aChunk', new THREE.InstancedBufferAttribute(f.chunks, 1));
        const mesh = new THREE.InstancedMesh(geo, this.mat.far, f.count);
        mesh.instanceMatrix = new THREE.InstancedBufferAttribute(f.matrices, 16);
        mesh.computeBoundingSphere();
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
      }
      this.farLoaded++;
      onSector?.(this.farLoaded / N_U);
    })));
  }

  // ---- near-LOD streaming --------------------------------------------------------------------------

  setFocus(u, v) {
    const R = this.q.nearRadius + 180, p = surface(u, v);
    const ci = Math.floor(wrapU(u) / CHUNK_DU), span = Math.ceil(R / (CHUNK_DU * 3700)) + 1;
    const needed = new Map();
    for (let di = -span; di <= span; di++) {
      const i = (((ci + di) % N_U) + N_U) % N_U;
      for (let j = 0; j < N_V; j++) {
        const d = dist3(p, surface((i + 0.5) * CHUNK_DU, -VMAX + (j + 0.5) * CHUNK_DV));
        if (d < R) needed.set(this.key(i, j), d);
      }
    }
    this.needed = new Set(needed.keys());
    this.pool.cancel((m) => m.type === 'near' && !this.needed.has(this.key(m.i, m.j)));
    const now = performance.now();
    for (const [k, entry] of this.near) this._show(k, entry, this.needed.has(k), now);
    const missing = [...needed.entries()].filter(([k]) => !this.near.has(k) && !this.requested.has(k)).sort((a, b) => a[1] - b[1]);
    for (const [k, d] of missing) {
      this.requested.add(k);
      this.pool.run({ type: 'near', i: k % N_U, j: Math.floor(k / N_U) }, -1 + d * 1e-6)
        .then((g) => this._addNear(k, g))
        .catch((e) => { if (!e.cancelled) console.error(e); })
        .finally(() => { this.requested.delete(k); this._checkReady(); });
    }
    this.mat.nearMask.needsUpdate = true;
    this._evict();
    this._checkReady();
  }

  _show(k, entry, on, now) {
    if (entry.mesh) entry.mesh.visible = on;
    this.mask[k] = on ? 255 : 0;
    if (on) entry.used = now;
  }

  _addNear(k, g) {
    const entry = { mesh: null, used: performance.now() };
    if (g.tris > 0) {
      entry.mesh = placed(new THREE.Mesh(geometryFrom(g), this.mat.city), g.origin);
      this.group.add(entry.mesh);
    }
    this.near.set(k, entry);
    this._show(k, entry, this.needed.has(k), entry.used);
    this.mat.nearMask.needsUpdate = true;
    this._evict();
  }

  _evict() {
    if (this.near.size <= this.q.nearCache) return;
    const idle = [...this.near.entries()].filter(([k]) => !this.needed.has(k)).sort((a, b) => a[1].used - b[1].used);
    for (const [k, entry] of idle) {
      if (this.near.size <= this.q.nearCache) break;
      if (entry.mesh) { this.group.remove(entry.mesh); entry.mesh.geometry.dispose(); }
      this.near.delete(k);
      this.mask[k] = 0;
    }
    this.mat.nearMask.needsUpdate = true;
  }

  get nearReady() { for (const k of this.needed) if (!this.near.has(k)) return false; return true; }

  _checkReady() {
    if (!this.nearReady) return;
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w();
  }

  whenNearReady() {
    return this.nearReady ? Promise.resolve() : new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  // ---- smoke ----------------------------------------------------------------------------------------

  _addSmoke(emitters) {
    const PER = 16, count = emitters.length * PER, origin = emitters[0].pos;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3), age = new Float32Array(count);
    for (let q = 0; q < count; q++) age[q] = (q % PER) / PER + Math.random() * 0.05;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    const points = new THREE.Points(geo, this.mat.smoke);
    points.frustumCulled = false;
    points.renderOrder = 2;
    placed(points, origin);
    this.group.add(points);
    const wind = emitters.map((e) => { const [u] = [Math.atan2(e.pos[2], e.pos[0])]; return eUAt(u); });
    this.smoke = { points, emitters, wind, origin, PER, jitter: Array.from({ length: count }, () => [Math.random() - 0.5, Math.random() - 0.5]) };
    this.updateSmoke(0);
  }

  updateSmoke(dt) {
    const s = this.smoke;
    if (!s) return;
    const pos = s.points.geometry.attributes.position.array, age = s.points.geometry.attributes.aAge.array;
    for (let q = 0; q < age.length; q++) {
      age[q] += dt / 16;
      if (age[q] >= 1) age[q] -= 1;
      const e = s.emitters[Math.floor(q / s.PER)], w = s.wind[Math.floor(q / s.PER)], a = age[q], j = s.jitter[q];
      const rise = a * 95, drift = a * a * 40 + j[0] * 10 * a, side = j[1] * 12 * a;
      for (let c = 0; c < 3; c++) pos[q * 3 + c] = e.pos[c] - s.origin[c] + e.up[c] * rise + w[c] * drift + (c === 1 ? side : 0);
    }
    s.points.geometry.attributes.position.needsUpdate = true;
    s.points.geometry.attributes.aAge.needsUpdate = true;
  }
}
