"""Final printability & orientation analysis — runs INSIDE Blender (driver stage).

After moldforge has generated and validated every part, this stage answers one
question per printable object: "if this went to a slicer right now, which side
should sit on the build plate?" The chosen orientation is then baked into the
object (rotation + translation only — dimensions and scale are untouched) so
the exported STL sits on the virtual build plate at Z=0, slicer-ready.

Method (standard FDM lay-flat logic, geometric — no slicer simulation):

1.  Candidate "down" directions: the convex hull's face normals (every flat
    spot the part could physically rest on), largest first and clustered so
    near-duplicates cost nothing, plus the ±X/±Y/±Z axes as a safety net.
2.  Each candidate is scored in numpy on the world-space triangles:
      - footprint — convex hull of the contact points vs. the bbox footprint
        (a part that starts printing from a point or an edge is unstable);
      - real contact area — mesh faces lying in the lowest slice, projected;
      - tipping — the volume centroid must project inside the contact hull,
        with a stability-margin bonus;
      - supports — downward faces steeper than 45° that don't rest on the
        plate (the classic FDM support rule of thumb);
      - cavity protection — those overhangs that lie in concavities (off the
        convex hull) weigh extra: that is support scarring inside the mold
        cavity / on mating faces, the surfaces that matter;
      - height — unnecessarily tall orientations wobble, take longer and use
        more material.
3.  Best score wins; a tidy 90° roll puts the longer footprint side along X,
    the bottom is lowered exactly onto Z=0 and the transform is baked into
    the mesh. moldforge/ is never touched — this runs strictly on its output.

Every part is analyzed independently and any failure falls back to "original
orientation, bottom lowered to the plate" — a successful build is never
turned into a failed job by this stage.
"""

import math
import os

import bpy
import bmesh
import numpy as np
from bmesh.types import BMFace
from mathutils import Matrix, Vector, Quaternion
from mathutils.bvhtree import BVHTree

# Reference FDM build volume for "fits the bed" notes (Ender-3 class).
REFERENCE_BED = (220.0, 220.0, 250.0)

# ---- thresholds (angles/percentages of the FDM rule-of-thumb kind) ----------
SUPPORT_ANGLE_DEG = 45.0        # faces steeper than this, facing down, need supports
NEAR_PLATE_MM = 1.0             # down-faces this close to the plate just rest on it
BOTTOM_SLICE_FRAC = 0.0025      # contact slice thickness, relative to the diagonal
BOTTOM_SLICE_MIN_MM = 0.25
CANDIDATE_CLUSTER_DEG = 10.0    # hull normals closer than this are one candidate
MAX_CANDIDATES = 24             # cap per part (largest flats come first)

# ---- score weights ----------------------------------------------------------
W_FLAT = 0.40                   # footprint coverage of the bbox (stability)
W_TOUCH = 0.10                  # real mesh contact area
W_STAB = 0.08                   # tipping-margin bonus
W_SUPPORT = -0.30               # share of the surface needing supports
W_CAVITY = -0.35                # supports landing inside concavities (cavity/mating)
W_HEIGHT = -0.15                # taller than necessary
TIP_PENALTY = -5.0              # center of mass outside the contact polygon

_COS_SUPPORT = math.cos(math.radians(SUPPORT_ANGLE_DEG))
_DOWN = np.array([0.0, 0.0, -1.0])


# --------------------------------------------------------------------------
# geometry helpers


def _world_triangles(obj):
    """World-space geometry of an object as numpy arrays.

    Returns (verts, idx, tris, normals, areas): verts (V,3) mesh vertices in
    world coordinates, idx (T,3) triangle vertex indices, tris (T,3,3) world
    triangles, normals (T,3) unit face normals, areas (T,) — or None if the
    object has no faces."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        me.calc_loop_triangles()
        nv = len(me.vertices)
        lt = me.loop_triangles
        if nv == 0 or len(lt) == 0:
            return None
        co = np.empty(nv * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        idx = np.empty(len(lt) * 3, dtype=np.int64)
        lt.foreach_get("vertices", idx)
        idx = idx.reshape(-1, 3)
        mw = np.array(ev.matrix_world, dtype=np.float64)
        verts = co @ mw[:3, :3].T + mw[:3, 3]
        tris = verts[idx]
        cross = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
        twice = np.linalg.norm(cross, axis=1)
        areas = 0.5 * twice
        normals = cross / np.maximum(twice, 1e-30)[:, None]
        return verts, idx, tris, normals, areas
    finally:
        ev.to_mesh_clear()


def _hull(verts):
    """Convex hull of a point cloud. Returns (hull_faces, on_surface).

    hull_faces: [(normal (3,), area)] — the flats the part could rest on.
    on_surface: (V,) bool — the vertex lies on the hull surface; a triangle
    whose vertices are interior sits inside a concavity (cavity, pocket,
    mating relief)."""
    tmp = bpy.data.meshes.new("MF_PrintHullTmp")
    try:
        tmp.from_pydata(verts.tolist(), [], [])
        bm = bmesh.new()
        try:
            bm.from_mesh(tmp)
            result = bmesh.ops.convex_hull(bm, input=bm.verts,
                                           use_existing_faces=False)
            faces = [f for f in result.get("geom", ()) if isinstance(f, BMFace)]
            hull_faces = [(np.array(f.normal, dtype=np.float64), f.calc_area())
                          for f in faces if f.calc_area() > 1e-9]
            if not hull_faces:
                return None, np.ones(len(verts), dtype=bool)
            tree = BVHTree.FromBMesh(bm)
            eps = max(1e-4, float(np.abs(verts).max()) * 2e-5)
            on_surface = np.fromiter(
                (tree.find_nearest(Vector(v))[3] <= eps for v in verts),
                dtype=bool, count=len(verts))
            return hull_faces, on_surface
        finally:
            bm.free()
    finally:
        bpy.data.meshes.remove(tmp, do_unlink=True)


def _convex_hull_2d(points):
    """Monotone-chain hull of 2D points; CCW, no duplicate endpoints.
    Deterministically subsamples very large inputs (the hull of a dense
    cloud is computed from a seeded sample — plenty for a stability metric)."""
    if len(points) > 4096:
        points = points[np.random.default_rng(0).choice(
            len(points), 4096, replace=False)]
    pts = sorted(set(map(tuple, np.round(points, 6))))
    if len(pts) < 3:
        return np.array(pts, dtype=np.float64) if pts else np.zeros((0, 2))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1], dtype=np.float64)


def _polygon_metrics(hull2d, point):
    """Area of a CCW convex polygon, whether `point` lies inside, and its
    distance to the nearest edge (negative when outside — it tips)."""
    if len(hull2d) < 3:
        return 0.0, False, -1.0
    a = np.roll(hull2d, -1, axis=0)
    edge = a - hull2d
    cr = (edge[:, 0] * (point[1] - hull2d[:, 1])
          - edge[:, 1] * (point[0] - hull2d[:, 0]))
    area = 0.5 * float(np.abs(np.sum(hull2d[:, 0] * a[:, 1]
                                     - a[:, 0] * hull2d[:, 1])))
    inside = bool(np.all(cr >= -1e-9))
    lengths = np.maximum(np.linalg.norm(edge, axis=1), 1e-12)
    dist = float(np.min(np.abs(cr) / lengths))
    return area, inside, (dist if inside else -dist)


def _volume_centroid(tris):
    """Volume centroid via signed tetrahedra about the origin; vertex-mean
    fallback for open/degenerate shells."""
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    tet = np.einsum("ij,ij->i", a, np.cross(b, c))       # 6x signed volume
    vol = tet.sum()
    if abs(vol) < 1e-9:
        return tris.reshape(-1, 3).mean(axis=0)
    centroid = (tet[:, None] * (a + b + c) / 4.0).sum(axis=0) / vol
    return centroid


# --------------------------------------------------------------------------
# candidates + scoring


def _candidate_directions(hull_faces):
    """Deduped down-direction candidates: hull flats (largest first) plus the
    six world axes (mold systems are axis-aligned, and a box's real resting
    faces are exact axis normals the hull triangulation may split oddly)."""
    out = []
    axes = [np.array(v, dtype=np.float64) for v in
            ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0),
             (0, 0, 1), (0, 0, -1))]
    cos_cluster = math.cos(math.radians(CANDIDATE_CLUSTER_DEG))
    cos_axis = math.cos(math.radians(5.0))

    def add(vec):
        n = np.linalg.norm(vec)
        if n < 1e-9:
            return
        v = vec / n
        for kept, _ in out:
            if float(np.dot(kept, v)) > cos_cluster:
                return
        out.append((v, True))

    max_area = max((a for _, a in hull_faces), default=0.0)
    min_face = max(4.0, 0.005 * max_area)   # dust facets can't carry a part
    for normal, area in sorted(hull_faces, key=lambda f: -f[1]):
        if area < min_face or len(out) >= MAX_CANDIDATES:
            break
        if any(float(np.dot(normal, ax)) > cos_axis for ax in axes):
            continue                        # the axis entry covers it
        add(normal)
    for ax in axes:                         # safety net, always present
        add(ax)
    return [v for v, _ in out]


def _evaluate(verts, idx, normals, areas, cavity_tri, com, d, diag, total_area,
              outline_pts):
    """All printability metrics for one candidate down-direction `d`.

    `outline_pts` are the part's convex-hull-surface vertices (precomputed):
    their 2D hull is the printed silhouette — the tipping reference. A part
    whose volume centroid projects outside its own silhouette genuinely
    falls over; a small-but-centered contact patch is *instability*, captured
    by the footprint score, not tipping."""
    v3 = Vector(d).rotation_difference(Vector(_DOWN))
    m = v3.to_matrix()
    rot = np.array([m.row[0], m.row[1], m.row[2]], dtype=np.float64)

    vr = verts @ rot.T                       # (V,3) rotated into the print frame
    zverts = vr[:, 2]
    zmin, zmax = float(zverts.min()), float(zverts.max())
    height = zmax - zmin
    eps = max(BOTTOM_SLICE_MIN_MM, diag * BOTTOM_SLICE_FRAC)
    com2 = rot @ com                         # centroid in the print frame

    nz = normals @ rot[:, 2]                 # face-normal z in the print frame
    cz = zverts[idx].mean(axis=1)            # face-centroid heights

    # contact: mesh faces lying in the bottom slice, projected onto the plate
    in_slice = zverts[idx] <= (zmin + eps)
    bottom = in_slice.all(axis=1) & (nz < -0.2)
    contact_area = float((areas[bottom] * np.clip(-nz[bottom], 0.0, 1.0)).sum())

    # support-needing overhangs: steep down-faces floating above the plate
    support = (nz < -_COS_SUPPORT) & \
              (cz > zmin + max(NEAR_PLATE_MM, 0.01 * height))
    support_area = float(areas[support].sum())
    cavity_support = float(areas[support & cavity_tri].sum())
    up_cavity = float(areas[cavity_tri & (nz > _COS_SUPPORT)].sum())

    # footprint: hull of the actually-low points (the real bed contact)
    low_pts = vr[zverts <= zmin + eps][:, :2]
    hull2d = _convex_hull_2d(low_pts) if len(low_pts) else np.zeros((0, 2))
    hull_area = 0.0
    if len(hull2d) >= 3:
        a = np.roll(hull2d, -1, axis=0)
        hull_area = 0.5 * float(np.abs(np.sum(
            hull2d[:, 0] * a[:, 1] - a[:, 0] * hull2d[:, 1])))

    # silhouette: hull of the projected outline; tipping vs. the centroid
    sil = _convex_hull_2d((outline_pts @ rot.T)[:, :2])
    sil_area, inside, margin = _polygon_metrics(sil, com2[:2])

    span = vr.max(axis=0) - vr.min(axis=0)
    bbox_xy = max(span[0] * span[1], 1e-9)

    footprint_frac = min(hull_area / bbox_xy, 1.0)
    contact_frac = contact_area / max(total_area, 1e-9)
    support_frac = support_area / max(total_area, 1e-9)
    cavity_frac = cavity_support / max(total_area, 1e-9)
    tips = not inside

    score = (W_FLAT * footprint_frac
             + W_TOUCH * min(contact_frac / 0.25, 1.0)
             + (0.0 if tips else W_STAB * min(
                 margin / max(0.3 * math.sqrt(sil_area / math.pi), 1e-9), 1.0))
             + W_SUPPORT * min(support_frac / 0.10, 1.5)
             + W_CAVITY * min(cavity_frac / 0.05, 2.0)
             + W_HEIGHT * (height / max(diag, 1e-9))
             + (TIP_PENALTY if tips else 0.0))

    return {
        "score": float(score),
        "down": d,
        "rot": rot,
        "zmin": zmin,
        "dims": (float(span[0]), float(span[1]), float(height)),
        "footprint_frac": float(footprint_frac),
        "contact_frac": float(contact_frac),
        "support_frac": float(support_frac),
        "cavity_frac": float(cavity_frac),
        "up_cavity_frac": up_cavity / max(total_area, 1e-9),
        "tips": tips,
    }


def _bake(obj, quaternion, z_drop):
    """Rigidly bake world transform + print rotation into the mesh data and
    reset the object so matrix_world is the identity; the exported STL is
    then exactly the analyzed print frame. Scale is never touched."""
    m4 = quaternion.to_matrix().to_4x4()
    m4.translation = (0.0, 0.0, z_drop)
    obj.data.transform(m4 @ Matrix(obj.matrix_world))
    obj.matrix_world = Matrix.Identity(4)
    obj.data.update()


def analyze_object(obj, log=None):
    """Pick the best print orientation for one object and bake it in: the mesh
    is rotated (rigid transform only) and lowered so its lowest point sits
    exactly at Z=0. Returns the report entry for result.json."""
    data = _world_triangles(obj)
    if data is None:
        raise ValueError("the object has no faces")
    verts, idx, tris, normals, areas = data
    mn, mx = verts.min(axis=0), verts.max(axis=0)
    diag = float(np.linalg.norm(mx - mn))
    total_area = float(areas.sum())
    com = _volume_centroid(tris)
    assembly_center = (mn + mx) * 0.5

    hull_faces, on_surface = _hull(verts)
    if hull_faces is None:
        hull_faces = []
    # triangles whose vertices are mostly interior sit in concavities —
    # supports landing there scar the mold cavity / mating faces
    cavity_tri = (~on_surface)[idx].mean(axis=1) > 0.5

    best = None
    outline_pts = verts[on_surface] if on_surface.any() else verts
    _dbg = os.environ.get("MOLDFORGE_PO_DEBUG")
    for d in _candidate_directions(hull_faces):
        m = _evaluate(verts, idx, normals, areas, cavity_tri, com, d, diag,
                      total_area, outline_pts)
        if _dbg:
            print(f"[PO] {obj.name} d=({d[0]:+.3f},{d[1]:+.3f},{d[2]:+.3f}) "
                  f"score={m['score']:+.3f} fp={m['footprint_frac']:.3f} "
                  f"sup={m['support_frac']:.3f} cav={m['cavity_frac']:.3f} "
                  f"up={m['up_cavity_frac']:.3f} h={m['dims'][2]:.1f} "
                  f"tips={int(m['tips'])} ct={m['contact_frac']:.3f}")
        if best is None or m["score"] > best["score"]:
            best = m

    # tidy roll: of the four 90° rolls, put the longer footprint side along X
    q_down = Vector(best["down"]).rotation_difference(Vector(_DOWN))
    corners = np.array([(x, y, z) for x in (mn[0], mx[0]) for y in (mn[1], mx[1])
                        for z in (mn[2], mx[2])])
    corners = corners @ best["rot"].T
    best_k, best_span = 0, -1.0
    for k in range(4):
        c = math.radians(90.0 * k)
        span_x = float(np.ptp(corners[:, 0] * math.cos(c) - corners[:, 1] * math.sin(c)))
        if span_x > best_span:
            best_span, best_k = span_x, k
    q = Quaternion((0.0, 0.0, 1.0), math.radians(90.0 * best_k)) @ q_down

    _bake(obj, q, -best["zmin"])

    dims = best["dims"]
    if best_k % 2 == 1:                       # a 90° roll swaps the plate axes
        dims = (dims[1], dims[0], dims[2])
    cavity_total = float(areas[cavity_tri].sum()) / max(total_area, 1e-9)
    return _report_entry(obj, best, dims, q, assembly_center, cavity_total)


def _report_entry(obj, best, dims, q, assembly_center, cavity_total_frac=0.0):
    fp = best["footprint_frac"]
    rest = ("flat face" if fp >= 0.60 else
            "partial flat" if fp >= 0.25 else "edge/point")
    dx, dy, dz = dims
    fits = (dx <= REFERENCE_BED[0] and dy <= REFERENCE_BED[1]
            and dz <= REFERENCE_BED[2])
    support_pct = round(best["support_frac"] * 100, 1)
    cavity_pct = round(best["cavity_frac"] * 100, 1)
    bits = [f"rests on {'a' if fp >= 0.25 else 'an'} {rest} "
            f"({round(fp * 100)}% bed contact)"]
    if cavity_total_frac > 0.02:
        if best["up_cavity_frac"] > 0.20 and cavity_pct <= 2:
            bits.append("cavity opens upward — printed without supports "
                        "inside it")
        elif cavity_pct <= 2:
            bits.append("supports stay off the cavity & mating faces")
    if support_pct <= 2:
        bits.append("almost support-free")
    elif support_pct <= 8:
        bits.append(f"light supports (~{support_pct:.0f}%)")
    else:
        bits.append(f"~{support_pct:.0f}% of the surface needs supports")
    if fp < 0.25:
        bits.append("add a brim for bed adhesion")
    bits.append(f"{dz:.0f} mm tall on the plate")
    bits.append(f"fits a {REFERENCE_BED[0]:.0f}×{REFERENCE_BED[1]:.0f} mm bed"
                if fits else
                f"exceeds a {REFERENCE_BED[0]:.0f}×{REFERENCE_BED[1]:.0f} mm bed")

    return {
        "name": obj.name,
        "rest": rest,
        "down": [round(float(c), 4) for c in best["down"]],
        "dims": [round(dx, 1), round(dy, 1), round(dz, 1)],
        "height_mm": round(dz, 1),
        "footprint_pct": round(fp * 100, 1),
        "support_pct": support_pct,
        "cavity_pct": round(best["cavity_frac"] * 100, 1),
        "tips": bool(best["tips"]),
        "fits_ref_bed": fits,
        "score": round(best["score"], 3),
        "q": [round(c, 6) for c in (q.x, q.y, q.z, q.w)],
        "assembly_center": [round(float(c), 3) for c in assembly_center],
        "why": " · ".join(bits),
    }


def _fallback_orient(obj, why):
    """Never fail a finished build: keep the generation orientation, lower the
    bottom onto the plate. Rigid transform only."""
    data = _world_triangles(obj)
    if data is not None:
        verts = data[0]
        mn, mx = verts.min(axis=0), verts.max(axis=0)
        center = (mn + mx) * 0.5
        dims = mx - mn
        z_drop = -float(data[2][:, :, 2].min())
    else:
        center, dims, z_drop = np.zeros(3), np.zeros(3), 0.0
    _bake(obj, Quaternion((1.0, 0.0, 0.0, 0.0)), z_drop)
    return {
        "name": obj.name,
        "rest": "original orientation",
        "down": [0.0, 0.0, -1.0],
        "dims": [round(float(c), 1) for c in dims],
        "height_mm": round(float(dims[2]), 1),
        "footprint_pct": None, "support_pct": None, "cavity_pct": None,
        "tips": False,
        "fits_ref_bed": bool(dims[0] <= REFERENCE_BED[0]
                             and dims[1] <= REFERENCE_BED[1]
                             and dims[2] <= REFERENCE_BED[2]),
        "score": None, "q": [0.0, 0.0, 0.0, 1.0],
        "assembly_center": [round(float(c), 3) for c in center],
        "why": why,
    }


def analyze_printables(parts, master=None, include_master=False, progress=None,
                       log=None):
    """Analyze + bake every printable part (and the master when the workflow
    needs it printed — a pour box / tray pours silicone around a physical
    master; a direct-printed SOLID mold replaces the master). Returns
    (export_objects, report): export_objects is exactly what the driver
    exports, report lands in result.json under "print"."""
    report = {"bed_reference": list(REFERENCE_BED), "parts": [], "master": None}
    objects = list(parts)
    n = len(objects) + (1 if include_master and master is not None else 0)

    def run(obj, i):
        if progress:
            progress(0.93 + 0.05 * i / max(n, 1),
                     f"print orientation {i + 1}/{n} — {obj.name}")
        try:
            return analyze_object(obj)
        except Exception as exc:                    # noqa: BLE001 — never fatal
            if log:
                log("print_orientation_fallback", obj=obj.name,
                    error=" ".join(str(exc).split())[:200])
            return _fallback_orient(
                obj, "kept the original orientation — print analysis was "
                     "unavailable for this part")

    for i, obj in enumerate(objects):
        report["parts"].append(run(obj, i))
    if include_master and master is not None:
        master.name = "Master"
        report["master"] = run(master, n - 1)
        objects.append(master)
    return objects, report
