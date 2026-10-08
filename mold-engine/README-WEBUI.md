# MoldForge WebUI

A web interface for [MoldForge](https://github.com/Plesuro/MoldForge) — the
Blender add-on that turns a 3D model into a printable mold system (silicone
pour box, direct printed mold, or open-pour tray with sprues, vents, split and
clamp features, plus volume/weight estimates).

**The molding algorithms are 100% unchanged.** This project does not port or
modify any geometry code: generation runs the add-on's own
`moldforge/core/pipeline.py` inside a headless Blender subprocess
(`webui/driver.py`), exactly the way the add-on's own headless test suite
drives it. The web layer only feeds parameters in and renders the resulting
STLs.

The engine is **Blender 5.1.2 portable** — the version on which the add-on's
full upstream test suite passes **377/377** (on 5.2.2 the same suite scores
375/377: two adversarial "fold-over" quality checks regress in Blender's
boolean solver between 5.1 and 5.2). Point `MOLDFORGE_BLENDER` at another
`blender.exe` to use a different engine.

## What you get

- **Every Blender panel parameter** in a schema-driven form (`webui/static/js/schema.js`
  mirrors `properties.py` + `panel.py`, including conditional sections,
  presets and the funnel "truth row")
- **3D view instead of Blender's viewport** — Three.js viewer with orbit
  controls, the uploaded model, color-coded mold parts, translucent silicone
  skin (MF_Skin), exploded-view slider, wireframe toggle
- **Final printability & orientation analysis** — after generation, every
  printable part (including the master itself for pour-box / tray workflows)
  is rotated into its recommended FDM print orientation with the bottom
  aligned to a virtual build plate at Z=0; the exported STLs are
  slicer-ready as downloaded, and the viewer's default **🖨 Print bed** view
  shows them laid out on the bed exactly as they should be printed (toggle
  to **Assembly** for the mold put back together around the model)
- **STL download** per part or as a zip; volume/weight estimates in ml/g with
  the same math the add-on's panel uses

## Run it

```bat
setup.bat   :: one-time: clone repo, venv + pip, download portable Blender (~390 MB), vendor Three.js
run.bat     :: starts http://127.0.0.1:8000 and opens the browser
```

Requirements: Git, Python 3.10+, internet on first setup. Blender installs
**portably inside `engine/`** — no admin rights, nothing added to your system;
delete the folder to remove it.

Custom engine location: set `MOLDFORGE_BLENDER=C:\path\to\blender.exe` (or put
any `blender-*/blender.exe` under `engine/`, or have `blender` on PATH).

## How it works

```
browser ──POST /api/generate (mesh + params JSON)──► FastAPI (webui/server.py)
                                                        │ job queue, one at a time
                                                        ▼
                     blender --background --factory-startup --python webui/driver.py
                                                        │
                     driver: import moldforge (untouched) → pipeline.build_mold_system()
                                                        │
                     print_orientation.analyze_printables(): per part —
                       convex-hull resting candidates + ±axes → FDM score
                       (footprint, tipping, 45° overhangs, cavity protection,
                       height) → rigid transform baked in, bottom → Z=0
                                                        │
                     output/<job>/ : progress.json, result.json, MF_Mold_*.stl,
                     Master.stl (pour box / tray), MF_Skin.stl — all STLs in
                     their recommended print orientation
                                                        ▼
browser ◄── GET /api/job/{id} (progress/phase) + STL parts ──┘
```

Units follow the add-on's convention: **1 unit = 1 mm** — the web form's mm
values are passed through raw, and result volumes are converted with the same
`mm-per-unit` math as the add-on panel.

## Smart adviser

After a model uploads and renders, the browser analyzes the mesh client-side
(zero backend involvement, deterministic — no AI calls) and re-fits the
parameters to the shape; everything stays user-editable afterwards.

- `webui/static/js/analyze.js` — geometry pass over the parsed preview mesh:
  bbox, volume, welded-vertex topology (connected pieces, open/non-manifold
  edges), a 48-point footprint fill and a 32×32 per-axis undercut grid that
  mirrors the add-on's own draft check (`util.undercut_fraction`: a pull-axis
  ray crossing the surface more than twice sits over a trapped pocket).
- `webui/static/js/adviser.js` — pure decision rules, every threshold a named
  constant anchored to the add-on (TRAY_FLAT_RATIO, HEAVY_FACES, mold caps,
  "undercuts on every side → 3–4 pieces", …). Safety rails: SOLID is never
  auto-picked, `big_throat`/`big_mouth` never auto-enabled, `split_axis`
  stays AUTO, and sprue/vent suggestions are capped by `moldCaps()` so the
  form never shows a value the engine would snap down.
- UI (in `app.js`): a banner above the form lists one plain-language reason
  per adjustment plus model-health warnings (multi-piece, non-watertight,
  heavy mesh); advised fields carry an `auto` pill until the user edits them;
  **re-fit** re-runs the advice for the user's chosen mold type while keeping
  manual edits; **reset** restores factory defaults.

Run the unit tests and the real-model smoke test with Node:

```bat
node webui\static\js\analyze.test.mjs
node webui\static\js\adviser.test.mjs
node webui\smoke_advisor.mjs "D:\path\to\model.stl"
```

## Final printability & orientation analysis

The last pipeline stage (`webui/print_orientation.py`, runs inside the same
guarded Blender process, ~1 s even on a 550k-face part) answers, per
printable object: *if this went to a slicer right now, which side belongs on
the build plate?* It never modifies `moldforge/` and never fails a finished
build (per-part fallback = original orientation, bottom lowered to the
plate).

- **Candidates**: the convex hull's face normals (every flat the part could
  rest on, largest first, clustered, capped) plus the ±X/±Y/±Z axes.
- **Scoring** (numpy, on world-space triangles): bed-contact footprint vs.
  the bbox; real contact area; tipping (volume centroid must project inside
  the silhouette); the 45° overhang rule for supports; a heavier penalty for
  overhangs that land **inside concavities** (mold cavities, mating faces —
  support scars where they hurt); and height (wobble / time / material).
- **Output**: the winning orientation is baked into the object as a rigid
  transform (rotation + translation only — **dimensions and scale are
  exactly what the pipeline produced**), bottom exactly at Z=0. The
  downloaded STLs are slicer-ready; `result.json["print"]` carries per-part
  rationale (rest face, dims, contact %, support %, fits-a-220×220-bed) that
  the results panel shows as the *Print Plan*, and the viewer's default view
  lays the parts out on a virtual build plate. **Assembly** reconstructs the
  mold around the model from the reported rotation + original centers.
- The **master model** is included as a printable part (exported as
  `Master.stl`) for pour-box and tray workflows — the silicone cures around
  a printed original — and omitted for direct-printed (SOLID) molds.

Set `MOLDFORGE_PO_DEBUG=1` to dump every candidate's metrics to the job's
Blender stdout (`webui/tools/po_debug.py` / `po_stress.py` probe the stage
standalone).

## Resource safety (no model can hang or eat the RAM)

A pathological model used to be able to pin the CPU and grow Blender's memory
until the worker — or the whole machine — died (the classic case: a mesh whose
near-degenerate regions make the Solidify offset fling vertices ~10⁸ mm out;
the repair voxel-remesh then allocates ~1 GB/s inside OpenVDB). The webui now
bounds every run at four layers; `moldforge/` itself is never modified:

1. **Preflight** (`webui/safety/preflight.py`, runs after import): rejects
   inputs no build could survive — non-finite coordinates, bbox > 20 m,
   > 4M faces — with `ERROR_INVALID_GEOMETRY` / `ERROR_UNSUPPORTED_COMPLEXITY`.
   Everything else (non-manifold, disconnected, self-intersecting) is only
   *reported* into `preflight.json`; the pipeline has recovery paths for those.
2. **Runtime hooks** (`webui/safety/hooks.py`, installed by the driver):
   every modifier application (Solidify / Boolean / Remesh / Decimate) is
   wrapped — deadline + op-budget checks, a heartbeat before each op, and a
   post-op sanity scan that aborts the moment an intermediate mesh explodes to
   astronomic coordinates (`ERROR_INVALID_GEOMETRY`, stage + evidence, ~2 s /
   ~230 MB on the model that used to eat 6 GB). Identical operations failing
   on identical geometry abort with `ERROR_REPEATED_FAILURE`, and the
   recovery ladder re-running the whole build with no effect aborts with
   `ERROR_NO_PROGRESS`. Instrumentation trail in `output/<job>/stages.jsonl`.
3. **In-process watchdog**: samples Blender's own RSS; on breach it writes a
   structured result and exits (`ERROR_MEMORY_LIMIT` / `ERROR_PROCESSING_TIMEOUT`).
4. **Supervisor** (`webui/safety/supervisor.py`, authoritative): the server
   polls the child Blender's memory, wall time and stage heartbeat and KILLS
   the process on breach — this fires even when a C++ operation holds the GIL
   for minutes. Mapped to `ERROR_MEMORY_LIMIT` / `ERROR_JOB_TIMEOUT` /
   `ERROR_PROCESSING_TIMEOUT`; a crash without a result is
   `ERROR_BLENDER_CRASH`.

Dangerous failures (`ERROR_MEMORY_LIMIT`, `ERROR_BLENDER_CRASH`,
`ERROR_REPEATED_FAILURE`, `ERROR_NO_PROGRESS`, timeouts, op budget) preserve
the model + full context in `quarantine/` for the regression dataset.

All caps are env-tunable (`MOLDFORGE_MAX_MEMORY_MB` — default half of RAM
clamped to 2–8 GB, `MOLDFORGE_JOB_TIMEOUT_S` 1800, `MOLDFORGE_STAGE_TIMEOUT_S`
600, …); `GET /api/health` reports them. Every job result now carries
`error_code`, `stage`, `diagnostics` (elapsed, peak RSS, attempts, event tail)
and `peak_rss_mb`.

Run the safety regression suite (generated pathological models + the real
models that used to kill the worker — every case must end bounded):

```bat
.venv\Scripts\python.exe webui\run_safety_tests.py
.venv\Scripts\python.exe -m unittest discover -s webui\tests   (guard logic)
```

## Verify the engine

The add-on's own headless suite runs against the bundled Blender (the
`webui/run_upstream_tests.py` wrapper re-registers the scene property after
each reset to work around a Blender 5.x `read_factory_settings` behavior; the
suite code itself runs unmodified):

```bat
engine\blender-5.1.2-windows-x64\blender.exe --background --python webui\run_upstream_tests.py
```

It exits 0 when every scenario passes — proof the geometry code behaves exactly
as upstream (377/377 on 5.1.2).

## B2C / production notes

The local design is deliberately production-shaped:

- **`BlenderRunner` is the only execution seam** — replace it with a cloud
  queue (Celery/SQS + worker pool) without touching anything else. Each job is
  already an isolated directory (upload → params → artifacts).
- **Workers**: container image with Blender (or the official `bpy` pip wheel),
  autoscale CPU-only workers; a build is seconds-to-minutes and single-threaded
  heavy. One Blender per worker process; serialize per worker.
- **Artifacts** to object storage (S3 + CDN) instead of `output/`; serve signed
  URLs. Add the same caps already enforced here (file type, size) plus mesh
  polycount limits at the edge.
- **Licensing** (consult counsel): MoldForge is GPL-3.0. Running it server-side
  in a SaaS does not distribute it, so your web app need not be GPL — but keep
  attribution intact and comply with GPL if you ever ship bundled binaries.
  Blender (GPL) used as a separate backend process is the standard pattern.

## Project layout

```
moldforge/            the cloned add-on — NEVER modified
engine/               portable Blender 5.1.2 (setup-managed; 377/377 upstream suite)
webui/server.py       FastAPI: jobs API + static hosting; supervises Blender
webui/driver.py       runs INSIDE blender --background, drives the pipeline
webui/print_orientation.py  final printability analysis + build-plate alignment
webui/safety/         resource-safety layer (preflight, hooks, guards, supervisor)
webui/tools/          diagnostic probes (repro_probe, solidify_probe, capped_run, stl_stats, po_debug)
webui/tests/          unit tests for the safety guard logic
webui/static/         frontend: index.html, js/{app,viewer,schema}.js, vendor three.js
uploads/ output/ quarantine/   per-job scratch, artifacts, dangerous-model archive
setup.bat / run.bat   environment + launcher
```
