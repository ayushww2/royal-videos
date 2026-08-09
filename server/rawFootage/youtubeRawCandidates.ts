import type {
  JobRecord,
  UserYoutubeRawClip,
  VisualBeat,
  VisualCandidate,
} from "../../shared/visualIntelligence.js";
import {
  celebrityRawMixBand,
  celebrityRecipeActive,
} from "../visualIntelligence/celebrityV1/referenceRecipe.js";
import {
  WAR_RAW_TARGET,
  WAR_RAW_TARGET_MAX,
  WAR_RAW_TARGET_MIN,
} from "../visualIntelligence/warV1/library.js";

const QUALITY_FLOOR = 70;

export function isRawFootageSource(source: string | undefined): boolean {
  return source === "raw_footage" || source === "user_youtube_raw";
}

export function usableUserYoutubeClips(clips: UserYoutubeRawClip[] | undefined): UserYoutubeRawClip[] {
  return (clips || []).filter((c) => c.usableRaw && c.qualityScore >= QUALITY_FLOOR && c.filePathOrUrl);
}

/** Convert cloud-ingested YouTube clips into shared candidate pool entries. */
export function userYoutubeClipsToCandidates(
  job: JobRecord,
  beats: VisualBeat[],
  clips?: UserYoutubeRawClip[]
): VisualCandidate[] {
  const usable = usableUserYoutubeClips(clips || job.userYoutubeRawIngest?.clips);
  const beatIds = beats.map((b) => b.beatId);
  return usable.map((clip) => ({
    candidateId: clip.clipId,
    source: "user_youtube_raw" as const,
    urlOrPath: clip.filePathOrUrl,
    thumbnail: clip.thumbnail,
    duration: clip.duration,
    title: `YT raw ${clip.videoId} ${clip.startTime.toFixed(1)}–${clip.endTime.toFixed(1)}s`,
    snippet: `user youtube raw topics=${clip.topics.join(",")} quality=${clip.qualityScore}`,
    sourcePageUrl: clip.sourceUrl,
    relatedEntities: clip.topics,
    relatedBeatIds: beatIds,
    detectedVisualType: "video",
    metadata: {
      userYoutubeRaw: true,
      videoId: clip.videoId,
      qualityScore: clip.qualityScore,
      topics: clip.topics,
      startTime: clip.startTime,
      endTime: clip.endTime,
      r2Key: clip.r2Key,
    },
  }));
}

export function rawMixOptionsFromJob(job: JobRecord): {
  useUserYoutubeMix: boolean;
  targetMin: number;
  targetMax: number;
  qualityFloor: number;
  effectiveRawTargetPercent: number;
  rawTargetPercent: number;
  rawReducedReason?: string;
} | null {
  // War v1: library raw + optional YT raw — hard 20–30% band (images fill the rest).
  if (job.niche === "War v1") {
    const ingest = job.userYoutubeRawIngest;
    const ingestFailed =
      job.rawIngestStatus === "failed" || job.rawIngestStatus === "skipped";
    if (ingestFailed && !ingest?.clips?.length) {
      // Still allow War R2 library raw; assembly enforces the same band.
    }
    return {
      useUserYoutubeMix: true,
      targetMin: WAR_RAW_TARGET_MIN,
      targetMax: WAR_RAW_TARGET_MAX,
      qualityFloor: QUALITY_FLOOR,
      effectiveRawTargetPercent: Math.round(WAR_RAW_TARGET * 100),
      rawTargetPercent: Math.round(WAR_RAW_TARGET * 100),
      rawReducedReason: "war_v1_library_20_30",
    };
  }

  const ingest = job.userYoutubeRawIngest;
  if (!job.userYoutubeRawUrls?.length && !ingest?.clips?.length) return null;
  if (job.rawIngestStatus === "failed" || job.rawIngestStatus === "skipped") {
    return {
      useUserYoutubeMix: true,
      targetMin: 0,
      targetMax: 0,
      qualityFloor: QUALITY_FLOOR,
      effectiveRawTargetPercent: 0,
      rawTargetPercent: ingest?.rawTargetPercent ?? 20,
      rawReducedReason: job.rawIngestError || ingest?.rawReducedReason || "ingest failed",
    };
  }
  if (!ingest) return null;

  // Celebrity v1 reference edit: hard band 22–38% (never inherit inflated ingest %).
  if (celebrityRecipeActive(job.niche) && (ingest.clips?.length || 0) > 0) {
    const ingestEff = Number(ingest.effectiveRawTargetPercent) || 0;
    // Prefer recipe target (30); clamp any ingest suggestion into 22–38.
    const blended = ingestEff > 0 ? Math.min(38, Math.max(22, Math.min(ingestEff, 30))) : 30;
    const band = celebrityRawMixBand(blended);
    return {
      useUserYoutubeMix: true,
      targetMin: band.targetMin,
      targetMax: band.targetMax,
      qualityFloor: QUALITY_FLOOR,
      effectiveRawTargetPercent: band.effectiveRawTargetPercent,
      rawTargetPercent: band.rawTargetPercent,
      rawReducedReason: ingest.rawReducedReason || "celebrity_v1_recipe_22_38",
    };
  }

  const effective = Math.max(0, Number(ingest.effectiveRawTargetPercent) || 0) / 100;
  const targetMin = Math.max(0, effective * 0.8);
  const targetMax = Math.max(targetMin, Math.min(0.3, effective * 1.2 || effective));
  return {
    useUserYoutubeMix: true,
    targetMin,
    targetMax,
    qualityFloor: QUALITY_FLOOR,
    effectiveRawTargetPercent: ingest.effectiveRawTargetPercent,
    rawTargetPercent: ingest.rawTargetPercent,
    rawReducedReason: ingest.rawReducedReason,
  };
}
