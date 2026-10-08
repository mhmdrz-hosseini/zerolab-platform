"""MoldForge Web UI server.

FastAPI app that serves the static frontend and runs mold generation as jobs:
each job spawns one headless Blender subprocess (webui/driver.py) which drives
the UNMODIFIED moldforge add-on code. Artifacts land in output/<job_id>/.

Endpoints:
    GET  /api/health              -> engine path/status
    POST /api/generate            -> multipart (model file + params JSON) -> job_id
    GET  /api/job/{id}            -> live status/progress/result
    GET  /api/job/{id}/parts/{f}  -> download one generated STL
    GET  /api/job/{id}/zip        -> all generated STLs zipped

Safety: BlenderRunner runs the driver under webui/safety/supervisor.py — the
Blender process is polled for memory use, wall time and stage heartbeats and
is KILLED when a cap trips (a pathological model used to be able to pin the
CPU and eat RAM until the machine died). Dangerous failures are preserved in
quarantine/ for the regression dataset.

Production note: the BlenderRunner class is the only place that knows how a job
is executed — swapping it for a cloud queue/worker pool later touches nothing
else (see README-WEBUI.md).
"""

import hashlib
import json
import os
import queue
import subprocess
import threading
import time
import uuid
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
WEBUI = ROOT / "webui"
STATIC = WEBUI / "static"
DRIVER = WEBUI / "driver.py"
UPLOADS = ROOT / "uploads"
OUTPUT = ROOT / "output"
ENGINE = ROOT / "engine"
SAFETY = WEBUI / "safety"

import sys  # noqa: E402
sys.path.insert(0, str(WEBUI))

from safety import limits as sf_limits, supervisor as sf_supervisor  # noqa: E402
from safety.errors import (DANGEROUS_CODES, ERROR_BLENDER_CRASH,  # noqa: E402
                           ERROR_INTERNAL, ERROR_JOB_TIMEOUT,
                           ERROR_MEMORY_LIMIT, ERROR_PROCESSING_TIMEOUT)

ALLOWED_EXT = {".stl", ".obj", ".ply", ".glb", ".gltf"}
MAX_UPLOAD_BYTES = 200 * 1024 * 1024        # 200 MB
JOB_TTL_S = 24 * 3600                       # prune artifacts older than a day


def _plugin_version():
    try:
        for line in (ROOT / "moldforge" / "blender_manifest.toml").read_text(
                encoding="utf-8").splitlines():
            if line.strip().startswith("version"):
                return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return "unknown"


PLUGIN_VERSION = _plugin_version()


def _blender_version(exe: Optional[Path]):
    if not exe:
        return "unknown"
    try:
        out = subprocess.run([str(exe), "--version"], capture_output=True,
                             text=True, timeout=30)
        return (out.stdout or out.stderr).splitlines()[0].strip()
    except Exception:
        return "unknown"


# --------------------------------------------------------------------------
# engine discovery


def find_blender() -> Optional[Path]:
    """blender.exe from $MOLDFORGE_BLENDER, else the portable install under
    engine/ (any version), else PATH.

    Prefers Blender 5.1.x: the upstream test suite passes 377/377 there, while
    5.2.2 shows two adversarial fold-over quality regressions in the boolean
    solver (375/377). Algorithm fidelity is the product guarantee, so the
    fully-green engine is the default; override with MOLDFORGE_BLENDER."""
    env = os.environ.get("MOLDFORGE_BLENDER")
    if env:
        p = Path(env)
        if p.is_file():
            return p
        raise RuntimeError(f"MOLDFORGE_BLENDER points to a missing file: {env}")
    if ENGINE.is_dir():
        preferred = sorted(ENGINE.glob("blender-5.1.*/blender.exe"))
        if preferred:
            return preferred[-1]
        candidates = sorted(ENGINE.glob("blender-*/blender.exe"))
        if candidates:
            return candidates[-1]
        # allow a plain extracted layout too
        direct = ENGINE / "blender.exe"
        if direct.is_file():
            return direct
    from shutil import which
    exe = which("blender")
    return Path(exe) if exe else None


# --------------------------------------------------------------------------
# job store + single-blender worker (serialize heavy geometry builds)


class JobStore:
    def __init__(self):
        self._jobs = {}
        self._lock = threading.Lock()

    def create(self, job_id, upload_path, params):
        with self._lock:
            self._jobs[job_id] = {
                "id": job_id, "status": "queued", "progress": 0.0,
                "phase": "waiting for the build worker", "error": None,
                "error_code": None, "peak_rss_mb": None,
                "result": None, "upload": upload_path, "params": params,
                "dir": OUTPUT / job_id, "created": time.time(),
            }
        return self._jobs[job_id]

    def get(self, job_id):
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def update(self, job_id, **kw):
        with self._lock:
            self._jobs[job_id].update(kw)

    def snapshot_public(self, job):
        """What the poll endpoint returns: everything except local paths."""
        out = {k: job.get(k) for k in
               ("id", "status", "progress", "phase", "error", "error_code",
                "peak_rss_mb", "result")}
        return out


JOBS = JobStore()
QUEUE: "queue.Queue[str]" = queue.Queue()


def _sha256(path: Path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _prune_quarantine(limits):
    qdir = Path(limits.quarantine_dir)
    if not qdir.is_dir():
        return
    reports = sorted(qdir.glob("*.json"), key=lambda p: p.stat().st_mtime)
    excess = len(reports) - limits.quarantine_keep
    for old in reports[:max(0, excess)]:
        try:
            model = None
            try:
                model = json.loads(old.read_text(encoding="utf-8")).get("model_file")
            except Exception:
                pass
            old.unlink()
            if model:
                m = qdir / model
                if m.is_file():
                    m.unlink()
        except OSError:
            pass


def _quarantine(job, limits, result, run_info):
    """Phase 11: preserve the failing model + full context for the regression
    dataset. Never raises — quarantine is best-effort."""
    try:
        qdir = Path(limits.quarantine_dir)
        qdir.mkdir(parents=True, exist_ok=True)
        upload = Path(job["upload"])
        stamp = time.strftime("%Y%m%d_%H%M%S")
        model_name = f"{job['id']}_{upload.name}"
        report = {
            "job_id": job["id"],
            "input_filename": upload.name,
            "input_model_sha256": _sha256(upload) if upload.is_file() else None,
            "params": job["params"],
            "error_code": result.get("error_code") or "UNKNOWN",
            "error": result.get("error"),
            "stage": result.get("stage") or run_info.get("killed_at_stage"),
            "blender_version": app.state.blender_version,
            "plugin_version": PLUGIN_VERSION,
            "peak_rss_mb": run_info.get("peak_rss_mb"),
            "elapsed_s": run_info.get("elapsed_s"),
            "killed_reason": run_info.get("reason"),
            "diagnostics": result.get("diagnostics"),
            "preflight": result.get("preflight"),
            "quarantined_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "model_file": model_name,
        }
        (qdir / f"{stamp}_{job['id']}.json").write_text(
            json.dumps(report, indent=2, default=str), encoding="utf-8")
        if upload.is_file():
            (qdir / model_name).write_bytes(upload.read_bytes())
        _prune_quarantine(limits)
    except Exception as exc:                    # noqa: BLE001 — best-effort
        print(f"quarantine failed for {job['id']}: {exc}")


class BlenderRunner:
    """Executes one job as a headless Blender subprocess under the resource
    supervisor (memory / time / stage-heartbeat caps, kill on breach). This is
    the seam to replace when moving generation to a cloud worker pool."""

    def __init__(self, blender_exe: Path):
        self.blender_exe = blender_exe

    def run(self, job):
        outdir = job["dir"]
        outdir.mkdir(parents=True, exist_ok=True)
        limits = sf_limits.Limits.from_env(root=ROOT)
        params_path = outdir / "params.json"
        params_path.write_text(json.dumps(job["params"]), encoding="utf-8")
        cmd = [
            str(self.blender_exe), "--background", "--factory-startup",
            "--python", str(DRIVER), "--",
            str(job["upload"]), str(params_path), str(outdir),
        ]
        runinfo = sf_supervisor.CappedRun(
            cmd, cwd=str(outdir),
            stdout_path=outdir / "blender_stdout.log",
            stderr_path=outdir / "blender_stderr.log",
            limits=limits,
            heartbeat_path=outdir / "progress.json",
        ).run()

        # memory timeline for the job record (downsampled to ~120 points)
        samples = runinfo.get("samples") or []
        stride = max(1, len(samples) // 120)
        (outdir / "mem_samples.json").write_text(json.dumps(
            {"peak_rss_mb": runinfo["peak_rss_mb"], "elapsed_s": runinfo["elapsed_s"],
             "killed_reason": runinfo["reason"], "killed_at_stage":
             runinfo.get("killed_at_stage"),
             "samples": samples[::stride]}), encoding="utf-8")

        def fail(error_code, message):
            result = {"ok": False, "kind": "safety", "error": message,
                      "error_code": error_code,
                      "stage": runinfo.get("killed_at_stage"),
                      "diagnostics": {"elapsed_s": runinfo["elapsed_s"],
                                      "peak_rss_mb": round(runinfo["peak_rss_mb"]),
                                      "killed_reason": runinfo["reason"]}}
            (outdir / "result.json").write_text(
                json.dumps(result, indent=2), encoding="utf-8")
            JOBS.update(job["id"], status="error", error=message,
                        error_code=error_code,
                        peak_rss_mb=round(runinfo["peak_rss_mb"]), result=result)
            if error_code in DANGEROUS_CODES:
                _quarantine(job, limits, result, runinfo)

        try:
            log = ((outdir / "blender_stdout.log").read_text(
                        encoding="utf-8", errors="replace")
                   + "\n"
                   + (outdir / "blender_stderr.log").read_text(
                        encoding="utf-8", errors="replace"))
        except OSError:
            log = ""
        (outdir / "blender.log").write_text(log[-200000:], encoding="utf-8",
                                            errors="replace")

        result_file = outdir / "result.json"
        if runinfo["reason"] == "memory":
            fail(ERROR_MEMORY_LIMIT,
                 f"Blender memory usage exceeded the "
                 f"{limits.max_memory_mb} MB cap"
                 + (f" while in '{runinfo.get('killed_at_stage')}'."
                    if runinfo.get("killed_at_stage") else "."))
            return
        if runinfo["reason"] == "timeout":
            fail(ERROR_JOB_TIMEOUT,
                 f"The build exceeded the total job time of "
                 f"{limits.job_timeout_s // 60} minutes.")
            return
        if runinfo["reason"] == "stage_timeout":
            fail(ERROR_PROCESSING_TIMEOUT,
                 f"Processing stage exceeded the maximum allowed execution "
                 f"time ({limits.stage_timeout_s // 60} minutes)"
                 + (f": stuck in '{runinfo.get('killed_at_stage')}'."
                    if runinfo.get("killed_at_stage") else "."))
            return
        if not result_file.is_file():
            # nonzero exit without writing a result: a hard Blender crash
            rc = runinfo.get("rc")
            fail(ERROR_BLENDER_CRASH,
                 "The build engine crashed"
                 + (f" (exit code {rc})" if rc is not None else "")
                 + (f": {log.strip()[-600:]}" if log.strip() else "."))
            return
        result = json.loads(result_file.read_text(encoding="utf-8"))
        peak = max(round(runinfo["peak_rss_mb"]),
                   int(result.get("peak_rss_mb") or 0))
        if result.get("ok"):
            JOBS.update(job["id"], status="done", progress=1.0,
                        phase="done", error_code=None, peak_rss_mb=peak,
                        result=result)
        else:
            JOBS.update(job["id"], status="error",
                        error=result.get("error", "unknown error"),
                        error_code=result.get("error_code", ERROR_INTERNAL),
                        peak_rss_mb=peak, result=result)
            # Phase 11: dangerous = runaway-ish processing (limits, crashes,
            # deterministic repeats) or an intermediate-mesh explosion — the
            # classes worth keeping for the regression dataset.
            if (result.get("error_code") in DANGEROUS_CODES
                    or "absmax_mm" in (result.get("diagnostics") or {})):
                _quarantine(job, limits, result, runinfo)


def _worker(runner: BlenderRunner):
    while True:
        job_id = QUEUE.get()
        job = JOBS.get(job_id)
        if not job:
            continue
        JOBS.update(job_id, status="running", progress=0.0,
                    phase="starting Blender")
        try:
            runner.run(job)
        except Exception as exc:  # never kill the worker thread
            JOBS.update(job_id, status="error",
                        error=f"internal error: {exc}",
                        error_code=ERROR_INTERNAL)
        finally:
            _prune_old_artifacts()


def _prune_old_artifacts():
    cutoff = time.time() - JOB_TTL_S
    for base in (OUTPUT, UPLOADS):
        if not base.is_dir():
            continue
        for child in base.iterdir():
            try:
                if child.is_dir() and child.stat().st_mtime < cutoff:
                    import shutil
                    shutil.rmtree(child, ignore_errors=True)
            except OSError:
                pass


# --------------------------------------------------------------------------
# app

app = FastAPI(title="MoldForge WebUI")


@app.on_event("startup")
def _startup():
    exe = find_blender()
    app.state.blender = exe
    app.state.blender_version = _blender_version(exe)
    if exe is None:
        print("WARNING: no blender.exe found — set MOLDFORGE_BLENDER or "
              "install the portable build under engine/ (run setup.bat).")
    threading.Thread(target=_worker, args=(BlenderRunner(exe),),
                     daemon=True).start()


@app.get("/api/health")
def health():
    exe = app.state.blender
    limits = sf_limits.Limits.from_env(root=ROOT)
    return {"blender": str(exe) if exe else None,
            "blender_version": getattr(app.state, "blender_version", None),
            "driver": str(DRIVER),
            "moldforge": str(ROOT / "moldforge"),
            "plugin_version": PLUGIN_VERSION,
            "limits": limits.describe()}


@app.post("/api/generate")
async def generate(file: UploadFile = File(...),
                   params: str = Form("{}")):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type '{ext}'. "
                                 f"Upload one of: {', '.join(sorted(ALLOWED_EXT))}")
    try:
        params_obj = json.loads(params) if params.strip() else {}
        if not isinstance(params_obj, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(400, "params must be a JSON object")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "File too large "
                                 f"(max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).")

    job_id = uuid.uuid4().hex[:12]
    updir = UPLOADS / job_id
    updir.mkdir(parents=True, exist_ok=True)
    safe_stem = "".join(c if (c.isalnum() or c in "._-") else "_"
                        for c in Path(file.filename).stem)[:80] or "model"
    upload_path = updir / f"{safe_stem}{ext}"
    upload_path.write_bytes(data)

    JOBS.create(job_id, upload_path, params_obj)
    QUEUE.put(job_id)
    return {"job_id": job_id}


def _job_or_404(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job id.")
    return job


@app.get("/api/job/{job_id}")
def job_status(job_id: str):
    job = _job_or_404(job_id)
    public = JOBS.snapshot_public(job)
    # live progress from the driver's progress.json, if present
    if job["status"] == "running":
        try:
            prog = json.loads((job["dir"] / "progress.json").read_text())
            public["progress"] = prog.get("progress", public["progress"])
            public["phase"] = prog.get("phase", public["phase"])
        except Exception:
            pass
    return public


def _safe_part_path(job_dir: Path, name: str) -> Path:
    if not name.endswith(".stl"):
        raise HTTPException(400, "Only STL part files are served.")
    path = (job_dir / name).resolve()
    if job_dir.resolve() not in path.parents:
        raise HTTPException(400, "Bad path.")
    if not path.is_file():
        raise HTTPException(404, "No such part.")
    return path


@app.get("/api/job/{job_id}/parts/{name}")
def job_part(job_id: str, name: str):
    job = _job_or_404(job_id)
    path = _safe_part_path(job["dir"], name)
    return FileResponse(path, media_type="model/stl",
                        filename=path.name)


@app.get("/api/job/{job_id}/zip")
def job_zip(job_id: str):
    job = _job_or_404(job_id)
    stls = sorted(job["dir"].glob("*.stl"))
    if not stls:
        raise HTTPException(404, "No parts generated yet.")

    def chunks():
        import io
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for p in stls:
                z.write(p, arcname=p.name)
        buf.seek(0)
        yield from iter(lambda: buf.read(65536), b"")

    return StreamingResponse(
        chunks(),
        media_type="application/zip",
        headers={"Content-Disposition":
                 f'attachment; filename="moldforge_{job_id}.zip"'},
    )


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
