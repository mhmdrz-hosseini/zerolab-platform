"""Standalone binary-STL analyzer (pure Python, no Blender).

Usage: python stl_stats.py <file.stl> [file.stl ...]

Reports the mesh properties that matter for mold-generation failure analysis:
triangle/vertex counts, edge manifoldness, connected components, degenerate
faces, duplicate vertices, bbox/dimensions.
"""

import array
import struct
import sys
from collections import defaultdict


def analyze(path):
    with open(path, "rb") as f:
        header = f.read(80)
        (n,) = struct.unpack("<I", f.read(4))
        expected = 84 + n * 50
        import os
        actual = os.path.getsize(path)
        if actual < expected:
            raise SystemExit(f"{path}: truncated STL ({actual} < {expected} bytes)")
        tri = array.array("f")
        data = f.read(n * 50)
    tri.frombytes(data[: n * 12 * 4])

    # welded vertex map (exact float coords)
    vert_id = {}
    verts = []
    faces = []          # tuples of 3 vertex ids
    raw_coords = []     # per-face raw coords for area/degenerate checks
    for t in range(n):
        base = t * 12
        fvids = []
        fraw = []
        for k in range(3):
            x, y, z = tri[base + 3 + k * 3: base + 6 + k * 3 + 1][0], \
                      tri[base + 4 + k * 3], tri[base + 5 + k * 3]
            key = (x, y, z)
            vid = vert_id.get(key)
            if vid is None:
                vid = len(verts)
                vert_id[key] = vid
                verts.append(key)
            fvids.append(vid)
            fraw.append((x, y, z))
        faces.append(tuple(fvids))
        raw_coords.append(fraw)

    # edge -> incident face count (manifoldness), dedup identical faces
    edge_faces = defaultdict(int)
    face_set = defaultdict(int)
    degenerate = 0
    for fi, (a, b, c) in enumerate(faces):
        if a == b or b == c or a == c:
            degenerate += 1
            continue
        face_set[(a, b, c)] += 1
        for e in ((a, b), (b, c), (c, a)):
            edge_faces[tuple(sorted(e))] += 1
        (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = raw_coords[fi]
        ux, uy, uz = x2 - x1, y2 - y1, z2 - z1
        vx, vy, vz = x3 - x1, y3 - y1, z3 - z1
        cx, cy, cz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        if (cx * cx + cy * cy + cz * cz) == 0.0:
            degenerate += 1

    nonmanifold_edges = sum(1 for c in edge_faces.values() if c != 2)
    boundary_edges = sum(1 for c in edge_faces.values() if c == 1)
    dup_faces = sum(c - 1 for c in face_set.values() if c > 1)

    # connected components over welded topology
    parent = list(range(len(verts)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b, c in faces:
        for u, v in ((a, b), (b, c)):
            ru, rv = find(u), find(v)
            if ru != rv:
                parent[ru] = rv
    comps = len({find(i) for i in range(len(verts))})

    xs = [v[0] for v in verts]; ys = [v[1] for v in verts]; zs = [v[2] for v in verts]
    dims = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    dup_vert_slots = n * 3 - len(verts)

    return {
        "file": path.split("\\")[-1].split("/")[-1],
        "triangles": n,
        "unique_vertices": len(verts),
        "duplicate_vertex_slots": dup_vert_slots,
        "duplicate_faces": dup_faces,
        "degenerate_faces": degenerate,
        "nonmanifold_edges": nonmanifold_edges,
        "boundary_edges (open mesh)": boundary_edges,
        "connected_components": comps,
        "dimensions_mm": tuple(round(d, 2) for d in dims),
        "manifold": nonmanifold_edges == 0 and boundary_edges == 0,
    }


if __name__ == "__main__":
    for p in sys.argv[1:]:
        try:
            r = analyze(p)
        except Exception as e:
            print(f"{p}: ERROR {e}")
            continue
        print(f"--- {r.pop('file')} ---")
        for k, v in r.items():
            print(f"  {k:32s} {v}")
