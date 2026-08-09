import crypto from "node:crypto";
import { jobDataFile, loadJob, readJson, saveJob, writeJson } from "../../storage.js";
import type { RoyalRepetitionViolation, TimelineScene } from "../../../shared/visualIntelligence.js";

export function royalTimelineHash(scenes: TimelineScene[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(scenes)).digest("hex");
}

export async function lockRoyalV2Timeline(
  jobId: string,
  lockedBy = "manager"
): Promise<{ hash: string; sceneCount: number; lockedAt: string }> {
  const job = await loadJob(jobId);
  if (!job || job.niche !== "Royal v2") throw new Error("Royal v2 job not found");
  const assignment = await readJson<{ scenes: TimelineScene[] }>(
    jobDataFile("visual-intelligence-final-assignment", jobId)
  );
  const scenes = assignment?.scenes || [];
  if (!scenes.length) throw new Error("No final timeline to lock");
  const approvals = job.sceneApprovals || {};
  const unapproved = scenes.filter((scene) => approvals[scene.sceneId] !== "approved");
  if (unapproved.length) throw new Error(`${unapproved.length} scenes still require approval`);
  if (scenes.some((scene) => !scene.selectedVisualId || !scene.approvedVisualId)) {
    throw new Error("Every scene must have an approved visual before locking");
  }
  const audit = await readJson<{ violations?: RoyalRepetitionViolation[] }>(
    jobDataFile("royal-v2-repetition-audit", jobId)
  );
  const blocked = (audit?.violations || []).filter((item) => item.severity === "blocked");
  if (blocked.length) throw new Error(`${blocked.length} blocked repetition violations must be repaired`);
  const qa = await readJson<{ canRender?: boolean; criticalIssues?: string[] }>(
    jobDataFile("visual-intelligence-final-qa", jobId)
  );
  if (qa?.canRender === false) {
    throw new Error(`Final QA blocks locking: ${(qa.criticalIssues || []).join("; ")}`);
  }

  const hash = royalTimelineHash(scenes);
  const lockedAt = new Date().toISOString();
  await writeJson(jobDataFile("final-timeline", jobId), {
    jobId,
    locked: true,
    hash,
    lockedAt,
    lockedBy,
    scenes,
  });
  const summary =
    (await readJson<Record<string, unknown>>(jobDataFile("royal-v2-manager-summary", jobId))) || {};
  await writeJson(jobDataFile("royal-v2-manager-summary", jobId), {
    ...summary,
    managerApprovals: scenes.length,
    renderReadiness: true,
    timelineLocked: true,
    timelineHash: hash,
    lockedAt,
  });
  job.timelineLock = { locked: true, hash, lockedAt, lockedBy, sceneCount: scenes.length };
  job.status = "approved";
  job.updatedAt = lockedAt;
  await saveJob(job);
  return { hash, sceneCount: scenes.length, lockedAt };
}

export async function unlockRoyalV2Timeline(jobId: string, unlockedBy = "manager"): Promise<void> {
  const job = await loadJob(jobId);
  if (!job || job.niche !== "Royal v2") throw new Error("Royal v2 job not found");
  await writeJson(jobDataFile("final-timeline", jobId), {
    jobId,
    locked: false,
    previousLock: job.timelineLock,
    unlockedAt: new Date().toISOString(),
    unlockedBy,
  });
  job.timelineLock = undefined;
  job.status = "scene_review_ready";
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
}

export async function loadVerifiedRoyalV2Timeline(jobId: string): Promise<TimelineScene[]> {
  const job = await loadJob(jobId);
  if (!job || job.niche !== "Royal v2") throw new Error("Royal v2 job not found");
  if (!job.timelineLock?.locked) throw new Error("Royal v2 timeline must be locked before rendering");
  const locked = await readJson<{ locked?: boolean; hash?: string; scenes?: TimelineScene[] }>(
    jobDataFile("final-timeline", jobId)
  );
  if (!locked?.locked || !locked.scenes?.length) throw new Error("Locked Royal v2 timeline file is missing");
  const hash = royalTimelineHash(locked.scenes);
  if (hash !== locked.hash || hash !== job.timelineLock.hash) {
    throw new Error("Royal v2 timeline changed after approval; unlock and review it again");
  }
  return locked.scenes;
}

