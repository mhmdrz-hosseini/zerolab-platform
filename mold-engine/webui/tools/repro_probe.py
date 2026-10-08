"""Instrumented reproduction probe — runs INSIDE blender --background.

Wraps the moldforge pipeline's expensive operations at RUNTIME (module
attribute patching — the moldforge/ files themselves are never modified) and
logs every call: operation, input sizes, duration, and process RSS. Combined
with tools/capped_run.py this pins down exactly which operation spins on a
pathological model.

Usage:
    blender --background --factory-startup --python repro_probe.py --
            <model.stl> <out.jsonl> <deadline_seconds> [params_json]

Writes one JSON line per event to <out.jsonl> and a summary object as the
last line ("event": "summary").
"""

import ctypes
import json
import os
import sys
import time
import traceback
from ctypes import wintypes

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)

import bpy  # noqa: E402


# ---- RSS sampling (Windows, zero deps) --------------------------------------

class PMC(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t)]


_psapi = ctypes.WinDLL("psapi")
_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


def rss_mb():
    pmc = PMC()
    pmc.cb = ctypes.sizeof(PMC)
    h = _kernel32.GetCurrentProcess()
    if not _psapi.GetProcessMemoryInfo(h, ctypes.byref(pmc), pmc.cb):
        return -1.0
    return pmc.WorkingSetSize / (1024.0 * 1024.0)


# ---- probe ------------------------------------------------------------------

EVENTS = []
START = time.time()
DEADLINE_S = 600.0


class ProbeAbort(Exception):
    pass


def log_event(**kw):
    ev = {"t": round(time.time() - START, 2), "rss_mb": round(rss_mb(), 1)}
    ev.update(kw)
    EVENTS.append(ev)
    try:
        print("PROBE " + json.dumps(ev, default=str), flush=True)
    except Exception:
        pass


def _mesh_sig(obj):
    try:
        me = obj.data
        return {"name": obj.name, "verts": len(me.vertices), "faces": len(me.polygons)}
    except Exception:
        return {"name": getattr(obj, "name", "?")}


def _wrap(module, attrname, label):
    """Patch module.attr with a timing/RSS-logging wrapper."""
    orig = getattr(module, attrname)

    def wrapper(*a, **kw):
        if time.time() - START > DEADLINE_S:
            raise ProbeAbort(f"probe deadline hit before {label}")
        t0 = time.time()
        r0 = rss_mb()
        sig = {"args": [_mesh_sig(x) for x in a if hasattr(x, "data")],
               "kw": {k: str(v) for k, v in kw.items() if k in ("operation", "solver", "voxel_size", "ratio", "dist")}}
        log_event(event="call", op=label, **sig)
        try:
            res = orig(*a, **kw)
        except Exception as exc:
            log_event(event="error", op=label, dur=round(time.time() - t0, 2),
                      rss_before=r0, rss_after=round(rss_mb(), 1),
                      err=type(exc).__name__, msg=str(exc)[:300])
            raise
        log_event(event="done", op=label, dur=round(time.time() - t0, 2),
                  rss_before=r0, rss_after=round(rss_mb(), 1))
        return res

    wrapper.__name__ = attrname
    setattr(module, attrname, wrapper)
    return orig


def main():
    global DEADLINE_S
    argv = sys.argv[sys.argv.index("--") + 1:]
    model_path, out_path = argv[0], argv[1]
    DEADLINE_S = float(argv[2]) if len(argv) > 2 else 600.0
    params = json.loads(argv[3]) if len(argv) > 3 else {}

    out = open(out_path, "w", encoding="utf-8")

    def emit(ev):
        out.write(json.dumps(ev, default=str) + "\n")
        out.flush()

    summary = {"model": os.path.basename(model_path), "events": 0}
    try:
        # -- what does Blender's STL importer actually give us? ---------------
        bpy.ops.wm.read_factory_settings(use_empty=True)
        t0 = time.time()
        bpy.ops.wm.stl_import(filepath=model_path)
        emit({"event": "import", "dur": round(time.time() - t0, 2),
              "rss_mb": round(rss_mb(), 1)})
        objs = [o for o in bpy.data.objects if o.type == "MESH"]
        me = objs[0].data
        nverts = len(me.vertices)
        nfaces = len(me.polygons)
        nan = sum(1 for v in me.vertices
                  if not all((v.co.x == v.co.x, v.co.y == v.co.y, v.co.z == v.co.z)))
        big = sum(1 for v in me.vertices
                  if max(abs(v.co.x), abs(v.co.y), abs(v.co.z)) > 1e6)
        import mathutils
        if nverts:
            mn = me.vertices[0].co.copy()
            mx = mn.copy()
            for v in me.vertices:
                mn.x = min(mn.x, v.co.x); mn.y = min(mn.y, v.co.y); mn.z = min(mn.z, v.co.z)
                mx.x = max(mx.x, v.co.x); mx.y = max(mx.y, v.co.y); mx.z = max(mx.z, v.co.z)
            bbox = [tuple(round(c, 2) for c in mn), tuple(round(c, 2) for c in mx)]
        else:
            bbox = None
        pre = {"verts": nverts, "faces": nfaces, "nan_verts": nan,
               "verts_beyond_1e6": big, "bbox": bbox}
        emit({"event": "post_import", **pre, "rss_mb": round(rss_mb(), 1)})
        summary["post_import"] = pre

        master = objs[0]
        bpy.context.view_layer.objects.active = master

        # -- instrument the moldforge modules (runtime patching only) ---------
        from moldforge.core import pipeline as mf_pipeline
        from moldforge.core import util as mf_util
        from moldforge.core import meshprep as mf_meshprep
        from moldforge.core import build as mf_build

        _wrap(mf_util, "boolean", "boolean")
        _wrap(mf_util, "apply_all_modifiers", "apply_modifiers")
        _wrap(mf_util, "undercut_fraction", "undercut_fraction")
        _wrap(mf_util, "has_self_intersections", "self_intersections")
        _wrap(mf_util, "remove_small_islands", "remove_small_islands")
        _wrap(mf_util, "island_count", "island_count")
        _wrap(mf_util, "nonmanifold_count", "nonmanifold_count")
        _wrap(mf_meshprep, "voxel_remesh", "voxel_remesh")
        _wrap(mf_meshprep, "heal", "heal")
        _wrap(mf_meshprep, "decimate", "decimate")
        _wrap(mf_build, "_dilate_solid", "dilate_solid")
        _wrap(mf_pipeline, "_build_once", "build_once_attempt")

        import types
        props = types.SimpleNamespace(**dict(mf_pipeline._prop_defaults()))
        for k, v in params.items():
            setattr(props, k, v)

        t0 = time.time()
        r0 = rss_mb()
        emit({"event": "build_start", "rss_mb": r0})
        try:
            result = mf_pipeline.build_mold_system(
                master, props,
                progress=lambda f, l: emit({"event": "phase", "frac": f,
                                            "label": l,
                                            "rss_mb": round(rss_mb(), 1)}))
            summary["build"] = "ok"
            summary["parts"] = len(result["parts"])
        except Exception as exc:
            summary["build"] = f"{type(exc).__name__}: {exc}"[:500]
            summary["build_trace"] = traceback.format_exc(limit=12)
        emit({"event": "build_end", "dur": round(time.time() - t0, 2),
              "rss_mb": round(rss_mb(), 1)})
    except ProbeAbort as exc:
        summary["build"] = f"PROBE ABORT: {exc}"
    except Exception as exc:
        summary["fatal"] = f"{type(exc).__name__}: {exc}"
        summary["fatal_trace"] = traceback.format_exc(limit=12)
    finally:
        summary["elapsed_s"] = round(time.time() - START, 1)
        summary["peak_rss_mb"] = round(rss_mb(), 1)
        summary["events"] = len(EVENTS)
        emit({"event": "summary", **summary})
        out.close()


main()
