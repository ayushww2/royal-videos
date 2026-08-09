/**
 * Royal v2 queue — thin wrapper over the global pipeline concurrency gate.
 * Keeps batch bookkeeping; actual parallel limit is PIPELINE_WORKER_CONCURRENCY.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { listJobs, loadJob, readJson, saveJob } from "../../storage.js";
import {
  enqueuePipelineJob,
  pipelineQueueSnapshot,
  pipelineWorkerConcurrency,
} from "../pipelineQueue.js";
import {
  loadRoyalV2Batch,
  refreshRoyalV2Batch,
  saveRoyalV2Batch,
} from "./batchStore.js";
import type { RoyalBulkBatch } from "../../../shared/visualIntelligence.js";

export { loadRoyalV2Batch, saveRoyalV2Batch, refreshRoyalV2Batch };

export function royalV2WorkerConcurrency(): number {
  return pipelineWorkerConcurrency();
}

export async function listRoyalV2Batches(): Promise<RoyalBulkBatch[]> {
  try {
    const names = await fs.readdir(config.dataPath);
    const batches = await Promise.all(
      names
        .filter((name) => /^royal-v2-bulk-batch-.*\.json$/.test(name))
        .map((name) => readJson<RoyalBulkBatch>(path.join(config.dataPath, name))),
    );
    return batches
      .filter((batch): batch is RoyalBulkBatch => Boolean(batch))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function enqueueRoyalV2Job(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job || job.niche !== "Royal v2") throw new Error("Cannot queue non-Royal-v2 job");
  if (
    ["scene_review_ready", "ready_for_scene_review", "approved", "completed", "rendering"].includes(
      job.status,
    )
  ) {
    return;
  }
  job.status = "queued";
  job.progressPercent = 0;
  job.error = undefined;
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  await refreshRoyalV2Batch(job.batchId);
  await enqueuePipelineJob(jobId);
}

export async function resumeRoyalV2Queue(): Promise<void> {
  const jobs = await listJobs();
  const resumable = jobs.filter(
    (job) =>
      job.niche === "Royal v2" &&
      ![
        "scene_review_ready",
        "ready_for_scene_review",
        "approved",
        "rendering",
        "completed",
        "failed",
      ].includes(job.status),
  );
  for (const job of resumable) await enqueueRoyalV2Job(job.jobId);
}

export function royalV2QueueSnapshot(): { queued: number; running: number; concurrency: number } {
  const snap = pipelineQueueSnapshot();
  return { queued: snap.queued, running: snap.running, concurrency: snap.concurrency };
}
