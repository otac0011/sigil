// Sigil torus geometry — pure math shared by the renderer, the mini-map, the generator and the tests.
// Must never import three: js/math and js/gen also run inside module workers, where import maps don't apply.
//
// Conventions (JOURNAL.md, "Torus parameterisation"):
//   world +Y is the ring axis; u = major angle; v = minor angle measured from the outer equator.
//   The city covers the tube's inner face for v in [-VMAX, VMAX]. "Up" for someone standing in the
//   city points at the tube's centre line. (e_u, e_v, n) is right-handed: e_u x e_v = n.

export const R = 3915;                 // tube-centre radius, m  (R + r ~ 20 mi / 2pi)
export const r = 1207;                 // tube radius, m         (tube 1.5 mi thick)
export const DEG = Math.PI / 180;
export const VMAX = 100 * DEG;         // half-width of the city band around the tube
export const TAU = Math.PI * 2;

export const wrapU = (u) => ((u % TAU) + TAU) % TAU;
export const metricU = (v) => R + r * Math.cos(v);   // metres per radian of u at v
export const metricV = r;                             // metres per radian of v

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

export function surface(u, v, out = [0, 0, 0]) {
  const rho = R + r * Math.cos(v);
  out[0] = rho * Math.cos(u); out[1] = r * Math.sin(v); out[2] = rho * Math.sin(u);
  return out;
}

/** Local "up": unit normal of the inner face, pointing at the tube centre line. */
export function upAt(u, v, out = [0, 0, 0]) {
  const cv = Math.cos(v);
  out[0] = -cv * Math.cos(u); out[1] = -Math.sin(v); out[2] = -cv * Math.sin(u);
  return out;
}

export function eUAt(u, out = [0, 0, 0]) {
  out[0] = -Math.sin(u); out[1] = 0; out[2] = Math.cos(u);
  return out;
}

export function eVAt(u, v, out = [0, 0, 0]) {
  const sv = Math.sin(v);
  out[0] = -sv * Math.cos(u); out[1] = Math.cos(v); out[2] = -sv * Math.sin(u);
  return out;
}

/** Building frame at (u, v): origin on the surface, x = e_u, y = up, z = -e_v (right-handed). */
export function frameAt(u, v) {
  const ev = eVAt(u, v);
  return { p: surface(u, v), x: eUAt(u), y: upAt(u, v), z: [-ev[0], -ev[1], -ev[2]] };
}

/** Turn a frame's horizontal axes so x points along heading a (same sense as the view heading psi). */
export function rotateFrame(f, a) {
  const c = Math.cos(a), s = Math.sin(a), { x, z } = f;
  return {
    p: f.p, y: f.y,
    x: [c * x[0] - s * z[0], c * x[1] - s * z[1], c * x[2] - s * z[2]],
    z: [s * x[0] + c * z[0], s * x[1] + c * z[1], s * x[2] + c * z[2]],
  };
}

export function chordDist(u1, v1, u2, v2) {
  const a = surface(u1, v1), b = surface(u2, v2);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Heading (psi) at (u, v) that faces the surface point (u2, v2). psi = 0 is +e_u, psi = pi/2 is +e_v. */
export function headingTo(u, v, u2, v2) {
  const a = surface(u, v), b = surface(u2, v2);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  return Math.atan2(dot(d, eVAt(u, v)), dot(d, eUAt(u)));
}

/** Walk dist metres from (u, v) along heading psi, integrated in small steps. Returns [u, v]. */
export function walk(u, v, psi, dist, steps = 12) {
  const ds = dist / steps;
  for (let i = 0; i < steps; i++) {
    u += Math.cos(psi) * ds / metricU(v);
    v += Math.sin(psi) * ds / r;
  }
  return [u, v];
}

/**
 * Camera basis for a view state {u, v, psi, theta, h}. X right, Y up, Z backwards (three.js camera axes).
 * Built from the horizontal heading hd (never parallel to n), so it stays valid looking straight up.
 */
export function viewBasis(s) {
  const n = upAt(s.u, s.v), eu = eUAt(s.u), ev = eVAt(s.u, s.v), p = surface(s.u, s.v);
  const c = Math.cos(s.psi), sn = Math.sin(s.psi), ct = Math.cos(s.theta), st = Math.sin(s.theta);
  const hd = [c * eu[0] + sn * ev[0], c * eu[1] + sn * ev[1], c * eu[2] + sn * ev[2]];
  const f = [ct * hd[0] + st * n[0], ct * hd[1] + st * n[1], ct * hd[2] + st * n[2]];
  const X = norm(cross(hd, n));
  const Y = cross(X, f);
  return {
    pos: [p[0] + n[0] * s.h, p[1] + n[1] * s.h, p[2] + n[2] * s.h],
    X, Y, Z: [-f[0], -f[1], -f[2]], f, n, hd,
  };
}

// ---- Mini-map chart -------------------------------------------------------------------------------
// Slightly oval annulus. Angle = u (clockwise on screen from the top, starting at u0);
// radius = position across the band (inner drawn edge = -VMAX, outer = +VMAX). Not mirrored:
// facing +u in 3D, +v is on your left; on the chart +v is outward, which is left of clockwise travel.

export function makeChart({ width, height, margin = 10, a = 1.2, inner = 0.56, u0 = 0 }) {
  const rout = Math.max(10, Math.min(height / 2 - margin, (width / 2 - margin) / a));
  return { width, height, cx: width / 2, cy: height / 2, a, rout, rin: rout * inner, u0 };
}

export const chartRho = (c, v) => c.rin + (v + VMAX) / (2 * VMAX) * (c.rout - c.rin);

export function chartForward(c, u, v) {
  const phi = u - c.u0, rho = chartRho(c, v);
  return [c.cx + c.a * rho * Math.sin(phi), c.cy - rho * Math.cos(phi)];
}

export function chartInverse(c, x, y) {
  const X = (x - c.cx) / c.a, Y = c.cy - y, rho = Math.hypot(X, Y);
  if (rho < c.rin || rho > c.rout) return null;
  return { u: wrapU(Math.atan2(X, Y) + c.u0), v: (rho - c.rin) / (c.rout - c.rin) * 2 * VMAX - VMAX };
}
