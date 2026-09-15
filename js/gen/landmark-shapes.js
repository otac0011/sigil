// Original procedural landmark designs (no official art referenced). Pure JS, no three.
// Local frame per landmark: origin at its centre, y up, +z facing its curated viewpoint.

import { frameAt, rotateFrame, surface, upAt, metricU, r, TAU, DEG } from '../math/torus.js';
import { mulberry32, hashInts, range } from '../math/rng.js';
import { MeshBuilder, hexToRgb, IRON } from './mesh-build.js';

const STONE_L = [0.64, 0.61, 0.68], STONE = [0.52, 0.5, 0.56], STONE_D = [0.38, 0.36, 0.41];
const DARK = [0.15, 0.14, 0.16], DARK2 = [0.22, 0.2, 0.23], WARM = [0.66, 0.58, 0.48];
const ROOF_D = [0.3, 0.28, 0.33], COPPER = [0.62, 0.46, 0.28], BRICK = [0.36, 0.26, 0.21];
const FIRE = [1.9, 1.0, 0.35], EMBER = [1.8, 0.45, 0.2], GHOST = [0.5, 1.2, 0.75], STAINED = [1.5, 1.05, 1.6], LANTERN = [1.7, 1.2, 0.6];
const CANOPIES = [[0.62, 0.22, 0.18], [0.24, 0.42, 0.3], [0.66, 0.5, 0.2], [0.3, 0.32, 0.55], [0.5, 0.26, 0.45], [0.7, 0.62, 0.45]];

function ring(b, hx, hz, t, y, h, wall, top, wo) {
  b.box(-hx, hx, 0, y + h, hz - t, hz, wall, top, wo);
  b.box(-hx, hx, 0, y + h, -hz, -hz + t, wall, top, wo + 60);
  b.box(-hx, -hx + t, 0, y + h, -hz + t, hz - t, wall, top, wo + 120);
  b.box(hx - t, hx, 0, y + h, -hz + t, hz - t, wall, top, wo + 180);
}

function columns(b, x0, x1, z, count, rad, y0, y1, color) {
  for (let i = 0; i < count; i++) b.cylinder(x0 + ((x1 - x0) * i) / (count - 1), z, rad, y0, y1, 8, color, color);
}

const SHAPES = {
  court(b) {
    b.box(-42, 42, 0, 3, -28, 28, STONE_D, STONE_L);
    b.box(-20, 20, 0, 1.5, 28, 34, STONE_L, STONE_L);
    b.box(-34, 34, 3, 26, -20, 20, STONE, ROOF_D, 0);
    for (let i = 0; i < 7; i++) {
      const x = -27 + i * 9, h = 30 + 18 * (1 - Math.abs(i - 3) / 3);
      b.spike(x, 22, 1.3, 3, h, IRON, [0, 2.2]);
    }
    b.box(-8, 8, 26, 56, -8, 8, STONE_L, ROOF_D, 300);
    b.pyramid(-9, 9, -9, 9, 56, 34, IRON);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.spike(sx * 32, sz * 18, 1, 26, 16, IRON, [sx * 1.5, 0]);
  },
  prison(b) {
    ring(b, 54, 54, 6, 0, 20, DARK2, STONE_D, 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      b.box(sx * 54 - 6, sx * 54 + 6, 0, 36, sz * 54 - 6, sz * 54 + 6, DARK2, STONE_D, 400);
      b.pyramid(sx * 54 - 6.5, sx * 54 + 6.5, sz * 54 - 6.5, sz * 54 + 6.5, 36, 14, IRON);
    }
    b.box(-14, 14, 0, 42, -14, 14, STONE_D, DARK, 500);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      b.spike(Math.cos(a) * 12, Math.sin(a) * 12, 0.8, 42, 9, IRON, [Math.cos(a) * 1.5, Math.sin(a) * 1.5]);
    }
    b.box(-7, 7, 0, 14, 54, 58, DARK, DARK);
  },
  armory(b) {
    b.box(-32, 32, 0, 20, -22, 22, STONE_D, ROOF_D, 0);
    b.box(-8, 8, 0, 14, 22, 27, DARK2, ROOF_D);
    for (const sx of [-1, 1]) {
      b.cylinder(sx * 26, -16, 8, 0, 46, 12, STONE_D, null, 200);
      b.cone(sx * 26, -16, 9, 46, 18, 12, IRON);
    }
    for (let i = 0; i < 5; i++) b.spike(-20 + i * 10, 0, 1.5, 20, 12 + (i % 2) * 8, IRON, [0, 1.5]);
  },
  barracks(b, rng) {
    ring(b, 62, 48, 3, 0, 9, STONE_D, STONE_D, 0);
    for (const z of [-28, 0, 28]) {
      b.box(-45, 45, 0, 12, z - 7, z + 7, STONE, ROOF_D, 100 + z);
      b.gable(-45.5, 45.5, z - 7.5, z + 7.5, 12, 5, ROOF_D, STONE, true);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      b.box(sx * 62 - 3, sx * 62 + 3, 0, 18, sz * 48 - 3, sz * 48 + 3, STONE_D, ROOF_D);
      b.pyramid(sx * 62 - 3.5, sx * 62 + 3.5, sz * 48 - 3.5, sz * 48 + 3.5, 18, 7, IRON);
    }
  },
  foundry(b, rng, emit) {
    b.box(-70, 70, 0, 24, -34, 34, BRICK, ROOF_D, 0);
    for (let q = 0; q < 10; q++) {
      const xa = -70 + q * 14, xb = xa + 14, cIn = [xa + 7, 23, 0];
      b.quad([xa, 24, -34], [xa, 24, 34], [xb, 30, 34], [xb, 30, -34], ROOF_D, null, cIn);
      b.quad([xb, 24, 34], [xb, 24, -34], [xb, 30, -34], [xb, 30, 34], [0.28, 0.26, 0.25], null, [xb - 1, 24, 0]);
      b.tri([xa, 24, 34], [xb, 24, 34], [xb, 30, 34], ROOF_D, null, null, null, cIn);
      b.tri([xa, 24, -34], [xb, 24, -34], [xb, 30, -34], ROOF_D, null, null, null, cIn);
    }
    b.box(-62, -18, 0, 16, 36, 62, BRICK, ROOF_D, 400);
    b.box(24, 62, 0, 14, 36, 60, BRICK, ROOF_D, 500);
    [-50, -30, -10, 10, 30, 50].forEach((x, i) => {
      const top = 70 + ((i * 7) % 20);
      b.cylinder(x, -20, 4.5, 24, top, 10, BRICK);
      b.cylinder(x, -20, 5.3, top - 3, top, 10, IRON, DARK);
      emit.push([x, top + 1, -20]);
    });
    for (const x of [-40, 0, 40]) b.box(x - 4, x + 4, 2, 8, 34, 34.6, FIRE, FIRE);
  },
  ruin(b, rng) {
    b.box(-30, 30, 0, 3, -20, 20, STONE, STONE_L);
    for (const z of [-16, 16]) {
      for (let i = 0; i < 9; i++) {
        const x = -26 + i * 6.5, full = rng() < 0.35, h = full ? 18 : range(rng, 3, 14);
        b.cylinder(x, z, 1.6, 3, 3 + h, 8, STONE_L, STONE_L);
        if (full) b.box(x - 2, x + 2, 3 + h, 4.5 + h, z - 2, z + 2, STONE_L, STONE_L);
      }
    }
    b.box(-28, -8, 21, 24, 13, 19, STONE_L, STONE);
    for (let i = 0; i < 18; i++) {
      const x = range(rng, -34, 34), z = range(rng, -26, 26), s = range(rng, 0.6, 2);
      b.box(x - s, x + s, 0, s * range(rng, 0.6, 1.4), z - s, z + s, STONE, STONE_L);
    }
    b.box(-3, 3, 3, 5, -3, 3, STONE_D, STONE_D);
  },
  mortuary(b) {
    b.box(-36, 36, 0, 12, -36, 36, DARK, DARK2);
    b.box(-26, 26, 12, 22, -26, 26, DARK, DARK2);
    b.box(-16, 16, 22, 31, -16, 16, DARK, DARK2);
    b.dome(0, 0, 12, 31, 12, 4, DARK2);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.spike(sx * 25, sz * 25, 0.9, 22, 7, IRON);
    b.box(-6, 6, 0, 9, 36, 42, DARK, DARK2);
    b.box(-2.5, 2.5, 0.5, 6.5, 42, 42.4, GHOST, GHOST);
  },
  gatehouse(b, rng) {
    let y = 0, ox = 0, oz = 0;
    for (let t = 0; t < 7; t++) {
      const half = 15 - t * 1.8, h = range(rng, 8, 12);
      b.box(ox - half, ox + half, y, y + h, oz - half, oz + half, t % 2 ? [0.42, 0.38, 0.33] : [0.36, 0.33, 0.3], ROOF_D, t * 90);
      y += h; ox += range(rng, -2.5, 2.5); oz += range(rng, -2.5, 2.5);
    }
    b.pyramid(ox - 5, ox + 5, oz - 5, oz + 5, y, 16, IRON, [3, -2]);
    for (const [x, z] of [[-22, 6], [20, -8], [4, 22]]) b.box(x - 6, x + 6, 0, 8, z - 5, z + 5, [0.4, 0.36, 0.31], ROOF_D, 700);
  },
  tavern(b, rng, emit) {
    b.box(-10, 10, 0, 9, -8, 8, [0.3, 0.26, 0.23], ROOF_D, 0);
    b.gable(-10.5, 10.5, -8.5, 8.5, 9, 5, ROOF_D, [0.3, 0.26, 0.23], true);
    b.box(-7, -3, 2, 5, 8, 8.3, EMBER, EMBER);
    b.box(3, 7, 2, 5, 8, 8.3, EMBER, EMBER);
    b.cylinder(6, -4, 1, 9, 17, 8, BRICK, DARK);
    emit.push([6, 18, -4]);
    b.box(10.5, 11, 0, 6, 7, 7.5, DARK2, DARK2);
    b.box(11, 14, 4.5, 6, 7, 7.5, DARK2, DARK2);
  },
  records(b) {
    b.box(-48, 48, 0, 4, -30, 30, STONE_D, STONE_L);
    b.box(-42, 42, 4, 28, -24, 20, STONE_L, ROOF_D, 0);
    columns(b, -38, 38, 25, 12, 1.8, 4, 24, STONE_L);
    b.box(-42, 42, 24, 28, 20, 28, STONE_L, STONE_L);
    b.gable(-42, 42, -24, 28, 28, 10, ROOF_D, STONE_L, false);
    b.box(-48, -42, 4, 20, -28, 14, STONE, ROOF_D, 300);
    b.box(42, 48, 4, 20, -28, 14, STONE, ROOF_D, 400);
  },
  festhall(b) {
    b.box(-44, 44, 0, 16, -44, 44, WARM, ROOF_D, 0);
    b.cylinder(0, 0, 26, 16, 26, 20, WARM, null, 400);
    b.cylinder(0, 0, 26.4, 21, 24, 20, STAINED);
    b.dome(0, 0, 27, 26, 20, 6, COPPER, 0.9);
    b.cylinder(0, 0, 4, 50, 56, 8, WARM, null);
    b.cone(0, 0, 4.6, 56, 8, 8, COPPER);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      b.cylinder(sx * 36, sz * 36, 6, 0, 34, 10, WARM, null, 600);
      b.dome(sx * 36, sz * 36, 6.5, 34, 10, 3, COPPER);
    }
    b.box(-16, 16, 0, 12, 44, 50, WARM, ROOF_D);
    columns(b, -14, 14, 51, 6, 1.2, 0, 12, STONE_L);
    for (const x of [-10, 0, 10]) b.box(x - 2, x + 2, 3, 9, 50, 50.4, LANTERN, LANTERN);
  },
  speakers(b) {
    b.cylinder(0, 0, 34, 0, 18, 24, STONE_L, null, 0);
    b.dome(0, 0, 35, 18, 24, 5, ROOF_D, 0.45);
    b.cylinder(0, 0, 2, 33, 40, 8, STONE_L);
    b.cone(0, 0, 2.6, 40, 8, 8, IRON);
    b.box(-14, 14, 0, 3, 34, 44, STONE, STONE_L);
    columns(b, -12, 12, 42, 6, 1.3, 3, 16, STONE_L);
    b.box(-14, 14, 16, 19, 36, 44, STONE_L, STONE_L);
    b.gable(-14, 14, 36, 44, 19, 5, ROOF_D, STONE_L, false);
  },
  gymnasium(b) {
    b.box(-50, 50, 0, 18, -20, 20, STONE, ROOF_D, 0);
    b.gable(-50.5, 50.5, -20.5, 20.5, 18, 8, ROOF_D, STONE, true);
    for (const z of [-24, 24]) {
      columns(b, -48, 48, z, 14, 1.4, 0, 16, STONE_L);
      b.box(-52, 52, 16, 18, z - 2, z + 2, STONE_L, STONE_L);
    }
    b.box(-60, -52, 0, 4, -40, 40, STONE_D, STONE_D);
    b.box(52, 60, 0, 4, -40, 40, STONE_D, STONE_D);
    for (const x of [-35, 35]) { b.cylinder(x, -36, 9, 0, 6, 12, WARM); b.dome(x, -36, 9, 6, 12, 4, COPPER); }
  },
  bazaar(b, rng) {
    b.cylinder(0, 0, 7, 0, 1.2, 16, STONE_L, [0.3, 0.42, 0.48]);
    b.box(-2.5, 2.5, 0, 3, -2.5, 2.5, STONE, STONE_L);
    b.spike(0, 0, 1.6, 3, 26, COPPER);
    for (let x = -80; x <= 80; x += 9) {
      for (let z = -80; z <= 80; z += 9) {
        const d = Math.hypot(x, z);
        if (d < 12 || d > 84 || Math.abs(x) < 5 || Math.abs(z) < 5 || rng() < 0.35) continue;
        const w = range(rng, 1.5, 2.5), dd = range(rng, 1.5, 2), h = range(rng, 2.4, 3);
        const canopy = CANOPIES[Math.floor(rng() * CANOPIES.length) % CANOPIES.length];
        b.box(x - w, x + w, 0, h, z - dd, z + dd, WARM, WARM);
        b.pyramid(x - w - 0.6, x + w + 0.6, z - dd - 0.6, z + dd + 0.6, h, range(rng, 0.8, 1.5), canopy);
        if (rng() < 0.25) b.box(x + w, x + w + 0.4, h - 0.6, h - 0.2, z + dd, z + dd + 0.4, LANTERN, LANTERN);
      }
    }
  },
};

/** Paved plaza following the doubly-curved surface (a flat disc would sink ~4 m at a 100 m radius). */
function plaza(b, layout, lm) {
  const g = hexToRgb(layout.wards[lm.wardIndex].ground);
  const base = lm.archetype === 'bazaar' ? [0.62, 0.55, 0.43] : [g[0] * 1.28, g[1] * 1.28, g[2] * 1.28];
  const K = 6, S = 48, R0 = lm.plaza - 6;
  const pt = (rho, phi) => {
    const u = lm.u + (rho * Math.cos(phi)) / metricU(lm.v), v = lm.v + (rho * Math.sin(phi)) / r;
    const p = surface(u, v), n = upAt(u, v);
    return [p[0] + n[0] * 0.25, p[1] + n[1] * 0.25, p[2] + n[2] * 0.25];
  };
  const col = (k) => { const s = k % 2 ? 0.94 : 1.0; return [base[0] * s, base[1] * s, base[2] * s]; };
  for (let k = 0; k < K; k++) {
    const r0 = (R0 * k) / K, r1 = (R0 * (k + 1)) / K;
    for (let s = 0; s < S; s++) {
      const a0 = (s / S) * TAU, a1 = ((s + 1) / S) * TAU;
      const A = pt(r0, a0), B = pt(r1, a0), C = pt(r1, a1), D = pt(r0, a1);
      b.triWorld(A, B, C, col(k), col(k), col(k));
      if (k > 0) b.triWorld(A, C, D, col(k), col(k), col(k));
    }
  }
}

export function buildLandmark(layout, lm) {
  const b = new MeshBuilder(lm.p, 4096);
  plaza(b, layout, lm);
  const f = rotateFrame(frameAt(lm.u, lm.v), lm.view.bearingDeg * DEG + Math.PI / 2);
  b.setFrame(f);
  const emitLocal = [];
  let h = 0;
  for (const ch of lm.id) h = hashInts(h, ch.charCodeAt(0));
  SHAPES[lm.archetype](b, mulberry32(hashInts(layout.seed, 500, h)), emitLocal);
  const emitters = new Float32Array(emitLocal.length * 3);
  emitLocal.forEach(([x, y, z], i) => {
    for (let a = 0; a < 3; a++) emitters[i * 3 + a] = f.p[a] + f.x[a] * x + f.y[a] * y + f.z[a] * z - lm.p[a];
  });
  return { id: lm.id, origin: lm.p, up: upAt(lm.u, lm.v), emitters, ...b.finish() };
}
