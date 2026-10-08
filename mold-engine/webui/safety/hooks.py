"""Runtime instrumentation installed INSIDE the Blender process by the driver.

The moldforge/ add-on files are never modified. Instead, the driver patches a
small set of module attributes at import time (the add-on resolves these names
on its own modules at call time, so the patches take effect everywhere):

* ``util.apply_all_modifiers`` — EVERY modifier application (Solidify, Boolean,
  Voxel Remesh, Decimate) funnels through this one function. The wrapper
  enforces, around each call:
      - heartbeat + total-deadline + op-budget checks (Phases 1/4)
      - a POST-OPERATION geometry sanity scan: non-finite or astronomic
        coordinates mean an intermediate mesh exploded (a Solidify spike on a
        degenerate region reaches ~10^6 mm) — abort NOW, before the next
        operation amplifies it into gigabytes of allocation (the Körper bug)
* ``util.boolean`` / ``meshprep.*`` / ``build._dilate_solid`` / slow scans —
  stage labels, failure signatures (Phase 6/7)
* ``pipeline._build_once`` — recovery-ladder rung tracking + no-progress
  detection (Phase 3)

SafetyAbort deliberately subclasses plain Exception (NOT RuntimeError): the
ladder's ``except (MoldGeometryError, RuntimeError)`` must not swallow it. If
a best-effort bare ``except Exception`` block does swallow one, ``guard.tripped``
stays set and the next wrapped operation re-raises immediately — processing
cannot continue after a trip.
"""

import array
import math
import os
import threading
import time

from .errors import (SafetyAbort, ERROR_INVALID_GEOMETRY, ERROR_MEMORY_LIMIT,
                     ERROR_PROCESSING_TIMEOUT)
from . import procmon
from .guards import quantize

try:
    import bpy  # noqa: F401
    _HAS_BPY = True
except ImportError:
    _HAS_BPY = False


# --------------------------------------------------------------------------
# cheap mesh scanning (foreach_get -> buffer math; numpy fast path in Blender)


def _coord_buffer(me):
    n = len(me.vertices)
    if n == 0:
        return None
    buf = array.array("f", bytes(4 * 3 * n))
    me.vertices.foreach_get("co", buf)
    return buf


def _np(buf):
    try:
        import numpy as np
        return np.frombuffer(buf, dtype=np.float32)
    except ImportError:
        return None


def mesh_bbox(me):
    """Fast (min, max) per axis via foreach_get, or None for an empty mesh."""
    buf = _coord_buffer(me)
    if buf is None:
        return None
    xs, ys, zs = buf[0::3], buf[1::3], buf[2::3]
    return ((min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs)))


def mesh_nonfinite_count(me):
    buf = _coord_buffer(me)
    if buf is None:
        return 0
    arr = _np(buf)
    if arr is not None:
        import numpy as np
        return int((~np.isfinite(arr)).sum())
    return sum(1 for v in buf if not math.isfinite(v))


def mesh_absmax(me):
    """Largest |coordinate| in the mesh (inf-safe)."""
    buf = _coord_buffer(me)
    if buf is None:
        return 0.0
    arr = _np(buf)
    if arr is not None:
        import numpy as np
        return float(np.abs(arr).max()) if arr.size else 0.0
    peak = 0.0
    for v in buf:
        a = abs(v)
        if not math.isfinite(a):
            return math.inf
        if a > peak:
            peak = a
    return peak


def object_signature(obj):
    """Cheap identity for an object's geometry: verts/faces + quantized bbox.
    Used to detect the *same* operation being retried on the *same* input."""
    try:
        me = obj.data
        bbox = mesh_bbox(me)
        qb = None
        if bbox:
            qb = (tuple(quantize(c, 1e-3) for c in bbox[0]),
                  tuple(quantize(c, 1e-3) for c in bbox[1]))
        return (len(me.vertices), len(me.polygons), qb)
    except Exception:
        return ("?", "?", None)


# --------------------------------------------------------------------------
# hook installation


class _OpContext:
    """Tracks which semantic operation is on the stack (for labels)."""

    def __init__(self):
        self.stack = []

    def label(self):
        return self.stack[-1] if self.stack else "apply_modifiers"


_CTX = _OpContext()
_ORIG = {}


def _heartbeat(path, stage, progress=None):
    if not path:
        return
    tmp = path + ".hb.tmp"
    try:
        payload = {"phase": stage[:120], "ts": time.time()}
        if progress is not None:
            payload["progress"] = progress
        with open(tmp, "w", encoding="utf-8") as f:
            import json
            json.dump(payload, f)
        os.replace(tmp, path)
    except OSError:
        pass


def install(guard, limits, heartbeat_path=None, progress_getter=None):
    """Patch the moldforge modules. Returns a restore() (tests only)."""
    if not _HAS_BPY:
        raise RuntimeError("hooks.install() must run inside Blender")

    from moldforge.core import util as mf_util
    from moldforge.core import meshprep as mf_meshprep
    from moldforge.core import build as mf_build
    from moldforge.core import pipeline as mf_pipeline

    def save(module, name):
        _ORIG[(id(module), name)] = getattr(module, name)

    # ---- apply_all_modifiers: the choke point for every heavy operation ----
    save(mf_util, "apply_all_modifiers")
    orig_apply = mf_util.apply_all_modifiers

    def guarded_apply(obj):
        guard.check("apply_modifiers")          # re-raises tripped aborts
        guard.bump_op("apply_modifiers")
        label = _CTX.label()
        stage = f"{label} :: {obj.name}"
        guard.note_stage(stage)
        _heartbeat(heartbeat_path, stage,
                   progress_getter() if progress_getter else None)
        t0 = time.time()
        r0 = procmon.rss_mb() or 0.0
        prev_faces = len(obj.data.polygons) if obj.data else 0
        guard.log("op_start", op=label, obj=obj.name, faces=prev_faces)
        try:
            orig_apply(obj)
        except SafetyAbort:
            raise
        except Exception as exc:
            guard.record_op_failure(label, object_signature(obj), exc)
            raise
        dur = round(time.time() - t0, 2)
        r1 = procmon.rss_mb() or 0.0
        guard.peak_rss_mb = max(guard.peak_rss_mb, r1)
        # POST-OP SANITY (the Körper fix): an intermediate that exploded to
        # astronomic coordinates would make the next remesh/boolean allocate
        # without bound. Fail here, cleanly, with evidence.
        me = obj.data
        cur_faces = len(me.polygons) if me else 0
        absmax = mesh_absmax(me)
        if math.isinf(absmax) or absmax > limits.guard_max_coord_mm:
            guard.abort(
                ERROR_INVALID_GEOMETRY,
                f"An intermediate mesh exploded: '{obj.name}' reaches "
                f"|coord| = {absmax:.3g} mm after '{label}' (model has "
                f"near-degenerate geometry the offset could not handle).",
                obj=obj.name, op=label, absmax_mm=absmax,
                faces=cur_faces, prev_faces=prev_faces,
                op_dur_s=dur)
        nan = mesh_nonfinite_count(me)
        if nan:
            guard.abort(
                ERROR_INVALID_GEOMETRY,
                f"An intermediate mesh became non-finite: '{obj.name}' has "
                f"{nan} NaN/inf coordinates after '{label}'.",
                obj=obj.name, op=label, nonfinite=nan,
                faces=cur_faces, prev_faces=prev_faces, op_dur_s=dur)
        guard.log("op_done", op=label, obj=obj.name, dur=dur,
                  rss_mb=round(r1, 1), prev_faces=prev_faces,
                  faces=cur_faces)

    guarded_apply.__name__ = "apply_all_modifiers"
    mf_util.apply_all_modifiers = guarded_apply

    # ---- labeled operations (context + failure signatures) ----------------
    def _labeled(module, name, label, sig_args=(0,)):
        save(module, name)
        orig = getattr(module, name)

        def wrapper(*a, **kw):
            guard.check(label)
            sig = tuple(object_signature(a[i]) for i in sig_args if i < len(a))
            _CTX.stack.append(label)
            t0 = time.time()
            try:
                res = orig(*a, **kw)
            except SafetyAbort:
                raise
            except Exception as exc:
                guard.record_op_failure(label, sig, exc)
                raise
            finally:
                _CTX.stack.pop()
                guard.log("call", op=label, dur=round(time.time() - t0, 2),
                          rss_mb=round(procmon.rss_mb() or 0.0, 1),
                          result=object_signature(a[sig_args[0]])
                          if sig_args and sig_args[0] < len(a) and
                          hasattr(a[sig_args[0]], "data") else None)
            return res

        wrapper.__name__ = name
        setattr(module, name, wrapper)

    _labeled(mf_util, "boolean", "boolean", sig_args=(0, 1))
    _labeled(mf_util, "undercut_fraction", "undercut_scan")
    _labeled(mf_util, "has_self_intersections", "self_intersection_scan")
    _labeled(mf_util, "remove_small_islands", "island_cleanup")
    _labeled(mf_meshprep, "voxel_remesh", "voxel_remesh")
    _labeled(mf_meshprep, "heal", "heal")
    _labeled(mf_meshprep, "decimate", "decimate")
    _labeled(mf_build, "_dilate_solid", "solidify_offset")

    # ---- recovery-ladder rung tracking (Phase 3) ---------------------------
    # NOTE: _build_once is a GENERATOR — failures only surface while the
    # caller drives it, so this wrapper must be a generator too (yield from
    # forwards send/throw/close and the return value untouched).
    save(mf_pipeline, "_build_once")
    orig_build_once = mf_pipeline._build_once

    def guarded_build_once(master, props, trim_ok=False):
        rung = guard.rung_index + 1
        guard.note_stage(f"build attempt {rung}")
        _heartbeat(heartbeat_path, f"build attempt {rung}",
                   progress_getter() if progress_getter else None)
        guard.log("rung_start", rung=rung, trim_ok=trim_ok,
                  master=object_signature(master))
        try:
            result = yield from orig_build_once(master, props, trim_ok=trim_ok)
        except SafetyAbort:
            raise
        except Exception as exc:
            if isinstance(exc, (mf_pipeline.MoldGeometryError, RuntimeError)):
                guard.record_rung_failure(object_signature(master), exc)
            raise
        guard.record_rung_success()
        guard.log("rung_done", rung=rung)
        return result

    guarded_build_once.__name__ = "_build_once"
    mf_pipeline._build_once = guarded_build_once

    def restore():
        mf_util.apply_all_modifiers = _ORIG[(id(mf_util), "apply_all_modifiers")]
        for module, name in ((mf_util, "boolean"),
                             (mf_util, "undercut_fraction"),
                             (mf_util, "has_self_intersections"),
                             (mf_util, "remove_small_islands"),
                             (mf_meshprep, "voxel_remesh"),
                             (mf_meshprep, "heal"),
                             (mf_meshprep, "decimate"),
                             (mf_build, "_dilate_solid"),
                             (mf_pipeline, "_build_once")):
            setattr(module, name, _ORIG[(id(module), name)])
        _CTX.stack.clear()
        _ORIG.clear()

    return restore


# --------------------------------------------------------------------------
# in-process watchdog (best-effort; the server-side supervisor is the
# authoritative kill — a C++ operation holding the GIL starves this thread)


def start_watchdog(guard, limits, write_result, poll_s=0.5):
    """Sample our own RSS + deadline; on breach write result.json and
    os._exit so the failure is structured even when hooks cannot run.
    write_result(code, message, stage) must produce the final result file."""

    def loop():
        while True:
            time.sleep(poll_s)
            rss = procmon.rss_mb()
            if rss is not None:
                guard.peak_rss_mb = max(guard.peak_rss_mb, rss)
                if rss > limits.max_memory_mb:
                    try:
                        write_result(ERROR_MEMORY_LIMIT,
                                     f"Blender memory usage ({rss:.0f} MB) "
                                     f"exceeded the {limits.max_memory_mb} MB cap "
                                     f"during stage '{guard.stage}'.",
                                     guard.stage)
                    finally:
                        os._exit(100)
            if guard.elapsed() > limits.job_timeout_s:
                try:
                    write_result(ERROR_PROCESSING_TIMEOUT,
                                 f"Build exceeded the total job time of "
                                 f"{limits.job_timeout_s}s (watchdog).",
                                 guard.stage)
                finally:
                    os._exit(101)

    threading.Thread(target=loop, daemon=True).start()
