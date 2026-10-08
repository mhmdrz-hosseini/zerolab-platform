"""Server-side job supervisor: run Blender as a child under hard caps.

Phase 5 of the safety design — the authoritative resource protection. The
in-driver hooks/watchdog can be starved when a C++ operation (OpenVDB remesh,
the exact boolean solver) holds the GIL for minutes while allocating
gigabytes; this process-level monitor cannot. It polls the child's working
set and the driver's heartbeat file and terminates the child on:

* memory cap breach                        -> reason "memory"
* total job timeout                        -> reason "timeout"
* stale stage heartbeat (> stage_timeout)  -> reason "stage_timeout"

The caller (server.BlenderRunner) maps the outcome to a structured error code
and a user-facing job failure. Stdout/stderr are redirected to files (no pipe
deadlocks, logs survive a kill).
"""

import json
import subprocess
import time
from pathlib import Path

from . import procmon


class CappedRun:
    def __init__(self, cmd, cwd, stdout_path, stderr_path, limits,
                 heartbeat_path=None, sample_every=1.0, env=None):
        self.cmd = cmd
        self.cwd = cwd
        self.stdout_path = str(stdout_path)
        self.stderr_path = str(stderr_path)
        self.limits = limits
        self.heartbeat_path = str(heartbeat_path) if heartbeat_path else None
        self.sample_every = sample_every
        self.env = env
        self.out = {
            "rc": None, "reason": "",          # ''|memory|timeout|stage_timeout
            "peak_rss_mb": 0.0, "elapsed_s": 0.0,
            "killed_at_stage": None, "samples": [],
        }

    def _heartbeat_age(self, started):
        if not self.heartbeat_path or not Path(self.heartbeat_path).is_file():
            return None
        try:
            hb = json.loads(Path(self.heartbeat_path).read_text("utf-8"))
            return time.time() - float(hb.get("ts", 0))
        except Exception:
            return None

    def _last_stage(self):
        if not self.heartbeat_path:
            return None
        try:
            hb = json.loads(Path(self.heartbeat_path).read_text("utf-8"))
            return hb.get("phase")
        except Exception:
            return None

    def run(self):
        cap_bytes = self.limits.max_memory_mb * 1024 * 1024
        started = time.time()
        with open(self.stdout_path, "wb") as so, \
                open(self.stderr_path, "wb") as se:
            proc = subprocess.Popen(self.cmd, cwd=self.cwd, stdout=so,
                                    stderr=se, env=self.env)
            self.out["pid"] = proc.pid
            while True:
                rc = proc.poll()
                if rc is not None:
                    self.out["rc"] = rc
                    break
                now = time.time()
                rss = procmon.rss_bytes(proc.pid)
                if rss is not None:
                    self.out["peak_rss_mb"] = max(self.out["peak_rss_mb"],
                                                  rss / (1024 * 1024))
                    self.out["samples"].append(
                        [round(now - started, 1), round(rss / (1024 * 1024))])
                    if rss > cap_bytes:
                        self.out["reason"] = "memory"
                        break
                elapsed = now - started
                if elapsed > self.limits.job_timeout_s:
                    self.out["reason"] = "timeout"
                    break
                hb_age = self._heartbeat_age(started)
                if hb_age is not None and hb_age > self.limits.stage_timeout_s:
                    self.out["reason"] = "stage_timeout"
                    self.out["killed_at_stage"] = self._last_stage()
                    break
                # never sleep past the deadlines we enforce
                time.sleep(min(self.sample_every,
                               max(0.1, min(self.limits.job_timeout_s - elapsed,
                                            30))))
            if self.out["reason"]:
                proc.kill()
                try:
                    proc.wait(10)
                except subprocess.TimeoutExpired:
                    pass                       # Windows: TerminateProcess is abrupt
                self.out["rc"] = proc.returncode
        self.out["elapsed_s"] = round(time.time() - started, 1)
        return self.out
