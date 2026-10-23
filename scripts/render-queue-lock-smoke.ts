/**
 * Local-only check for finalize-on-lock. Uses a temp directory, never production storage.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "rv-lock-"));
process.env.STORAGE_PATH = path.join(root, "storage");
process.env.DATA_PATH = path.join(root, "data");

const { saveJob } = await import("../server/storage.js");
const { lockRoyalV2Timeline, unlockRoyalV2Timeline } = await import(
  "../server/visualIntelligence/royalV2/lock.js"
);
const { writeJson, jobDataFile, loadJob } = await import("../server/storage.js");

const jobId = "fixture-finalize-lock";
await saveJob({
  jobId,
  title: "Fixture finalize",
  niche: "Royal v3",
  script: "One line.",
  rawFootagePaths: [],
  uploadedAssetPaths: [],
  status: "scene_review_ready",
  createdAt: "2026-10-02T04:00:00.000Z",
  updatedAt: "2026-10-02T04:00:00.000Z",
  sceneApprovals: { "scene-001": "approved" },
});
await writeJson(jobDataFile("visual-intelligence-final-assignment", jobId), {
  scenes: [
    {
      sceneId: "scene-001",
      narrationText: "One line.",
      selectedVisualId: "vis-1",
      approvedVisualId: "vis-1",
    },
  ],
});

const locked = await lockRoyalV2Timeline(jobId, "smoke");
const afterLock = await loadJob(jobId);
if (afterLock?.status !== "finalized") throw new Error(`expected finalized, got ${afterLock?.status}`);
if (!afterLock.timelineLock?.lockedAt) throw new Error("missing lock time");
if (afterLock.timelineLock.statusBeforeLock !== "scene_review_ready") {
  throw new Error(`statusBeforeLock ${afterLock.timelineLock.statusBeforeLock}`);
}
const assignment = JSON.parse(
  await fs.readFile(jobDataFile("visual-intelligence-final-assignment", jobId), "utf8")
) as { scenes: Array<{ selectedVisualId?: string }> };
if (assignment.scenes[0]?.selectedVisualId !== "vis-1") throw new Error("scene visual changed");

await unlockRoyalV2Timeline(jobId, "smoke");
const afterUnlock = await loadJob(jobId);
if (afterUnlock?.status !== "scene_review_ready") throw new Error(`restore ${afterUnlock?.status}`);
if (afterUnlock.timelineLock) throw new Error("still locked");

console.log("ok", locked.sceneCount, "scenes, status finalized then restored");
