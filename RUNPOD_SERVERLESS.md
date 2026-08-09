# RunPod Serverless Remotion

Preferred path for **ASAP** final MP4 renders. Default is **scale-to-zero** (`workersMin=0`, `workersMax=1`) to avoid idle GPU burn. **1 job = 1 worker** (default queue worker; no concurrent handler packing).

**Cost warning:** `workersMin=1` (warm) costs **~$0.68/hr** even with no jobs. Only raise min temporarily for ASAP pickup, then set back to `0`.

Pod path (`RUNPOD.md`) remains the fallback when `RUNPOD_SERVERLESS_ENDPOINT_ID` is unset.

## Images-only harden (default ON)

`REMOTION_IMAGES_ONLY=1` (default unless set to `0`/`false`):

1. Scene `videoUrl` demoted to still (`thumbnail` / library still)
2. All HTTPS scene/effect/VO assets mirrored to **R2** before queue
3. Preflight fails the queue if any non-R2 host remains, coverage &lt;95%, or VO/timeline mismatch
4. Override with `force=true` only for emergencies

This is the stable path for 25–30 min renders under ~$1.

## Cost (RTX 3090 serverless)

Official RunPod 24 GB tier (L4 / A5000 / **3090**): **~$0.00019 / second** ≈ **$0.68 / hour** while a worker is running.

| Scenario | GPU bill (approx) |
| --- | --- |
| Idle (`workersMin=0`, default) | **$0** (scale to zero; cold start on next Render) |
| Idle (`workersMin=1`, 1x warm GPU) | **~$0.68/hr** — do not leave on |
| Per minute GPU | **~$0.011** |
| ~5 min documentary cut (warm, ~6–10 min GPU incl. encode) | **~$0.07–$0.12** |
| ~20 min cut (warm, ~15–35 min GPU) | **~$0.17–$0.40** |
| Cold start add-on (first wake after idle) | often **+$0.02–$0.10** (1–8 min wall depending on image pull) |

FlashBoot is enabled on the endpoint to shorten cold starts after prior use.

## Time estimates

| Phase | Estimate |
| --- | --- |
| Cold start (scale from 0, first image pull) | **2–8 min** |
| Cold start with FlashBoot / warm cache | **30–90 s** |
| Warm worker pickup | **~1–10 s** |
| 5 min cut render (RTX 3090, concurrency 8) | **~5–12 min** GPU |
| 20 min cut render | **~15–40 min** GPU |

## App flow (Render button)

1. Job Status / Timeline **Render** → `POST /api/jobs/:jobId/render`
2. Railway builds `inputProps`, writes props files, sets `render_queued`
3. If `RUNPOD_SERVERLESS_ENDPOINT_ID` set → `POST https://api.runpod.ai/v2/{endpoint}/run`
4. Worker runs Remotion → uploads MP4 to **R2** → `POST /api/render-queue/:jobId/complete-url`
5. Job Status `<video>` plays `job.render.outputUrl` (R2 public URL)
6. If serverless env missing → existing **Pod** start/claim path

## Railway env

`workersMin` / `workersMax` are **RunPod endpoint** settings (not Railway vars). Keep **`workersMin=0`** on endpoint `x002w2cpc23m38` unless actively rendering ASAP — **`workersMin=1` (warm) costs ~$0.68/hr** even with no jobs.

```env
RENDERER=runpod
RUNPOD_API_KEY=
RUNPOD_WORKER_SECRET=
RUNPOD_SERVERLESS_ENDPOINT_ID=
PUBLIC_APP_URL=https://web-production-a65b9.up.railway.app
# R2_* required for worker upload + playback
# Pod fallback (optional when serverless set):
# RUNPOD_POD_ID=
```

## Deploy / update endpoint

```bash
# 1) Build+push image (GitHub Actions → GHCR)
gh workflow run runpod-serverless-image.yml

# 2) Create/update template + endpoint (uses .env RUNPOD_API_KEY)
npx tsx scripts/deploy-runpod-serverless.ts
```

Endpoint settings created by the script:

- GPU: `NVIDIA GeForce RTX 3090`
- `workersMin=0`, `workersMax=1` (scale-to-zero by default; **warm=`workersMin=1` costs ~$0.68/hr** — only raise min temporarily for ASAP)
- `executionTimeoutMs=7200000` (2h)
- `flashboot=true`
- `scalerType=REQUEST_COUNT`, `scalerValue=1` → one pending job spins one worker

## Smoke

```bash
npx tsx scripts/smoke-runpod-serverless.ts
# live (billable):
npx tsx scripts/smoke-runpod-serverless.ts --live
# or Actions (registers short-lived GHCR auth):
gh workflow run runpod-serverless-smoke.yml
```

Dry-validates endpoint exists; `--live` submits a tiny smoke job (billable).

## Critical: GHCR must be pullable by RunPod

Image: `ghcr.io/ayushww2/new-video-ai-remotion-serverless:latest`

RunPod workers **cannot** pull a private GHCR package without registry auth. Do one of:

1. **Recommended:** Package settings → change visibility to **Public**  
   https://github.com/users/ayushww2/packages/container/package/new-video-ai-remotion-serverless/settings  
2. Or create a GitHub PAT (`read:packages`), then RunPod → Container Registry Auth → attach to the serverless template (`containerRegistryAuthId`).

Until then, jobs stay `IN_QUEUE` with workers stuck `initializing`.
