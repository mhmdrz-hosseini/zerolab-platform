"""Count connected mesh components in a GLB (diagnostic for mold engine failures)."""
import struct, json, sys
from collections import defaultdict

path = sys.argv[1] if len(sys.argv) > 1 else r"D:\code\3d\MOLD\zerolab-platform\mold-engine\uploads\db9b15e16250\model.glb"
data = open(path, "rb").read()
magic, ver, length = struct.unpack("<III", data[:12])
chunk_len, chunk_type = struct.unpack("<II", data[12:20])
gltf = json.loads(data[20:20 + chunk_len])
print("nodes:", len(gltf.get("nodes", [])), "meshes:", len(gltf.get("meshes", [])))
for m in gltf.get("meshes", []):
    for p in m.get("primitives", []):
        acc = gltf["accessors"][p["indices"]]
        print("primitive: mode", p.get("mode", 4), "indices", acc["count"], "-> tris", acc["count"] // 3)

off = 20 + chunk_len
blen, btype = struct.unpack("<II", data[off:off + 8])
bin_data = data[off + 8:off + 8 + blen]
prim = gltf["meshes"][0]["primitives"][0]

def read_acc(idx):
    a = gltf["accessors"][idx]
    bv = gltf["bufferViews"][a["bufferView"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    comp = {5125: "I", 5126: "f", 5123: "H"}[a["componentType"]]
    n = {"SCALAR": 1, "VEC3": 3}[a["type"]]
    count = a["count"]
    size = struct.calcsize(comp)
    stride = bv.get("byteStride") or size * n
    out = []
    for i in range(count):
        out.append(struct.unpack_from("<" + comp * n, bin_data, start + i * stride))
    return out

tris_flat = [i[0] for i in read_acc(prim["indices"])]
tris = [tris_flat[i:i + 3] for i in range(0, len(tris_flat), 3)]
pos = read_acc(prim["attributes"]["POSITION"])
print("verts:", len(pos), "tris:", len(tris))

parent = list(range(len(pos)))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[ra] = rb
for t in tris:
    union(t[0], t[1])
    union(t[0], t[2])

comp_faces = defaultdict(int)
for t in tris:
    comp_faces[find(t[0])] += 1
sizes = sorted(comp_faces.values(), reverse=True)
print("components:", len(sizes))
print("largest:", sizes[:8], "of", len(tris), "tris")

top = sorted(comp_faces.items(), key=lambda kv: -kv[1])[:6]
idxmap = {root: i for i, (root, _) in enumerate(top)}
acc = defaultdict(lambda: [1e9, 1e9, 1e9, -1e9, -1e9, -1e9])
for vi, p in enumerate(pos):
    r = find(vi)
    if r in idxmap:
        a = acc[idxmap[r]]
        for k in range(3):
            a[k] = min(a[k], p[k])
            a[3 + k] = max(a[3 + k], p[k])
for i, (root, fc) in enumerate(top):
    a = acc[i]
    print("comp%d: faces=%d bbox=(%.3f,%.3f,%.3f)..(%.3f,%.3f,%.3f)" % (i, fc, a[0], a[1], a[2], a[3], a[4], a[5]))
