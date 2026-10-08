"""Headless driver: runs the MoldForge pipeline inside `blender --background`.

Invoked by the web server as:
    blender --background --factory-startup --python driver.py --
            <mesh_path> <params_json_path> <output_dir>

It imports the UNMODIFIED moldforge package (repo root on sys.path, same pattern
as moldforge/tests/test_headless.py) and calls its public pipeline entry points:
`prebuild_warnings` and `build_mold_system`, then `export_objects` for STLs.

Artifacts written into <output_dir>:
    progress.json  {"progress": 0..1, "phase": "...", "ts": epoch}   (live)
    result.json    final status, volumes, notes, warnings, part list,
                   "print" (per-part recommended print orientation + rationale)
    preflight.json geometry stats of the imported mesh (always, cheap)
    stages.jsonl   per-operation instrumentation trail (durations, RSS)
    *.stl          the mold parts IN THEIR RECOMMENDED PRINT ORIENTATION,
                   bottom aligned to Z=0 (plus Master.stl when the workflow
                   needs the original printed, and MF_Skin silicone preview)

Safety (see webui/safety/): a preflight inspection rejects inputs no build
could survive; runtime hooks bound every modifier application (deadline, op
budget, post-op geometry sanity, repeated-failure detection); an in-process
watchdog caps memory/time; the SERVER-side supervisor is the authoritative
kill when a C++ operation holds the GIL. All failures carry an error_code.

The moldforge/ directory is never modified. Units follow the add-on's
convention: 1 scene unit = 1 mm, so parameter values pass through raw.
The web UI's size step sends two reserved keys alongside the moldforge
parameters, both popped here before the add-on ever sees the params:
`model_scale` (uniform factor) and `model_rotation` ([rx, ry, rz] degrees
from the size step's orientation control). Both are baked into the imported
mesh before the pipeline runs (moldforge never sees the keys).
"""

import json
import math
import os
import sys
import time
import traceback
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                            # workspace root
REPO_PARENT = ROOT                                      # contains moldforge/
sys.path.insert(0, REPO_PARENT)
sys.path.insert(0, HERE)                                # webui/safety package

import bpy  # noqa: E402  (we are running inside Blender)

from safety import limits as sf_limits, hooks as sf_hooks, preflight as sf_pref
from safety.errors import (SafetyAbort, ERROR_BOOLEAN_FAILED,  # noqa: E402
                           ERROR_GEOMETRY_FAILED,
                           ERROR_INVALID_PARAMETER)
from safety.guards import GuardState, make_jsonl_sink


# --------------------------------------------------------------------------
# mesh import


def _objects_before():
    return set(bpy.data.objects)


def _try_import(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    ops = bpy.ops
    attempts = {
        ".stl": (ops.wm.stl_import,),
        ".obj": (ops.wm.obj_import,),
        ".ply": (ops.wm.ply_import,),
        ".glb": (ops.import_scene.gltf,),
        ".gltf": (ops.import_scene.gltf,),
    }[ext]
    last_err = None
    for op in attempts:
        try:
            return op(filepath=filepath)
        except Exception as exc:  # try the next spelling of the operator
            last_err = exc
    raise RuntimeError(f"Could not import {ext} file: {last_err}")


def import_master(filepath):
    """Import the uploaded mesh and return a single master MESH object."""
    before = _objects_before()
    res = _try_import(filepath)
    if res not in ({'FINISHED'}, 'FINISHED'):
        raise ValueError("The uploaded file could not be read as a mesh.")
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    if not new:
        raise ValueError("No mesh geometry found in the uploaded file.")

    if len(new) > 1:  # multi-object OBJ/GLTF: join into one master
        bpy.ops.object.select_all(action='DESELECT')
        for o in new:
            o.select_set(True)
        bpy.context.view_layer.objects.active = new[0]
        bpy.ops.object.join()
        bpy.ops.object.select_all(action='DESELECT')
    master = bpy.context.view_layer.objects.active
    if master is None or master.type != 'MESH':
        master = new[0]
    bpy.context.view_layer.objects.active = master
    master.select_set(True)
    bpy.context.view_layer.update()
    return master


# --------------------------------------------------------------------------
# props


def build_props(params):
    """A SimpleNamespace starting from the add-on's OWN introspected defaults
    (`pipeline._prop_defaults()` reads the real property definitions, so it can
    never drift), overlaid with the web UI's parameters. Only keys the add-on
    actually defines are accepted."""
    from moldforge.core import pipeline
    base = dict(pipeline._prop_defaults())
    unknown = [k for k in params if k not in base]
    if unknown:
        raise ValueError(f"Unknown parameter(s): {', '.join(sorted(unknown))}")
    base.update(params)
    return types.SimpleNamespace(**base)


def pop_model_scale(params):
    """Remove the web UI's reserved `model_scale` key (the size step's uniform
    scale factor). Popped before build_props() so the add-on's strict
    unknown-key check never sees it. Not a moldforge property."""
    if "model_scale" not in params:
        return 1.0
    raw = params.pop("model_scale")
    try:
        s = float(raw)
    except (TypeError, ValueError):
        raise ValueError("model_scale must be a number.")
    if not math.isfinite(s) or s <= 0:
        raise ValueError("model_scale must be a positive number.")
    return min(max(s, 0.001), 1000.0)


def apply_model_scale(master, scale):
    """Bake a uniform scale into the master's mesh data (rotation/location
    untouched) so every downstream read — raw vertices or world matrices —
    sees the scaled geometry. No-op at scale 1."""
    if abs(scale - 1.0) < 1e-9:
        return
    master.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def pop_model_rotation(params):
    """Remove the web UI's reserved `model_rotation` key ([rx, ry, rz] in
    degrees, the size step's orientation control). Popped before build_props()
    so the add-on's strict unknown-key check never sees it. Not a moldforge
    property. Returns None when absent."""
    if "model_rotation" not in params:
        return None
    raw = params.pop("model_rotation")
    try:
        rx, ry, rz = (float(raw[0]), float(raw[1]), float(raw[2]))
    except (TypeError, ValueError, IndexError, KeyError):
        raise ValueError("model_rotation must be [x, y, z] degrees.")
    for a in (rx, ry, rz):
        if not math.isfinite(a):
            raise ValueError("model_rotation must be finite degrees.")
    return (rx, ry, rz)


def apply_model_rotation(master, rot):
    """Bake the size step's orientation into the master's mesh data by
    post-multiplying the imported object matrix (degrees, X then Y then Z),
    so it composes with whatever rotation the importer left on the object
    instead of overwriting it. No-op at (0, 0, 0)."""
    if not rot or all(abs(a) < 1e-9 for a in rot):
        return
    from mathutils import Matrix, Euler
    spin = Euler(tuple(math.radians(a) for a in rot), 'XYZ').to_matrix().to_4x4()
    master.matrix_world = spin @ master.matrix_world
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


# --------------------------------------------------------------------------
# main


def _write(path, payload):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    os.replace(tmp, path)          # atomic-ish: the server polls this file


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    mesh_path, params_path, outdir = argv[0], argv[1], argv[2]
    os.makedirs(outdir, exist_ok=True)
    progress_path = os.path.join(outdir, "progress.json")
    result_path = os.path.join(outdir, "result.json")
    started = time.time()

    limits = sf_limits.Limits.from_env()
    guard = GuardState(limits, sink=make_jsonl_sink(
        os.path.join(outdir, "stages.jsonl")))
    guard.log("job_start", model=os.path.basename(mesh_path),
              limits=limits.describe())

    state = {"progress": 0.0}

    def progress(frac, label):
        state["progress"] = frac
        _write(progress_path, {"progress": round(frac, 4), "phase": label,
                               "ts": time.time()})

    def finish(payload):
        payload.setdefault("elapsed_s", round(time.time() - started, 1))
        payload["peak_rss_mb"] = round(guard.peak_rss_mb, 1)
        _write(progress_path, {"progress": 1.0, "phase": "done",
                               "ts": time.time()})
        _write(result_path, payload)

    def watchdog_result(code, message, stage):
        finish({"ok": False, "kind": "safety", "error": message,
                "error_code": code, "stage": stage,
                "diagnostics": guard.diagnostics()})

    payload = {"ok": False, "error": "driver did not finish"}
    try:
        with open(params_path, "r", encoding="utf-8") as f:
            params = json.load(f)
        model_scale = pop_model_scale(params)
        model_rotation = pop_model_rotation(params)

        # Fresh empty scene, default unit system (1 unit = 1 mm convention).
        bpy.ops.wm.read_factory_settings(use_empty=True)

        guard.note_stage("import")
        _write(progress_path, {"progress": 0.0, "phase": "importing model",
                               "ts": time.time()})
        try:
            master = import_master(mesh_path)
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("The uploaded file could not be imported: "
                             + " ".join(str(exc).split())[:200]) from exc
        apply_model_scale(master, model_scale)
        apply_model_rotation(master, model_rotation)

        # ---- preflight (Phase 9): cheap inspection before any heavy work --
        guard.note_stage("preflight")
        guard.check("preflight")
        stats = sf_pref.enforce(sf_pref.inspect(master, limits), limits)
        _write(os.path.join(outdir, "preflight.json"), stats)
        guard.log("preflight", **{k: stats[k] for k in
                                  ("vertices", "faces", "manifold",
                                   "max_extent") if k in stats})

        # ---- safety hooks + in-process watchdog ----------------------------
        sf_hooks.install(guard, limits, heartbeat_path=progress_path,
                         progress_getter=lambda: state["progress"])
        sf_hooks.start_watchdog(guard, limits, watchdog_result)

        from moldforge.core import pipeline
        from moldforge.core import export as mf_export

        props = build_props(params)

        warnings = pipeline.prebuild_warnings(master, props)
        _write(progress_path, {"progress": 0.02, "phase": "starting build",
                               "ts": time.time()})

        result = pipeline.build_mold_system(master, props, progress=progress)

        # ---- final printability & orientation analysis (post-processing) --
        # Every generated part — and the master too when the workflow pours
        # silicone around a physical original (pour box / tray) — is rotated
        # into its recommended FDM print orientation and lowered onto the
        # virtual build plate at Z=0. Rigid transform only: dimensions and
        # scale are exactly what the pipeline produced. The exported STLs are
        # slicer-ready as-is; result.json carries the per-part rationale.
        guard.note_stage("print_orientation")
        guard.check("print_orientation")
        from print_orientation import analyze_printables
        export_objs, print_report = analyze_printables(
            result["parts"], master=master,
            include_master=getattr(props, "box_style", "POUR_BOX") != "SOLID",
            progress=progress, log=guard.log)
        guard.log("print_orientation_done",
                  parts=len(print_report["parts"]),
                  master=bool(print_report["master"]))

        part_files = mf_export.export_objects(export_objs, outdir)
        parts = [{"name": os.path.splitext(os.path.basename(p))[0],
                  "file": os.path.basename(p),
                  "bytes": os.path.getsize(p),
                  "faces": len(o.data.polygons),
                  "role": ("master" if o is master else "part")}
                 for p, o in zip(part_files, export_objs)]

        skin_file = None
        if result.get("skin") is not None:
            written = mf_export.export_objects([result["skin"]], outdir)
            skin_file = os.path.basename(written[0])

        payload = {
            "ok": True,
            "summary": {
                "style": getattr(props, "box_style", "POUR_BOX"),
                "tray_mode": result.get("tray_mode"),
                "skin_keys": bool(getattr(props, "skin_keys", False)),
                "parts_count": len(parts),
                "radial": getattr(props, "parts_count", 2) >= 3
                          and getattr(props, "box_style", "") != "TRAY",
            },
            "volumes": {
                "cavity_volume": result["cavity_volume"],
                "silicone_volume": result["silicone_volume"],
                "plastic_volume": result.get("plastic_volume", 0.0),
            },
            "notes": {
                "remeshed": bool(result.get("remeshed")),
                "trimmed": bool(result.get("trimmed")),
                "undercut": result.get("undercut", 0.0),
                "axis": result.get("axis"),
                "model_scale": model_scale,
                "model_rotation": list(model_rotation or (0.0, 0.0, 0.0)),
            },
            "warnings": warnings,
            "parts": parts,
            "print": print_report,
            "skin": skin_file,
            "preflight": stats,
        }
    except SafetyAbort as exc:         # controlled safety failure
        payload = exc.payload()
        payload["diagnostics"] = {**payload.get("diagnostics", {}),
                                  **guard.diagnostics()}
        print(f"SAFETY ABORT [{exc.code}] stage={exc.stage}: {exc}",
              file=sys.stderr)
    except ValueError as exc:          # clean, user-facing input error
        payload = {"ok": False, "kind": "input", "error": str(exc),
                   "error_code": ERROR_INVALID_PARAMETER,
                   "diagnostics": guard.diagnostics()}
    except Exception as exc:            # geometry failure / recovery exhausted
        last_op = ""
        for ev in reversed(guard.events):
            if ev.get("event") == "op_start":
                last_op = ev.get("op", "")
                break
        payload = {"ok": False, "kind": "geometry", "error": str(exc),
                   "error_code": (ERROR_BOOLEAN_FAILED if last_op == "boolean"
                                  else ERROR_GEOMETRY_FAILED),
                   "stage": guard.stage,
                   "diagnostics": guard.diagnostics(),
                   "trace": traceback.format_exc(limit=8)}
        print(traceback.format_exc(), file=sys.stderr)
    finally:
        finish(payload)


main()
