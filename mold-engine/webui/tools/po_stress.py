"""Timing stress test: analyze a heavy generated part STL (no pipeline).

    blender --background --factory-startup --python po_stress.py -- <part.stl>
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
WEBUI = os.path.dirname(HERE)
ROOT = os.path.dirname(WEBUI)
sys.path.insert(0, ROOT)
sys.path.insert(0, WEBUI)

import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
path = argv[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
before = set(bpy.data.objects)
bpy.ops.wm.stl_import(filepath=path)
obj = [o for o in bpy.data.objects if o not in before and o.type == 'MESH'][0]
print(f"loaded {path}: {len(obj.data.vertices)} verts, "
      f"{len(obj.data.polygons)} faces")

import print_orientation as po  # noqa: E402

import numpy as np  # noqa: E402

t0 = time.time()
data = po._world_triangles(obj)
verts, idx, tris, normals, areas = data
t1 = time.time()
print(f"_world_triangles: {t1 - t0:.2f}s")
hull_faces, on_surface = po._hull(verts)
t2 = time.time()
print(f"_hull (+BVH per-vertex): {t2 - t1:.2f}s  "
      f"({len(hull_faces or [])} hull faces, {int((~on_surface).sum())} interior)")
com = po._volume_centroid(tris)
t3 = time.time()
print(f"_volume_centroid: {t3 - t2:.2f}s")

cavity_tri = (~on_surface)[idx].mean(axis=1) > 0.5
outline_pts = verts[on_surface] if on_surface.any() else verts
diag = float(np.linalg.norm(verts.max(axis=0) - verts.min(axis=0)))
total = float(areas.sum())
cands = po._candidate_directions(hull_faces or [])
t4 = time.time()
print(f"prep+candidates ({len(cands)}): {t4 - t3:.2f}s")
for i, d in enumerate(cands):
    m = po._evaluate(verts, idx, normals, areas, cavity_tri, com, d, diag,
                     total, outline_pts)
    print(f"  cand {i}: score={m['score']:+.3f} fp={m['footprint_frac']:.2f} "
          f"sup={m['support_frac']:.3f} h={m['dims'][2]:.1f}")
print(f"_evaluate x{len(cands)}: {time.time() - t4:.2f}s")

t5 = time.time()
entry = po.analyze_object(obj)
print(f"analyze_object total: {time.time() - t5:.2f}s")
print("winner:", entry["rest"], entry["dims"], "|", entry["why"])
