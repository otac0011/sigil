# Sigil — the City of Doors

**Live:** https://otac0011.github.io/sigil/

A first-person view from inside Sigil, the ring-shaped city of the Planescape setting. The city is
built on the inside of a torus about 20 miles around, with no sky. Look ahead and the street rises, look
sideways and the city climbs up the tube walls, and look straight up to see the far side of the ring
about six miles away through the smog.

- **Mini-map (bottom left):** the six wards in canon clockwise order, the avenues, and 14 landmarks.
  Click a landmark to stand in its plaza, or click anywhere to be dropped on the nearest open street.
- **Caption bar:** where you are, which ward, and a short description.
- **Settings (gear):** eye height (street, rooftop, bird's-eye), the peak/antipeak light cycle, and quality.

Controls: drag to look, wheel or pinch to zoom, arrow keys to turn. Deep links: `#lm=civic-festhall`,
`#at=<u>,<v>`.

Unofficial fan content. See [NOTICE.md](NOTICE.md).

## How it works

| Piece | File | Method |
|---|---|---|
| Torus geometry | `js/math/torus.js` | Parameterisation `S(u,v)` with R = 3915 m, r = 1207 m, band v ∈ ±100°; local frame (e_u, e_v, n); camera basis built from the horizontal heading so it stays valid looking straight up |
| City layout | `js/gen/layout.js` | Ring avenues → jittered cross avenues → two-phase recursive BSP (far nodes, then lots), seeded per superblock and per node with mulberry32; seamless simplex noise for heights |
| Geometry | `js/gen/mesh-build.js`, `landmark-shapes.js` | Flat-shaded vertex-coloured triangles with baked "sourceless light", auto-corrected winding, window UVs in metres |
| Workers | `js/gen/worker.js`, `js/render/worker-pool.js` | Module workers build typed arrays and transfer them; main-thread fallback with the same handler |
| LOD | `js/render/chunks.js` | Whole city as instanced boxes in 128 sectors; detailed chunks streamed within 450 m; a per-chunk mask texture makes the far shader collapse boxes the near LOD is drawing |
| Look | `js/render/materials.js`, `atmosphere.js` | One shader family: vertex colour × ambient, procedural windows with derivative-based fade, two-layer (haze + ward smog) fog, logarithmic depth |
| Mini-map | `js/ui/minimap.js` | Oval annulus chart (angle = u, radius = v) with exact inverse for clicks |

The reasoning behind each choice, and the alternatives that were rejected, is in [JOURNAL.md](JOURNAL.md).

## Run locally

No build step and no npm: plain ES modules, with three.js 0.186.0 loaded from jsDelivr through an import map.

```
python tools/serve.py        # http://localhost:8137/
```

`tools/serve.py` exists because Windows often serves `.js` as `text/plain`, which breaks module scripts.

- Tests: http://localhost:8137/tests/ (geometry, map inverse and handedness, ward order, plazas and
  sightlines, lot overlaps, worker/main-thread determinism, street snapping).
- Debug switches: `?fps=1` (frame times, draw calls, triangles), `?fog=0`, `?q=low|high`.

## Repository layout

```
index.html, css/        page shell and styles
js/math/                torus math, PRNG and noise        (no three.js; worker-safe)
js/gen/                 layout, geometry, landmarks, worker (no three.js; worker-safe)
js/render/              three.js scene: materials, chunks/LOD, atmosphere, worker pool
js/ui/                  viewer, mini-map, caption and settings
data/sigil.json         wards and landmarks (names, positions, original descriptions)
tests/index.html        in-browser test page
tools/serve.py          dev server
```
