"""Resource-safety layer for the MoldForge WebUI.

Goal: a malformed, complex or unsupported model may FAIL, but may never trap
Blender in an uncontrolled loop, consume unbounded RAM, or take down the
processing service. The add-on code in ``moldforge/`` is never modified — every
protection here lives at the webui boundary:

* :mod:`errors`  — structured error codes + the SafetyAbort exception
* :mod:`limits`  — configurable caps (time / memory / geometry), env overridable
* :mod:`procmon` — Windows RSS sampling via ctypes (no psutil dependency)
* :mod:`guards`  — budgets, deadlines, repeated-failure / no-progress detection
* :mod:`hooks`   — runtime instrumentation installed inside the Blender process
* :mod:`supervisor` — process-level watchdog that kills Blender on cap breach
"""
