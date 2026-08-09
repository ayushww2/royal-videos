"""
RunPod Serverless handler for Remotion final renders.

One job per worker (default RunPod queue worker — no concurrent handler).
Receives { jobId, compositionId, inputProps? } or fetches props from the app.
Uploads MP4 to R2 when credentials are present; otherwise POSTs back to Railway.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

import runpod

APP_ROOT = Path(__file__).resolve().parent.parent
RENDER_SCRIPT = APP_ROOT / "scripts" / "runpod-serverless-render.ts"


def _progress(job: dict, message: str) -> None:
    try:
        runpod.serverless.progress_update(job, message)
    except Exception:
        pass


def handler(job: dict):
    job_input = job.get("input") or {}
    if not isinstance(job_input, dict):
        return {"error": "input must be an object"}

    job_id = str(job_input.get("jobId") or "").strip()
    if not job_id:
        return {"error": "Missing jobId"}

    work_dir = Path(tempfile.mkdtemp(prefix=f"rp-render-{job_id}-"))
    input_path = work_dir / "input.json"
    output_path = work_dir / "final.mp4"
    result_path = work_dir / "result.json"

    payload = {
        "jobId": job_id,
        "compositionId": job_input.get("compositionId") or "DocumentaryEdit",
        "inputProps": job_input.get("inputProps"),
        "propsUrl": job_input.get("propsUrl"),
        "appBaseUrl": job_input.get("appBaseUrl")
        or os.environ.get("APP_BASE_URL")
        or os.environ.get("PUBLIC_APP_URL"),
        "workerSecret": job_input.get("workerSecret")
        or os.environ.get("RUNPOD_WORKER_SECRET"),
        "outputPath": str(output_path),
        "resultPath": str(result_path),
        "smoke": bool(job_input.get("smoke")),
    }
    input_path.write_text(json.dumps(payload), encoding="utf-8")

    _progress(job, f"Starting Remotion render for {job_id}")

    env = os.environ.copy()
    env["RENDERER"] = "remotion"
    env["REMOTION_LAMBDA"] = "0"
    env["RUNPOD_RENDER"] = "0"
    env.setdefault("NODE_ENV", "production")
    env.setdefault("STORAGE_PATH", "/app/storage")
    # Cap concurrency to avoid OOM on short Serverless workers.
    try:
        conc = int(
            os.environ.get("RUNPOD_REMOTION_CONCURRENCY")
            or os.environ.get("REMOTION_CONCURRENCY")
            or "4"
        )
    except ValueError:
        conc = 4
    env["REMOTION_CONCURRENCY"] = str(max(1, min(conc, 8)))

    cmd = [
        "npx",
        "tsx",
        str(RENDER_SCRIPT),
        "--input",
        str(input_path),
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(APP_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            print(line, flush=True)
            if line.startswith("PROGRESS "):
                try:
                    pct = float(line.split(" ", 1)[1])
                    _progress(job, f"Rendering {int(pct * 100)}%")
                except Exception:
                    pass
            elif line.startswith("STATUS "):
                _progress(job, line[7:].strip())

        code = proc.wait()
        if code != 0:
            return {
                "error": f"Render process exited with code {code}",
                "jobId": job_id,
            }

        if not result_path.exists():
            return {"error": "Render finished but result.json missing", "jobId": job_id}

        result = json.loads(result_path.read_text(encoding="utf-8"))
        result["refresh_worker"] = True
        _progress(job, "Render complete")
        return result
    except Exception as exc:
        traceback.print_exc()
        return {"error": str(exc), "jobId": job_id}
    finally:
        # Keep artifacts only if debug requested; otherwise temp dir is fine to leave
        # (worker disk is ephemeral). Prefer cleanup to save space.
        try:
            for p in work_dir.glob("*"):
                try:
                    p.unlink()
                except Exception:
                    pass
            work_dir.rmdir()
        except Exception:
            pass


if __name__ == "__main__":
    print("[serverless] starting RunPod Remotion handler", flush=True)
    runpod.serverless.start({"handler": handler})
