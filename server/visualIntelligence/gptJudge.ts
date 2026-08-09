import { chatJson } from "../openaiClient.js";
import { jobDataFile, writeJson } from "../storage.js";
import { nicheRules } from "./nicheRules.js";
import type {
  CandidateJudgment,
  GlobalContextReport,
  JobRecord,
  VisualBeat,
  VisualCandidate,
} from "../../shared/visualIntelligence.js";
import { getJobCostLimits, sampleBeatsForPrompt } from "./jobDuration.js";
import { cheapPipeline, efficientPipeline, maxJudgeCandidates } from "./pipelineMode.js";
import { isRawFootageSource, rawMixOptionsFromJob } from "../rawFootage/youtubeRawCandidates.js";

/**
 * Softer Celebrity/legacy gates — identity still matters, but 85/75 floors
 * were starving usable Google stills. Wrong-entity/watermark stay firm.
 */
function meetsMinimum(j: CandidateJudgment, needsExactEntity: boolean): boolean {
  const s = j.scores;
  if (needsExactEntity && s.entityMatch < 72) return false;
  if (s.topicRelevance < 62) return false;
  if (s.sceneMatch < 55) return false;
  if (s.visualQuality < 58) return false;
  if (s.wrongEntityRisk > 35) return false;
  if (s.watermarkTextRisk > 28) return false;
  return true;
}

function sourceRank(c: VisualCandidate): number {
  if (isRawFootageSource(c.source)) return 0;
  if (c.source === "uploaded_asset") return 1;
  if (c.source === "pexels_clip" || c.source === "pexels_image") return 2;
  if (c.source === "pixabay_clip" || c.source === "pixabay_image") return 2;
  return 3;
}

/**
 * Editor-style judgment: collect ALL visuals first, then GPT reviews the full pool
 * in one pass (not tiny sequential batches).
 */
export async function judgeCandidates(
  job: JobRecord,
  context: GlobalContextReport,
  beats: VisualBeat[],
  candidates: VisualCandidate[]
): Promise<CandidateJudgment[]> {
  const LIMITS = getJobCostLimits(job);
  const ordered = [...candidates].sort((a, b) => sourceRank(a) - sourceRank(b));
  const limited = ordered.slice(0, maxJudgeCandidates(LIMITS.maxGptVisionJudgments));
  const judgments: CandidateJudgment[] = [];

  if (cheapPipeline() || efficientPipeline()) {
    const mode = cheapPipeline() ? "PIPELINE_CHEAP" : "PIPELINE_EFFICIENT";
    console.warn(`[gptJudge] ${mode} — local editor approve ${limited.length} for ${job.jobId} (stay under ~$1/min)`);
    for (const c of limited) {
      const isRaw = isRawFootageSource(c.source);
      const metaQ = Number(c.metadata?.qualityScore);
      judgments.push({
        candidateId: c.candidateId,
        approved: true,
        scores: {
          entityMatch: isRaw ? 72 : 80,
          sceneMatch: isRaw ? 78 : 75,
          topicRelevance: 80,
          eventPlaceYearRelevance: 70,
          visualQuality: isRaw
            ? Number.isFinite(metaQ) && metaQ > 0
              ? metaQ
              : 78
            : 75,
          cropSafety16x9: 80,
          sourceReliability: isRaw ? 90 : 70,
          wrongEntityRisk: isRaw ? 15 : 10,
          watermarkTextRisk: isRaw ? 5 : 10,
          reusePotential: isRaw ? 85 : 60,
        },
        reason: `${mode} local editor approve${isRaw ? " (raw preferred for share)" : ""}`,
        matchedEntities: c.relatedEntities || [],
        warnings: [],
      });
    }
    await writeJson(jobDataFile("visual-intelligence-gpt-judgment", job.jobId), {
      jobId: job.jobId,
      judgments,
      mode: mode.toLowerCase(),
    });
    return judgments;
  }

  const rawCount = limited.filter((c) => isRawFootageSource(c.source)).length;
  const imageCount = limited.length - rawCount;
  const ytMix = rawMixOptionsFromJob(job);
  const rawShareHint = ytMix?.useUserYoutubeMix
    ? `target roughly ${Math.round(ytMix.effectiveRawTargetPercent)}% of timeline duration from user_youtube_raw / raw_footage (base 20%, reduced after analysis if usable yield is weak)`
    : "target roughly 30–40% of timeline duration from raw when raw exists";

  let result: { judgments?: CandidateJudgment[]; editorNotes?: string } = { judgments: [] };
  try {
    console.log(
      `[gptJudge] holistic editor pass for ${job.jobId}: ${limited.length} candidates (raw=${rawCount}, other=${imageCount})`
    );
    result = await chatJson<{ judgments: CandidateJudgment[]; editorNotes?: string }>({
      system: `You are a documentary VIDEO EDITOR reviewing the FULL collected visual pool at once.

Workflow already done:
1) Raw footage chunks collected (if any) — may include user_youtube_raw from our channel
2) Web/image candidates collected
3) Soft filters applied
NOW you see everything together — judge like an editor assembling a cut, not a batch keyword scorer.

Rules:
- Prefer raw_footage / user_youtube_raw for atmosphere, motion, texture, B-roll when it fits the moment (${rawShareHint}).
- Prefer clean horizontal images for exact people/places/objects named in narration.
- A beautiful WRONG visual must be rejected.
- Only horizontal 16:9 or 4:3 frames are useful.
- Reject watermarks, big baked text, memes, wrong entity.
- Score each candidate 0–100 for:
  entityMatch, sceneMatch, topicRelevance, eventPlaceYearRelevance,
  visualQuality, cropSafety16x9, sourceReliability, wrongEntityRisk,
  watermarkTextRisk, reusePotential.
- Set approved=true only if you would put it in the timeline.

Return JSON:
{ editorNotes: string,
  judgments: [{ candidateId, approved, scores, reason, matchedEntities, warnings }] }

Judge EVERY candidate in the list. Niche: ${nicheRules(job.niche)}
Forbidden: ${(context.forbiddenEntities || []).join(", ") || "none"}
Confusing: ${(context.confusingSimilarEntities || []).join(", ") || "none"}`,
      user: JSON.stringify({
        title: job.title,
        mainSubject: context.mainSubject,
        people: (context.people || []).slice(0, 12),
        places: (context.places || []).slice(0, 12),
        companies: (context.companies || []).slice(0, 8),
        events: (context.events || []).slice(0, 12),
        poolSummary: { total: limited.length, rawFootage: rawCount, imagesAndOther: imageCount },
        beats: beats.slice(0, 48).map((b) => ({
          beatId: b.beatId,
          narrationText: (b.narrationText || "").slice(0, 140),
          mustMatchEntity: b.mustMatchEntity,
          visualRole: b.visualRole,
          mentionedPeople: (b.mentionedPeople || []).slice(0, 3),
          mentionedPlaces: (b.mentionedPlaces || []).slice(0, 3),
        })),
        candidates: limited.map((c) => ({
          candidateId: c.candidateId,
          source: c.source,
          title: (c.title || "").slice(0, 120),
          snippet: (c.snippet || "").slice(0, 80),
          urlOrPath: (c.urlOrPath || "").slice(0, 180),
          queryUsed: c.queryUsed,
          relatedBeatIds: c.relatedBeatIds,
          relatedEntities: (c.relatedEntities || []).slice(0, 4),
          detectedVisualType: c.detectedVisualType,
          dimensions: c.dimensions,
        })),
      }),
    });
  } catch (err) {
    console.warn(
      `[gptJudge] holistic pass failed for ${job.jobId}, soft-approving pool:`,
      err instanceof Error ? err.message : String(err)
    );
    result = {
      judgments: limited.map((c) => ({
        candidateId: c.candidateId,
        approved: true,
        scores: {
          entityMatch: 70,
          sceneMatch: 70,
          topicRelevance: 75,
          eventPlaceYearRelevance: 70,
          visualQuality: 70,
          cropSafety16x9: 80,
          sourceReliability: isRawFootageSource(c.source) ? 85 : 70,
          wrongEntityRisk: 15,
          watermarkTextRisk: 10,
          reusePotential: 70,
        },
        reason: "Soft-approved after holistic judge outage",
        matchedEntities: c.relatedEntities || [],
        warnings: ["judge_fallback"],
      })),
    };
  }

  for (const j of result.judgments || []) {
    const candidate = limited.find((c) => c.candidateId === j.candidateId);
    const relatedBeats = beats.filter((b) => candidate?.relatedBeatIds?.includes(b.beatId));
    const needsExact = relatedBeats.some((b) => !!b.mustMatchEntity);
    const scores = {
      entityMatch: j.scores?.entityMatch ?? 0,
      sceneMatch: j.scores?.sceneMatch ?? 0,
      topicRelevance: j.scores?.topicRelevance ?? 0,
      eventPlaceYearRelevance: j.scores?.eventPlaceYearRelevance ?? 0,
      visualQuality: j.scores?.visualQuality ?? 0,
      cropSafety16x9: j.scores?.cropSafety16x9 ?? 0,
      sourceReliability: j.scores?.sourceReliability ?? 0,
      wrongEntityRisk: j.scores?.wrongEntityRisk ?? 100,
      watermarkTextRisk: j.scores?.watermarkTextRisk ?? 100,
      reusePotential: j.scores?.reusePotential ?? 0,
    };
    const normalized: CandidateJudgment = {
      candidateId: j.candidateId,
      scores,
      reason: j.reason || "",
      matchedEntities: j.matchedEntities || [],
      warnings: j.warnings || [],
      approved: false,
    };
    normalized.approved = Boolean(j.approved) && meetsMinimum(normalized, needsExact);
    if (!normalized.approved && Boolean(j.approved)) {
      normalized.warnings.push("Failed minimum approval thresholds");
    }
    judgments.push(normalized);
  }

  // Any candidates GPT omitted → soft reserve (still one pass, no extra GPT)
  const seen = new Set(judgments.map((j) => j.candidateId));
  for (const c of limited) {
    if (seen.has(c.candidateId)) continue;
    judgments.push({
      candidateId: c.candidateId,
      approved: isRawFootageSource(c.source),
      scores: {
        entityMatch: 65,
        sceneMatch: 65,
        topicRelevance: 70,
        eventPlaceYearRelevance: 65,
        visualQuality: Number(c.metadata?.qualityScore) || 70,
        cropSafety16x9: 80,
        sourceReliability: 80,
        wrongEntityRisk: 20,
        watermarkTextRisk: 10,
        reusePotential: 70,
      },
      reason: "Not returned in holistic pass — reserved",
      matchedEntities: c.relatedEntities || [],
      warnings: ["omitted_by_model"],
    });
  }

  await writeJson(jobDataFile("visual-intelligence-gpt55-judgment", job.jobId), {
    jobId: job.jobId,
    mode: "holistic_editor_once",
    editorNotes: result.editorNotes || "",
    judgedCount: judgments.length,
    poolSummary: { total: limited.length, rawFootage: rawCount, imagesAndOther: imageCount },
    judgments,
  });
  await writeJson(jobDataFile("visual-intelligence-gpt-judgment", job.jobId), {
    jobId: job.jobId,
    mode: "holistic_editor_once",
    judgments,
  });

  return judgments;
}
