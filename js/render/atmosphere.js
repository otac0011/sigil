// Ward-tinted fog and Sigil's peak/antipeak light cycle. phase 0 = antipeak (darkest), 0.5 = peak.

import * as THREE from 'three';

export class Atmosphere {
  constructor(shared, scene, wards) {
    this.shared = shared;
    this.scene = scene;
    this.wardFog = wards.map((w) => new THREE.Color(w.fog));
    this.wardNear = wards.map((w) => w.nearAmt);
    this.fog = new THREE.Color().copy(this.wardFog[0]);
    this.fogTarget = this.fog.clone();
    this.nearAmt = this.wardNear[0];
    this.nearTarget = this.nearAmt;
    this.phase = 0.22;
    this.auto = false;
    this.cycleSeconds = 180;
    scene.background = new THREE.Color();
    this.update(0);
  }

  setWard(index, instant = false) {
    this.fogTarget.copy(this.wardFog[index]);
    this.nearTarget = this.wardNear[index];
    if (instant) { this.fog.copy(this.fogTarget); this.nearAmt = this.nearTarget; }
  }

  setPhase(p) { this.phase = ((p % 1) + 1) % 1; }

  get brightness() { return 0.5 - 0.5 * Math.cos(Math.PI * 2 * this.phase); }

  update(dt) {
    if (this.auto) this.phase = (this.phase + dt / this.cycleSeconds) % 1;
    const k = 1 - Math.exp(-dt * 1.5);
    this.fog.lerp(this.fogTarget, k);
    this.nearAmt += (this.nearTarget - this.nearAmt) * k;
    const br = this.brightness;
    // The haze is the light source: keep it brighter than lit stone, so distance reads as glow, not as a hole.
    this.shared.uFogColor.value.copy(this.fog).multiplyScalar(0.42 + 0.78 * br);
    this.shared.uAmbient.value = 0.22 + 0.7 * br;
    this.shared.uWindow.value = 1 - THREE.MathUtils.smoothstep(br, 0.25, 0.75);
    this.shared.uNearAmt.value = this.nearAmt;
    this.scene.background.copy(this.shared.uFogColor.value).multiplyScalar(1.08);
  }
}
