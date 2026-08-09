import type { JobRecord } from "../../../shared/visualIntelligence.js";

/**
 * Mystery v1 now uses the shared documentary DIRECTOR pipeline
 * (title lock → visual map → director queries → collect → judge → cut → soft repair).
 */
export async function runMysteryV1Pipeline(jobId: string): Promise<JobRecord> {
  const { runDirectorPipeline } = await import("../director/directorPipeline.js");
  return runDirectorPipeline(jobId);
}
