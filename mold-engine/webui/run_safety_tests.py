"""Safety regression suite — proves no model can trap Blender or eat the RAM.

For each test model (generated pathological meshes + the REAL models that used
to kill the worker), the driver runs under the same supervisor the server
uses. A test PASSES when the run is BOUNDED:

    success (result.json ok=true)
 OR controlled failure (result.json with an error_code)
 OR a supervisor kill for a cap breach (memory/stage-timeout/job-timeout)

and FAILS when Blender runs unbounded (no result, no kill) or exceeds the
suite's own wall budget.

Usage:
    .venv/Scripts/python.exe webui/run_safety_tests.py [--quick]

Artifacts: test/safety/<case>/ (result.json, preflight.json, stages.jsonl,
mem_samples.json, logs). Summary: test/safety/summary.md
"""

import argparse
import json
import math
import os
import struct
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from safety import limits as sf_limits, supervisor as sf_supervisor  # noqa: E402
from make_test_model import icosahedron, subdivide  # noqa: E402

OUT = ROOT / "test" / "safety"
INPUT_DIR = Path(r"D:/code/3d/MOLD/MOLD-generator base/input")

# suite-level caps (tighter than production so the suite is quick; the Körper
# case peaked ~6 GB unprotected — 3.5 GB here still proves the kill works if
# the in-driver guard somehow doesn't fire first)
SUITE = dict(
    MOLDFORGE_MAX_MEMORY_MB="3500",
    MOLDFORGE_JOB_TIMEOUT_S="300",
    MOLDFORGE_STAGE_TIMEOUT_S="150",
    MOLDFORGE_QUARANTINE_DIR=str(OUT / "_quarantine"),
)


# --------------------------------------------------------------------------
# pathological STL generators


def _write_stl(path, tris):
    with open(path, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", len(tris)))
        for pts in tris:
            (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = pts
            ux, uy, uz = x2 - x1, y2 - y1, z2 - z1
            vx, vy, vz = x3 - x1, y3 - y1, z3 - z1
            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            nl = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            f.write(struct.pack("<3f", nx / nl, ny / nl, nz / nl))
            for p in pts:
                f.write(struct.pack("<3f", *p))
            f.write(struct.pack("<H", 0))


def sphere_tris(radius=10.0, subdiv=3, center=(0.0, 0.0, 0.0), scale=(1, 1, 1)):
    verts, faces = icosahedron()
    for _ in range(subdiv):
        faces = subdivide(verts, faces)
    tris = []
    for a, b, c in faces:
        pts = []
        for i in (a, b, c):
            x, y, z = verts[i]
            n = math.sqrt(x * x + y * y + z * z)
            pts.append((center[0] + x / n * radius * scale[0],
                        center[1] + y / n * radius * scale[1],
                        center[2] + z / n * radius * scale[2]))
        tris.append(tuple(pts))
    return tris


def gen_simple(d):
    _write_stl(d / "simple_sphere.stl", sphere_tris())


def gen_high_poly(d):
    _write_stl(d / "high_poly.stl", sphere_tris(subdiv=7))       # 327,680 tris


def gen_open_grid(d):
    """A flat open grid — non-manifold (every edge boundary), no volume."""
    tris = []
    n = 24
    for i in range(n):
        for j in range(n):
            x0, y0 = i * 2.0, j * 2.0
            tris.append(((x0, y0, 0), (x0 + 2, y0, 0), (x0, y0 + 2, 0)))
            tris.append(((x0 + 2, y0, 0), (x0 + 2, y0 + 2, 0), (x0, y0 + 2, 0)))
    _write_stl(d / "open_grid.stl", tris)


def gen_self_intersect(d):
    """Two interpenetrating spheres in one soup — self-intersecting shells."""
    tris = sphere_tris(radius=12, center=(-5, 0, 0))
    tris += sphere_tris(radius=12, center=(5, 0, 0))
    _write_stl(d / "self_intersect.stl", tris)


def gen_disconnected(d):
    """Two spheres far apart — recovery remesh can never merge these."""
    tris = sphere_tris(radius=8, center=(0, 0, 0))
    tris += sphere_tris(radius=8, center=(80, 0, 0))
    _write_stl(d / "disconnected.stl", tris)


def gen_nan(d):
    """A good sphere with a few NaN-coordinate triangles bolted on."""
    tris = sphere_tris()
    tris += [((float("nan"), 0, 0), (1, 1, 1), (2, 0, 0))] * 5
    _write_stl(d / "nan_spikes.stl", tris)


def gen_huge_coords(d):
    """A good sphere plus one triangle parked 1e6 mm away."""
    tris = sphere_tris()
    tris.append(((1e6, 1e6, 1e6), (1e6 + 5, 1e6, 1e6), (1e6, 1e6 + 5, 1e6)))
    _write_stl(d / "huge_coords.stl", tris)


GENERATORS = {
    "simple_sphere": gen_simple,
    "high_poly": gen_high_poly,
    "open_grid": gen_open_grid,
    "self_intersect": gen_self_intersect,
    "disconnected": gen_disconnected,
    "nan_spikes": gen_nan,
    "huge_coords": gen_huge_coords,
}


# --------------------------------------------------------------------------
# the runner


def find_blender():
    env = os.environ.get("MOLDFORGE_BLENDER")
    if env:
        return Path(env)
    cands = sorted((ROOT / "engine").glob("blender-5.1.*/blender.exe"))
    if cands:
        return cands[-1]
    cands = sorted((ROOT / "engine").glob("blender-*/blender.exe"))
    return cands[-1] if cands else None


def run_case(name, stl_path, blender, quick=False):
    case_dir = OUT / name
    case_dir.mkdir(parents=True, exist_ok=True)
    for stale in ("result.json", "progress.json", "blender_stdout.log",
                  "blender_stderr.log", "mem_samples.json"):
        p = case_dir / stale
        if p.is_file():
            p.unlink()
    stl_path = stl_path.resolve()
    params = case_dir / "params.json"
    params.write_text("{}", encoding="utf-8")

    env = {**os.environ, **SUITE}
    from safety.limits import Limits
    limits = Limits(
        job_timeout_s=int(SUITE["MOLDFORGE_JOB_TIMEOUT_S"]),
        stage_timeout_s=int(SUITE["MOLDFORGE_STAGE_TIMEOUT_S"]),
        max_memory_mb=int(SUITE["MOLDFORGE_MAX_MEMORY_MB"]),
        quarantine_dir=SUITE["MOLDFORGE_QUARANTINE_DIR"])

    cmd = [str(blender), "--background", "--factory-startup",
           "--python", str(HERE / "driver.py"), "--",
           str(stl_path), str(params), str(case_dir)]
    run = sf_supervisor.CappedRun(
        cmd, cwd=str(case_dir),
        stdout_path=case_dir / "blender_stdout.log",
        stderr_path=case_dir / "blender_stderr.log",
        limits=limits, heartbeat_path=case_dir / "progress.json",
        env=env).run()

    (case_dir / "mem_samples.json").write_text(json.dumps(run, indent=1))

    result = None
    rf = case_dir / "result.json"
    if rf.is_file():
        try:
            result = json.loads(rf.read_text(encoding="utf-8"))
        except Exception:
            result = None

    bounded = result is not None or bool(run["reason"])
    outcome = {
        "case": name,
        "bounded": bounded,
        "status": ("ok" if result and result.get("ok")
                   else "controlled_error" if result else
                   f"killed:{run['reason']}" if run["reason"] else "UNBOUNDED"),
        "error_code": (result or {}).get("error_code"),
        "stage": (result or {}).get("stage") or run.get("killed_at_stage"),
        "error": ((result or {}).get("error") or "")[:110],
        "elapsed_s": run["elapsed_s"],
        "peak_rss_mb": round(run["peak_rss_mb"]),
        "parts": len((result or {}).get("parts", [])),
    }
    return outcome


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true",
                    help="skip the slow high-poly and real-model cases")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    blender = find_blender()
    if not blender:
        print("no blender found under engine/")
        sys.exit(2)
    print(f"engine: {blender}")

    gen_dir = OUT / "_models"
    gen_dir.mkdir(parents=True, exist_ok=True)
    cases = []
    for name, gen in GENERATORS.items():
        if args.quick and name == "high_poly":
            continue
        stl = gen_dir / f"{name}.stl"
        if not stl.is_file():
            gen(gen_dir)
        cases.append((name, stl))

    real = [
        ("real_koerper", INPUT_DIR / "obj_1_Körper.stl"),
        ("real_angel2", INPUT_DIR / "obj_1_christmas_angel2.stl"),
    ]
    if not args.quick:
        for name, path in real:
            if path.is_file():
                cases.append((name, path))

    rows = []
    for name, stl in cases:
        print(f"[{len(rows) + 1}/{len(cases)}] {name} ...", flush=True)
        t0 = time.time()
        row = run_case(name, stl, blender, args.quick)
        row["wall_s"] = round(time.time() - t0, 1)
        rows.append(row)
        print(f"    {row['status']:18s} code={row['error_code']} "
              f"stage={row['stage']} peak={row['peak_rss_mb']}MB "
              f"t={row['elapsed_s']}s", flush=True)

    ok = all(r["bounded"] for r in rows)
    lines = ["# Safety regression suite", "",
             f"- Engine: `{blender}`",
             f"- Suite caps: mem {SUITE['MOLDFORGE_MAX_MEMORY_MB']} MB, "
             f"job {SUITE['MOLDFORGE_JOB_TIMEOUT_S']} s, "
             f"stage {SUITE['MOLDFORGE_STAGE_TIMEOUT_S']} s",
             f"- Result: {'ALL BOUNDED' if ok else 'UNBOUNDED RUNS PRESENT'}", "",
             "| Case | Outcome | Code | Stage | Peak MB | Elapsed s | Error |",
             "|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['case']} | {r['status']} | {r['error_code'] or ''} "
                     f"| {(r['stage'] or '')[:36]} | {r['peak_rss_mb']} "
                     f"| {r['elapsed_s']} | {r['error'][:60]} |")
    (OUT / "summary.md").write_text("\n".join(lines), encoding="utf-8")
    (OUT / "summary.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False),
                                      encoding="utf-8")
    print(f"\n{'PASS' if ok else 'FAIL'} -> {OUT / 'summary.md'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
