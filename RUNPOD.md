# RunPod

This repo uses RunPod for two optional workers. Configure only what you need.

---

# RunPod YouTube raw ingest

Optional Celebrity / Mystery / Space jobs can paste **up to 3 YouTube links** from your channel. Download + 3ΓÇô5s clip extraction runs on a **cloud ingest worker** (RunPod), not on the PC/Railway app host.

## Flow

1. New Job UI submits `userYoutubeRawUrls` (JSON array, max 3).
2. Railway/app queues an ingest item and sets job status `raw_ingest_queued`.
3. App best-effort wakes `RUNPOD_INGEST_POD_ID`.
4. Worker (`npm run runpod:ingest-worker`) claims the job via Bearer `RUNPOD_WORKER_SECRET`.
5. Worker runs yt-dlp ΓåÆ vision sample ΓåÆ ffmpeg 3ΓÇô5s muted clips ΓåÆ R2 `jobs/{jobId}/raw/...`.
6. Worker posts `/complete` (or `/fail`). Soft-fail continues with images only.
7. App starts the normal visual intelligence pipeline. Mix target is **~20%** raw, reduced after analysis when usable yield/quality is weak.

## Pod setup

- Image/volume: Node repo + `yt-dlp` + `ffmpeg` + Chromium not required for ingest.
- Place Netscape cookies at `YT_COOKIES_PATH` (default `/workspace/secrets/youtube-cookies.txt`).
- Do **not** use `--cookies-from-browser` on the pod.
- Env on pod: `APP_BASE_URL` / `PUBLIC_APP_URL`, `RUNPOD_WORKER_SECRET`, `OPENAI_*`, `R2_*`, `YT_COOKIES_PATH`, optional `YTDLP_PROXY`, `RUNPOD_API_KEY`, `RUNPOD_INGEST_POD_ID`.

### Cookies

YouTube session cookies expire ~1ΓÇô2 weeks. Export a Netscape `cookies.txt` from a residential browser session (private window ΓåÆ youtube.com/robots.txt ΓåÆ export ΓåÆ close window) and copy it onto the pod volume. Refresh when downloads start failing with auth/bot errors.

### Proxy

Datacenter IPs are often blocked even with valid cookies. Set `YTDLP_PROXY` to a residential proxy URL when needed:

```bash
YTDLP_PROXY=socks5h://user:pass@host:port
```

### Idle stop

Worker idles after `RAW_INGEST_IDLE_STOP_MS` (default 10 minutes) and attempts to stop the pod via RunPod API so you are not billed 24/7.

## Caps / early exit

- Download height Γëñ 480p.
- Clip length 3ΓÇô5s (default 4s), muted.
- Early-exit once enough usable clip seconds exist for ~20% of the job target duration (buffered).
- Quality floor ~70; weak pools lower `effectiveRawTargetPercent` instead of padding bad clips.

## API (worker)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/raw-ingest/health` | Bearer worker secret |
| POST | `/api/raw-ingest/claim` | Bearer |
| POST | `/api/raw-ingest/:jobId/progress` | Bearer |
| POST | `/api/raw-ingest/:jobId/complete` | Bearer |
| POST | `/api/raw-ingest/:jobId/fail` | Bearer |
| GET | `/api/raw-ingest/:jobId` | App session (status) |

## Local / manual worker

If RunPod wake is not configured, start the worker yourself against the app URL:

```bash
export APP_BASE_URL=https://your-app.example
export RUNPOD_WORKER_SECRET=...
export YT_COOKIES_PATH=/path/to/cookies.txt
npm run runpod:ingest-worker
```

The app host still never runs yt-dlp for this path ΓÇö only the worker does.

---

# On-demand RunPod Remotion renders

You are **billed for GPU/CPU only while the pod is Running** (boot + render). When the queue is empty for `RUNPOD_IDLE_STOP_MINUTES` (default 10), the worker **stops** the pod. Stopped pods do **not** burn compute.

A **network volume** keeps `/workspace` (repo, `node_modules`, Remotion browser/bundle caches) so each wake does not re-download everything. Network volumes have a small storage fee even when stopped ΓÇö that is expected.

Do **not** leave the pod Running 24/7.

## One-time setup (RunPod UI)

### 1. Network volume

1. RunPod console ΓåÆ **Storage** ΓåÆ **Network Volume** ΓåÆ Create.
2. Pick a region you will always deploy in (volume is region-locked).
3. Size: start at **50ΓÇô100 GB** (repo + `node_modules` + Chromium + render temp).
4. Copy the **volume ID** ΓåÆ set `RUNPOD_VOLUME_ID` on Railway.

### 2. First boot: install Remotion on the volume

1. Deploy a temporary GPU/CPU pod **with that network volume mounted at `/workspace`**.
2. SSH / web terminal:

```bash
cd /workspace
git clone <your-repo-url> documentary-video-factory
cd documentary-video-factory
npm ci
# Remotion will download Chromium on first render via ensureBrowser()
```

3. Stop (do not terminate) this pod after install, or terminate it if you will recreate from a template that always attaches the same volume.

### 3. Template (recommended)

1. **Templates** ΓåÆ create from a Node-friendly image (e.g. `runpod/pytorch` or a plain Ubuntu+Node image).
2. Attach the **same network volume** at `/workspace`.
3. Set **Container start command** (adjust path if needed):

```bash
bash -lc 'cd /workspace/documentary-video-factory && npm run runpod:worker'
```

4. Template env (also injectable by API when creating from template):

| Variable | Value |
| --- | --- |
| `APP_BASE_URL` | Your Railway public URL (same as `PUBLIC_APP_URL`) |
| `PUBLIC_APP_URL` | Same |
| `RUNPOD_WORKER_SECRET` | Long random secret (same as Railway) |
| `RUNPOD_API_KEY` | Same key as Railway (for self-stop) |
| `REMOTION_CONCURRENCY` | `8`ΓÇô`16` |
| `RUNPOD_IDLE_STOP_MINUTES` | `10` |
| `STORAGE_PATH` | `/workspace/storage` |
| `RENDERER` | `remotion` (local render on the pod) |

5. Copy **template ID** ΓåÆ `RUNPOD_TEMPLATE_ID` on Railway.

### 4. Preferred: one reusable stopped pod

After the first successful deploy from the template:

1. Note the **pod ID**.
2. Set `RUNPOD_POD_ID` on Railway.
3. Keep the pod **Stopped** when idle. Railway will `POST /pods/{id}/start` when a render is queued, and the worker will stop it again when idle.

Using a fixed `RUNPOD_POD_ID` avoids creating a new pod every time and keeps the volume attached cleanly.

## Railway env

```env
RENDERER=runpod
# or: RUNPOD_RENDER=1

RUNPOD_API_KEY=           # already in your .env ΓÇö do not commit
RUNPOD_WORKER_SECRET=     # generate a long random string; same on pod template
PUBLIC_APP_URL=https://your-app.up.railway.app

# Prefer a stopped reusable pod:
RUNPOD_POD_ID=

# Fallback if the pod was terminated ΓÇö recreate from template:
RUNPOD_TEMPLATE_ID=
RUNPOD_VOLUME_ID=
RUNPOD_GPU_TYPE=NVIDIA GeForce RTX 4090
# Optional cheaper CPU pods:
# RUNPOD_COMPUTE_TYPE=CPU
# RUNPOD_CPU_FLAVOR=cpu3g

RUNPOD_IDLE_STOP_MINUTES=10
RUNPOD_REMOTION_CONCURRENCY=8
```

## Flow

1. Dashboard **Render** with `RENDERER=runpod`.
2. Railway builds Remotion `inputProps` (public HTTPS media via `PUBLIC_APP_URL` / R2), sets job `render_queued`, and **starts** the stopped pod (or creates from template).
3. Pod worker polls `POST /api/render-queue/claim` with `Authorization: Bearer $RUNPOD_WORKER_SECRET`.
4. Worker renders with Remotion, uploads `final.mp4` to `POST /api/render-queue/:jobId/complete`.
5. Dashboard plays `/media/renders/{jobId}/final.mp4`.
6. After idle timeout with an empty queue, worker stops the pod ΓåÆ **compute billing stops**.

## Local smoke (optional)

```bash
# On a machine with the repo + Remotion deps (or on the pod):
export APP_BASE_URL=https://your-app.up.railway.app
export RUNPOD_WORKER_SECRET=...
export REMOTION_CONCURRENCY=4
npm run runpod:worker
```

## Billing notes

| Item | When charged |
| --- | --- |
| Pod compute | Only while **Running** (boot + render + idle grace) |
| Network volume | Small ongoing storage fee |
| Stopped pod | No GPU/CPU compute |

Local Remotion and Remotion Lambda paths are unchanged (`RENDERER=remotion` / `remotion-lambda`).
