import { jobDataFile, writeJson, readJson, loadJob } from "../../storage.js";
import { clampScore } from "../editorScores.js";
import { assembleEditorTimeline } from "../assembleEditorTimeline.js";
import { writeMysteryRawUsage } from "./rawFootage.js";
import {
  isRawFootageSource,
  rawMixOptionsFromJob,
} from "../../rawFootage/youtubeRawCandidates.js";
import type {
  ApprovedVisual,
  CandidateJudgment,
  TimelineScene,
  TitleLock,
  VisualBeat,
  VisualCandidate,
} from "../../../shared/visualIntelligence.js";

export async function buildMysteryApprovedLibrary(
  jobId: string,
  candidates: VisualCandidate[],
  judgments: CandidateJudgment[],
  beats: VisualBeat[],
  titleLock?: TitleLock
): Promise<ApprovedVisual[]> {
  const byId = new Map(candidates.map((c) => [c.candidateId, c]));
  const approved: ApprovedVisual[] = [];

  for (const j of judgments.filter((x) => x.approved)) {
    const c = byId.get(j.candidateId);
    if (!c || !c.urlOrPath) continue;
    if (c.source === "fallback_card") continue;

    const related = beats.filter((b) => c.relatedBeatIds.includes(b.beatId));
    const metaQuality = Number(c.metadata?.qualityScore);
    const scores = {
      ...j.scores,
      visualQuality:
        Number.isFinite(metaQuality) && metaQuality > 0
          ? Math.max(j.scores.visualQuality || 0, metaQuality)
          : j.scores.visualQuality,
    };
    const ves = clampScore(scores.visualEditorScore ?? scores.topicRelevance);
    const titleSupport = clampScore(scores.titleSupportScore ?? scores.topicRelevance);
    const narr = clampScore(scores.narrationMatchScore ?? scores.sceneMatch);
    const clarity = clampScore(scores.instantClarityScore ?? scores.visualQuality);
    const horiz = clampScore(scores.horizontalUsability ?? scores.cropSafety16x9);
    const topics = Array.isArray(c.metadata?.topics)
      ? (c.metadata!.topics as string[])
      : j.matchedEntities;

    approved.push({
      approvedVisualId: `av-${c.candidateId}`,
      source: c.source,
      filePathOrUrl: c.urlOrPath,
      thumbnail: c.thumbnail,
      matchedPeople: j.matchedEntities.filter((e) =>
        related.some((b) => b.mentionedPeople.includes(e))
      ),
      matchedCompanies: j.matchedEntities.filter((e) =>
        related.some((b) => b.mentionedCompanies.includes(e))
      ),
      matchedPlaces: j.matchedEntities.filter((e) =>
        related.some((b) => b.mentionedPlaces.includes(e))
      ),
      matchedEvents: j.matchedEntities.filter((e) =>
        related.some((b) => b.mentionedEvents.includes(e))
      ),
      matchedDocuments: j.matchedEntities.filter((e) =>
        related.some((b) => b.mentionedDocuments.includes(e))
      ),
      matchedObjects: j.matchedEntities.filter((e) =>
        related.some((b) => b.mentionedObjects.includes(e))
      ),
      allowedBeatIds: c.relatedBeatIds.length ? c.relatedBeatIds : beats.map((b) => b.beatId),
      bestUseCase: j.editorReason || j.reason || "documentary narration match",
      confidenceScores: scores,
      // Mystery lock: stills max 2–3× / video (prefer 3 when strong match); raw can reuse more.
      reuseLimit: isRawFootageSource(c.source)
        ? Math.max(8, ves >= 85 ? 12 : 8)
        : ves >= 80
          ? 3
          : 2,
      cropInstructions: j.cropInstruction || "clean 16:9 center crop",
      durationRecommendation: j.isTextHeavy
        ? 5
        : c.duration
          ? Math.min(6, Math.max(3, c.duration))
          : 3.5,
      warnings: j.warnings,
      candidateId: c.candidateId,
      queryPackId: c.queryPackId,
      supportsTitle: titleSupport >= 70,
      matchedScriptSubjects: topics,
      visualEditorScore: ves,
      titleSupportScore: titleSupport,
      narrationMatchScore: narr,
      instantClarityScore: clarity,
      horizontalUsability: horiz,
      isTextHeavy: j.isTextHeavy,
      mediaType: isRawFootageSource(c.source) ? "raw_footage" : "image",
    });
  }

  // Keep library strong but not enormous
  approved.sort((a, b) => (b.visualEditorScore || 0) - (a.visualEditorScore || 0));
  const trimmed = approved.slice(0, 80);

  await writeJson(jobDataFile("editor-approved-visual-library", jobId), {
    jobId,
    titleLock: titleLock || null,
    approved: trimmed,
  });
  await writeJson(jobDataFile("mystery-v1-approved-visual-library", jobId), {
    jobId,
    approved: trimmed,
  });
  await writeJson(jobDataFile("visual-intelligence-approved-library", jobId), {
    jobId,
    approved: trimmed,
  });

  return trimmed;
}

export async function assembleMysteryTimeline(
  jobId: string,
  beats: VisualBeat[],
  library: ApprovedVisual[],
  titleLock: TitleLock
): Promise<TimelineScene[]> {
  const job = await loadJob(jobId);
  const mix = job ? rawMixOptionsFromJob(job) : null;
  const scenes = await assembleEditorTimeline(
    jobId,
    beats,
    library,
    titleLock,
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
  await writeMysteryRawUsage(jobId, scenes);
  return scenes;
}

export async function saveMysteryCandidatePool(
  jobId: string,
  candidates: VisualCandidate[],
  imageQueriesUsed: number
): Promise<void> {
  await writeJson(jobDataFile("mystery-v1-candidate-pool", jobId), {
    jobId,
    imageQueriesUsed,
    candidates,
  });
  void readJson;
}
