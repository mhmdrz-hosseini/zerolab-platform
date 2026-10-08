"""Solidify intermediate-mesh diagnostic — runs INSIDE blender --background.

Reproduces exactly what _build_once does up to the explosion point on a model:
import -> duplicate -> ensure normals -> Solidify(wall+shell) -> inspect the
intermediate mesh (NaN/inf? scale? islands?) -> STOP before the repair remesh.

Usage:
    blender --background --factory-startup --python solidify_probe.py -- <model.stl>
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)

import bpy  # noqa: E402


def mesh_report(me):
    nverts = len(me.vertices)
    nan = inf = big = 0
    if nverts:
        mn = me.vertices[0].co.copy(); mx = mn.copy()
        for v in me.vertices:
            c = v.co
            if c.x != c.x or c.y != c.y or c.z != c.z:
                nan += 1
            elif c.x in (float("inf"), float("-inf")) or c.y in (float("inf"), float("-inf")) or c.z in (float("inf"), float("-inf")):
                inf += 1
            elif max(abs(c.x), abs(c.y), abs(c.z)) > 1e5:
                big += 1
            mn.x = min(mn.x, c.x); mn.y = min(mn.y, c.y); mn.z = min(mn.z, c.z)
            mx.x = max(mx.x, c.x); mx.y = max(mx.y, c.y); mx.z = max(mx.z, c.z)
        bbox = [[round(c, 2) for c in mn], [round(c, 2) for c in mx]]
    else:
        bbox = None
    return {"verts": nverts, "faces": len(me.polygons), "nan": nan,
            "inf": inf, "beyond_1e5": big, "bbox": bbox}


def main():
    model_path = sys.argv[sys.argv.index("--") + 1]
    out = {}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.stl_import(filepath=model_path)
    master = next(o for o in bpy.data.objects if o.type == "MESH")
    out["imported"] = mesh_report(master.data)

    from moldforge.core import util as mf_util, meshprep as mf_meshprep

    work = mf_util.duplicate_object(master, "MF_Positive", mf_util.ensure_collection())
    mf_meshprep.ensure_outward_normals(work)
    out["after_normals"] = mesh_report(work.data)
    out["nonmanifold"] = mf_util.nonmanifold_count(work)
    out["islands"] = mf_util.island_count(work)

    mod = work.modifiers.new("mf_solidify", 'SOLIDIFY')
    mod.thickness = 5.0        # pour-box default: wall 3 + shell 2
    mod.offset = 1.0
    mod.use_even_offset = True
    mod.use_quality_normals = True
    mf_util.apply_all_modifiers(work)
    out["after_solidify"] = mesh_report(work.data)
    out["nonmanifold_after"] = mf_util.nonmanifold_count(work)
    out["islands_after"] = mf_util.island_count(work)

    print("SOLIDIFY_PROBE " + json.dumps(out, default=str), flush=True)


main()
