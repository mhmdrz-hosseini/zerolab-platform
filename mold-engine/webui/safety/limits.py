"""All safety caps in one place, overridable via environment variables.

Defaults are chosen so that every model which builds successfully today keeps
building exactly the same way (the heaviest known-good builds stay well inside
them); the caps only bite on pathological runs that used to hang or eat RAM
until the machine died.
"""

import os
from dataclasses import dataclass

from . import procmon


def _env_int(name, default):
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def _default_memory_mb():
    """Half the installed RAM, clamped to [2048, 8192] MB."""
    total = procmon.total_physical_mb() or 8192.0
    return int(min(max(total * 0.5, 2048.0), 8192.0))


@dataclass(frozen=True)
class Limits:
    # time
    job_timeout_s: int = 30 * 60       # whole build (was the old hard cap)
    stage_timeout_s: int = 10 * 60     # no stage heartbeat for this long -> kill
    # memory (watched by the server-side supervisor AND an in-driver thread)
    max_memory_mb: int = 0             # 0 -> _default_memory_mb() at from_env()
    # preflight geometry caps (Phase 9)
    max_faces: int = 4_000_000         # ~4M faces: nothing sane comes close
    max_extent_mm: int = 20_000        # 20 m: beyond this the file is corrupt
    # post-operation sanity (in-driver): coordinates beyond this mean an
    # intermediate exploded (a Solidify spike reaches ~10^6 mm) — fail fast
    # before the next operation amplifies it
    guard_max_coord_mm: int = 100_000  # 100 m
    # op budget (Phase 4): wrapped heavy operations per build
    max_ops: int = 1500                # a normal build uses ~100-200
    # Phase 6/7: an identical (op, input geometry, error) may fail this many
    # times before we stop retrying it
    max_repeat_failures: int = 2
    # Phase 3: ladder-level no-progress — the same error class on this many
    # consecutive recovery rungs (same input master) means the recovery
    # variations change nothing; stop. (Upstream tries up to 8 rungs; a model
    # that fails the SAME way on 3 different variations never recovers.)
    max_rung_repeat: int = 3
    # Phase 11 quarantine
    quarantine_dir: str = ""
    quarantine_keep: int = 100

    @classmethod
    def from_env(cls, root=None):
        mem = _env_int("MOLDFORGE_MAX_MEMORY_MB", 0) or _default_memory_mb()
        qdir = os.environ.get("MOLDFORGE_QUARANTINE_DIR", "").strip()
        if not qdir and root:
            qdir = str(root / "quarantine")
        return cls(
            job_timeout_s=_env_int("MOLDFORGE_JOB_TIMEOUT_S", cls.job_timeout_s),
            stage_timeout_s=_env_int("MOLDFORGE_STAGE_TIMEOUT_S", cls.stage_timeout_s),
            max_memory_mb=mem,
            max_faces=_env_int("MOLDFORGE_MAX_FACES", cls.max_faces),
            max_extent_mm=_env_int("MOLDFORGE_MAX_EXTENT_MM", cls.max_extent_mm),
            guard_max_coord_mm=_env_int("MOLDFORGE_GUARD_MAX_COORD_MM",
                                        cls.guard_max_coord_mm),
            max_ops=_env_int("MOLDFORGE_MAX_OPS", cls.max_ops),
            max_repeat_failures=_env_int("MOLDFORGE_MAX_REPEAT_FAILURES",
                                         cls.max_repeat_failures),
            max_rung_repeat=_env_int("MOLDFORGE_MAX_RUNG_REPEAT", cls.max_rung_repeat),
            quarantine_dir=qdir,
            quarantine_keep=_env_int("MOLDFORGE_QUARANTINE_KEEP", cls.quarantine_keep),
        )

    def describe(self):
        return {
            "job_timeout_s": self.job_timeout_s,
            "stage_timeout_s": self.stage_timeout_s,
            "max_memory_mb": self.max_memory_mb,
            "max_faces": self.max_faces,
            "max_extent_mm": self.max_extent_mm,
            "guard_max_coord_mm": self.guard_max_coord_mm,
            "max_ops": self.max_ops,
        }
