"""Submit models via the HTTP API and print the job outcome — verification
helper for the safety integration.

Usage: python http_check.py <model.stl> ['{"params":"json"}']
"""
import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8000"


def submit(path, params="{}"):
    with open(path, "rb") as f:
        data = f.read()
    boundary = "----mfwcheck"
    name = path.replace("\\", "/").split("/")[-1]
    body = (f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + data + (
        f"\r\n--{boundary}\r\n"
        f'Content-Disposition: form-data; name="params"\r\n\r\n'
        f"{params}\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(
        BASE + "/api/generate", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["job_id"]


def wait(job_id, timeout_s=600):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        with urllib.request.urlopen(f"{BASE}/api/job/{job_id}", timeout=30) as r:
            j = json.load(r)
        if j["status"] in ("done", "error"):
            j["wall_s"] = round(time.time() - t0, 1)
            return j
        time.sleep(1.5)
    return {"status": "client-timeout", "wall_s": round(time.time() - t0, 1)}


if __name__ == "__main__":
    model = sys.argv[1]
    params = sys.argv[2] if len(sys.argv) > 2 else "{}"
    jid = submit(model, params)
    print(f"job {jid} submitted")
    job = wait(jid)
    print(json.dumps({
        "status": job["status"],
        "wall_s": job.get("wall_s"),
        "error_code": job.get("error_code"),
        "peak_rss_mb": job.get("peak_rss_mb"),
        "parts": len((job.get("result") or {}).get("parts", [])),
        "error": (job.get("error") or "")[:160],
    }, ensure_ascii=False, indent=1))
