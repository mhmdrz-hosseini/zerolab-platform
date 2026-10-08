"""Structured error codes for controlled failures.

Every failure the pipeline can now produce carries one of these codes plus a
``stage`` and a ``diagnostics`` dict, so a caller can tell WHICH model failed,
WHERE it failed, and WHY — without reading logs. See Phase 10 of the safety
design: no model may hang or crash the service; it must fail like this.
"""

# --- input / geometry ---------------------------------------------------------
ERROR_INVALID_PARAMETER = "ERROR_INVALID_PARAMETER"       # unknown params, bad values
ERROR_INVALID_GEOMETRY = "ERROR_INVALID_GEOMETRY"         # non-finite / exploded coords,
                                                            # empty mesh, unusable input
ERROR_UNSUPPORTED_COMPLEXITY = "ERROR_UNSUPPORTED_COMPLEXITY"  # preflight caps (faces/extent)

# --- pipeline outcomes --------------------------------------------------------
ERROR_GEOMETRY_FAILED = "ERROR_GEOMETRY_FAILED"           # upstream geometry failure
ERROR_BOOLEAN_FAILED = "ERROR_BOOLEAN_FAILED"             # failure inside a boolean op

# --- safety limits ------------------------------------------------------------
ERROR_MAX_ITERATIONS = "ERROR_MAX_ITERATIONS"             # op budget exhausted
ERROR_NO_PROGRESS = "ERROR_NO_PROGRESS"                   # ladder retries without effect
ERROR_REPEATED_FAILURE = "ERROR_REPEATED_FAILURE"         # identical op failed on identical
                                                            # geometry again
ERROR_PROCESSING_TIMEOUT = "ERROR_PROCESSING_TIMEOUT"     # one stage stuck too long
ERROR_JOB_TIMEOUT = "ERROR_JOB_TIMEOUT"                   # whole build over its lifetime
ERROR_MEMORY_LIMIT = "ERROR_MEMORY_LIMIT"                 # RAM cap hit

# --- process ------------------------------------------------------------------
ERROR_BLENDER_CRASH = "ERROR_BLENDER_CRASH"               # nonzero exit, no result
ERROR_INTERNAL = "ERROR_INTERNAL"                         # unexpected driver error

#: error codes that indicate a model dangerous enough to quarantine for the
#: regression dataset (Phase 11)
DANGEROUS_CODES = {
    ERROR_MEMORY_LIMIT, ERROR_BLENDER_CRASH, ERROR_REPEATED_FAILURE,
    ERROR_NO_PROGRESS, ERROR_PROCESSING_TIMEOUT, ERROR_JOB_TIMEOUT,
    ERROR_MAX_ITERATIONS,
}


class SafetyAbort(Exception):
    """Raised inside the Blender process to stop processing IMMEDIATELY.

    Deliberately NOT a RuntimeError subclass: moldforge's recovery ladder
    catches ``(MoldGeometryError, RuntimeError)`` and would retry — a safety
    abort must propagate straight out. (If a best-effort ``except Exception``
    block swallows one, the guard is flagged tripped and every subsequent
    instrumented operation re-raises it, so the build still cannot continue.)
    """

    def __init__(self, code, message, stage=None, diagnostics=None):
        super().__init__(message)
        self.code = code
        self.stage = stage
        self.diagnostics = diagnostics or {}

    def payload(self):
        """The structured failure payload written into result.json."""
        return {
            "ok": False,
            "kind": "safety",
            "error": str(self),
            "error_code": self.code,
            "stage": self.stage,
            "diagnostics": self.diagnostics,
        }
