"""Guard state shared by the in-driver hooks and the watchdog thread.

Pure Python (no bpy import) so it is unit-testable outside Blender. Tracks:

* deadlines      — total job budget (Phase 4)
* op budgets     — a build may not exceed N heavy operations (Phase 4)
* repeated failures — the same (op, input geometry, error) may not be retried
                      forever (Phases 6/7)
* rung no-progress  — moldforge's recovery ladder re-runs the whole build with
                      different trial parameters; if the SAME input master
                      fails with the SAME error class on several consecutive
                      rungs, the variations are not helping and the remaining
                      rungs are pure waste (Phase 3)
* a ring-buffer event log — the instrumentation trail (Phase 1) kept for
                      result payloads and failure reports (Phases 10/11)
"""

import json
import math
import time
from collections import Counter, deque

from .errors import (SafetyAbort, ERROR_MAX_ITERATIONS, ERROR_NO_PROGRESS,
                     ERROR_PROCESSING_TIMEOUT, ERROR_REPEATED_FAILURE)


class GuardState:
    def __init__(self, limits, started=None, sink=None):
        self.limits = limits
        self.started = started if started is not None else time.time()
        self.sink = sink                    # callable(dict) or None (jsonl file)
        self.stage = "startup"
        self.ops = Counter()                # op name -> count
        self.op_failures = Counter()        # (op, sig, err) -> count
        self.rung_failures = Counter()      # (master_sig, err_class) -> count
        self.rung_index = 0
        self.tripped = None                 # SafetyAbort raised, possibly swallowed
        self.events = deque(maxlen=600)
        self.peak_rss_mb = 0.0
        self._last_event_ts = 0.0

    # -- logging ----------------------------------------------------------

    def log(self, event, **fields):
        rec = {"t": round(time.time() - self.started, 2), "event": event}
        rec.update(fields)
        self.events.append(rec)
        if self.sink:
            try:
                self.sink(rec)
            except Exception:
                pass

    def tail(self, n=40):
        return list(self.events)[-n:]

    # -- stage tracking -----------------------------------------------------

    def note_stage(self, stage):
        self.stage = stage

    # -- checks (called before/after every heavy operation) ------------------

    def elapsed(self):
        return time.time() - self.started

    def check(self, op=""):
        """Raise SafetyAbort when a limit is already tripped (re-raise through
        best-effort except blocks) or the total deadline has passed."""
        if self.tripped is not None:
            raise self.tripped
        if self.elapsed() > self.limits.job_timeout_s:
            self.abort(ERROR_PROCESSING_TIMEOUT,
                       f"Build exceeded the total job time of "
                       f"{self.limits.job_timeout_s}s (at op '{op}').")

    def abort(self, code, message, **diag):
        exc = SafetyAbort(code, message, stage=self.stage, diagnostics=diag)
        self.tripped = exc
        self.log("abort", code=code, stage=self.stage, message=message, **diag)
        raise exc

    def bump_op(self, op):
        self.ops[op] += 1
        total = sum(self.ops.values())
        if total > self.limits.max_ops:
            self.abort(ERROR_MAX_ITERATIONS,
                       f"Operation budget exhausted ({total} > "
                       f"{self.limits.max_ops} heavy ops; op '{op}').",
                       op_counts=dict(self.ops))

    # -- failure signatures ---------------------------------------------------

    @staticmethod
    def normalize_error(exc):
        """Error class + message with numbers stripped, so 'piece B at 12%' and
        'piece C at 40%' count as the same failure."""
        msg = " ".join(str(exc).split())
        out, skip = [], False
        for ch in msg:
            if ch.isdigit() or ch == ".":
                skip = True
                continue
            if skip and out and not out[-1].isspace():
                out.append("*")
            skip = False
            out.append(ch)
        return type(exc).__name__, "".join(out)

    def record_op_failure(self, op, sig, exc):
        """Phases 6/7: an identical operation failing on identical input
        geometry is deterministic — never retry it past max_repeat_failures."""
        key = (op, sig, self.normalize_error(exc))
        self.op_failures[key] += 1
        self.log("op_failed", op=op, count=self.op_failures[key], err=key[2][0],
                 msg=str(exc)[:200])
        if self.op_failures[key] >= self.limits.max_repeat_failures:
            self.abort(ERROR_REPEATED_FAILURE,
                       f"Operation '{op}' failed {self.op_failures[key]}x with the "
                       f"exact same input geometry and error "
                       f"({key[2][0]}: {str(exc)[:120]}) — deterministic failure, "
                       f"not retrying again.",
                       op=op, attempts=self.op_failures[key])

    def record_rung_failure(self, master_sig, exc):
        """Phase 3: called when one recovery-ladder rung fails. Same input
        master + same error class on max_rung_repeat consecutive rungs means
        the recovery variations (axis/remesh/wings) have no effect — abort the
        remaining rungs instead of burning the same heavy work again."""
        key = (master_sig, self.normalize_error(exc))
        self.rung_failures[key] += 1
        self.rung_index += 1
        self.log("rung_failed", rung=self.rung_index,
                 count=self.rung_failures[key], err=key[1][0],
                 msg=str(exc)[:200])
        if self.rung_failures[key] >= self.limits.max_rung_repeat:
            self.abort(ERROR_NO_PROGRESS,
                       f"The build failed the same way on "
                       f"{self.rung_failures[key]} recovery attempts (input "
                       f"unchanged, error {key[1][0]}: {str(exc)[:120]}) — further "
                       f"recovery variations would repeat it.",
                       rung=self.rung_index, attempts=self.rung_failures[key])

    def record_rung_success(self):
        self.rung_index += 1

    # -- diagnostics ------------------------------------------------------------

    def diagnostics(self):
        return {
            "elapsed_s": round(self.elapsed(), 1),
            "stage": self.stage,
            "peak_rss_mb": round(self.peak_rss_mb, 1),
            "ops": dict(self.ops),
            "rung_failures": {f"{k[0]}|{k[1][0]}": v
                              for k, v in self.rung_failures.items()},
            "op_failures": {f"{k[0]}|{k[2][0]}": v
                            for k, v in self.op_failures.items()},
            "event_tail": self.tail(12),
        }


def quantize(value, step):
    """Quantize a float for geometry signatures (stable across runs)."""
    if not math.isfinite(value):
        return str(value)
    return str(math.floor(value / step))


def make_jsonl_sink(path):
    fh = open(path, "a", encoding="utf-8")

    def sink(rec):
        fh.write(json.dumps(rec, default=str) + "\n")
        fh.flush()

    return sink
