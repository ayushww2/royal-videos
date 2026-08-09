import { jobDataFile, writeJson } from "../storage.js";
import { isRawFootageSource } from "../rawFootage/youtubeRawCandidates.js";
import type {
  ApprovedVisual,
  CandidateJudgment,
  VisualBeat,
  VisualCandidate,
} from "../../shared/visualIntelligence.js";
import { assessContentSafety } from "./contentSafety.js";

export async function buildApprovedLibrary(
  jobId: string,
  candidates: VisualCandidate[],
  judgments: CandidateJudgment[],
  beats: VisualBeat[]
): Promise<ApprovedVisual[]> {
  const byId = new Map(candidates.map((c) => [c.candidateId, c]));
  const approved: ApprovedVisual[] = [];

  for (const j of judgments.filter((x) => x.approved)) {
    const c = byId.get(j.candidateId);
    if (!c) continue;
    const safety = assessContentSafety({
      title: c.title,
      url: c.urlOrPath,
      pageUrl: c.sourcePageUrl,
      query: c.queryUsed,
    });
    if (safety.unsafe) continue;
    const related = beats.filter((b) => c.relatedBeatIds.includes(b.beatId));
    const metaQuality = Number(c.metadata?.qualityScore);
    const scores = {
      ...j.scores,
      visualQuality:
        Number.isFinite(metaQuality) && metaQuality > 0
          ? Math.max(j.scores.visualQuality || 0, metaQuality)
          : j.scores.visualQuality,
    };
    const topics = Array.isArray(c.metadata?.topics)
      ? (c.metadata!.topics as string[])
      : c.relatedEntities || [];
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
      matchedScriptSubjects: topics,
      allowedBeatIds: c.relatedBeatIds.length ? c.relatedBeatIds : beats.map((b) => b.beatId),
      bestUseCase: `${j.reason || "matched narration context"}${
        isRawFootageSource(c.source) && c.snippet ? ` | ${c.snippet}` : ""
      }`,
      confidenceScores: scores,
      // Stills: low reuse (Celebrity assemble hard-caps ≤2). Raw: allow more; Celebrity still caps at 2.
      reuseLimit: isRawFootageSource(c.source)
        ? Math.max(4, Math.round((scores.reusePotential || 50) / 12))
        : Math.min(2, Math.max(1, Math.round((scores.reusePotential || 50) / 40))),
      cropInstructions: "center crop 16:9 when needed",
      durationRecommendation: c.duration ? Math.min(6, Math.max(3, c.duration)) : 3.5,
      warnings: j.warnings,
      candidateId: c.candidateId,
      queryPackId: c.queryPackId,
      mediaType: isRawFootageSource(c.source) ? "raw_footage" : "image",
    });
  }

  await writeJson(jobDataFile("visual-intelligence-approved-library", jobId), {
    jobId,
    approved,
  });

  return approved;
}
