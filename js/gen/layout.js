// City layout: one deterministic function of (data, seed) shared by the 3D renderer, the mini-map,
// street snapping and the tests. Pure JS (no three) so it runs identically inside workers.
//
// Hierarchy (JOURNAL.md, "City generation"):
//   strips       bands of v between ring avenues (and the rim)
//   superblocks  cells of a strip between jittered cross avenues
//   far nodes    BSP phase A: split with streets/alleys until the longer side <= farT metres.
//                One far-LOD box each, and the unit of chunk membership for both LODs.
//   lots         BSP phase B inside a far node, seeded per node: one detailed building each.

import { r, VMAX, TAU, DEG, metricU, surface, wrapU, walk, headingTo } from '../math/torus.js';
import { mulberry32, hashInts, makeNoise3, range } from '../math/rng.js';

export const N_U = 128;
export const N_V = 16;
export const CHUNK_DU = TAU / N_U;
export const CHUNK_DV = (2 * VMAX) / N_V;
export const RING_AVENUES_DEG = [-72, -38, 0, 38, 72];
const RING_AVENUE_WIDTH = { 0: 22, 38: 14, 72: 12 };
const RIM_MARGIN = 3;

// Per-ward building style. lot = [min, max] lot side (m); street/alley = BSP gap widths (m);
// h = [min, max] wall height (m); arche = archetype weights; rot = max footprint twist (deg).
export const STYLES = {
  ladys: {
    lot: [18, 34], street: 9, alley: 4.5, alleyP: 0.35, h: [12, 28], setback: [1.5, 4], rot: 0,
    arche: { flat: 3, pitched: 2, spire: 3, blades: 2.5, dome: 1, tower: 1.5, courtyard: 1 },
    walls: ['#8e8898', '#7d7888', '#a39db0', '#6f6a78', '#968f86'], roofs: ['#4b4656', '#5a5368', '#3e3a48', '#6d6478'],
  },
  lower: {
    lot: [22, 46], street: 10, alley: 6, alleyP: 0.5, h: [8, 16], setback: [0.5, 2], rot: 0,
    arche: { shed: 5, chimney: 3, flat: 2, pitched: 1 },
    walls: ['#6b5a4a', '#5c4d40', '#7a6450', '#4f4239'], roofs: ['#3a302a', '#4a3b30', '#2f2925', '#5a4232'],
  },
  hive: {
    lot: [7, 13], street: 6, alley: 2.5, alleyP: 0.55, h: [5, 13], setback: [0.2, 1.2], rot: 7,
    arche: { crooked: 5, pitched: 3, flat: 2, blades: 0.4 },
    walls: ['#5e554b', '#6b6054', '#4e473f', '#766957', '#5a5046'], roofs: ['#3b352f', '#4a4038', '#2e2a26', '#57493a'],
  },
  clerks: {
    lot: [14, 26], street: 8, alley: 4, alleyP: 0.4, h: [10, 22], setback: [1, 3], rot: 0,
    arche: { flat: 3, pitched: 2, dome: 2, spire: 1, courtyard: 1 },
    walls: ['#8a8f94', '#7a7f85', '#9aa0a6', '#6e7378'], roofs: ['#474c55', '#3e434b', '#555c66', '#5b5550'],
  },
  guildhall: {
    lot: [11, 22], street: 7, alley: 3.5, alleyP: 0.4, h: [7, 16], setback: [0.5, 2], rot: 2,
    arche: { pitched: 4, flat: 2, chimney: 1, blades: 0.5 },
    walls: ['#86796a', '#766a5c', '#978874', '#6a5f53'], roofs: ['#4c3f35', '#5b4a3c', '#3f352e', '#6a5242'],
  },
  market: {
    lot: [9, 18], street: 8, alley: 3, alleyP: 0.5, h: [5, 12], setback: [0.3, 1.5], rot: 3,
    arche: { stall: 3, pitched: 3, flat: 2 },
    walls: ['#8b7c66', '#7a6c58', '#9b8a70', '#6d6150'], roofs: ['#7a3f2e', '#4e5a3a', '#6a4a2a', '#3f4a5a', '#8a6a3a'],
  },
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function pickFrom(table, x) {
  let total = 0;
  for (const k in table) total += table[k];
  let acc = x * total;
  for (const k in table) { acc -= table[k]; if (acc <= 0) return k; }
  return Object.keys(table)[0];
}

export function chunkOf(u, v) {
  const i = Math.floor(wrapU(u) / CHUNK_DU) % N_U;
  const j = Math.min(N_V - 1, Math.max(0, Math.floor((v + VMAX) / CHUNK_DV)));
  return [i, j];
}

export function createLayout(data, opts = {}) {
  const seed = data.seed | 0;
  const farT = opts.farT ?? 60;
  const noise = makeNoise3(hashInts(seed, 1));

  // ---- wards: shares around the ring, boundaries wobble +-2 deg along v ------------------------
  const total = data.wards.reduce((s, w) => s + w.share, 0);
  let acc = 0;
  const wards = data.wards.map((w, index) => {
    const u0 = (acc / total) * TAU;
    acc += w.share;
    return { ...w, index, u0, u1: (acc / total) * TAU };
  });
  const wobble = (b, v) => 2 * DEG * noise(b * 7.31 + 3.1, v * 2.2, 0.5);
  function wardIndexAt(u, v) {
    const base = wobble(0, v), uu = wrapU(u - base);
    for (let w = wards.length - 1; w > 0; w--) if (uu >= wards[w].u0 + wobble(w, v) - base) return w;
    return 0;
  }
  const styleAt = (u, v) => STYLES[wards[wardIndexAt(u, v)].style];
  const wardBoundaryU = (b, v) => wards[b].u0 + wobble(b, v);

  // ---- smooth height field, seamless around the ring (noise sampled on a cylinder) ----------------
  const K = metricU(0) / 700;
  const heightNoise = (u, v) => noise(K * Math.cos(u), K * Math.sin(u), (v * r) / 700);

  // ---- landmarks --------------------------------------------------------------------------------
  const landmarks = data.landmarks.map((lm) => {
    const w = wards.find((x) => x.id === lm.ward);
    const u = w.u0 + lm.f * (w.u1 - w.u0), v = lm.vDeg * DEG;
    return { ...lm, u, v, p: surface(u, v), wardIndex: w.index };
  });
  function landmarkCovering(p, extra) {
    for (const lm of landmarks) if (dist3(p, lm.p) < lm.plaza + extra) return lm;
    return null;
  }
  function nearestLandmark(u, v) {
    const p = surface(u, v);
    let best = null, bd = Infinity;
    for (const lm of landmarks) { const d = dist3(p, lm.p); if (d < bd) { bd = d; best = lm; } }
    return { landmark: best, distance: bd };
  }
  function viewpointOf(lm) {
    const [vu, vv] = walk(lm.u, lm.v, lm.view.bearingDeg * DEG, lm.view.dist);
    return { u: wrapU(vu), v: vv, psi: headingTo(vu, vv, lm.u, lm.v), theta: lm.view.thetaDeg * DEG, h: lm.view.h };
  }

  // ---- strips and cross avenues -------------------------------------------------------------------
  const edges = [-VMAX, ...RING_AVENUES_DEG.map((d) => d * DEG), VMAX];
  const ringHalf = (vEdge) => (RING_AVENUE_WIDTH[Math.round(Math.abs(vEdge / DEG))] ?? 12) / 2;
  const strips = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const v0 = edges[k], v1 = edges[k + 1], vc = (v0 + v1) / 2;
    const rng = mulberry32(hashInts(seed, 100, k));
    const n = Math.max(8, Math.round((TAU * metricU(vc)) / 430));
    const base = TAU / n, offset = rng() * base;
    const us = [], widths = [];
    for (let m = 0; m < n; m++) {
      us.push(offset + m * base + (rng() - 0.5) * 0.45 * base);
      widths.push(range(rng, 10, 15));
    }
    strips.push({
      k, v0, v1, vc, n, us, widths,
      lo: k === 0 ? RIM_MARGIN : ringHalf(v0),
      hi: k === edges.length - 2 ? RIM_MARGIN : ringHalf(v1),
    });
  }
  const ringAvenues = RING_AVENUES_DEG.map((d) => ({ v: d * DEG, width: RING_AVENUE_WIDTH[Math.abs(d)] }));

  function superblock(k, m) {
    const s = strips[k], n = s.n;
    const ua = s.us[m], ub = m + 1 < n ? s.us[m + 1] : s.us[0] + TAU;
    const mu = metricU(s.vc);
    const u0 = ua + s.widths[m] / 2 / mu, u1 = ub - s.widths[(m + 1) % n] / 2 / mu;
    const v0 = s.v0 + s.lo / r, v1 = s.v1 - s.hi / r;
    return { k, m, u0, u1, v0, v1, W: (u1 - u0) * mu, H: (v1 - v0) * r, rimLo: k === 0, rimHi: k === strips.length - 1 };
  }

  function superblocksOverlapping(uA, uB, vA, vB) {
    const out = [];
    for (const s of strips) {
      if (s.v1 < vA || s.v0 > vB) continue;
      for (let m = 0; m < s.n; m++) {
        const ua = s.us[m], ub = m + 1 < s.n ? s.us[m + 1] : s.us[0] + TAU;
        for (const shift of [-TAU, 0, TAU]) {
          if (ua + shift <= uB && ub + shift >= uA) { out.push([s.k, m]); break; }
        }
      }
    }
    return out;
  }

  const uOf = (sb, a) => sb.u0 + (a / sb.W) * (sb.u1 - sb.u0);
  const vOf = (sb, b) => sb.v0 + b / r;

  // ---- BSP phase A: far nodes ---------------------------------------------------------------------
  const nodeCache = new Map();
  function makeNode(sb, idx, a0, a1, b0, b1) {
    const u = uOf(sb, (a0 + a1) / 2), v = vOf(sb, (b0 + b1) / 2);
    const wi = wardIndexAt(u, v), st = STYLES[wards[wi].style];
    const mu = metricU(v), p = surface(u, v);
    const w = ((a1 - a0) / sb.W) * (sb.u1 - sb.u0) * mu, d = b1 - b0;
    const rim = (sb.rimLo && b0 < 0.5) || (sb.rimHi && b1 > sb.H - 0.5);
    const baseHeight = st.h[0] + (st.h[1] - st.h[0]) * clamp01(0.5 + 0.6 * heightNoise(u, v));
    const [ci, cj] = chunkOf(u, v);
    return {
      k: sb.k, m: sb.m, idx, a0, a1, b0, b1, u, v, p, w, d, ci, cj, rim, baseHeight,
      height: rim ? baseHeight * 2.2 + 12 : baseHeight,
      u0: uOf(sb, a0), u1: uOf(sb, a1), v0: vOf(sb, b0), v1: vOf(sb, b1),
      ward: wi, style: wards[wi].style,
      dropped: !!landmarkCovering(p, 0.5 * Math.hypot(w, d)),
    };
  }

  function farNodes(k, m) {
    const key = k * 1000 + m;
    const hit = nodeCache.get(key);
    if (hit) return hit;
    const sb = superblock(k, m);
    const rng = mulberry32(hashInts(seed, 200, k, m));
    const nodes = [];
    const rec = (a0, a1, b0, b1, depth) => {
      const w = a1 - a0, h = b1 - b0;
      if (w < 2 || h < 2) return;
      const t = range(rng, 0.38, 0.62), flip = rng() < 0.5;
      if (Math.max(w, h) <= farT || depth > 14) { nodes.push(makeNode(sb, nodes.length, a0, a1, b0, b1)); return; }
      const st = styleAt(uOf(sb, (a0 + a1) / 2), vOf(sb, (b0 + b1) / 2));
      const gap = depth < 2 ? st.street : st.alley;
      if (w > h * 1.25 || (h <= w * 1.25 && flip)) {
        const c = a0 + w * t;
        rec(a0, c - gap / 2, b0, b1, depth + 1); rec(c + gap / 2, a1, b0, b1, depth + 1);
      } else {
        const c = b0 + h * t;
        rec(a0, a1, b0, c - gap / 2, depth + 1); rec(a0, a1, c + gap / 2, b1, depth + 1);
      }
    };
    rec(0, sb.W, 0, sb.H, 0);
    nodeCache.set(key, nodes);
    return nodes;
  }

  // ---- BSP phase B: lots inside one far node --------------------------------------------------------
  function lotsOf(node) {
    const sb = superblock(node.k, node.m);
    const rng = mulberry32(hashInts(seed, 300, node.k, node.m, node.idx));
    const lots = [];
    const leaf = (a0, a1, b0, b1, u, v, wi, st) => {
      // Consume a fixed number of rng draws before any rejection so determinism never depends on filtering.
      const hj = range(rng, 0.7, 1.3), archeX = rng(), twist = (rng() - 0.5) * 2 * st.rot * DEG;
      const setback = range(rng, st.setback[0], st.setback[1]), colorSeed = (rng() * 0x7fffffff) | 0;
      const w = ((a1 - a0) / sb.W) * (sb.u1 - sb.u0) * metricU(v), d = b1 - b0, p = surface(u, v);
      if (landmarkCovering(p, 0.3 * Math.hypot(w, d))) return;
      const rim = (sb.rimLo && b0 < 0.5) || (sb.rimHi && b1 > sb.H - 0.5);
      let height = node.baseHeight * hj, arche = pickFrom(st.arche, archeX);
      if (rim) { height = height * 2.2 + 12; arche = archeX < 0.5 ? 'flat' : 'blades'; }
      lots.push({
        u, v, w, d, height, arche, rot: twist, setback, colorSeed, rim, ward: wi, style: wards[wi].style,
        u0: uOf(sb, a0), u1: uOf(sb, a1), v0: vOf(sb, b0), v1: vOf(sb, b1), rimSide: sb.rimLo ? -1 : 1,
      });
    };
    const rec = (a0, a1, b0, b1, depth) => {
      const w = a1 - a0, h = b1 - b0;
      if (w < 1.5 || h < 1.5) return;
      const u = uOf(sb, (a0 + a1) / 2), v = vOf(sb, (b0 + b1) / 2);
      const wi = wardIndexAt(u, v), st = STYLES[wards[wi].style];
      const limit = range(rng, st.lot[0], st.lot[1]), t = range(rng, 0.36, 0.64), flip = rng() < 0.5;
      const alley = rng() < st.alleyP ? st.alley : 0;
      const long = Math.max(w, h);
      if (long <= limit || long < 1.6 * st.lot[0] + alley || depth > 16) { leaf(a0, a1, b0, b1, u, v, wi, st); return; }
      if (w > h * 1.2 || (h <= w * 1.2 && flip)) {
        const c = a0 + w * t;
        rec(a0, c - alley / 2, b0, b1, depth + 1); rec(c + alley / 2, a1, b0, b1, depth + 1);
      } else {
        const c = b0 + h * t;
        rec(a0, a1, b0, c - alley / 2, depth + 1); rec(a0, a1, c + alley / 2, b1, depth + 1);
      }
    };
    rec(node.a0, node.a1, node.b0, node.b1, 0);
    return lots;
  }

  // ---- queries -----------------------------------------------------------------------------------------
  function farNodesInChunk(i, j) {
    const u0 = i * CHUNK_DU, v0 = -VMAX + j * CHUNK_DV, out = [];
    for (const [k, m] of superblocksOverlapping(u0, u0 + CHUNK_DU, v0, v0 + CHUNK_DV))
      for (const nd of farNodes(k, m)) if (nd.ci === i && nd.cj === j) out.push(nd);
    return out;
  }

  function farNodesInSector(i) {
    const u0 = i * CHUNK_DU, out = [];
    for (const [k, m] of superblocksOverlapping(u0, u0 + CHUNK_DU, -VMAX, VMAX))
      for (const nd of farNodes(k, m)) if (nd.ci === i) out.push(nd);
    return out;
  }

  const lotsInChunk = (i, j) => farNodesInChunk(i, j).flatMap(lotsOf);

  function obstaclesNear(u, v, radius) {
    const du = radius / metricU(v) + 0.02, dv = radius / r + 0.02, p = surface(u, v), lots = [];
    for (const [k, m] of superblocksOverlapping(u - du, u + du, v - dv, v + dv))
      for (const nd of farNodes(k, m)) if (dist3(nd.p, p) <= radius + farT) lots.push(...lotsOf(nd));
    return lots;
  }

  function insideLot(lot, u, v, margin) {
    const du = wrapU(u - lot.u0 + Math.PI) - Math.PI, mu = metricU(v);
    return du >= -margin / mu && du <= lot.u1 - lot.u0 + margin / mu && v >= lot.v0 - margin / r && v <= lot.v1 + margin / r;
  }

  function blockedAt(u, v, lots, margin) {
    if (Math.abs(v) > VMAX - 12 / r) return true;
    const p = surface(u, v);
    for (const lm of landmarks) if (dist3(p, lm.p) < lm.footprint + 6) return true;
    for (const lot of lots) if (insideLot(lot, u, v, margin)) return true;
    return false;
  }

  /** Nearest open ground to (u, v), facing the longest clear sightline (biased toward the nearest landmark). */
  function findStandpoint(u, v) {
    const lots = obstaclesNear(u, v, 220);
    let at = null;
    search: for (let ring = 0; ring <= 32; ring++) {
      const rad = ring * 2.5, steps = ring === 0 ? 1 : Math.ceil((TAU * rad) / 2.5);
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * TAU;
        const cu = u + (Math.cos(ang) * rad) / metricU(v), cv = v + (Math.sin(ang) * rad) / r;
        if (!blockedAt(cu, cv, lots, 1.5)) { at = [cu, cv]; break search; }
      }
    }
    if (!at) at = [u, Math.max(-VMAX + 20 / r, Math.min(VMAX - 20 / r, v))];
    const { landmark } = nearestLandmark(at[0], at[1]);
    const toLm = headingTo(at[0], at[1], landmark.u, landmark.v);
    let bestPsi = toLm, bestScore = -Infinity;
    for (let s = 0; s < 24; s++) {
      const psi = (s / 24) * TAU;
      let len = 0;
      for (let dd = 4; dd <= 240; dd += 4) {
        const cu = at[0] + (Math.cos(psi) * dd) / metricU(at[1]), cv = at[1] + (Math.sin(psi) * dd) / r;
        if (blockedAt(cu, cv, lots, 0)) break;
        len = dd;
      }
      const score = len + 25 * Math.cos(psi - toLm);
      if (score > bestScore) { bestScore = score; bestPsi = psi; }
    }
    return { u: wrapU(at[0]), v: at[1], psi: bestPsi, theta: 15 * DEG };
  }

  /** Eye height that clears nearby roofs for the "Rooftop" view mode. */
  function rooftopHeight(u, v, minimum = 40) {
    let top = 0;
    for (const lot of obstaclesNear(u, v, 30)) if (insideLot(lot, u, v, 15)) top = Math.max(top, lot.height * 1.6);
    return Math.max(minimum, top + 4);
  }

  return {
    seed, farT, wards, strips, ringAvenues, landmarks, STYLES,
    wardIndexAt, styleAt, wardBoundaryU, nearestLandmark, viewpointOf,
    superblock, superblocksOverlapping, farNodes, lotsOf,
    farNodesInChunk, farNodesInSector, lotsInChunk, obstaclesNear, insideLot, blockedAt,
    findStandpoint, rooftopHeight,
  };
}
