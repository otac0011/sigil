// First-person viewer on the torus: look-only controls and the lift-veil-descend transition.
// State is (u, v, psi, theta, h, fov); the camera is rebuilt from it every frame (no drift).

import * as THREE from 'three';
import { viewBasis, wrapU, DEG } from '../math/torus.js';

const THETA_MAX = 89 * DEG;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Viewer {
  constructor(camera, dom, { onChange = () => {}, onInteract = () => {} } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.onChange = onChange;
    this.onInteract = onInteract;
    this.state = { u: 0, v: 0, psi: 0, theta: 0, h: 1.7, fov: 70 };
    this.keys = new Set();
    this.flying = false;
    this.token = 0;
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
    this._bind();
  }

  set(s) {
    Object.assign(this.state, s);
    this.state.u = wrapU(this.state.u);
    this.state.theta = clamp(this.state.theta, -THETA_MAX, THETA_MAX);
    this.state.fov = clamp(this.state.fov, 25, 90);
    this.onChange(this.state);
  }

  apply() {
    const b = viewBasis(this.state);
    this.camera.position.set(b.pos[0], b.pos[1], b.pos[2]);
    this._m.makeBasis(this._x.fromArray(b.X), this._y.fromArray(b.Y), this._z.fromArray(b.Z));
    this.camera.quaternion.setFromRotationMatrix(this._m);
    if (this.camera.fov !== this.state.fov) { this.camera.fov = this.state.fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld();
  }

  update(dt) {
    if (this.flying || !this.keys.size) return;
    const turn = 1.1 * dt, s = this.state;
    const k = this.keys;
    let dpsi = 0, dth = 0, dfov = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) dpsi += turn;
    if (k.has('ArrowRight') || k.has('KeyD')) dpsi -= turn;
    if (k.has('ArrowUp') || k.has('KeyW')) dth += turn;
    if (k.has('ArrowDown') || k.has('KeyS')) dth -= turn;
    if (k.has('Equal') || k.has('NumpadAdd')) dfov -= 40 * dt;
    if (k.has('Minus') || k.has('NumpadSubtract')) dfov += 40 * dt;
    if (dpsi || dth || dfov) this.set({ psi: s.psi + dpsi, theta: s.theta + dth, fov: s.fov + dfov });
  }

  _bind() {
    const pts = new Map();
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.onInteract();
    });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p || this.flying) { if (p) { p.x = e.clientX; p.y = e.clientY; } return; }
      if (pts.size === 1) {
        const k = (this.state.fov * DEG) / Math.max(200, el.clientHeight);
        this.set({ psi: this.state.psi + (e.clientX - p.x) * k, theta: this.state.theta + (e.clientY - p.y) * k });
      } else if (pts.size === 2) {
        const other = [...pts.entries()].find(([id]) => id !== e.pointerId)[1];
        const before = Math.hypot(p.x - other.x, p.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 10 && after > 10) this.set({ fov: this.state.fov * (before / after) });
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    const end = (e) => pts.delete(e.pointerId);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.set({ fov: this.state.fov * Math.exp(e.deltaY * 0.0012) });
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, select, textarea, dialog')) return;
      if (/^(Arrow|Key[WASD]$|Equal|Minus|Numpad(Add|Subtract))/.test(e.code)) { this.keys.add(e.code); this.onInteract(); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _tween(ms, fn, token) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        if (token !== this.token) return resolve(false);
        const t = Math.min(1, (now - t0) / ms);
        fn(t);
        if (t < 1) requestAnimationFrame(step); else resolve(true);
      };
      requestAnimationFrame(step);
    });
  }

  /**
   * Lift-veil-descend: rise and tip down, veil to the fog colour, cut to the target (after onCut has
   * started streaming it), wait briefly for near chunks, then descend while the veil lifts.
   */
  async flyTo(target, { veil, onCut, waitReady, reducedMotion = false }) {
    const token = ++this.token;
    this.flying = true;
    const s0 = { ...this.state }, LIFT = reducedMotion ? 0 : 150, DOWN = -18 * DEG;
    veil.style.transitionDuration = reducedMotion ? '200ms' : '320ms';
    veil.classList.add('on');
    const ok = await this._tween(reducedMotion ? 220 : 360, (t) => {
      const e = ease(t);
      this.set({ h: s0.h + LIFT * e, theta: reducedMotion ? s0.theta : lerp(s0.theta, DOWN, e) });
    }, token);
    if (!ok) return false;
    const full = { u: target.u, v: target.v, psi: target.psi, theta: target.theta, h: target.h, fov: target.fov ?? this.state.fov };
    this.set({ ...full, h: full.h + LIFT, theta: reducedMotion ? full.theta : DOWN });
    onCut?.(full);
    await Promise.race([waitReady ? waitReady() : Promise.resolve(), sleep(1800)]);
    if (token !== this.token) return false;
    veil.style.transitionDuration = reducedMotion ? '200ms' : '520ms';
    veil.classList.remove('on');
    if (!reducedMotion) {
      const done = await this._tween(650, (t) => {
        const e = ease(t);
        this.set({ h: full.h + LIFT * (1 - e), theta: lerp(DOWN, full.theta, e) });
      }, token);
      if (!done) return false;
    }
    this.set(full);
    this.flying = false;
    return true;
  }

  animateHeight(h) {
    const token = ++this.token, h0 = this.state.h;
    this.flying = true;
    return this._tween(700, (t) => this.set({ h: lerp(h0, h, ease(t)) }), token).then((ok) => { if (ok) this.flying = false; return ok; });
  }
}
