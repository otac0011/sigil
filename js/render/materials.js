// One shader family for the whole city: baked vertex colour x ambient (Sigil's light has no source,
// so there are no lights or shadows), procedural windows, and a two-layer fog. All materials share
// the same uniform objects, so the atmosphere updates every material by writing one value.

import * as THREE from 'three';
import { N_U, N_V } from '../gen/layout.js';

export function createSharedUniforms() {
  return {
    uFogColor: { value: new THREE.Color(0x8c8577) },
    uFogK: { value: 1.5e-4 },
    uNearAmt: { value: 0.2 },
    uNearDist: { value: 300 },
    uFogEnabled: { value: 1 },
    uAmbient: { value: 0.6 },
    uWindow: { value: 0.7 },
    uWindowColor: { value: new THREE.Color(1.0, 0.7, 0.38) },
  };
}

const COMMON = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogK;
uniform float uNearAmt;
uniform float uNearDist;
uniform float uFogEnabled;
uniform float uAmbient;
uniform float uWindow;
uniform vec3 uWindowColor;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

// Two-layer fog: a thin long-range haze (keeps the far side of the ring readable) and a
// short-range ward smog that saturates at uNearAmt.
vec3 applyFog(vec3 col, float d) {
  float far = 1.0 - exp(-d * uFogK);
  float near = uNearAmt * (1.0 - exp(-d / uNearDist));
  return mix(col, uFogColor, clamp(max(far, near), 0.0, 1.0) * uFogEnabled);
}
`;

const CITY_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aCol;
attribute vec2 aWin;
varying vec3 vCol;
varying vec2 vWin;
varying float vDepth;
varying vec3 vGrit;
void main() {
  vCol = aCol;
  vWin = aWin;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = length(mv.xyz);
  vGrit = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const CITY_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${COMMON}
varying vec3 vCol;
varying vec2 vWin;
varying float vDepth;
varying vec3 vGrit;
void main() {
  #include <logdepthbuf_fragment>
  vec3 base = min(vCol, vec3(1.0));
  vec3 emissive = max(vCol - 1.0, vec3(0.0));
  vec3 gc = vGrit * 0.7;
  float grit = mix(1.0, 0.9 + 0.2 * hash13(floor(gc)), 1.0 - smoothstep(0.3, 0.9, length(fwidth(gc))));
  vec3 col = base * grit * uAmbient;
  vec3 glow = emissive * mix(0.55, 1.0, uWindow);
  if (vWin.y >= 0.0) {
    vec2 c = vWin / vec2(3.2, 3.6);
    vec2 fc = fract(c);
    vec2 fw = fwidth(c);
    float aa = 1.0 - smoothstep(0.2, 0.55, max(fw.x, fw.y));
    float w = step(0.32, fc.x) * step(fc.x, 0.68) * step(0.28, fc.y) * step(fc.y, 0.72);
    float bars = max(step(abs(fc.x - 0.5), 0.022), step(abs(fc.y - 0.5), 0.02));
    float h = hash12(floor(c));
    float lit = step(0.58, h) * (1.0 - bars);
    col *= mix(1.0, 1.0 - 0.3 * w, aa);
    glow += uWindowColor * (0.55 + 0.45 * fract(h * 7.13)) * uWindow * mix(0.04, w * lit * 0.8, aa);
  }
  // Lamplight carries further through the smog than lit stone does.
  gl_FragColor = vec4(applyFog(col, vDepth) + glow * exp(-vDepth * uFogK * 0.4), 1.0);
}
`;

const FAR_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aInstCol;
attribute float aChunk;
uniform sampler2D uNearMask;
varying vec3 vCol;
varying float vDepth;
varying float vSide;
varying float vSeed;
void main() {
  int ic = int(aChunk + 0.5);
  float hidden = texelFetch(uNearMask, ivec2(ic % ${N_U}, ic / ${N_U}), 0).r;
  float top = max(normal.y, 0.0);
  float shade = (0.62 + 0.1 * abs(normal.x)) * (1.0 - top) + 0.82 * top;
  float ao = mix(0.72, 1.0, clamp(position.y * 4.0, 0.0, 1.0));
  vCol = aInstCol * shade * ao;
  vSide = 1.0 - top;
  vSeed = fract(sin(aChunk * 0.1234 + float(gl_InstanceID) * 12.9898) * 43758.5453);
  // Chunks drawn by the near LOD collapse to a point (degenerate triangles produce no fragments).
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position * (1.0 - step(0.5, hidden)), 1.0);
  vDepth = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const FAR_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${COMMON}
varying vec3 vCol;
varying float vDepth;
varying float vSide;
varying float vSeed;
void main() {
  #include <logdepthbuf_fragment>
  vec3 glow = uWindowColor * uWindow * vSide * (0.03 + 0.08 * vSeed);
  gl_FragColor = vec4(applyFog(vCol * uAmbient, vDepth) + glow * exp(-vDepth * uFogK * 0.4), 1.0);
}
`;

const SMOKE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aAge;
uniform float uScale;
varying float vAge;
varying float vDepth;
void main() {
  vAge = aAge;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(512.0, uScale * (6.0 + 30.0 * aAge) / max(1.0, -mv.z));
  #include <logdepthbuf_vertex>
}
`;

const SMOKE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${COMMON}
varying float vAge;
varying float vDepth;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = (1.0 - d * 2.0) * (1.0 - vAge) * 0.7;
  vec3 col = mix(vec3(0.14, 0.12, 0.11), vec3(0.52, 0.49, 0.46), vAge) * (0.6 + 0.4 * uAmbient);
  gl_FragColor = vec4(applyFog(col, vDepth), a);
}
`;

export function createMaterials(shared) {
  const nearMask = new THREE.DataTexture(new Uint8Array(N_U * N_V), N_U, N_V, THREE.RedFormat, THREE.UnsignedByteType);
  nearMask.magFilter = nearMask.minFilter = THREE.NearestFilter;
  nearMask.needsUpdate = true;

  const city = new THREE.ShaderMaterial({ uniforms: { ...shared }, vertexShader: CITY_VERT, fragmentShader: CITY_FRAG });
  const far = new THREE.ShaderMaterial({ uniforms: { ...shared, uNearMask: { value: nearMask } }, vertexShader: FAR_VERT, fragmentShader: FAR_FRAG });
  const smoke = new THREE.ShaderMaterial({
    uniforms: { ...shared, uScale: { value: 800 } }, vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
    transparent: true, depthWrite: false,
  });
  return { city, far, smoke, nearMask };
}
