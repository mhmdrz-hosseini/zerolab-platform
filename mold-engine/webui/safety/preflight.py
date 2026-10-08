"""Preflight model inspection — runs after import, BEFORE any heavy build work.

Phase 9 of the safety design: a cheap look at the raw mesh that (a) rejects
inputs no voxel/boolean run could ever survive, (b) feeds the job record with
the geometry statistics that later explain a failure, and (c) never rejects a
model the pipeline could plausibly handle.

Hard rejections (SafetyAbort):
* non-finite vertex coordinates       -> ERROR_INVALID_GEOMETRY
* bbox extent beyond max_extent_mm    -> ERROR_INVALID_GEOMETRY (corrupt file)
* face count beyond max_faces         -> ERROR_UNSUPPORTED_COMPLEXITY

Everything else (non-manifold edges, disconnected islands, open boundary,
degenerate faces, self-intersections) is REPORTED, not rejected — the pipeline
has recovery paths (voxel remesh) for those.
"""

from .errors import (SafetyAbort, ERROR_INVALID_GEOMETRY,
                     ERROR_UNSUPPORTED_COMPLEXITY)
from . import hooks


def inspect(master, limits):
    """Return the preflight stats dict for the imported master object."""
    me = master.data
    faces = len(me.polygons)
    verts = len(me.vertices)

    stats = {"objects_merged": 1, "vertices": verts, "faces": faces}
    nonfinite = hooks.mesh_nonfinite_count(me)
    stats["nonfinite_vertices"] = nonfinite
    bbox = hooks.mesh_bbox(me)
    if bbox:
        mn, mx = bbox
        dims = [round(mx[i] - mn[i], 2) for i in range(3)]
        stats["dimensions"] = dims
        stats["bbox_min"] = [round(c, 2) for c in mn]
        stats["bbox_max"] = [round(c, 2) for c in mx]
        stats["max_extent"] = round(max(dims), 2)
    else:
        stats["dimensions"] = None
        stats["max_extent"] = 0.0

    # manifoldness / connectivity — reported (the pipeline remeshes around it)
    try:
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(me)
        try:
            stats["nonmanifold_edges"] = sum(
                1 for e in bm.edges if not e.is_manifold)
            boundary = sum(1 for e in bm.edges if e.is_boundary)
            stats["boundary_edges"] = boundary
            stats["manifold"] = stats["nonmanifold_edges"] == 0
            if faces <= 400_000:                     # flood fill cost cap
                seen = set()
                comps = 0
                for f in bm.faces:
                    if f in seen:
                        continue
                    comps += 1
                    stack = [f]
                    while stack:
                        cf = stack.pop()
                        if cf in seen:
                            continue
                        seen.add(cf)
                        for e in cf.edges:
                            for lf in e.link_faces:
                                if lf not in seen:
                                    stack.append(lf)
                stats["connected_components"] = comps
            else:
                stats["connected_components"] = None   # too heavy to count
        finally:
            bm.free()
    except Exception:
        pass                                          # best-effort stats only

    stats["self_intersection_warning"] = False
    if faces <= 150_000:                              # BVH overlap cost cap
        try:
            from moldforge.core import util as mf_util
            stats["self_intersection_warning"] = bool(
                mf_util.has_self_intersections(master))
        except Exception:
            pass
    return stats


def enforce(stats, limits):
    """Raise SafetyAbort when the input is beyond what any build could
    survive. Returns the stats dict (for chaining)."""
    if stats["nonfinite_vertices"]:
        raise SafetyAbort(
            ERROR_INVALID_GEOMETRY,
            f"The uploaded mesh has {stats['nonfinite_vertices']} vertices "
            f"with NaN/infinite coordinates — the file is corrupt.",
            stage="preflight",
            diagnostics={"preflight": stats})
    if stats.get("max_extent", 0.0) > limits.max_extent_mm:
        raise SafetyAbort(
            ERROR_INVALID_GEOMETRY,
            f"The uploaded mesh spans {stats['max_extent']:.0f} mm "
            f"(> {limits.max_extent_mm} mm) — the coordinates are corrupt or "
            f"the units are wrong; mold generation needs a model in "
            f"millimetres.",
            stage="preflight",
            diagnostics={"preflight": stats})
    if stats["faces"] > limits.max_faces:
        raise SafetyAbort(
            ERROR_UNSUPPORTED_COMPLEXITY,
            f"The uploaded mesh has {stats['faces']:,} faces "
            f"(> {limits.max_faces:,}) — too complex to process. Decimate it "
            f"and re-upload.",
            stage="preflight",
            diagnostics={"preflight": stats})
    return stats
