// City geometry, pure JS (no three): every builder returns transferable typed arrays.
// Colours are baked "sourceless light": flat shade by face orientation + ground-contact darkening.
// Colour channels above 1.0 mean emissive (glass, braziers); the shader skips lighting for them.
// Window UVs are metres (along the wall, height); v < 0 means "no windows".

import { frameAt, rotateFrame, surface, upAt, TAU, VMAX } from '../math/torus.js';
import { mulberry32, hashInts, range } from '../math/rng.js';
import { STYLES, N_U, CHUNK_DU, CHUNK_DV } from './layout.js';

export const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const PALETTES = Object.fromEntries(
  Object.entries(STYLES).map(([k, s]) => [k, { walls: s.walls.map(hexToRgb), roofs: s.roofs.map(hexToRgb) }]),
);
export const IRON = [0.21, 0.2, 0.23];
const VINE = [0.1, 0.13, 0.09];
const BRICK = [0.34, 0.25, 0.21];
const GLASS = [0.26, 0.26, 0.27];

const jitter = (c, rng, amt) => { const k = 1 + (rng() - 0.5) * 2 * amt; return [c[0] * k, c[1] * k, c[2] * k]; };
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];

export class MeshBuilder {
  constructor(origin, capTris = 4096) {
    this.origin = origin;
    this.cap = capTris;
    this.n = 0;
    this.pos = new Float32Array(capTris * 9);
    this.col = new Float32Array(capTris * 9);
    this.win = new Float32Array(capTris * 6);
    this.f = null;
  }

  setFrame(f) { this.f = f; }

  grow(extra) {
    if (this.n + extra <= this.cap) return;
    let cap = this.cap * 2;
    while (cap < this.n + extra) cap *= 2;
    const p = new Float32Array(cap * 9), c = new Float32Array(cap * 9), w = new Float32Array(cap * 6);
    p.set(this.pos); c.set(this.col); w.set(this.win);
    this.pos = p; this.col = c; this.win = w; this.cap = cap;
  }

  _vert(k, x, y, z, color, s, emissive, w) {
    const f = this.f, o3 = k * 3, o2 = k * 2;
    this.pos[o3] = f.p[0] + f.x[0] * x + f.y[0] * y + f.z[0] * z - this.origin[0];
    this.pos[o3 + 1] = f.p[1] + f.x[1] * x + f.y[1] * y + f.z[1] * z - this.origin[1];
    this.pos[o3 + 2] = f.p[2] + f.x[2] * x + f.y[2] * y + f.z[2] * z - this.origin[2];
    const lit = emissive ? 1 : s * (y < 4 ? 0.7 + 0.075 * Math.max(0, y) : 1);
    this.col[o3] = color[0] * lit; this.col[o3 + 1] = color[1] * lit; this.col[o3 + 2] = color[2] * lit;
    if (w) { this.win[o2] = w[0]; this.win[o2 + 1] = w[1]; } else { this.win[o2] = 0; this.win[o2 + 1] = -1; }
  }

  /** Triangle in frame-local coords. If `inside` is given, winding is fixed to face away from it. */
  tri(a, b, c, color, wa = null, wb = null, wc = null, inside = null) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    if (inside) {
      const gx = (a[0] + b[0] + c[0]) / 3 - inside[0], gy = (a[1] + b[1] + c[1]) / 3 - inside[1], gz = (a[2] + b[2] + c[2]) / 3 - inside[2];
      if (nx * gx + ny * gy + nz * gz < 0) {
        let t = b; b = c; c = t; t = wb; wb = wc; wc = t;
        nx = -nx; ny = -ny; nz = -nz;
      }
    }
    this.grow(1);
    const emissive = color[0] > 1 || color[1] > 1 || color[2] > 1;
    const s = (ny >= 0 ? 0.62 + 0.38 * ny : 0.62 + 0.22 * ny) + 0.1 * Math.abs(nx);
    const k = this.n * 3;
    this._vert(k, a[0], a[1], a[2], color, s, emissive, wa);
    this._vert(k + 1, b[0], b[1], b[2], color, s, emissive, wb);
    this._vert(k + 2, c[0], c[1], c[2], color, s, emissive, wc);
    this.n++;
  }

  tri2(a, b, c, color) { this.tri(a, b, c, color); this.tri(a, c, b, color); }

  quad(a, b, c, d, color, w = null, inside = null) {
    this.tri(a, b, c, color, w && w[0], w && w[1], w && w[2], inside);
    this.tri(a, c, d, color, w && w[0], w && w[2], w && w[3], inside);
  }

  /** Triangle already in world coordinates with per-vertex colours; winding must already face the viewer. */
  triWorld(a, b, c, ca, cb, cc) {
    this.grow(1);
    const k = this.n * 3, O = this.origin;
    const put = (i, p, col) => {
      this.pos[i * 3] = p[0] - O[0]; this.pos[i * 3 + 1] = p[1] - O[1]; this.pos[i * 3 + 2] = p[2] - O[2];
      this.col[i * 3] = col[0]; this.col[i * 3 + 1] = col[1]; this.col[i * 3 + 2] = col[2];
      this.win[i * 2] = 0; this.win[i * 2 + 1] = -1;
    };
    put(k, a, ca); put(k + 1, b, cb); put(k + 2, c, cc);
    this.n++;
  }

  box(x0, x1, y0, y1, z0, z1, wall, top, winOff = -1) {
    const cIn = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const W = x1 - x0, D = z1 - z0, o = winOff;
    const wq = winOff >= 0 && y1 - y0 > 3.5 ? (ua, ub) => [[ua, y0], [ub, y0], [ub, y1], [ua, y1]] : () => null;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], wall, wq(o, o + W), cIn);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], wall, wq(o + W, o + W + D), cIn);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], wall, wq(o + W + D, o + 2 * W + D), cIn);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], wall, wq(o + 2 * W + D, o + 2 * W + 2 * D), cIn);
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, null, cIn);
  }

  gable(x0, x1, z0, z1, y, rh, roof, wall, alongX) {
    const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2, cIn = [xm, y, zm];
    if (alongX) {
      this.quad([x0, y, z1], [x1, y, z1], [x1, y + rh, zm], [x0, y + rh, zm], roof, null, cIn);
      this.quad([x1, y, z0], [x0, y, z0], [x0, y + rh, zm], [x1, y + rh, zm], roof, null, cIn);
      this.tri([x0, y, z0], [x0, y, z1], [x0, y + rh, zm], wall, null, null, null, cIn);
      this.tri([x1, y, z1], [x1, y, z0], [x1, y + rh, zm], wall, null, null, null, cIn);
    } else {
      this.quad([x1, y, z0], [x1, y, z1], [xm, y + rh, z1], [xm, y + rh, z0], roof, null, cIn);
      this.quad([x0, y, z1], [x0, y, z0], [xm, y + rh, z0], [xm, y + rh, z1], roof, null, cIn);
      this.tri([x0, y, z1], [x1, y, z1], [xm, y + rh, z1], wall, null, null, null, cIn);
      this.tri([x1, y, z0], [x0, y, z0], [xm, y + rh, z0], wall, null, null, null, cIn);
    }
  }

  pyramid(x0, x1, z0, z1, y, h, color, lean = null) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, lx = lean ? lean[0] : 0, lz = lean ? lean[1] : 0;
    const A = [cx + lx, y + h, cz + lz], cIn = [cx + lx / 3, y + h / 3, cz + lz / 3];
    this.tri([x0, y, z1], [x1, y, z1], A, color, null, null, null, cIn);
    this.tri([x1, y, z1], [x1, y, z0], A, color, null, null, null, cIn);
    this.tri([x1, y, z0], [x0, y, z0], A, color, null, null, null, cIn);
    this.tri([x0, y, z0], [x0, y, z1], A, color, null, null, null, cIn);
  }

  spike(cx, cz, half, y, h, color, lean = null) { this.pyramid(cx - half, cx + half, cz - half, cz + half, y, h, color, lean); }

  cylinder(cx, cz, rad, y0, y1, sides, color, top = null, winOff = -1) {
    const cIn = [cx, (y0 + y1) / 2, cz], seg = (TAU * rad) / sides;
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * TAU, a1 = ((s + 1) / sides) * TAU;
      const x0 = cx + rad * Math.cos(a0), z0 = cz + rad * Math.sin(a0), x1 = cx + rad * Math.cos(a1), z1 = cz + rad * Math.sin(a1);
      const w = winOff >= 0 ? [[winOff + s * seg, y0], [winOff + (s + 1) * seg, y0], [winOff + (s + 1) * seg, y1], [winOff + s * seg, y1]] : null;
      this.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], color, w, cIn);
      if (top) this.tri([cx, y1, cz], [x0, y1, z0], [x1, y1, z1], top, null, null, null, [cx, y1 - 1, cz]);
    }
  }

  cone(cx, cz, rad, y0, h, sides, color) {
    const A = [cx, y0 + h, cz], cIn = [cx, y0 + h / 3, cz];
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * TAU, a1 = ((s + 1) / sides) * TAU;
      this.tri([cx + rad * Math.cos(a0), y0, cz + rad * Math.sin(a0)], [cx + rad * Math.cos(a1), y0, cz + rad * Math.sin(a1)], A, color, null, null, null, cIn);
    }
  }

  dome(cx, cz, rad, y0, sides, rings, color, squash = 1) {
    const cIn = [cx, y0, cz];
    for (let i = 0; i < rings; i++) {
      const t0 = (i / rings) * (Math.PI / 2), t1 = ((i + 1) / rings) * (Math.PI / 2);
      const r0 = rad * Math.cos(t0), r1 = rad * Math.cos(t1);
      const h0 = y0 + rad * squash * Math.sin(t0), h1 = y0 + rad * squash * Math.sin(t1);
      for (let s = 0; s < sides; s++) {
        const a0 = (s / sides) * TAU, a1 = ((s + 1) / sides) * TAU;
        const A = [cx + r0 * Math.cos(a0), h0, cz + r0 * Math.sin(a0)], B = [cx + r0 * Math.cos(a1), h0, cz + r0 * Math.sin(a1)];
        if (i === rings - 1) this.tri(A, B, [cx, h1, cz], color, null, null, null, cIn);
        else this.quad(A, B, [cx + r1 * Math.cos(a1), h1, cz + r1 * Math.sin(a1)], [cx + r1 * Math.cos(a0), h1, cz + r1 * Math.sin(a0)], color, null, cIn);
      }
    }
  }

  finish() {
    const v = this.n * 3;
    return { position: this.pos.slice(0, v * 3), color: this.col.slice(0, v * 3), win: this.win.slice(0, v * 2), tris: this.n };
  }
}

// ---- buildings ---------------------------------------------------------------------------------------

function razorvine(b, rng, hw, hd, H) {
  const z = hd + 0.07, top = H - 0.15;
  for (let x = -hw; x < hw - 0.9; x += 0.9) b.tri2([x, top, z], [x + 0.45, H + range(rng, 0.35, 0.9), z], [x + 0.9, top, z], VINE);
  const vx = range(rng, -hw * 0.7, hw * 0.7), low = H * range(rng, 0.25, 0.6);
  for (let y = top; y > low; y -= 0.8) b.tri2([vx - 0.35, y, z], [vx + 0.35, y - 0.4, z], [vx - 0.2, y - 0.8, z], VINE);
}

function crookedBox(b, rng, hw, hd, H, wall, roof, winOff) {
  const j = () => (rng() - 0.5) * 0.9;
  const t = [[-hw + j(), H + j(), hd + j()], [hw + j(), H + j(), hd + j()], [hw + j(), H + j(), -hd + j()], [-hw + j(), H + j(), -hd + j()]];
  const g = [[-hw, 0, hd], [hw, 0, hd], [hw, 0, -hd], [-hw, 0, -hd]];
  const cIn = [0, H / 2, 0], per = [0, 2 * hw, 2 * hw + 2 * hd, 4 * hw + 2 * hd, 4 * hw + 4 * hd];
  for (let s = 0; s < 4; s++) {
    const e = (s + 1) % 4, ua = winOff + per[s], ub = winOff + per[s + 1];
    b.quad(g[s], g[e], t[e], t[s], wall, H > 3.5 ? [[ua, 0], [ub, 0], [ub, t[e][1]], [ua, t[s][1]]] : null, cIn);
  }
  if (rng() < 0.6) {
    const ridge = Math.min(hw, hd) * range(rng, 0.5, 0.9), mid = (a, c) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 + ridge, (a[2] + c[2]) / 2];
    const r0 = mid(t[0], t[3]), r1 = mid(t[1], t[2]);
    b.quad(t[0], t[1], r1, r0, roof, null, cIn);
    b.quad(t[2], t[3], r0, r1, roof, null, cIn);
    b.tri(t[1], t[2], r1, wall, null, null, null, cIn);
    b.tri(t[3], t[0], r0, wall, null, null, null, cIn);
  } else {
    b.quad(t[0], t[1], t[2], t[3], roof, null, cIn);
  }
}

export function buildLot(b, lot) {
  const pal = PALETTES[lot.style];
  const rng = mulberry32(lot.colorSeed);
  const f0 = frameAt(lot.u, lot.v);
  b.setFrame(lot.rot ? rotateFrame(f0, lot.rot) : f0);
  const wall = jitter(pick(pal.walls, rng), rng, 0.08), roof = jitter(pick(pal.roofs, rng), rng, 0.08);
  const hw = Math.max(1.6, lot.w / 2 - lot.setback), hd = Math.max(1.6, lot.d / 2 - lot.setback);
  const H = Math.max(3, lot.height), wo = (lot.colorSeed % 211) * 3.2;

  switch (lot.arche) {
    case 'pitched':
      b.box(-hw, hw, 0, H, -hd, hd, wall, roof, wo);
      b.gable(-hw - 0.4, hw + 0.4, -hd - 0.4, hd + 0.4, H, Math.min(hw, hd) * range(rng, 0.6, 1.0), roof, wall, hw >= hd);
      break;
    case 'spire':
      b.box(-hw, hw, 0, H, -hd, hd, wall, roof, wo);
      b.pyramid(-hw * 0.8, hw * 0.8, -hd * 0.8, hd * 0.8, H, H * range(rng, 0.8, 1.6), roof);
      if (rng() < 0.4) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.spike(sx * (hw - 0.6), sz * (hd - 0.6), 0.5, H, H * 0.35, IRON);
      break;
    case 'blades': {
      b.box(-hw, hw, 0, H, -hd, hd, wall, roof, wo);
      const count = 3 + Math.floor(rng() * 4);
      for (let q = 0; q < count; q++) {
        const sx = range(rng, -hw + 0.8, hw - 0.8), sz = rng() < 0.5 ? -hd + 0.8 : hd - 0.8;
        const h = H * range(rng, 0.35, 0.95);
        b.spike(sx, sz, range(rng, 0.45, 0.9), H, h, IRON, [sx * 0.08, sz * 0.12]);
      }
      break;
    }
    case 'dome':
      b.box(-hw, hw, 0, H, -hd, hd, wall, roof, wo);
      b.dome(0, 0, Math.min(hw, hd) * 0.85, H, 10, 4, rng() < 0.3 ? [0.36, 0.46, 0.43] : roof);
      break;
    case 'tower':
      b.box(-hw, hw, 0, H * 0.5, -hd, hd, wall, roof, wo);
      b.box(-hw * 0.55, hw * 0.55, H * 0.5, H * 1.9, -hd * 0.55, hd * 0.55, wall, roof, wo);
      b.pyramid(-hw * 0.6, hw * 0.6, -hd * 0.6, hd * 0.6, H * 1.9, H * 0.7, roof);
      break;
    case 'courtyard': {
      const t = Math.max(3, Math.min(hw, hd) * 0.32);
      b.box(-hw, hw, 0, H, hd - t, hd, wall, roof, wo);
      b.box(-hw, hw, 0, H, -hd, -hd + t, wall, roof, wo + 50);
      b.box(-hw, -hw + t, 0, H, -hd + t, hd - t, wall, roof, wo + 100);
      b.box(hw - t, hw, 0, H, -hd + t, hd - t, wall, roof, wo + 150);
      break;
    }
    case 'shed': case 'chimney': {
      b.box(-hw, hw, 0, H, -hd, hd, wall, roof, wo);
      if (lot.arche === 'shed') {
        const teeth = Math.max(2, Math.round((2 * hw) / 8)), step = (2 * hw) / teeth, th = Math.min(4, step * 0.4);
        for (let q = 0; q < teeth; q++) {
          const xa = -hw + q * step, xb = xa + step, cIn = [(xa + xb) / 2, H - 1, 0];
          b.quad([xa, H, -hd], [xa, H, hd], [xb, H + th, hd], [xb, H + th, -hd], roof, null, cIn);
          b.quad([xb, H, hd], [xb, H, -hd], [xb, H + th, -hd], [xb, H + th, hd], GLASS, null, [xb - 1, H, 0]);
          b.tri([xa, H, hd], [xb, H, hd], [xb, H + th, hd], roof, null, null, null, cIn);
          b.tri([xa, H, -hd], [xb, H, -hd], [xb, H + th, -hd], roof, null, null, null, cIn);
        }
      }
      const stacks = lot.arche === 'chimney' ? 1 + Math.floor(rng() * 3) : rng() < 0.4 ? 1 : 0;
      for (let q = 0; q < stacks; q++) {
        const rad = range(rng, 1, 2.2), cx = range(rng, -hw + rad, hw - rad), cz = range(rng, -hd + rad, hd - rad);
        b.cylinder(cx, cz, rad, H, H + range(rng, 10, 26), 8, BRICK, IRON);
      }
      break;
    }
    case 'crooked':
      crookedBox(b, rng, hw, hd, H, wall, roof, wo);
      break;
    case 'stall': {
      const nx = hw > 6 ? 2 : 1, nz = hd > 6 ? 2 : 1, cw = (2 * hw) / nx, cd = (2 * hd) / nz;
      for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        if (rng() < 0.2) continue;
        const x0 = -hw + ix * cw + 0.8, x1 = x0 + cw - 1.6, z0 = -hd + iz * cd + 0.8, z1 = z0 + cd - 1.6;
        const h = range(rng, 2.4, 3.2), canopy = jitter(pick(pal.roofs, rng), rng, 0.15);
        b.box(x0, x1, 0, h, z0, z1, wall, wall);
        b.pyramid(x0 - 0.6, x1 + 0.6, z0 - 0.6, z1 + 0.6, h, range(rng, 0.8, 1.6), canopy);
      }
      break;
    }
    default: // flat
      b.box(-hw, hw, 0, H, -hd, hd, wall, roof, wo);
      if (rng() < 0.35) {
        const sx = hw * range(rng, 0.2, 0.45), sz = hd * range(rng, 0.2, 0.45);
        const ox = (rng() - 0.5) * (hw - sx), oz = (rng() - 0.5) * (hd - sz);
        b.box(ox - sx, ox + sx, H, H + range(rng, 2, 4), oz - sz, oz + sz, wall, roof);
      }
  }

  const vineP = lot.style === 'hive' ? 0.3 : lot.style === 'lower' ? 0.25 : 0.07;
  if (lot.arche !== 'stall' && rng() < vineP) razorvine(b, rng, hw, hd, H);
}

// ---- LOD payloads ------------------------------------------------------------------------------------

const FAR_HEIGHT = { ladys: 1.15, lower: 1.05, hive: 1.0, clerks: 1.08, guildhall: 1.05, market: 0.95 };

/** Far LOD for one u-sector: one instanced unit box per far node (matrix columns: e_u*w, n*h, -e_v*d, p). */
export function buildFarSector(layout, i) {
  const nodes = layout.farNodesInSector(i).filter((nd) => !nd.dropped);
  const N = nodes.length;
  const matrices = new Float32Array(N * 16), colors = new Float32Array(N * 3), chunks = new Float32Array(N);
  for (let q = 0; q < N; q++) {
    const nd = nodes[q], f = frameAt(nd.u, nd.v), o = q * 16;
    const rng = mulberry32(hashInts(layout.seed, 400, nd.k, nd.m, nd.idx));
    const w = Math.max(2, nd.w - 1.2), d = Math.max(2, nd.d - 1.2), h = nd.height * FAR_HEIGHT[nd.style] * range(rng, 0.85, 1.15);
    matrices[o] = f.x[0] * w; matrices[o + 1] = f.x[1] * w; matrices[o + 2] = f.x[2] * w;
    matrices[o + 4] = f.y[0] * h; matrices[o + 5] = f.y[1] * h; matrices[o + 6] = f.y[2] * h;
    matrices[o + 8] = f.z[0] * d; matrices[o + 9] = f.z[1] * d; matrices[o + 10] = f.z[2] * d;
    matrices[o + 12] = f.p[0]; matrices[o + 13] = f.p[1]; matrices[o + 14] = f.p[2]; matrices[o + 15] = 1;
    const c = jitter(pick(PALETTES[nd.style].walls, rng), rng, 0.1);
    colors[q * 3] = c[0]; colors[q * 3 + 1] = c[1]; colors[q * 3 + 2] = c[2];
    chunks[q] = nd.ci + nd.cj * N_U;
  }
  return { sector: i, count: N, matrices, colors, chunks };
}

/** Near LOD for one chunk: every lot as detailed merged geometry, positions relative to the chunk centre. */
export function buildNearChunk(layout, i, j) {
  const origin = surface((i + 0.5) * CHUNK_DU, -VMAX + (j + 0.5) * CHUNK_DV);
  const b = new MeshBuilder(origin, 8192);
  const lots = layout.lotsInChunk(i, j);
  for (const lot of lots) buildLot(b, lot);
  return { i, j, origin, lots: lots.length, ...b.finish() };
}

/** Ground band for one of `sectors` u-sectors, plus the rim walls at both band edges. */
export function buildGroundSector(layout, s, sectors, segU, segV) {
  const du = TAU / sectors, u0 = s * du, origin = surface(u0 + du / 2, 0);
  const b = new MeshBuilder(origin, segU * segV * 2 + segU * 4);
  const grounds = layout.wards.map((w) => hexToRgb(w.ground));
  const pts = [], cols = [];
  for (let jj = 0; jj <= segV; jj++) {
    const v = -VMAX + (jj / segV) * 2 * VMAX, edge = 1 - 0.22 * Math.pow(Math.abs(v) / VMAX, 6);
    for (let ii = 0; ii <= segU; ii++) {
      const u = u0 + (ii / segU) * du, g = grounds[layout.wardIndexAt(u, v)];
      const k = edge * (0.92 + 0.12 * ((hashInts(layout.seed, 7, Math.round(u * 1e4), jj) % 1000) / 1000));
      pts.push(surface(u, v));
      cols.push([g[0] * k, g[1] * k, g[2] * k]);
    }
  }
  const at = (ii, jj) => jj * (segU + 1) + ii;
  for (let jj = 0; jj < segV; jj++) for (let ii = 0; ii < segU; ii++) {
    const a = at(ii, jj), bb = at(ii + 1, jj), c = at(ii, jj + 1), d = at(ii + 1, jj + 1);
    b.triWorld(pts[a], pts[bb], pts[c], cols[a], cols[bb], cols[c]);   // (u, v) -> (u+du) -> (v+dv) faces +n
    b.triWorld(pts[bb], pts[d], pts[c], cols[bb], cols[d], cols[c]);
  }
  const RIM = [0.23, 0.22, 0.25];
  for (const v of [-VMAX, VMAX]) {
    for (let ii = 0; ii < segU; ii++) {
      const ua = u0 + (ii / segU) * du, ub = u0 + ((ii + 1) / segU) * du;
      const pa = surface(ua, v), pb = surface(ub, v), na = upAt(ua, v), nb = upAt(ub, v);
      const ta = [pa[0] + na[0] * 28, pa[1] + na[1] * 28, pa[2] + na[2] * 28], tb = [pb[0] + nb[0] * 28, pb[1] + nb[1] * 28, pb[2] + nb[2] * 28];
      b.triWorld(pa, pb, tb, RIM, RIM, RIM); b.triWorld(pa, tb, pb, RIM, RIM, RIM);
      b.triWorld(pa, tb, ta, RIM, RIM, RIM); b.triWorld(pa, ta, tb, RIM, RIM, RIM);
    }
  }
  return { sector: s, origin, ...b.finish() };
}
