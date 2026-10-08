"""Generate a small test model (icosphere STL) for webui smoke tests —
mirrors the add-on's headless test master: radius 10, scale (1, 0.8, 1.3).

Usage: python make_test_model.py [out.stl] [subdivisions]
"""
import math
import struct
import sys

PHI = (1 + 5 ** 0.5) / 2


def icosahedron():
    v = [
        (-1, PHI, 0), (1, PHI, 0), (-1, -PHI, 0), (1, -PHI, 0),
        (0, -1, PHI), (0, 1, PHI), (0, -1, -PHI), (0, 1, -PHI),
        (PHI, 0, -1), (PHI, 0, 1), (-PHI, 0, -1), (-PHI, 0, 1),
    ]
    faces = [
        (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
        (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
        (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
        (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
    ]
    mag = math.sqrt(1 + PHI * PHI)
    verts = [(x / mag, y / mag, z / mag) for x, y, z in v]
    return verts, faces


def subdivide(verts, faces):
    cache = {}

    def mid(a, b):
        key = (min(a, b), max(a, b))
        if key not in cache:
            va, vb = verts[a], verts[b]
            cache[key] = len(verts)
            verts.append(((va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2,
                          (va[2] + vb[2]) / 2))
        return cache[key]

    out = []
    for a, b, c in faces:
        ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
        out += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "test_model.stl"
    subdiv = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    verts, faces = icosahedron()
    for _ in range(subdiv):
        faces = subdivide(verts, faces)

    R, S = 10.0, (1.0, 0.8, 1.3)
    tris = []
    for a, b, c in faces:
        pts = []
        for i in (a, b, c):
            x, y, z = verts[i]
            n = math.sqrt(x * x + y * y + z * z)
            pts.append((x / n * R * S[0], y / n * R * S[1], z / n * R * S[2]))
        (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = pts
        ux, uy, uz = x2 - x1, y2 - y1, z2 - z1
        vx, vy, vz = x3 - x1, y3 - y1, z3 - z1
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        nl = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        tris.append(((nx / nl, ny / nl, nz / nl), pts))

    with open(path, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", len(tris)))
        for n, pts in tris:
            f.write(struct.pack("<3f", *n))
            for p in pts:
                f.write(struct.pack("<3f", *p))
            f.write(struct.pack("<H", 0))
    print(f"wrote {path}: {len(tris)} triangles")


if __name__ == "__main__":
    main()
