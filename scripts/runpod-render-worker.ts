/**
 * On-demand RunPod Remotion worker.
 *
 * Polls Railway for queued jobs, renders locally with high concurrency,
 * uploads final.mp4, then stops the pod after idle timeout (compute $0 when stopped).
 *
 * Env (pod / template):
 *   APP_BASE_URL or PUBLIC_APP_URL  — Railway app origin
 *   RUNPOD_WORKER_SECRET            — shared with Railway
 *   RUNPOD_API_KEY                  — for self-stop (optional if Railway stop-idle is used)
 *   RUNPOD_POD_ID                   — set automatically by RunPod on the pod
 *   REMOTION_CONCURRENCY            — e.g. 8–16
 *   RUNPOD_IDLE_STOP_MINUTES        — default 10
 *   STORAGE_PATH                    — prefer /workspace/storage (network volume)
 */
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

// Force local Remotion path on the pod (never Lambda / never re-queue to RunPod).
process.env.REMOTION_LAMBDA = "0";
if ((process.env.RENDERER || "").toLowerCase() === "runpod") {
  process.env.RENDERER = "remotion";
}

const APP_BASE = (
  process.env.APP_BASE_URL ||
  process.env.PUBLIC_APP_URL ||
  ""
).replace(/\/$/, "");
const SECRET = process.env.RUNPOD_WORKER_SECRET?.trim() || "";
const POLL_MS = Number(process.env.RUNPOD_POLL_MS || "5000") || 5000;
const IDLE_STOP_MINUTES = Number(process.env.RUNPOD_IDLE_STOP_MINUTES || "10") || 10;

if (!APP_BASE) {
  console.error("[runpod-worker] Set APP_BASE_URL or PUBLIC_APP_URL to the Railway app origin");
  process.exit(1);
}
if (!SECRET) {
  console.error("[runpod-worker] Set RUNPOD_WORKER_SECRET");
  process.exit(1);
}

type ClaimedJob = {
  jobId: string;
  compositionId: string;
  inputProps: Record<string, unknown>;
};

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${SECRET}`,
    ...extra,
  };
}

async function apiJson<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(`${APP_BASE}${pathname}`, {
    method,
    headers: authHeaders(body !== undefined ? { "Content-Type": "application/json" } : undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${pathname} → ${res.status}: ${typeof json === "object" && json && "error" in json ? String((json as { error: unknown }).error) : text.slice(0, 300)}`
    );
  }
  return json as T;
}

async function claimJob(): Promise<ClaimedJob | null> {
  const data = await apiJson<{ ok: boolean; job: ClaimedJob | null }>(
    "POST",
    "/api/render-queue/claim"
  );
  return data.job || null;
}

async function queueSnapshot(): Promise<{ queued: number; rendering: number }> {
  const data = await apiJson<{ queued: number; rendering: number }>("GET", "/api/render-queue");
  return { queued: data.queued || 0, rendering: data.rendering || 0 };
}

async function reportProgress(jobId: string, progress: number): Promise<void> {
  try {
    await apiJson("POST", `/api/render-queue/${jobId}/progress`, { progress });
  } catch {
    // non-fatal
  }
}

async function failJob(jobId: string, error: string): Promise<void> {
  await apiJson("POST", `/api/render-queue/${jobId}/fail`, { error });
}

/**
 * Upload final.mp4 Pod → R2 directly (never through Railway multipart).
 * Railway only receives a tiny complete-url JSON afterward.
 */
async function uploadComplete(
  jobId: string,
  filePath: string,
  durationInFrames?: number
): Promise<void> {
  const { r2Configured, r2UploadFileFromPath, mediaLibraryPublicBase } = await import(
    "../server/library/r2.js"
  );
  if (!r2Configured()) {
    throw new Error("R2 not configured on pod — cannot upload final.mp4 without Railway multipart");
  }
  const r2Key = `renders/${jobId}/final.mp4`;
  console.log(`[runpod-worker] uploading ${jobId} → R2 ${r2Key} (direct, no Railway)`);
  await r2UploadFileFromPath({
    key: r2Key,
    filePath,
    contentType: "video/mp4",
    metadata: { jobId, renderer: "runpod" },
  });
  const publicBase = mediaLibraryPublicBase()?.replace(/\/$/, "");
  if (!publicBase) {
    throw new Error("R2_PUBLIC_URL missing — cannot build outputUrl");
  }
  const outputUrl = `${publicBase}/${r2Key}`;
  await apiJson("POST", `/api/render-queue/${jobId}/complete-url`, {
    outputUrl,
    r2Key,
    durationInFrames,
  });
}

async function stopIdleViaApp(): Promise<boolean> {
  try {
    const data = await apiJson<{ stopped?: boolean }>("POST", "/api/render-queue/stop-idle");
    return Boolean(data.stopped);
  } catch (err) {
    console.warn(
      "[runpod-worker] stop-idle via app failed:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

async function stopSelfViaRunpodApi(): Promise<boolean> {
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  const podId = process.env.RUNPOD_POD_ID?.trim();
  if (!apiKey || !podId) return false;
  const res = await fetch(`https://rest.runpod.io/v1/pods/${podId}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RunPod stop failed (${res.status}): ${text.slice(0, 300)}`);
  }
  console.log(`[runpod-worker] stopped pod ${podId}`);
  return true;
}

async function renderClaimed(job: ClaimedJob): Promise<void> {
  const { renderRemotionMp4 } = await import("../server/render/remotionRender.js");
  const { config } = await import("../server/config.js");

  const outDir = path.join(config.storagePath, "renders", job.jobId);
  await fs.mkdir(outDir, { recursive: true });
  const outputPath = path.join(outDir, "final.mp4");

  console.log(`[runpod-worker] rendering ${job.jobId} → ${outputPath}`);
  let lastPct = -1;
  const result = await renderRemotionMp4({
    jobId: job.jobId,
    outputPath,
    inputProps: job.inputProps as Parameters<typeof renderRemotionMp4>[0]["inputProps"],
    onProgress: (progress) => {
      const pct = Math.round(progress * 100);
      if (pct >= lastPct + 5 || pct === 100) {
        lastPct = pct;
        console.log(`[runpod-worker] ${job.jobId} ${pct}%`);
        void reportProgress(job.jobId, progress);
      }
    },
  });

  await uploadComplete(job.jobId, result.outputPath, result.durationInFrames);
  console.log(`[runpod-worker] uploaded ${job.jobId}`);
}

async function main(): Promise<void> {
  console.log(
    `[runpod-worker] started app=${APP_BASE} idleStop=${IDLE_STOP_MINUTES}m concurrency=${process.env.REMOTION_CONCURRENCY || "1"}`
  );

  let lastWorkAt = Date.now();

  for (;;) {
    try {
      const job = await claimJob();
      if (job) {
        lastWorkAt = Date.now();
        try {
          await renderClaimed(job);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[runpod-worker] job ${job.jobId} failed:`, message);
          await failJob(job.jobId, message);
        }
        lastWorkAt = Date.now();
        continue;
      }

      const idleMs = Date.now() - lastWorkAt;
      const idleMinutes = idleMs / 60_000;
      if (idleMinutes >= IDLE_STOP_MINUTES) {
        const snap = await queueSnapshot();
        if (snap.queued === 0 && snap.rendering === 0) {
          console.log(
            `[runpod-worker] idle ${idleMinutes.toFixed(1)}m — stopping pod (queue empty)`
          );
          const stopped = (await stopIdleViaApp()) || (await stopSelfViaRunpodApi());
          if (stopped) {
            console.log("[runpod-worker] exit after idle stop");
            process.exit(0);
          }
          // If stop failed, wait longer before retrying stop.
          lastWorkAt = Date.now() - (IDLE_STOP_MINUTES - 1) * 60_000;
        } else {
          lastWorkAt = Date.now();
        }
      }
    } catch (err) {
      console.error("[runpod-worker] loop error:", err instanceof Error ? err.message : err);
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error("[runpod-worker] fatal:", err);
  process.exit(1);
});
