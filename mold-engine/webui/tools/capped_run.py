"""Run a subprocess under hard resource caps (time + memory), Windows/ctypes.

Zero dependencies (no psutil): polls the child's working set via psapi and
kills it when it crosses the caps. Used to reproduce pathological Blender runs
without endangering the machine, and as the model for the server-side watchdog.

Usage:
    python capped_run.py --timeout 480 --mem-mb 5000 --sample-every 1 \
        --out samples.json -- blender.exe --background ... ...

Exit status: the child's, or one of
    100  killed: memory cap
    101  killed: timeout
    102  child failed to start
Prints a one-line summary; writes the RSS timeline to --out (JSON).
"""

import argparse
import ctypes
import json
import subprocess
import sys
import time
from ctypes import wintypes

EXIT_MEM = 100
EXIT_TIMEOUT = 101
EXIT_SPAWN = 102


class PMC(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t)]


_psapi = ctypes.WinDLL("psapi")
_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_PROCESS_VM_READ = 0x0010


def rss_bytes(pid):
    """Current working-set size of a process, or None if it can't be queried."""
    handle = _kernel32.OpenProcess(
        _PROCESS_QUERY_LIMITED_INFORMATION | _PROCESS_VM_READ, False, pid)
    if not handle:
        return None
    try:
        pmc = PMC()
        pmc.cb = ctypes.sizeof(PMC)
        if not _psapi.GetProcessMemoryInfo(handle, ctypes.byref(pmc), pmc.cb):
            return None
        return pmc.WorkingSetSize
    finally:
        _kernel32.CloseHandle(handle)


def run_capped(cmd, timeout_s, mem_cap_bytes, sample_every=1.0, on_sample=None):
    """Launch cmd; poll RSS; kill on cap breach. Returns (returncode, reason,
    samples) where reason is ''|'memory'|'timeout' and samples are
    (elapsed_s, rss_bytes) tuples."""
    start = time.time()
    try:
        proc = subprocess.Popen(cmd)
    except OSError as exc:
        print(f"failed to start: {exc}", file=sys.stderr)
        return EXIT_SPAWN, "spawn", []
    samples = []
    peak = 0
    reason = ""
    while True:
        rc = proc.poll()
        if rc is not None:
            break
        rss = rss_bytes(proc.pid)
        now = time.time() - start
        if rss is not None:
            peak = max(peak, rss)
            samples.append((round(now, 2), rss))
            if on_sample:
                on_sample(now, rss)
            if rss > mem_cap_bytes:
                reason = "memory"
                proc.kill()
                proc.wait(10)
                break
        if time.time() - start > timeout_s:
            reason = "timeout"
            proc.kill()
            proc.wait(10)
            rc = proc.poll()
            break
        time.sleep(sample_every)
    if not reason:
        rc = proc.returncode
    if reason == "memory":
        rc = EXIT_MEM
    elif reason == "timeout":
        rc = EXIT_TIMEOUT
    return rc, reason, samples


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout", type=float, default=480)
    ap.add_argument("--mem-mb", type=float, default=5000)
    ap.add_argument("--sample-every", type=float, default=1.0)
    ap.add_argument("--out", default=None)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    args = ap.parse_args()
    cmd = args.cmd
    if cmd and cmd[0] == "--":
        cmd = cmd[1:]
    rc, reason, samples = run_capped(
        cmd, args.timeout, int(args.mem_mb * 1024 * 1024), args.sample_every)
    peak_mb = max((s[1] for s in samples), default=0) / (1024 * 1024)
    dur = samples[-1][0] if samples else 0.0
    print(f"[capped_run] rc={rc} reason={reason or 'exit'} "
          f"peak_rss={peak_mb:.0f}MB elapsed={dur:.0f}s samples={len(samples)}")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"rc": rc, "reason": reason, "peak_rss_mb": round(peak_mb, 1),
                       "elapsed_s": round(dur, 1), "samples": samples}, f)
    sys.exit(rc)


if __name__ == "__main__":
    main()
