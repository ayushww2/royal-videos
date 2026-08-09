import path from "node:path";
import { config } from "../../config.js";
import { loadJob, readJson, writeJson } from "../../storage.js";
import type { JobRecord, RoyalBulkBatch } from "../../../shared/visualIntelligence.js";

function batchPath(batchId: string): string {
  return path.join(config.dataPath, `royal-v2-bulk-batch-${batchId}.json`);
}

export async function saveRoyalV2Batch(batch: RoyalBulkBatch): Promise<void> {
  batch.updatedAt = new Date().toISOString();
  await writeJson(batchPath(batch.batchId), batch);
}

export async function loadRoyalV2Batch(batchId: string): Promise<RoyalBulkBatch | null> {
  return readJson<RoyalBulkBatch>(batchPath(batchId));
}

export async function refreshRoyalV2Batch(batchId?: string): Promise<void> {
  if (!batchId) return;
  const batch = await loadRoyalV2Batch(batchId);
  if (!batch) return;
  const jobs = (await Promise.all(batch.jobIds.map((id) => loadJob(id)))).filter(
    (job): job is JobRecord => Boolean(job),
  );
  const failed = jobs.filter((job) => job.status === "failed").length;
  const review = jobs.filter((job) =>
    ["scene_review_ready", "ready_for_scene_review", "approved", "rendering", "completed"].includes(
      job.status,
    ),
  ).length;
  const completed = jobs.filter((job) => job.status === "completed").length;
  const busy = jobs.some((job) =>
    [
      "queued",
      "script_analysis",
      "beat_breakdown",
      "library_candidate_collection",
      "visual_assignment",
      "repetition_audit",
      "weak_scene_repair",
      "effect_planning",
    ].includes(job.status),
  );
  batch.status =
    completed === jobs.length && jobs.length > 0
      ? "completed"
      : review + failed === jobs.length && jobs.length > 0
        ? failed
          ? "partial_failure"
          : "review_ready"
        : busy
          ? "processing"
          : failed === jobs.length && jobs.length > 0
            ? "failed"
            : "queued";
  batch.jobSummaries = jobs.map((job) => ({
    jobId: job.jobId,
    title: job.title,
    stage: job.status,
    progressPercent: job.progressPercent || 0,
    totalBeats: job.stats?.visualBeats || 0,
    visualsAssigned: job.stats?.finalScenes || 0,
    weakScenes: job.stats?.weakScenes || job.stats?.needsBetterVisualScenes || 0,
    repeatedVisuals: job.stats?.repeatedVisualWarnings || 0,
    rawFootagePercent: job.stats?.rawFootagePercent || 0,
    exactPersonMatches: job.stats?.exactPersonMatches || 0,
    exactPlaceMatches: job.stats?.exactPlaceMatches || 0,
    gptCallsUsed: job.gptCallsUsed || 0,
    estimatedCostUsd: job.estimatedCostUsd || 0,
    renderStatus: job.render?.status || "idle",
  }));
  await saveRoyalV2Batch(batch);
}
