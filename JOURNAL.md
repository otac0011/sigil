# Sigil engineering journal

Chronological record of **decisions, algorithms, and rejected alternatives**.
The git log says *what* changed; this says *why*, and what we chose not to do.

Newest entries at the bottom. One entry per meaningful step: a decision worth defending later, an
algorithm worth recognizing, or a trade-off worth revisiting.

**Entry format**
```
## YYYY-MM-DD — short title
**Context** — what prompted this.
**Decision** — what we did.
**Alternatives rejected** — what we didn't do, and why.
**Algorithm / mechanism** — how it actually works (name the method).
**Verification** — how we know it works.
**Open / revisit** — what's unresolved.
```

---

## 2026-09-14 — Scope and canon geometry

**Context** — Request: a GitHub Pages site with a 2D mini-map of Sigil bottom-left and a first-person
view of the city filling the rest. Clicking the map puts you "there, seeing the inside of the torus".
Decided with the user: look-around only (no walking), public repo `otac0011/sigil`, a caption bar at the
bottom, canon wards drawn as original art.

**Decision** — Use canon dimensions at 1 unit = 1 m. Circumference ~20 mi at the outermost street gives
R + r ≈ 5122 m. A tube "one-and-a-half miles thick" gives r ≈ 1207 m, so R ≈ 3915 m. The city covers the
inner face of the tube, outer portion only ("inside of a tire off its rim"), band v ∈ [-100°, +100°].
Wards run clockwise Lady's → Lower → Hive → Clerk's → Guildhall → Market, with shares 20/17/25/15/12/11 %
estimated from the label spacing on a fan map (used only for proportions).

**Alternatives rejected**
- *Full enclosed tube (v all the way round)* — contradicts the lore that you look across the centre of
  the ring to the far side, and doubles the building count.
- *Scaled-down city* — the whole point is the scale: the far side should be miles away and hazy.
- *Vmax = 110°* — the band edges would overhang more, adding ~9 % area and buildings for little visual gain.

**Algorithm / mechanism** — Band area = 2πr(2R·Vmax + 2r·sin Vmax) ≈ 122 km², which is what forces the
LOD design below.

**Verification** — Test page: wards in canon order; every landmark inside its own ward.

**Open / revisit** — Ward shares are an estimate; `data/sigil.json` makes them one-line edits.

---

## 2026-09-14 — Torus parameterisation, frames and camera

**Context** — Everything (mini-map, generator, camera, tests) must agree on one coordinate system, and
the camera has to look straight up without breaking.

**Decision** — World +Y is the ring axis. `S(u,v) = ((R + r cos v) cos u, r sin v, (R + r cos v) sin u)`,
v measured from the outer equator. Local up `n = -(cos v cos u, sin v, cos v sin u)` points at the tube
centre line. `e_u = (-sin u, 0, cos u)`, `e_v = (-sin v cos u, cos v, -sin v sin u)`, and `e_u × e_v = n`.
All geometry uses the building frame x = e_u, y = n, z = -e_v, which is right-handed, so triangle winding
survives the transform. The view state is (u, v, ψ, θ, h, fov) and the camera is rebuilt from it every
frame.

**Alternatives rejected**
- *Accumulating a camera quaternion* — drifts, and "up" changes as you move over a doubly-curved surface.
- *`lookAt` with n as the up vector* — singular exactly where this project is most interesting (looking
  straight up).

**Algorithm / mechanism** — Horizontal heading `hd = cos ψ e_u + sin ψ e_v` (never parallel to n), forward
`f = cos θ hd + sin θ n`, camera X = normalize(hd × n), Y = X × f, Z = -f. θ is clamped to ±89°.

**Verification** — Tests: frame orthonormal and right-handed (1e-10); numerical ∂S/∂u, ∂S/∂v match e_u,
e_v; camera basis orthonormal at θ = 0 and ±89° (1e-15); n points at the tube centre line.

**Open / revisit** — None.

---

## 2026-09-14 — Mini-map chart: oval annulus with an exact inverse, not mirrored

**Context** — Clicks must land exactly where they were drawn, and the map should match the canon
convention (a ring seen "from above").

**Decision** — Angle = u (clockwise from the top, starting at Lady's Ward's centre); radius = position
across the band (inner drawn edge = -Vmax, outer = +Vmax), stretched 1.2× horizontally. Forward:
`x = cx + a·ρ·sin φ`, `y = cy - ρ·cos φ`. Inverse: `φ = atan2((x-cx)/a, cy-y)`, reject ρ outside the band.

**Alternatives rejected**
- *Unrolled rectangle (u across, v down)* — easier maths, but it doesn't read as Sigil and hides that the
  city loops.
- *Metric-correct chart* — the band centre is longer than its edges in 3D, which an annulus can't show
  (its inner edge is shorter). The canon map is schematic too.

**Algorithm / mechanism** — Handedness check: facing +u in 3D, +v is on your left (camera X = -e_v). On the
chart +v is outward, which is left of clockwise travel. So turning in 3D and on the map agree.

**Verification** — Tests: round-trip on 10k random points, worst error 4.4e-15; out-of-band clicks
rejected; not-mirrored check at 500 random points.

---

## 2026-09-14 — City generation: strips → superblocks → two-phase BSP

**Context** — ~122 km² of city must be deterministic (workers and the main thread must agree), cheap to
regenerate for any chunk on demand, and shared by the mini-map, street snapping and the tests.

**Decision** — `createLayout(data)` is the single source of truth.
1. **Strips**: ring avenues at v = 0 (22 m), ±38° (14 m), ±72° (12 m), plus a rim margin.
2. **Superblocks**: per-strip cross avenues about every 430 m of arc, positions jittered ±22 % so
   crossings don't line up across ring avenues (T-junctions read as organic).
3. **BSP phase A** (seeded per superblock): split along the longer axis at t ∈ [0.38, 0.62] with street or
   alley gaps until the longer side ≤ farT (60 m high, 95 m low). Each leaf is a **far node**: one far-LOD
   box, and **the unit of chunk membership for both LODs**.
4. **BSP phase B** (seeded per far node): split into lots with per-ward sizes and optional alleys. Each lot
   carries archetype, height, twist, setback and colour seed.

Landmark plazas drop far nodes within plaza + ½ diagonal and lots within plaza + 0.3 diagonal.

**Alternatives rejected**
- *Voronoi or streamline street networks* — more organic, but much harder to make chunk-local and
  deterministic; a query for one chunk would need global state.
- *Assigning lots to chunks by their own centre* — a far box and its lots could then land in different
  chunks, leaving holes or doubles at the near/far boundary.
- *Noise-wobbled avenues* — curved block edges break the axis-aligned BSP; jitter gives enough irregularity.

**Algorithm / mechanism** — mulberry32 PRNG seeded with a MurmurHash3-style `hashInts`. Every BSP call
draws the same number of random values before any rejection, so filtering never shifts the stream. Heights
come from 3D simplex noise sampled on a cylinder `(k cos u, k sin u, v)`, so there's no seam at u = 0/2π.
Ward boundaries wobble ±2° by noise along v.

**Verification** — Tests: no lot overlaps another lot or crosses a ring avenue (two chunks); far-node chunk
membership is a partition (Σ chunks = sector); chunk hashes identical across two main-thread handlers and a
module worker; no lot in any plaza or across a viewpoint sightline. Timing, single thread: whole-city far
LOD (62,831 boxes) 92 ms; a dense Hive column (16 chunks, 9,548 lots, 215k triangles) 39 ms.

**Open / revisit** — Lots are axis-aligned in (u, v); the Hive gets ±7° twist to hide the grid.

---

## 2026-09-14 — LOD: instanced far city + streamed near chunks + a near-mask texture

**Context** — ~285k lots. Detailed geometry for all of them is several million triangles; the far side of
the ring is always on screen when you look up.

**Decision**
- **Far LOD (always present)**: one unit box per far node, as an `InstancedMesh` per u-sector (128 sectors,
  each culled on its own). Instance matrix columns are e_u·w, n·h, -e_v·d and the surface point.
- **Near LOD**: chunks (128 × 16 grid) within 450 m (250 m low) built by workers as merged, flat-shaded
  geometry, with an LRU cache of 48 chunks.
- **Exactly one LOD per chunk**: a 128×16 R8 `DataTexture`. The far vertex shader `texelFetch`es its
  chunk's byte and collapses the box to a point (degenerate triangles, no fragments) when the near mesh is
  showing.

**Alternatives rejected**
- *Shell-texture "carpet" for the distant city* — visible layering at the grazing angles you get looking
  along the ring.
- *InstancedMesh or BatchedMesh for near buildings* — workers can hand over finished typed arrays directly,
  and merged chunks cull independently.
- *Per-vertex "group centre vs. near radius" masking* — cost an extra vec3 per near vertex, and float32
  disagreement at the boundary could drop or double a box. A per-chunk mask is exact.

**Algorithm / mechanism** — Concave ground buries footprint corners rather than floating them (sagitta
w²/8r ≈ 0.2 m for 40 m), so buildings need no sinking. Chunk-local vertex positions and CPU-side
float64 matrices keep near geometry precise at 5 km from the origin.

**Verification** — City Court view (high quality): 75 draw calls, 353k triangles, p50 16.8 ms in the
preview browser. Near/far boundaries show no holes in screenshots.

**Open / revisit** — Far boxes read as noise at 5–10 km; the fog carries most of that (see the fog entry).

---

## 2026-09-14 — Depth: logarithmic depth buffer

**Context** — Near plane 0.25 m, far side of the ring ~10 km away.

**Decision** — `logarithmicDepthBuffer: true`, near 0.25 m, far 16 km. Custom shaders include the
`logdepthbuf_*` chunks.

**Alternatives rejected**
- *Reversed-Z* — needs EXT_clip_control, which is not universal on phones.
- *Two-pass frustum partition* — doubles draw calls; kept as a fallback idea only.

**Algorithm / mechanism** — Relative precision ≈ ln(far/near)/2²⁴ ≈ 7e-7, about 3 mm at 5 km, so plazas
lifted 0.25 m and razorvine offset 7 cm never z-fight.

**Verification** — No z-fighting seen on plazas, roofs or vines in screenshots.

**Open / revisit** — Log depth disables early-z; watch fill rate on phones.

---

## 2026-09-14 — Lighting: sourceless light, baked, no shadows

**Context** — Canon: no sky and no sun, just a light that waxes and wanes.

**Decision** — No lights at all. Geometry bakes a flat shade from its local normal (top 1.0, walls
0.62–0.72, undersides darker) plus ground-contact darkening in the bottom 4 m. The shader multiplies by a
global `uAmbient`. Emissive surfaces are encoded as colour channels above 1.0. Windows are procedural:
3.2 × 3.6 m cells, a per-cell hash for which are lit, and an `fwidth` fade to their average glow once
cells get smaller than a pixel. `THREE.ColorManagement.enabled = false` with linear output, so data
colours, fog, background and the transition veil match exactly.

**Alternatives rejected**
- *Hemisphere or directional lights* — a fixed world direction is wrong on a torus, where "up" changes
  everywhere.
- *Shadow maps* — there is no light source to cast them.
- *Window texture atlas* — aliasing at distance; the derivative fade in the shader is cheaper.

**Verification** — Lit windows and bladed silhouettes read clearly at dusk (City Court, Great Foundry
screenshots).

---

## 2026-09-14 — Transition, snapping, workers, dev server

**Decision**
- **Lift–veil–descend**: rise 150 m while pitching down (360 ms), veil to the fog colour, cut and start
  streaming, wait up to 1.8 s for near chunks, then descend (650 ms) as the veil lifts. Reduced motion
  gets a plain fade.
- **Street snapping** for arbitrary map clicks: a spiral search (2.5 m rings) for the nearest point
  outside every lot (1.5 m margin) and landmark footprint. Then cast 24 rays in 4 m steps up to 240 m and
  pick the heading with the longest clear sightline, plus a 25·cos bias toward the nearest landmark.
- **Workers**: `js/math` and `js/gen` never import three, because import maps don't apply in workers. The
  pool falls back to the same task handler on the main thread.
- **`tools/serve.py`** pins `.js` to `text/javascript`, because Windows' registry can map it to text/plain.

**Alternatives rejected** — *Instant cut* (disorienting on a surface where "up" differs between two
points); *arcing flight along the surface* (needs streaming during flight for no real gain).

**Verification** — Snapping test on random Hive points always lands on open ground; worker pool 81 ms
for 128 far sectors; transition to the Great Foundry shows the landmark with near chunks loaded.

---

## 2026-09-14 — False alarms while testing: hidden preview pane, `[hidden]` vs `display`

**Context** — The first run showed a 17.2 s p95 frame time and loads that seemed to take 10–25 s.

**Decision / finding** — Not the code. The in-app browser pane was hidden, so rAF and timers were
throttled. Direct timing on the page: pool init 1.6 s (module fetch per worker); 128 far sectors 81 ms;
32 ground sectors 22 ms; `__sigil.ready` at 4.3 s after navigation. Lesson: measure with explicit timers,
not the FPS overlay, when the preview isn't visible.

A real bug found at the same time: `#progress { display: flex }` overrode the `hidden` attribute, so
"Raising the far side" never disappeared. Fixed globally with `[hidden] { display: none !important; }`.

---

## 2026-09-14 — The "black sun": haze as the light source, lamplight through smog

**Context** — First screenshots showed a large dark disc above City Court, and looking straight up showed
a dark strip. Toggling layers ruled out smoke, far boxes and ground individually. A red background showed
only corner patches, so it was not the void. Green fog turned the disc fully green, so it was heavily
fogged geometry. With `?fog=0` it stayed dark brown.

**Finding** — The geometry was correct. The disc is the Hive, directly across the ring from Lady's Ward
(u + π), seen through the gap in our own tube and framed by our rims. Its dark palette next to pale
Lady's Ward stone, under a fog colour darker than lit surfaces, made the distant city read as a hole.

**Decision** — Treat the haze as the light source (canon: an all-pervasive light and no sky).
- Fog colour = ward tint × (0.42 + 0.78·brightness), always brighter than stone lit at ambient
  0.22 + 0.7·brightness. The background (the void past the rims) is 8 % brighter again.
- kFar raised from 1.2e-4 to 1.5e-4.
- Window and emissive light is added after fog with 0.4× the extinction (`glow · exp(-0.4·kFar·d)`), so
  at antipeak the far side becomes a field of lamps overhead.
- Windows got mullions and per-window brightness variation. Smoke was lightened so plumes read against
  the haze.

**Alternatives rejected**
- *Recolour or brighten the Hive* — only fixes it from Lady's Ward; any dark ward opposite a light one
  repeats the problem.
- *A painted "sky" behind the gap* — Sigil has no sky; the gap must show the far side of the city.
- *Less fog* — the far side becomes a sharp, shimmering carpet of sub-pixel boxes instead of a hazy city.

**Verification** — From City Court: looking up shows a glowing gap with the far side as a hazy band, and
the forward disc is now a light haze. Antipeak look-up: a lit city curving overhead. Great Foundry: smoke
plumes visible from the chimneys.

**Open / revisit** — The bird's-eye band-edge view reads flat in heavy ward smog; a height-dependent smog
term might help.

---

## 2026-09-14 — Deploy to GitHub Pages

**Decision** — Public repo `otac0011/sigil`, Pages with a legacy build from `main` root, enabled with
`gh api -X POST repos/otac0011/sigil/pages -f source[branch]=main -f source[path]=/`. `.nojekyll` so
Jekyll never processes the files.

**Alternatives rejected** — *Actions workflow deploy* (nothing to build); *`gh-pages` branch* (a second
branch to keep in sync for no benefit).

**Verification** — Build `built` with no error. On https://otac0011.github.io/sigil/ every module, data
and worker request returned 200, with no console errors and `__sigil.ready` at 1.7 s; the City Court view
matched local. Mobile emulation (375×812): no horizontal scroll, mini-map 208 px wide, caption wraps
to 144 px.

**Open / revisit** — README has no screenshots yet; the tooling here can't save browser captures to disk.
