import { enqueuePipelineJob } from "../visualIntelligence/pipelineQueue.js";
import { loadJob } from "../storage.js";

/**
 * After cloud YouTube ingest finishes (ready or soft-failed), start the normal VI pipeline.
 */
export async function startPipelineAfterIngest(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) {
    console.warn(`[raw-ingest] cannot start pipeline — job missing ${jobId}`);
    return;
  }
  if (job.niche === "Royal v2") {
    console.warn(`[raw-ingest] skipping pipeline kick for Royal v2 job ${jobId}`);
    return;
  }
  console.log(
    `[raw-ingest] queueing VI pipeline for ${jobId} (rawIngestStatus=${job.rawIngestStatus})`,
  );
  void enqueuePipelineJob(jobId).catch((err) => {
    console.error("Pipeline queue failed after raw ingest", jobId, err);
  });
}
