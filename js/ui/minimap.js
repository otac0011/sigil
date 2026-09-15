// 2D chart of the ring: ward fills, avenues, landmark glyphs, you-are-here marker and view cone.
// Uses the same layout functions as the 3D city, so a click lands exactly where it was drawn.

import { makeChart, chartForward, chartInverse, VMAX, TAU, DEG, metricU, r } from '../math/torus.js';

const LABEL_MIN_R = 105;

export class Minimap {
  constructor(wrap, layout, { onPick }) {
    this.wrap = wrap;
    this.layout = layout;
    this.onPick = onPick;
    this.base = wrap.querySelector('#minimap');
    this.overlay = wrap.querySelector('#minimap-overlay');
    this.tip = wrap.querySelector('#mm-tip');
    const w0 = layout.wards[0];
    this.u0 = (w0.u0 + w0.u1) / 2;
    this.state = null;
    this.aspect = 1.6;
    this.glyphs = [];
    new ResizeObserver(() => this.resize()).observe(this.base.parentElement);
    this._bind();
  }

  resize() {
    const box = this.base.parentElement.getBoundingClientRect();
    if (box.width < 10) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.base, this.overlay]) {
      c.width = Math.round(box.width * this.dpr);
      c.height = Math.round(box.height * this.dpr);
      c.style.width = `${box.width}px`;
      c.style.height = `${box.height}px`;
    }
    this.chart = makeChart({ width: box.width, height: box.height, margin: 7, u0: this.u0 });
    this.drawBase();
    this.drawMarker();
  }

  _poly(ctx, pts, move = true) {
    pts.forEach(([x, y], i) => (i === 0 && move ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  }

  drawBase() {
    const c = this.chart, L = this.layout, ctx = this.base.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);

    // ward sectors with wobbly boundaries
    const VS = 14;
    L.wards.forEach((w, wi) => {
      const nb = (wi + 1) % L.wards.length;
      const bu = (b, v) => L.wardBoundaryU(b, v) + (b === 0 && wi === L.wards.length - 1 ? TAU : 0);
      ctx.beginPath();
      const outer = [], inner = [], right = [], left = [];
      const ua = bu(wi, VMAX), ub = bu(nb, VMAX);
      for (let s = 0; s <= 40; s++) outer.push(chartForward(c, ua + ((ub - ua) * s) / 40, VMAX));
      for (let s = 0; s <= VS; s++) { const v = VMAX - (2 * VMAX * s) / VS; right.push(chartForward(c, bu(nb, v), v)); }
      const ia = bu(wi, -VMAX), ib = bu(nb, -VMAX);
      for (let s = 0; s <= 40; s++) inner.push(chartForward(c, ib - ((ib - ia) * s) / 40, -VMAX));
      for (let s = 0; s <= VS; s++) { const v = -VMAX + (2 * VMAX * s) / VS; left.push(chartForward(c, bu(wi, v), v)); }
      this._poly(ctx, outer); this._poly(ctx, right, false); this._poly(ctx, inner, false); this._poly(ctx, left, false);
      ctx.closePath();
      const g = ctx.createRadialGradient(c.cx, c.cy, c.rin, c.cx, c.cy, c.rout * c.a);
      g.addColorStop(0, shade(w.tint, 0.42));
      g.addColorStop(1, shade(w.tint, 0.62));
      ctx.fillStyle = g;
      ctx.fill();
    });

    // avenues
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(16, 13, 11, 0.55)';
    ctx.lineWidth = 1;
    for (const s of L.strips) {
      for (let m = 0; m < s.n; m++) {
        const u = s.us[m];
        ctx.beginPath();
        this._poly(ctx, [chartForward(c, u, s.v0), chartForward(c, u, s.v1)]);
        ctx.stroke();
      }
    }
    for (const av of L.ringAvenues) {
      ctx.lineWidth = av.width > 15 ? 1.6 : 1;
      ctx.beginPath();
      const pts = [];
      for (let s = 0; s <= 160; s++) pts.push(chartForward(c, (s / 160) * TAU, av.v));
      this._poly(ctx, pts);
      ctx.stroke();
    }

    // band edges
    ctx.strokeStyle = 'rgba(233, 226, 211, 0.35)';
    ctx.lineWidth = 1.2;
    for (const v of [-VMAX, VMAX]) {
      ctx.beginPath();
      const pts = [];
      for (let s = 0; s <= 160; s++) pts.push(chartForward(c, (s / 160) * TAU, v));
      this._poly(ctx, pts);
      ctx.stroke();
    }

    // ward names inside the hole, when there is room
    if (c.rout >= LABEL_MIN_R) {
      ctx.font = `${Math.round(c.rout / 12)}px "IM Fell English SC", Georgia, serif`;
      ctx.fillStyle = 'rgba(233, 226, 211, 0.62)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const w of L.wards) {
        const [x, y] = chartForward(c, (w.u0 + w.u1) / 2, -VMAX);
        const k = 0.8;
        ctx.fillText(w.name.replace(/^The /, ''), c.cx + (x - c.cx) * k, c.cy + (y - c.cy) * k);
      }
    }

    // landmark glyphs
    this.glyphs = L.landmarks.map((lm) => {
      const [x, y] = chartForward(c, lm.u, lm.v);
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, TAU);
      ctx.fillStyle = '#e9e2d3';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#211c17';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, TAU);
      ctx.fillStyle = '#211c17';
      ctx.fill();
      return { x, y, lm };
    });
  }

  setState(state, aspect) {
    this.state = state;
    if (aspect) this.aspect = aspect;
    this.drawMarker();
  }

  drawMarker() {
    const s = this.state, c = this.chart;
    if (!s || !c) return;
    const ctx = this.overlay.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const [x, y] = chartForward(c, s.u, s.v);
    if (s.theta < 60 * DEG) {
      const [x2, y2] = chartForward(c, s.u + (Math.cos(s.psi) * 30) / metricU(s.v), s.v + (Math.sin(s.psi) * 30) / r);
      const ang = Math.atan2(y2 - y, x2 - x);
      const hfov = 2 * Math.atan(Math.tan((s.fov * DEG) / 2) * this.aspect);
      const R = Math.max(22, c.rout * 0.22);
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, 'rgba(216, 166, 87, 0.75)');
      g.addColorStop(1, 'rgba(216, 166, 87, 0)');
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, R, ang - hfov / 2, ang + hfov / 2);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.arc(x, y, 11, 0, TAU);
      ctx.strokeStyle = 'rgba(216, 166, 87, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, TAU);
    ctx.fillStyle = '#d8a657';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff6e5';
    ctx.stroke();
  }

  _hit(x, y) {
    let best = null, bd = 11;
    for (const g of this.glyphs) { const d = Math.hypot(g.x - x, g.y - y); if (d < bd) { bd = d; best = g; } }
    return best;
  }

  _describe(x, y) {
    const g = this._hit(x, y);
    if (g) return { text: g.lm.name, pick: { landmark: g.lm } };
    const uv = chartInverse(this.chart, x, y);
    if (!uv) return null;
    return { text: this.layout.wards[this.layout.wardIndexAt(uv.u, uv.v)].name, pick: uv };
  }

  _bind() {
    const ov = this.overlay;
    let down = null;
    const local = (e) => { const b = ov.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    ov.addEventListener('pointermove', (e) => {
      const [x, y] = local(e), d = this.chart && this._describe(x, y);
      if (d && e.pointerType !== 'touch') { this.tip.textContent = d.text; this.tip.style.left = `${x}px`; this.tip.style.top = `${y}px`; this.tip.hidden = false; }
      else this.tip.hidden = true;
      ov.style.cursor = d ? (this._hit(x, y) ? 'pointer' : 'crosshair') : 'default';
    });
    ov.addEventListener('pointerleave', () => { this.tip.hidden = true; });
    ov.addEventListener('pointerdown', (e) => { down = local(e); });
    ov.addEventListener('pointerup', (e) => {
      if (!down || !this.chart) return;
      const [x, y] = local(e), moved = Math.hypot(x - down[0], y - down[1]);
      down = null;
      if (moved > 8) return;
      const d = this._describe(x, y);
      if (d) this.onPick(d.pick);
    });
    const toggle = this.wrap.querySelector('#mm-toggle');
    toggle.addEventListener('click', () => {
      const collapsed = this.wrap.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.textContent = collapsed ? '+' : '–';
      toggle.title = collapsed ? 'Show map' : 'Hide map';
    });
  }
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * k)}, ${Math.round(((n >> 8) & 255) * k)}, ${Math.round((n & 255) * k)})`;
}
