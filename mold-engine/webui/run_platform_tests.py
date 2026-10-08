"""Platform test: run the MoldForge WebUI over the models in the input folder
under a matrix of different settings, storing everything under test/.

Usage:
    python webui/run_platform_tests.py [input_dir] [output_dir]

Drives the real HTTP API (http://127.0.0.1:8000 — start the server first):
each run = one model x one named settings preset. Stored per run:
    test/<model>/<setting>/params.json    what was sent
    test/<model>/<setting>/result.json    job result (or error payload)
    test/<model>/<setting>/*.stl          generated parts + skin
Plus test/summary.json and test/summary.md at the end.
"""

import json
import sys
import time
from pathlib import Path

import requests

API = "http://127.0.0.1:8000"
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

DEFAULT_INPUT = Path(r"D:/code/3d/MOLD/MOLD-generator base/input")
DEFAULT_OUT = ROOT / "test"

# --- the settings matrix (named presets = parameter overrides) -------------
SETTINGS = {
    "pour_box_default":  {},                                          # add-on defaults
    "solid_hug_2part":   {"box_style": "SOLID"},                      # direct printed, hugging
    "tray_embed":        {"box_style": "TRAY"},                       # open-pour tray, embedded
    "pour_box_3part":    {"parts_count": 3},                          # radial wedges
    "pour_box_glove":    {"skin_keys": True},                         # glove/mother-mold workflow
    "solid_block_4part": {"box_style": "SOLID", "solid_shape": "BLOCK",
                          "parts_count": 4},                           # wingless block wedges
    "tray_frame":        {"box_style": "TRAY", "tray_mode": "FRAME"}, # frame for a real object
    "open_bottom_plate": {"base_style": "OPEN", "base_plate": True},  # detachable key plate
    "multi_sprue_vents": {"sprue_count": 2, "vent_count": 4,
                          "sprue_place": "XY"},                        # 2 funnels + 4 vents
}

HEAVY_MB = 50          # > this: only two cheap-ish settings (slow builds)
CORE = ["pour_box_default", "solid_hug_2part", "tray_embed", "pour_box_3part"]
HEAVY = ["pour_box_default", "tray_embed"]
EXTRA = ["pour_box_glove", "solid_block_4part", "tray_frame",
         "open_bottom_plate", "multi_sprue_vents"]
# diverse representatives that also exercise the extra settings
EXTRA_MODELS = {"kittie.stl", "Montagem flat.stl", "cutegnome (1).stl"}
JOB_TIMEOUT_S = 20 * 60


def _get(url, retries=30, timeout=30):
    """GET with tolerance for transient connection errors (e.g. while the
    machine is under memory pressure from a crashing Blender)."""
    last = None
    for _ in range(retries):
        try:
            return requests.get(url, timeout=timeout).json()
        except Exception as exc:
            last = exc
            time.sleep(2)
    raise last


def plans_for(models):
    """(model, [setting names]) per model, sized by model weight."""
    plans = []
    for m in models:
        mb = m.stat().st_size / 1024 / 1024
        if mb > HEAVY_MB:
            names = HEAVY
        elif m.name in EXTRA_MODELS:
            names = CORE + EXTRA
        else:
            names = CORE
        plans.append((m, names))
    return plans


def server_alive():
    try:
        requests.get(f"{API}/api/health", timeout=8).raise_for_status()
        return True
    except Exception:
        return False


def submit(path, params):
    last = None
    for _ in range(2):
        try:
            with open(path, "rb") as f:
                r = requests.post(f"{API}/api/generate",
                                  files={"file": (path.name, f)},
                                  data={"params": json.dumps(params)}, timeout=60)
            r.raise_for_status()
            return r.json()["job_id"]
        except Exception as exc:
            last = exc
            time.sleep(3)
    raise last


def wait_job(job_id):
    t0 = time.time()
    while time.time() - t0 < JOB_TIMEOUT_S:
        j = _get(f"{API}/api/job/{job_id}")
        if j["status"] in ("done", "error"):
            j["wall_s"] = round(time.time() - t0, 1)
            return j
        time.sleep(1.5)
    return {"status": "error", "error": "client-side job timeout",
            "wall_s": round(time.time() - t0, 1)}


def fetch_run_artifacts(job_id, result, outdir):
    """Download the generated STLs (parts + skin) into outdir."""
    saved = []
    names = [p["file"] for p in result.get("parts", [])]
    if result.get("skin"):
        names.append(result["skin"])
    for name in names:
        for attempt in range(5):
            try:
                r = requests.get(f"{API}/api/job/{job_id}/parts/{name}",
                                 timeout=300)
                if r.ok:
                    (outdir / name).write_bytes(r.content)
                    saved.append(name)
                    break
            except Exception:
                pass
            time.sleep(2)
    return saved


def row_from_result(model_name, mb, sname, stored):
    """Rebuild a summary row from a stored result.json (resume support)."""
    result = stored.get("result") or {}
    v = result.get("volumes", {}) if result.get("ok") else {}
    return {
        "model": model_name, "mb": mb, "setting": sname,
        "status": stored.get("status"),
        "error": stored.get("error"),
        "parts": len(result.get("parts", [])) if result.get("ok") else 0,
        "skin": bool(result.get("skin")),
        "cavity_ml": round(v.get("cavity_volume", 0) / 1000, 1),
        "silicone_ml": round(v.get("silicone_volume", 0) / 1000, 1),
        "plastic_ml": round(v.get("plastic_volume", 0) / 1000, 1),
        "remeshed": result.get("notes", {}).get("remeshed"),
        "trimmed": result.get("notes", {}).get("trimmed"),
        "undercut_pct": round(100 * result.get("notes", {}).get("undercut", 0)),
        "warnings": result.get("warnings", []),
        "build_s": result.get("elapsed_s"),
        "wall_s": stored.get("wall_s"),
    }


def main():
    input_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INPUT
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    out_dir.mkdir(parents=True, exist_ok=True)

    health = requests.get(f"{API}/api/health", timeout=10).json()
    print(f"engine: {health.get('blender')}")
    print(f"input:  {input_dir}")
    print(f"output: {out_dir}")

    supported = {".stl", ".obj", ".ply", ".glb", ".gltf"}
    models = sorted(p for p in input_dir.iterdir()
                    if p.is_file() and p.suffix.lower() in supported
                    and p.stat().st_size > 0)
    skipped = [{"file": p.name, "reason":
                ("unsupported type " + p.suffix if p.suffix.lower() not in supported
                 else "empty file")}
               for p in input_dir.iterdir()
               if p.is_file() and (p.suffix.lower() not in supported
                                   or p.stat().st_size == 0)]

    plans = plans_for(models)
    total = sum(len(n) for _, n in plans)
    print(f"{len(models)} models, {len(skipped)} skipped, {total} planned runs\n")

    rows = []
    done = 0
    skipped_runs = 0
    infra_failures = 0        # consecutive dead-server failures -> abort the run
    for model, setting_names in plans:
        mb = model.stat().st_size / 1024 / 1024
        model_dir = out_dir / model.stem
        for sname in setting_names:
            done += 1
            run_dir = model_dir / sname
            prior = run_dir / "result.json"
            if prior.is_file():                 # resume: keep earlier results
                try:
                    stored = json.loads(prior.read_text(encoding="utf-8"))
                    if stored.get("status") in ("done", "error"):
                        rows.append(row_from_result(model.name, round(mb, 2),
                                                     sname, stored))
                        skipped_runs += 1
                        continue
                    # infra failures (runner-exception) get retried instead
                except Exception:
                    pass                        # corrupt: re-run it
            params = dict(SETTINGS[sname])
            run_dir = model_dir / sname
            run_dir.mkdir(parents=True, exist_ok=True)
            (run_dir / "params.json").write_text(
                json.dumps({"model": model.name, "setting": sname,
                            "params": params}, indent=2))
            t0 = time.time()
            print(f"[{done}/{total}] {model.stem} :: {sname} "
                  f"({mb:.1f} MB) ...", flush=True)
            try:
                if not server_alive():
                    raise RuntimeError("server not responding (health check)")
                infra_failures = 0
                job_id = submit(model, params)
                job = wait_job(job_id)
                result = job.get("result") or {}
                stls = []
                if job["status"] == "done":
                    stls = fetch_run_artifacts(job_id, result, run_dir)
                (run_dir / "result.json").write_text(json.dumps(
                    {"job_id": job_id, "status": job["status"],
                     "wall_s": job.get("wall_s"), "error": job.get("error"),
                     "result": result, "stl_files": stls}, indent=2))
                v = result.get("volumes", {}) if result.get("ok") else {}
                rows.append({
                    "model": model.name, "mb": round(mb, 2), "setting": sname,
                    "status": job["status"],
                    "error": job.get("error"),
                    "parts": len(result.get("parts", [])) if result.get("ok") else 0,
                    "skin": bool(result.get("skin")),
                    "cavity_ml": round(v.get("cavity_volume", 0) / 1000, 1),
                    "silicone_ml": round(v.get("silicone_volume", 0) / 1000, 1),
                    "plastic_ml": round(v.get("plastic_volume", 0) / 1000, 1),
                    "remeshed": result.get("notes", {}).get("remeshed"),
                    "trimmed": result.get("notes", {}).get("trimmed"),
                    "undercut_pct": round(100 * result.get("notes", {})
                                          .get("undercut", 0)),
                    "warnings": result.get("warnings", []),
                    "build_s": result.get("elapsed_s"),
                    "wall_s": job.get("wall_s"),
                })
                tag = "OK " if job["status"] == "done" else "ERR"
                print(f"    {tag} parts={rows[-1]['parts']} "
                      f"silicone={rows[-1]['silicone_ml']} ml "
                      f"wall={job.get('wall_s')}s"
                      + (f"  ERROR: {job.get('error')}" if job["status"] != "done" else ""),
                      flush=True)
            except Exception as exc:
                (run_dir / "result.json").write_text(json.dumps(
                    {"status": "runner-exception", "error": str(exc)}, indent=2))
                rows.append({"model": model.name, "mb": round(mb, 2),
                             "setting": sname, "status": "runner-exception",
                             "error": str(exc)})
                print(f"    RUNNER-EXC {exc}", flush=True)
                infra_failures += 1
                if infra_failures >= 5:
                    print("ABORT: server unreachable for 5 consecutive runs "
                          "— restart it and re-run (resume keeps finished runs).",
                          flush=True)
                    break

    (out_dir / "summary.json").write_text(json.dumps(
        {"engine": health.get("blender"), "input_dir": str(input_dir),
         "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
         "settings": SETTINGS, "skipped_files": skipped, "runs": rows},
        indent=2, ensure_ascii=False))

    ok = sum(1 for r in rows if r["status"] == "done")
    err = len(rows) - ok
    lines = [
        "# MoldForge WebUI — platform test results", "",
        f"- Engine: `{health.get('blender')}`",
        f"- Input: `{input_dir}` ({len(models)} models, "
        f"{len(skipped)} skipped: "
        + "; ".join(s["file"] + " → " + s["reason"] for s in skipped) + ")",
        f"- Runs: **{ok} OK / {err} failed** of {len(rows)}",
        f"- Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}", "",
        "| Model | MB | Setting | Status | Parts | Silicone ml | Plastic ml | Cast ml | Notes | Build s |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        notes = []
        if r.get("remeshed"): notes.append("remeshed")
        if r.get("trimmed"): notes.append("trimmed")
        if r.get("undercut_pct", 0) > 4: notes.append(f"undercut {r['undercut_pct']}%")
        for w in r.get("warnings", []): notes.append(w[:60])
        st = "✅" if r["status"] == "done" else f"❌ {r['status']}"
        if r["status"] != "done":
            notes.append((r.get("error") or "")[:120])
        lines.append(
            f"| {r['model']} | {r['mb']} | {r['setting']} | {st} | "
            f"{r.get('parts', '')} | {r.get('silicone_ml', '')} | "
            f"{r.get('plastic_ml', '')} | {r.get('cavity_ml', '')} | "
            f"{'; '.join(notes)} | {r.get('build_s', r.get('wall_s', ''))} |")
    (out_dir / "summary.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\nDONE: {ok} ok / {err} failed -> {out_dir / 'summary.md'}")


if __name__ == "__main__":
    main()
