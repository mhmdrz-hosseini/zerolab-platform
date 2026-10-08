"""Debug probe: build a mold on a model, then print every orientation
candidate's metrics for each generated part (runs inside Blender).

    blender --background --factory-startup --python po_debug.py -- <model> [params.json]
"""
import json
import math
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
WEBUI = os.path.dirname(HERE)
ROOT = os.path.dirname(WEBUI)
sys.path.insert(0, ROOT)
sys.path.insert(0, WEBUI)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import print_orientation as po  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
mesh_path = argv[0]
params = {}
if len(argv) > 1 and os.path.isfile(argv[1]):
    params = json.load(open(argv[1], encoding="utf-8"))
params.pop("model_scale", None)
params.pop("model_rotation", None)

bpy.ops.wm.read_factory_settings(use_empty=True)

ext = os.path.splitext(mesh_path)[1].lower()
op = {".stl": bpy.ops.wm.stl_import, ".obj": bpy.ops.wm.obj_import,
      ".ply": bpy.ops.wm.ply_import}.get(ext, bpy.ops.wm.stl_import)
before = set(bpy.data.objects)
op(filepath=mesh_path)
master = [o for o in bpy.data.objects if o not in before and o.type == 'MESH'][0]

from moldforge.core import pipeline  # noqa: E402

base = dict(pipeline._prop_defaults())
base.update(params)
props = types.SimpleNamespace(**base)

result = pipeline.build_mold_system(master, props)

for obj in list(result["parts"]) + [master]:
    print("=" * 70)
    print("PART", obj.name)
    data = po._world_triangles(obj)
    if data is None:
        print("  no faces!")
        continue
    verts, idx, tris, normals, areas = data
    mn, mx = verts.min(axis=0), verts.max(axis=0)
    diag = float(np.linalg.norm(mx - mn))
    total = float(areas.sum())
    com = po._volume_centroid(tris)
    hull_faces, on_surface = po._hull(verts)
    if hull_faces is None:
        hull_faces = []
    cavity_tri = (~on_surface)[idx].mean(axis=1) > 0.5
    outline_pts = verts[on_surface] if on_surface.any() else verts
    print(f"  verts={len(verts)} tris={len(tris)} diag={diag:.1f} "
          f"area={total:.0f} hull_faces={len(hull_faces)} "
          f"cavity_tris={int(cavity_tri.sum())}")
    print(f"  bbox {mx-mn}")
    print(f"  com {com}")
    rows = []
    for d in po._candidate_directions(hull_faces):
        m = po._evaluate(verts, idx, normals, areas, cavity_tri, com, d,
                         diag, total, outline_pts)
        rows.append((m["score"], d, m))
    for score, d, m in sorted(rows, key=lambda r: -r[0]):
        print(f"  d=({d[0]:+.3f},{d[1]:+.3f},{d[2]:+.3f}) score={score:+.3f} "
              f"fp={m['footprint_frac']*100:5.1f}% sup={m['support_frac']*100:5.1f}% "
              f"cav={m['cavity_frac']*100:5.1f}% up={m['up_cavity_frac']*100:5.1f}% "
              f"h={m['dims'][2]:6.1f} tips={int(m['tips'])} "
              f"ct={m['contact_frac']*100:5.1f}%")
