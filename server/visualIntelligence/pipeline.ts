import { runDirectorPipeline } from "./director/directorPipeline.js";
import { runRoyalV2Pipeline } from "./royalV2/pipeline.js";
import { loadJob, readJson, jobDataFile } from "../storage.js";
import type { JobRecord, TimelineScene } from "../../shared/visualIntelligence.js";

/**
 * Visual intelligence entry:
 * - Celebrity / Mystery / Space → shared documentary DIRECTOR pipeline
 * - Royal v2 → library-first royal pipeline
 */
export async function runVisualIntelligencePipeline(jobId: string): Promise<JobRecord> {
  const job = await loadJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  if (job.niche === "Royal v2") {
    return runRoyalV2Pipeline(jobId);
  }

  // Celebrity v1, Mystery v1, Space v1, War v1, Royal v1 → AI director brain
  return runDirectorPipeline(jobId);
}

export async function loadScenes(jobId: string): Promise<TimelineScene[]> {
  const data = await readJson<{ scenes: TimelineScene[] }>(
    jobDataFile("visual-intelligence-final-assignment", jobId)
  );
  return data?.scenes || [];
}
