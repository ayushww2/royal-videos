import { jobDataFile, writeJson, loadJob } from "../storage.js";
import { assembleEditorTimeline } from "./assembleEditorTimeline.js";
import { rawMixOptionsFromJob } from "../rawFootage/youtubeRawCandidates.js";
import type {
  ApprovedVisual,
  TimelineScene,
  TitleLock,
  VisualBeat,
} from "../../shared/visualIntelligence.js";

/**
 * Generic timeline assembly — best appropriate real visual only.
 * Never creates fallback/evidence/map/title cards.
 */
export async function assembleTimeline(
  jobId: string,
  beats: VisualBeat[],
  library: ApprovedVisual[],
  titleLock?: TitleLock
): Promise<TimelineScene[]> {
  const lock: TitleLock =
    titleLock ||
    ({
      jobId,
      title: "",
      mainSubject: "",
      centralObjectOrPlace: "",
      emotionalPromise: "",
      mysteryOrConflict: "",
      expectedVisuals: [],
      forbiddenDrift: [],
      createdAt: new Date().toISOString(),
    } satisfies TitleLock);

  const job = await loadJob(jobId);
  const mix = job ? rawMixOptionsFromJob(job) : null;
  const scenes = await assembleEditorTimeline(
    jobId,
    beats,
    library,
    lock,
    mix
      ? {
          useUserYoutubeMix: mix.useUserYoutubeMix,
          targetMin: mix.targetMin,
          targetMax: mix.targetMax,
          qualityFloor: mix.qualityFloor,
          rawTargetPercent: mix.rawTargetPercent,
          effectiveRawTargetPercent: mix.effectiveRawTargetPercent,
          rawReducedReason: mix.rawReducedReason,
        }
      : undefined
  );
  await writeJson(jobDataFile("visual-intelligence-final-assignment", jobId), { jobId, scenes });
  return scenes;
}
