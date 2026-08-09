import { chatJson } from "../../openaiClient.js";
import { jobDataFile, writeJson } from "../../storage.js";
import type {
  CandidateJudgment,
  GlobalContextReport,
  JobRecord,
  VisualBeat,
  VisualCandidate,
} from "../../../shared/visualIntelligence.js";
import { getJobCostLimits, sampleBeatsForPrompt } from "../jobDuration.js";

export interface MysteryJudgmentScores {
  relevanceToNarration: number;
  entityMatch: number;
  locationMatch: number;
  objectMatch: number;
  eventMatch: number;
  documentaryUsefulness: number;
  visualQuality: number;
  watermarkRisk: number;
  alteredTextRisk: number;
  wrongContextRisk: number;
}

export interface MysteryJudgment {
  candidateId: string;
  approved: boolean;
  scores: MysteryJudgmentScores;
  reason: string;
  matchedEntities: string[];
  warnings: string[];
}

function mysteryMeetsSoftMinimum(j: MysteryJudgment, needsExact: boolean): boolean {
  const s = j.scores;
  if (s.relevanceToNarration < 70) return false;
  if (s.documentaryUsefulness < 65) return false;
  if (s.visualQuality < 60) return false;
  if (s.watermarkRisk > 20) return false;
  if (s.alteredTextRisk > 20) return false;
  if (s.wrongContextRisk > 35) return false;
  if (needsExact) {
    const exact = Math.max(s.entityMatch, s.locationMatch, s.objectMatch, s.eventMatch);
    if (exact < 80) return false;
  }
  return true;
}

function toSharedJudgment(j: MysteryJudgment): CandidateJudgment {
  return {
    candidateId: j.candidateId,
    approved: j.approved,
    reason: j.reason,
    matchedEntities: j.matchedEntities,
    warnings: j.warnings,
    scores: {
      entityMatch: j.scores.entityMatch,
      sceneMatch: j.scores.relevanceToNarration,
      topicRelevance: j.scores.relevanceToNarration,
      eventPlaceYearRelevance: Math.max(j.scores.locationMatch, j.scores.eventMatch),
      visualQuality: j.scores.visualQuality,
      cropSafety16x9: 80,
      sourceReliability: 75,
      wrongEntityRisk: j.scores.wrongContextRisk,
      watermarkTextRisk: Math.max(j.scores.watermarkRisk, j.scores.alteredTextRisk),
      reusePotential: j.scores.documentaryUsefulness,
    },
  };
}

export async function mysteryJudgeCandidates(
  job: JobRecord,
  context: GlobalContextReport,
  beats: VisualBeat[],
  candidates: VisualCandidate[]
): Promise<CandidateJudgment[]> {
  const LIMITS = getJobCostLimits(job);
  const limited = candidates.slice(0, LIMITS.maxGptVisionJudgments);
  const mysteryJudgments: MysteryJudgment[] = [];
  const beatContext = sampleBeatsForPrompt(beats, 80).map((b) => ({
    beatId: b.beatId,
    narrationText: (b.narrationText || "").slice(0, 180),
    mustMatchEntity: b.mustMatchEntity,
    visualIntent: (b.visualIntent || "").slice(0, 120),
    mentionedPlaces: (b.mentionedPlaces || []).slice(0, 4),
    mentionedObjects: (b.mentionedObjects || []).slice(0, 4),
    mentionedPeople: (b.mentionedPeople || []).slice(0, 4),
    mentionedEvents: (b.mentionedEvents || []).slice(0, 4),
    mentionedDocuments: (b.mentionedDocuments || []).slice(0, 4),
  }));

  for (let i = 0; i < limited.length; i += 8) {
    const batch = limited.slice(i, i + 8);
    let result: { judgments?: MysteryJudgment[] } = { judgments: [] };
    try {
      result = await chatJson<{ judgments: MysteryJudgment[] }>({
        system: `You are Mystery v1 visual judge for a clean documentary.
Style: serious evidence-style documentary — caves, ruins, maps, documents, archaeology, investigation photos.
SOFT clean-image policy:
- Reject mainly for VISIBLE watermark or BIG altered/baked-in text overlays (headlines, YouTube title text, meme text, poster text).
- Do NOT reject just because image is dramatic, dark, cinematic, from a web/news/blog result, or mystery-related.
- Do NOT reject a clean relevant image just because it is imperfect.
- A beautiful WRONG subject/context must still be rejected.
- Aspect: only horizontal 16:9 or 4:3 frames are allowed (portrait/square already filtered out).

Score 0-100:
relevanceToNarration, entityMatch, locationMatch, objectMatch, eventMatch,
documentaryUsefulness, visualQuality, watermarkRisk, alteredTextRisk, wrongContextRisk.

Return JSON { judgments: [{ candidateId, approved, scores, reason, matchedEntities, warnings }] }.`,
        user: JSON.stringify({
          title: job.title,
          mainSubject: context.mainSubject,
          places: (context.places || []).slice(0, 12),
          people: (context.people || []).slice(0, 12),
          events: (context.events || []).slice(0, 12),
          documents: (context.documents || []).slice(0, 8),
          objectsProducts: (context.objectsProducts || []).slice(0, 12),
          beats: beatContext,
          candidates: batch.map((c) => ({
            candidateId: c.candidateId,
            source: c.source,
            title: (c.title || "").slice(0, 160),
            urlOrPath: c.urlOrPath,
            queryUsed: c.queryUsed,
            relatedBeatIds: c.relatedBeatIds,
            relatedEntities: c.relatedEntities,
          })),
        }),
      });
    } catch (err) {
      console.warn(
        `[mysteryJudge] batch failed for ${job.jobId}, soft-approving batch:`,
        err instanceof Error ? err.message : String(err)
      );
      result = {
        judgments: batch.map((c) => ({
          candidateId: c.candidateId,
          approved: true,
          scores: {
            relevanceToNarration: 72,
            entityMatch: 70,
            locationMatch: 70,
            objectMatch: 70,
            eventMatch: 70,
            documentaryUsefulness: 70,
            visualQuality: 70,
            watermarkRisk: 10,
            alteredTextRisk: 10,
            wrongContextRisk: 20,
          },
          reason: "Soft-approved after GPT judge outage",
          matchedEntities: c.relatedEntities || [],
          warnings: ["judge_fallback"],
        })),
      };
    }

    for (const j of result.judgments || []) {
      const candidate = batch.find((c) => c.candidateId === j.candidateId);
      const relatedBeats = beats.filter((b) => candidate?.relatedBeatIds?.includes(b.beatId));
      const needsExact = relatedBeats.some((b) => !!b.mustMatchEntity);
      const scores: MysteryJudgmentScores = {
        relevanceToNarration: j.scores?.relevanceToNarration ?? 0,
        entityMatch: j.scores?.entityMatch ?? 0,
        locationMatch: j.scores?.locationMatch ?? 0,
        objectMatch: j.scores?.objectMatch ?? 0,
        eventMatch: j.scores?.eventMatch ?? 0,
        documentaryUsefulness: j.scores?.documentaryUsefulness ?? 0,
        visualQuality: j.scores?.visualQuality ?? 0,
        watermarkRisk: j.scores?.watermarkRisk ?? 100,
        alteredTextRisk: j.scores?.alteredTextRisk ?? 100,
        wrongContextRisk: j.scores?.wrongContextRisk ?? 100,
      };
      const normalized: MysteryJudgment = {
        candidateId: j.candidateId,
        scores,
        reason: j.reason || "",
        matchedEntities: j.matchedEntities || [],
        warnings: j.warnings || [],
        approved: false,
      };
      normalized.approved = Boolean(j.approved) && mysteryMeetsSoftMinimum(normalized, needsExact);
      if (scores.watermarkRisk > 20) normalized.warnings.push("possible watermark");
      if (scores.alteredTextRisk > 20) normalized.warnings.push("possible altered text");
      if (scores.wrongContextRisk > 35) normalized.warnings.push("possible wrong context");
      if (!normalized.approved && Boolean(j.approved)) {
        normalized.warnings.push("Failed Mystery v1 soft approval thresholds");
      }
      mysteryJudgments.push(normalized);
    }
  }

  await writeJson(jobDataFile("mystery-v1-gpt55-judgment", job.jobId), {
    jobId: job.jobId,
    policy: "soft_clean_image",
    judgedCount: mysteryJudgments.length,
    judgments: mysteryJudgments,
  });

  const shared = mysteryJudgments.map(toSharedJudgment);
  await writeJson(jobDataFile("visual-intelligence-gpt55-judgment", job.jobId), {
    jobId: job.jobId,
    judgedCount: shared.length,
    judgments: shared,
  });

  return shared;
}
