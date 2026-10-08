"""Process memory monitoring on Windows via ctypes — zero dependencies.

Used in TWO places: inside the Blender process (self-RSS for the in-driver
watchdog and diagnostics) and in the server (polling the child Blender's RSS
for the supervisor kill). Correct 64-bit HANDLE plumbing matters here: the
pseudo-handle from ``GetCurrentProcess()`` is -1 and gets mangled if ctypes
passes it as a default c_int.
"""

import ctypes
import sys
from ctypes import wintypes

_IS_WINDOWS = sys.platform == "win32"

if _IS_WINDOWS:
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

    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [("dwLength", wintypes.DWORD), ("dwMemoryLoad", wintypes.DWORD),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    _psapi = ctypes.WinDLL("psapi")
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    _kernel32.OpenProcess.restype = wintypes.HANDLE
    _kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    _kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    _psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE,
                                            ctypes.POINTER(PMC), wintypes.DWORD]
    _kernel32.GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(MEMORYSTATUSEX)]

    _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    _PROCESS_VM_READ = 0x0010


def rss_bytes(pid=None):
    """Working-set size of a process (self when pid is None), or None."""
    if not _IS_WINDOWS:
        return None
    if pid is None:
        handle = _kernel32.GetCurrentProcess()
        own = False
    else:
        handle = _kernel32.OpenProcess(
            _PROCESS_QUERY_LIMITED_INFORMATION | _PROCESS_VM_READ, False, pid)
        if not handle:
            return None
        own = True
    try:
        pmc = PMC()
        pmc.cb = ctypes.sizeof(PMC)
        if not _psapi.GetProcessMemoryInfo(handle, ctypes.byref(pmc), pmc.cb):
            return None
        return pmc.WorkingSetSize
    finally:
        if own:
            _kernel32.CloseHandle(handle)


def rss_mb(pid=None):
    b = rss_bytes(pid)
    return None if b is None else b / (1024.0 * 1024.0)


def total_physical_mb():
    """Total installed RAM in MB (best-effort; None if unavailable)."""
    if not _IS_WINDOWS:
        try:
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        return int(line.split()[1]) / 1024.0
        except OSError:
            return None
        return None
    stat = MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    if not _kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
        return None
    return stat.ullTotalPhys / (1024.0 * 1024.0)
