import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { jobDataFile, listJobs, readJson, writeJson } from "../storage.js";
import type { ApprovedVisual, TimelineScene } from "../../shared/visualIntelligence.js";
import { mediaKind } from "./mediaKind.js";

type AssignmentFile = { scenes?: TimelineScene[] } & Record<string, unknown>;

function visualFor(scene: TimelineScene, library: Map<string, ApprovedVisual>): ApprovedVisual | undefined {
  return library.get(scene.approvedVisualId || "") || library.get(scene.selectedVisualId || "");
}

/** Image stills that the review UI would still mount in a video element. */
export function imageScenesFlaggedAsRaw(
  scenes: TimelineScene[],
  library: Map<string, ApprovedVisual>
): string[] {
  const ids: string[] = [];
  for (const scene of scenes) {
    if (scene.rawFootageUsed !== true) continue;
    const visual = visualFor(scene, library);
    const kind = mediaKind({
      source: scene.source || visual?.source,
      mediaType: visual?.mediaType,
      url: visual?.filePathOrUrl || visual?.thumbnail,
    });
    if (kind === "image") ids.push(scene.sceneId);
  }
  return ids;
}

async function loadLibrary(jobId: string): Promise<Map<string, ApprovedVisual>> {
  const doc = await readJson<{ approved?: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", jobId)
  );
  return new Map((doc?.approved || []).map((item) => [item.approvedVisualId, item]));
}

function clearFlag(scenes: TimelineScene[], sceneIds: Set<string>): TimelineScene[] {
  return scenes.map((scene) =>
    sceneIds.has(scene.sceneId) ? { ...scene, rawFootageUsed: false } : scene
  );
}

export async function repairImageRawFlags(apply: boolean): Promise<{
  apply: boolean;
  backupDir?: string;
  jobs: Array<{ jobId: string; title?: string; scenes: string[] }>;
  sceneCount: number;
}> {
  const jobs = await listJobs();
  const hits: Array<{ jobId: string; title?: string; scenes: string[] }> = [];
  for (const job of jobs) {
    const assignment = await readJson<AssignmentFile>(
      jobDataFile("visual-intelligence-final-assignment", job.jobId)
    );
    const scenes = assignment?.scenes || [];
    if (!scenes.length) continue;
    const library = await loadLibrary(job.jobId);
    const sceneIds = imageScenesFlaggedAsRaw(scenes, library);
    if (sceneIds.length) hits.push({ jobId: job.jobId, title: job.title, scenes: sceneIds });
  }

  if (!apply || !hits.length) {
    return {
      apply,
      jobs: hits,
      sceneCount: hits.reduce((sum, item) => sum + item.scenes.length, 0),
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(config.dataPath, "backups", "image-raw-flag", stamp);
  await fs.mkdir(backupDir, { recursive: true });

  for (const hit of hits) {
    const jobDir = path.join(backupDir, hit.jobId);
    await fs.mkdir(jobDir, { recursive: true });
    const files = [
      jobDataFile("visual-intelligence-final-assignment", hit.jobId),
      jobDataFile("royal-v2-final-assignment", hit.jobId),
      jobDataFile("visual-intelligence-approved-library", hit.jobId),
      path.join(config.storagePath, "jobs", hit.jobId, "job.json"),
    ];
    for (const filePath of files) {
      try {
        await fs.copyFile(filePath, path.join(jobDir, path.basename(filePath)));
      } catch {
        /* royal copy is optional */
      }
    }
    const sceneIds = new Set(hit.scenes);
    for (const name of ["visual-intelligence-final-assignment", "royal-v2-final-assignment"] as const) {
      const filePath = jobDataFile(name, hit.jobId);
      const doc = await readJson<AssignmentFile>(filePath);
      if (!doc?.scenes) continue;
      await writeJson(filePath, { ...doc, scenes: clearFlag(doc.scenes, sceneIds) });
    }
  }

  return {
    apply: true,
    backupDir,
    jobs: hits,
    sceneCount: hits.reduce((sum, item) => sum + item.scenes.length, 0),
  };
}
