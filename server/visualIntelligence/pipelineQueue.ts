/**
 * Global visual-intelligence concurrency gate.
 * All niches share one pool so 5–6 submits don't stampede OpenAI / Railway RAM.
 *
 * Env:
 *   PIPELINE_WORKER_CONCURRENCY — default 4, clamp 1–6
 *   (falls back to ROYAL_V2_WORKER_CONCURRENCY if unset)
 */
import { loadJob, listJobs, saveJob } from "../storage.js";
import { runVisualIntelligencePipeline } from "./pipeline.js";
import { refreshRoyalV2Batch } from "./royalV2/batchStore.js";

const pending: string[] = [];
const queued = new Set<string>();
const active = new Set<string>();
let running = 0;

export function pipelineWorkerConcurrency(): number {
  const raw =
    process.env.PIPELINE_WORKER_CONCURRENCY ||
    process.env.ROYAL_V2_WORKER_CONCURRENCY ||
    "4";
  const value = Number(raw);
  return Math.max(1, Math.min(6, Number.isFinite(value) ? Math.floor(value) : 4));
}

const DONE = new Set([
  "scene_review_ready",
  "ready_for_scene_review",
  "approved",
  "completed",
  "rendering",
  "render_queued",
]);

async function runNext(): Promise<void> {
  while (running < pipelineWorkerConcurrency() && pending.length) {
    const jobId = pending.shift()!;
    queued.delete(jobId);
    active.add(jobId);
    running += 1;
    void (async () => {
      let batchId: string | undefined;
      try {
        const job = await loadJob(jobId);
        batchId = job?.batchId;
        if (!job) return;
        if (DONE.has(job.status)) return;
        await refreshRoyalV2Batch(batchId);
        await runVisualIntelligencePipeline(jobId);
      } catch (error) {
        console.error(`[pipeline-queue] ${jobId} failed`, error);
        try {
          const job = await loadJob(jobId);
          if (job && !DONE.has(job.status) && job.status !== "failed") {
            job.status = "failed";
            job.error = error instanceof Error ? error.message : String(error);
            job.updatedAt = new Date().toISOString();
            await saveJob(job);
          }
        } catch {
          /* ignore */
        }
      } finally {
        active.delete(jobId);
        running -= 1;
        await refreshRoyalV2Batch(batchId);
        void runNext();
      }
    })();
  }
}

/**
 * Queue a job for visual intelligence. Safe for every niche.
 * Caps parallel brain work (GPT / Whisper / library) across the whole app.
 */
export async function enqueuePipelineJob(
  jobId: string,
  opts?: { force?: boolean }
): Promise<void> {
  if (opts?.force) {
    // Force-retry must not get stuck behind a zombie active/queued flag after deploy.
    if (active.has(jobId)) {
      console.warn(`[pipeline-queue] force clear active flag for ${jobId}`);
      active.delete(jobId);
      running = Math.max(0, running - 1);
    }
    if (queued.has(jobId)) {
      queued.delete(jobId);
      const idx = pending.indexOf(jobId);
      if (idx >= 0) pending.splice(idx, 1);
    }
  } else if (active.has(jobId)) {
    console.warn(`[pipeline-queue] skip enqueue — already active ${jobId}`);
    return;
  } else if (queued.has(jobId)) {
    console.warn(`[pipeline-queue] clearing stuck queued flag for ${jobId}`);
    queued.delete(jobId);
    const idx = pending.indexOf(jobId);
    if (idx >= 0) pending.splice(idx, 1);
  }

  const job = await loadJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (!opts?.force && DONE.has(job.status)) {
    console.warn(`[pipeline-queue] skip enqueue — terminal status ${job.status} ${jobId}`);
    return;
  }

  job.status = "queued";
  job.progressPercent = job.progressPercent || 0;
  job.error = undefined;
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  queued.add(jobId);
  pending.push(jobId);
  console.log(
    `[pipeline-queue] enqueued ${jobId} force=${Boolean(opts?.force)} pending=${pending.length} running=${running}/${pipelineWorkerConcurrency()}`
  );
  void runNext();
}

export async function resumePipelineQueue(): Promise<void> {
  const jobs = await listJobs();
  for (const job of jobs) {
    if (DONE.has(job.status) || job.status === "failed") continue;
    if (job.status === "raw_ingest_queued") continue;
    if (job.rawIngestStatus === "ingesting") continue;
    await enqueuePipelineJob(job.jobId);
  }
}

export function pipelineQueueSnapshot(): {
  queued: number;
  running: number;
  concurrency: number;
  activeJobIds: string[];
} {
  return {
    queued: pending.length,
    running,
    concurrency: pipelineWorkerConcurrency(),
    activeJobIds: [...active],
  };
}
