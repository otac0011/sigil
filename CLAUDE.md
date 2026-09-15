# Working conventions for this repo

## Keep the engineering journal

**After each meaningful step, append an entry to [`JOURNAL.md`](JOURNAL.md).**

The git log records *what* changed. The journal records **why**: the decision, the algorithm or method
chosen, the alternatives rejected and the reason, and what remains unresolved. It exists so the reasoning
can be audited months later, not just the diff.

Use the entry format at the top of `JOURNAL.md`. Name the actual method ("two-phase recursive BSP",
"mulberry32", "derivative-based window fade"), not "a standard approach". Record failed approaches and
visual bugs found while testing; those entries are the most valuable. Journal entries go in the same
commit as the work they describe. Skip mechanical edits.

## Hard constraints

- **No build step, no Node.** Plain ES modules served as static files; GitHub Pages serves the repo root.
- **three.js is pinned to 0.186.0** through the import map in `index.html`. Change the version only on
  purpose, and journal it.
- **`js/math/` and `js/gen/` must never import three.** They run inside module workers, where import
  maps do not apply.
- **Relative, lowercase, kebab-case paths.** Pages is case-sensitive and serves the site under `/sigil/`.
- **Original art only.** Never trace or copy official Planescape maps or artwork. Descriptions in
  `data/sigil.json` must be our own wording. Keep the Fan Content Policy notice in the page and NOTICE.md.
- **Determinism.** Layout and geometry are pure functions of `data/sigil.json`. Any change to generated
  output bumps `generatorVersion` and gets a journal entry.
- `tests/index.html` must show all PASS before committing.

## Run / test / deploy

```
python tools/serve.py                 # http://localhost:8137/   (tests: /tests/)
git push                              # Pages rebuilds from main (legacy build, root)
gh api repos/otac0011/sigil/pages/builds/latest   # check the build status
```

Debug switches: `?fps=1`, `?fog=0`, `?q=low|high`, deep links `#lm=<landmark-id>` and `#at=<u>,<v>`.
`window.__sigil` exposes `ready`, `state`, `travel(pick)`, `layout`, `city` and `atmosphere` for
browser-driven checks.

## Architecture notes

- One source of truth: `createLayout()` feeds the mini-map, street snapping, the workers and the tests.
- A chunk is drawn by exactly one LOD. Far nodes (BSP phase A) decide chunk membership for both LODs, so
  the near-mask texture hides exactly the far boxes whose lots the near mesh draws.
- Colours are display values: `THREE.ColorManagement.enabled = false` and linear output, so the fog,
  background and veil colours match exactly.
- Frame convention for all geometry: x = e_u, y = up (toward the tube centre line), z = -e_v. It is
  right-handed, so triangle winding survives the transform.
