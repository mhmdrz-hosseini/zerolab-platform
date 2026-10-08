"""Unit tests for the pure-python safety logic (no Blender required).

Run:  .venv/Scripts/python.exe -m unittest discover -s webui/tests -v
"""

import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from safety.errors import (SafetyAbort, ERROR_MAX_ITERATIONS,           # noqa: E402
                           ERROR_NO_PROGRESS, ERROR_REPEATED_FAILURE,
                           ERROR_PROCESSING_TIMEOUT)
from safety.guards import GuardState, quantize
from safety.limits import Limits


def make_limits(**over):
    base = dict(job_timeout_s=10, stage_timeout_s=5, max_memory_mb=1024,
                max_faces=1000, max_extent_mm=100, guard_max_coord_mm=1000,
                max_ops=5, max_repeat_failures=2, max_rung_repeat=3)
    base.update(over)
    return Limits(**base)


class DeadlineTest(unittest.TestCase):
    def test_deadline_trips(self):
        g = GuardState(make_limits(job_timeout_s=0), started=time.time() - 5)
        with self.assertRaises(SafetyAbort) as cm:
            g.check("op")
        self.assertEqual(cm.exception.code, ERROR_PROCESSING_TIMEOUT)

    def test_tripped_reraises_through_except_blocks(self):
        """A best-effort `except Exception` in the add-on swallows the first
        SafetyAbort; the NEXT check must re-raise it (guard stays tripped)."""
        g = GuardState(make_limits(job_timeout_s=0), started=time.time() - 5)
        try:
            g.check("op")
        except SafetyAbort:
            pass
        with self.assertRaises(SafetyAbort):
            g.check("next-op")
        with self.assertRaises(SafetyAbort):
            g.check("another-op")


class OpBudgetTest(unittest.TestCase):
    def test_budget_exhausted(self):
        g = GuardState(make_limits(max_ops=3))
        g.bump_op("boolean")
        g.bump_op("boolean")
        g.bump_op("voxel_remesh")
        with self.assertRaises(SafetyAbort) as cm:
            g.bump_op("boolean")
        self.assertEqual(cm.exception.code, ERROR_MAX_ITERATIONS)
        self.assertEqual(cm.exception.diagnostics["op_counts"]["boolean"], 3)


class RepeatedFailureTest(unittest.TestCase):
    def test_identical_failure_aborts_on_second(self):
        g = GuardState(make_limits())
        sig = (100, 200, "x")
        try:
            raise RuntimeError("boolean failed on piece 3")
        except RuntimeError as exc:
            g.record_op_failure("boolean", sig, exc)      # first: recorded
        self.assertIsNone(g.tripped)
        try:
            raise RuntimeError("boolean failed on piece 7")
        except RuntimeError as exc:
            with self.assertRaises(SafetyAbort) as cm:
                g.record_op_failure("boolean", sig, exc)  # same sig: abort
        self.assertEqual(cm.exception.code, ERROR_REPEATED_FAILURE)

    def test_different_geometry_does_not_abort(self):
        g = GuardState(make_limits())
        for i in range(6):
            try:
                raise RuntimeError("empty half")
            except RuntimeError as exc:
                g.record_op_failure("split", (i, 10, "x"), exc)
        self.assertIsNone(g.tripped)                       # inputs differed

    def test_different_error_does_not_abort(self):
        g = GuardState(make_limits())
        sig = (1, 2, "x")
        for msg in ("empty half", "not watertight", "shards everywhere"):
            try:
                raise RuntimeError(msg)
            except RuntimeError as exc:
                g.record_op_failure("split", sig, exc)
        self.assertIsNone(g.tripped)

    def test_normalize_error_strips_numbers(self):
        g = GuardState(make_limits())
        try:
            raise RuntimeError("piece B has 12% of 34 faces at level 5")
        except RuntimeError as exc:
            a = g.normalize_error(exc)
        try:
            raise RuntimeError("piece B has 98% of 76 faces at level 2")
        except RuntimeError as exc:
            b = g.normalize_error(exc)
        self.assertEqual(a, b)


class NoProgressTest(unittest.TestCase):
    def test_same_rung_failure_three_times_aborts(self):
        """Same input master + same error class on 3 consecutive recovery
        rungs -> ERROR_NO_PROGRESS (the ladder's variations change nothing)."""
        g = GuardState(make_limits())
        master = (1, 2, "sig")
        for i in range(2):
            try:
                raise RuntimeError(f"attempt {i} produced empty half at 30%")
            except RuntimeError as exc:
                g.record_rung_failure(master, exc)
        self.assertIsNone(g.tripped)
        try:
            raise RuntimeError("attempt 3 produced empty half at 90%")
        except RuntimeError as exc:
            with self.assertRaises(SafetyAbort) as cm:
                g.record_rung_failure(master, exc)
        self.assertEqual(cm.exception.code, ERROR_NO_PROGRESS)

    def test_different_master_resets_nothing_but_does_not_abort(self):
        g = GuardState(make_limits())
        for master in ((1, 2, "a"), (9, 9, "b")):
            try:
                raise RuntimeError("separate pieces")
            except RuntimeError as exc:
                g.record_rung_failure(master, exc)
        self.assertIsNone(g.tripped)


class PayloadTest(unittest.TestCase):
    def test_safety_abort_payload_shape(self):
        exc = SafetyAbort(ERROR_NO_PROGRESS, "no progress",
                          stage="mesh_repair", diagnostics={"iteration": 14})
        p = exc.payload()
        self.assertFalse(p["ok"])
        self.assertEqual(p["error_code"], "ERROR_NO_PROGRESS")
        self.assertEqual(p["stage"], "mesh_repair")
        self.assertEqual(p["diagnostics"]["iteration"], 14)

    def test_safety_abort_not_runtimeerror(self):
        """The recovery ladder catches (MoldGeometryError, RuntimeError) — a
        SafetyAbort must NOT be either, or it would be retried."""
        self.assertFalse(issubclass(SafetyAbort, RuntimeError))


class LimitsTest(unittest.TestCase):
    def test_env_override(self):
        os.environ["MOLDFORGE_MAX_MEMORY_MB"] = "1234"
        os.environ["MOLDFORGE_MAX_OPS"] = "77"
        try:
            lim = Limits.from_env()
        finally:
            del os.environ["MOLDFORGE_MAX_MEMORY_MB"]
            del os.environ["MOLDFORGE_MAX_OPS"]
        self.assertEqual(lim.max_memory_mb, 1234)
        self.assertEqual(lim.max_ops, 77)

    def test_bad_env_falls_back(self):
        os.environ["MOLDFORGE_MAX_OPS"] = "not-a-number"
        try:
            lim = Limits.from_env()
        finally:
            del os.environ["MOLDFORGE_MAX_OPS"]
        self.assertEqual(lim.max_ops, Limits.max_ops)


class QuantizeTest(unittest.TestCase):
    def test_quantize(self):
        self.assertEqual(quantize(10.0004, 1e-3), quantize(10.0006, 1e-3))
        self.assertNotEqual(quantize(10.0, 1e-3), quantize(10.1, 1e-3))


if __name__ == "__main__":
    unittest.main(verbosity=2)
