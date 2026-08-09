import { chatJson } from "../openaiClient.js";
import { jobDataFile, writeJson } from "../storage.js";
import { clampScore } from "./editorScores.js";
import { isAllowedHorizontalAspect, aspectRatioLabel } from "./aspectPolicy.js";
import type {
  CandidateJudgment,
  FullScriptVisualMap,
  JobRecord,
  JudgmentScores,
  TitleLock,
  VisualBeat,
  VisualCandidate,
} from "../../shared/visualIntelligence.js";
import { getJobCostLimits } from "./jobDuration.js";
import { cheapPipeline, efficientPipeline, maxJudgeCandidates } from "./pipelineMode.js";
import { isRawFootageSource, rawMixOptionsFromJob } from "../rawFootage/youtubeRawCandidates.js";
import { textMentionsPerson } from "./contentSafety.js";
import { celebrityRecipeActive } from "./celebrityV1/referenceRecipe.js";

interface EditorGptJudgment {
  candidateId: string;
  editorDecision: "approve" | "reject" | "reserve" | "fallback_only";
  editorReason: string;
  visualEditorScore: number;
  titleSupportScore: number;
  narrationMatchScore: number;
  instantClarityScore: number;
  exactSubjectMatch: number;
  horizontalUsability: number;
  documentaryUsefulness: number;
  textHeavyPenalty: number;
  watermarkRisk: number;
  alteredTextRisk: number;
  wrongContextRisk: number;
  reusePotential: number;
  isTextHeavy?: boolean;
  matchedEntities?: string[];
  warnings?: string[];
}

function horizontalScore(c: VisualCandidate): number {
  const aspect = isAllowedHorizontalAspect(c.dimensions);
  if (!aspect.ok) {
    if (aspect.reason?.includes("portrait") || aspect.reason?.includes("square")) return 20;
    if (aspect.reason?.includes("missing")) return 55;
    return 45;
  }
  const label = aspect.label || aspectRatioLabel(c.dimensions!.width, c.dimensions!.height);
  if (label === "16:9") return 95;
  if (label === "4:3") return 88;
  return 78;
}

/**
 * Director-friendly gates: keep strong rejects for watermarks/wrong entity,
 * but do NOT starve the library with perfectionist floors.
 * Approve path ~68+; reserve path handled separately down to ~60.
 */
function meetsEditorMinimum(scores: JudgmentScores, isTextHeavy: boolean): boolean {
  const ves = scores.visualEditorScore ?? 0;
  const title = scores.titleSupportScore ?? 0;
  const narr = scores.narrationMatchScore ?? 0;
  const clarity = scores.instantClarityScore ?? 0;
  const horiz = scores.horizontalUsability ?? 0;
  const wm = scores.watermarkRisk ?? scores.watermarkTextRisk ?? 100;
  const alt = scores.alteredTextRisk ?? 100;
  const wrong = scores.wrongContextRisk ?? scores.wrongEntityRisk ?? 100;
  if (ves < 68) return false;
  // Soft: title/narration/clarity — one weak score shouldn't kill a useful visual
  const supportOk =
    (title >= 62 && narr >= 62 && clarity >= 60) ||
    (ves >= 78 && (title >= 55 || narr >= 55));
  if (!supportOk) return false;
  if (horiz < 65) return false;
  if (wm > 22 || alt > 22) return false;
  if (wrong > 38) return false;
  if (isTextHeavy && (scores.textHeavyPenalty ?? 0) > 45 && clarity < 75) return false;
  return true;
}

function toSharedScores(j: EditorGptJudgment, horizFallback: number): JudgmentScores {
  const visualEditorScore = clampScore(j.visualEditorScore);
  const titleSupportScore = clampScore(j.titleSupportScore);
  const narrationMatchScore = clampScore(j.narrationMatchScore);
  const instantClarityScore = clampScore(j.instantClarityScore);
  const exactSubjectMatch = clampScore(j.exactSubjectMatch);
  const horizontalUsability = clampScore(j.horizontalUsability ?? horizFallback);
  const documentaryUsefulness = clampScore(j.documentaryUsefulness);
  const textHeavyPenalty = clampScore(j.textHeavyPenalty);
  const watermarkRisk = clampScore(j.watermarkRisk);
  const alteredTextRisk = clampScore(j.alteredTextRisk);
  const wrongContextRisk = clampScore(j.wrongContextRisk);
  const reusePotential = clampScore(j.reusePotential);

  return {
    entityMatch: exactSubjectMatch,
    sceneMatch: narrationMatchScore,
    topicRelevance: narrationMatchScore,
    eventPlaceYearRelevance: exactSubjectMatch,
    visualQuality: instantClarityScore,
    cropSafety16x9: horizontalUsability,
    sourceReliability: clampScore(100 - watermarkRisk),
    wrongEntityRisk: wrongContextRisk,
    watermarkTextRisk: clampScore(Math.max(watermarkRisk, alteredTextRisk)),
    reusePotential,
    visualEditorScore,
    titleSupportScore,
    narrationMatchScore,
    instantClarityScore,
    exactSubjectMatch,
    horizontalUsability,
    documentaryUsefulness,
    textHeavyPenalty,
    watermarkRisk,
    alteredTextRisk,
    wrongContextRisk,
  };
}

function sourceRank(c: VisualCandidate): number {
  if (isRawFootageSource(c.source)) return 0;
  if (c.source === "uploaded_asset") return 1;
  return 2;
}

/**
 * Documentary editor brain: after ALL candidates are collected (images + raw),
 * GPT reviews the complete pool in ONE pass — not tiny sequential batches.
 */
export async function editorJudgeCandidates(
  job: JobRecord,
  titleLock: TitleLock,
  visualMap: FullScriptVisualMap,
  beats: VisualBeat[],
  candidates: VisualCandidate[]
): Promise<CandidateJudgment[]> {
  const LIMITS = getJobCostLimits(job);
  const ranked = [...candidates].sort(
    (a, b) => sourceRank(a) - sourceRank(b) || horizontalScore(b) - horizontalScore(a)
  );
  const limited = ranked.slice(0, maxJudgeCandidates(LIMITS.maxGptVisionJudgments));
  const judgments: CandidateJudgment[] = [];
  const rawCount = limited.filter((c) => isRawFootageSource(c.source)).length;
  const imageCount = limited.length - rawCount;
  const ytMix = rawMixOptionsFromJob(job);
  const rawShareHint = ytMix?.useUserYoutubeMix
    ? `aim for roughly ${Math.round(ytMix.effectiveRawTargetPercent)}% of approve/reserve picks from user_youtube_raw / raw_footage (base ~20%, reduced after analysis if weak)`
    : "aim for roughly 30–40% of approve/reserve picks from raw_footage for atmosphere, motion, and texture";

  // Celebrity / War: local judge — GPT holistic 48–72 candidate pass times out on Railway.
  // War already ran GPT library picks; Google fills only weak beats.
  // Also used for PIPELINE_CHEAP.
  const warMode = job.niche === "War v1";
  const localCelebrityJudge = cheapPipeline() || job.niche === "Celebrity v1" || warMode;
  if (localCelebrityJudge) {
    const pool = ranked.slice(0, Math.max(limited.length, Math.min(220, LIMITS.maxCandidatesCollected)));
    console.warn(
      `[editorJudge] local ${warMode ? "war-library" : "name-evidence"} judge for ${job.jobId}: ${pool.length} candidates`
    );
    for (const c of pool) {
      const parts = [
        c.title,
        c.snippet,
        c.queryUsed,
        c.urlOrPath,
        c.sourcePageUrl,
        ...(c.relatedEntities || []),
      ];
      const warLib = Boolean(c.metadata?.warLibrary || c.metadata?.warGptPick);
      const namesMain = textMentionsPerson(titleLock.mainSubject, parts);
      // Supporting people (e.g. Christina Sandera) — require a real multi-word person name.
      const namesRelated = (c.relatedEntities || []).some(
        (e) =>
          e &&
          e.split(/\s+/).length >= 2 &&
          !/^(at|the|hollywoodlywood|tragedy)\b/i.test(e) &&
          textMentionsPerson(e, parts)
      );
      // Trust name-locked Google queries for the MAIN celebrity only.
      const queryHasMain = textMentionsPerson(titleLock.mainSubject, [c.queryUsed]);
      const isRaw = isRawFootageSource(c.source);
      // Do NOT approve from stopword entityContext alone ("At", "Hollywood").
      const named = namesMain || namesRelated || queryHasMain;
      const warOk =
        warMode &&
        (warLib ||
          isRaw ||
          named ||
          (c.relatedEntities || []).some((e) => String(e || "").trim().length > 3));
      // Cap below Exact Match threshold (90) — name lock ≠ vision-verified Exact.
      const score = warLib ? 82 : isRaw ? 76 : namesMain ? 84 : named || warOk ? 78 : 45;
      const approve = warMode ? Boolean(warOk) : isRaw || named;
      judgments.push({
        candidateId: c.candidateId,
        approved: approve,
        scores: toSharedScores(
          {
            candidateId: c.candidateId,
            editorDecision: approve ? "approve" : "reject",
            editorReason: approve
              ? warLib
                ? "Local war judge — R2 library GPT pick"
                : namesMain
                  ? "Local celebrity judge — main subject name"
                  : isRaw
                    ? "Local judge — raw clip"
                    : warMode
                      ? "Local war judge — topic lock"
                      : "Local celebrity judge — query/entity name lock"
              : warMode
                ? "Local war judge — rejected (weak match)"
                : "Local celebrity judge — rejected (no name evidence)",
            visualEditorScore: Math.min(88, score),
            titleSupportScore: namesMain || warLib ? 84 : named || warOk ? 72 : 35,
            narrationMatchScore: named || isRaw || warLib ? 78 : 35,
            instantClarityScore: 75,
            exactSubjectMatch: namesMain || warLib ? 80 : named ? 70 : 15,
            horizontalUsability: horizontalScore(c),
            documentaryUsefulness: named || isRaw || warLib ? 78 : 35,
            textHeavyPenalty: 15,
            watermarkRisk: 8,
            alteredTextRisk: 8,
            wrongContextRisk: named || isRaw || warLib ? 10 : 50,
            reusePotential: 50,
          },
          horizontalScore(c)
        ),
        reason: approve
          ? warLib
            ? "local_war_library_pick"
            : warMode
              ? "local_war_topic_lock"
              : "local_celebrity_name_lock"
          : warMode
            ? "rejected_weak_war_match"
            : "rejected_no_name",
        matchedEntities: [
          ...(c.relatedEntities || []),
          ...(namesMain && titleLock.mainSubject ? [titleLock.mainSubject] : []),
        ],
        warnings: approve ? [] : [warMode ? "weak_war_match" : "no_name_evidence"],
        editorDecision: approve ? "approve" : "reject",
        editorReason: warMode ? "local_war_judge" : "local_celebrity_judge",
      });
    }
    await writeJson(jobDataFile("editor-gpt-judgment", job.jobId), {
      jobId: job.jobId,
      mode: warMode ? "local_war_library" : "local_celebrity_name_evidence",
      mainSubject: titleLock.mainSubject,
      judgments,
    });
    return judgments;
  }

  let gpt: { judgments?: EditorGptJudgment[]; editorNotes?: string; rawFootageShareTarget?: string } =
    { judgments: [] };
  try {
    console.log(
      `[editorJudge] holistic editor pass for ${job.jobId}: ${limited.length} candidates (raw=${rawCount}, other=${imageCount})`
    );
    gpt = await chatJson<{
      judgments: EditorGptJudgment[];
      editorNotes?: string;
      rawFootageShareTarget?: string;
    }>({
      system: `You are a documentary VIDEO EDITOR. The full visual pool is already collected:
1) Raw footage chunks (source=raw_footage or user_youtube_raw) if any
2) Web/image/search candidates
You must review EVERYTHING IN ONE PASS like an editor building a cut — not scoring tiny batches blindly.

Editor goals:
- Mix sources intentionally. When raw footage exists, ${rawShareHint}.
- Use still images for exact people/places/objects named in narration.
- Ask for each candidate: what should the viewer understand? exact subject? would a human editor choose this? title support? clear in 3–4 seconds? clean 16:9?
- Reject watermarks, big baked-in text, wrong subject, unreadable charts as main visuals.
- Do NOT reject only because dramatic/cinematic/from web.

Return JSON:
{ editorNotes: string,
  rawFootageShareTarget: string,
  judgments: [{ candidateId, editorDecision, editorReason,
    visualEditorScore, titleSupportScore, narrationMatchScore, instantClarityScore,
    exactSubjectMatch, horizontalUsability, documentaryUsefulness, textHeavyPenalty,
    watermarkRisk, alteredTextRisk, wrongContextRisk, reusePotential,
    isTextHeavy, matchedEntities, warnings }] }
Scores 0–100. editorDecision: approve|reject|reserve|fallback_only.
Include a judgment for EVERY candidateId provided.`,
      user: JSON.stringify({
        title: job.title,
        titleLock,
        visualMap: {
          mainVideoPromise: visualMap.mainVideoPromise,
          primaryVisualSubjects: visualMap.primaryVisualSubjects,
          mustNotShow: visualMap.mustNotShow,
          exactPlaces: visualMap.exactPlaces.slice(0, 12),
          exactObjects: visualMap.exactObjects.slice(0, 12),
          exactPeople: visualMap.exactPeople.slice(0, 12),
        },
        poolSummary: {
          total: limited.length,
          rawFootage: rawCount,
          imagesAndOther: imageCount,
          instruction: "Judge full pool together; balance raw vs images like an editor",
        },
        beats: beats.slice(0, 48).map((b) => ({
          beatId: b.beatId,
          narrationText: (b.narrationText || "").slice(0, 140),
          viewerShouldSee: b.viewerShouldSee,
          exactSubject: b.exactSubject || b.mustMatchEntity,
          visualRole: b.visualRole,
          mustShow: b.mustShow,
          shouldAvoid: b.shouldAvoid,
        })),
        candidates: limited.map((c) => ({
          candidateId: c.candidateId,
          source: c.source,
          title: (c.title || "").slice(0, 120),
          urlOrPath: (c.urlOrPath || "").slice(0, 180),
          queryUsed: c.queryUsed,
          dimensions: c.dimensions,
          relatedBeatIds: c.relatedBeatIds,
          relatedEntities: (c.relatedEntities || []).slice(0, 4),
          horizontalHint: horizontalScore(c),
        })),
      }),
    });
  } catch (err) {
    console.warn(
      `[editorJudge] holistic pass failed for ${job.jobId}:`,
      err instanceof Error ? err.message : err
    );
    // Soft reserve on outage — name-evidence local scores (not flat 60 junk).
    // Assembly also caps judge_fallback scenes so they cannot mint Exact Match 90+.
    gpt = {
      judgments: limited.map((c) => {
        const namesPerson = textMentionsPerson(titleLock.mainSubject, [
          c.title,
          c.snippet,
          c.queryUsed,
          c.urlOrPath,
          ...(c.relatedEntities || []),
        ]);
        const isRaw = isRawFootageSource(c.source);
        const visualEditorScore = isRaw ? 72 : namesPerson ? 76 : 48;
        return {
          candidateId: c.candidateId,
          editorDecision: (isRaw || namesPerson ? "approve" : "reject") as
            | "approve"
            | "reject"
            | "reserve"
            | "fallback_only",
          editorReason: namesPerson
            ? "Judge outage fallback — name evidence present"
            : isRaw
              ? "Judge outage fallback — raw clip reserved"
              : "Judge outage fallback — rejected (no celebrity name evidence)",
          visualEditorScore,
          titleSupportScore: namesPerson ? 78 : 40,
          narrationMatchScore: namesPerson || isRaw ? 70 : 40,
          instantClarityScore: 60,
          exactSubjectMatch: namesPerson ? 80 : isRaw ? 45 : 20,
          horizontalUsability: Math.max(70, horizontalScore(c)),
          documentaryUsefulness: namesPerson || isRaw ? 70 : 40,
          textHeavyPenalty: 20,
          watermarkRisk: 10,
          alteredTextRisk: 10,
          wrongContextRisk: namesPerson || isRaw ? 15 : 45,
          reusePotential: 45,
          isTextHeavy: false,
          matchedEntities: [
            ...(c.relatedEntities || []),
            ...(namesPerson && titleLock.mainSubject ? [titleLock.mainSubject] : []),
          ],
          warnings: [
            "judge_fallback",
            ...(namesPerson || isRaw ? [] : ["no_name_evidence"]),
            "needs human review",
          ],
        };
      }),
    };
  }

  for (const j of gpt.judgments || []) {
    const candidate = limited.find((c) => c.candidateId === j.candidateId);
    if (!candidate) continue;
    const scores: JudgmentScores = { ...toSharedScores(j, horizontalScore(candidate)) };
    const isTextHeavy = Boolean(j.isTextHeavy);
    const warnings = [...(j.warnings || [])];
    if (scores.watermarkRisk! > 15) warnings.push("possible watermark");
    if (scores.alteredTextRisk! > 15) warnings.push("possible altered text");
    if (scores.wrongContextRisk! > 30) warnings.push("possible wrong context");
    if (scores.horizontalUsability! < 75) warnings.push("portrait crop risk");
    if (isTextHeavy) warnings.push("text-heavy visual");
    if ((scores.visualEditorScore ?? 0) < 70) warnings.push("needs human review");

    let approved =
      (j.editorDecision === "approve" || j.editorDecision === "reserve") &&
      meetsEditorMinimum(scores, isTextHeavy);

    if (
      !approved &&
      j.editorDecision === "reserve" &&
      (scores.visualEditorScore ?? 0) >= 60 &&
      (scores.watermarkRisk ?? 0) <= 15 &&
      (scores.alteredTextRisk ?? 0) <= 15 &&
      (scores.wrongContextRisk ?? 0) <= 30 &&
      (scores.horizontalUsability ?? 0) >= 70
    ) {
      approved = true;
      warnings.push("related context — needs review");
    }

    if ((scores.visualEditorScore ?? 0) < 50) approved = false;

    // Ban inflated Exact Match from judge_fallback / stopword crumbs on web stills.
    const isFallback = warnings.some((w) => /judge_fallback/i.test(w));
    if (isFallback && !isRawFootageSource(candidate.source)) {
      scores.exactSubjectMatch = Math.min(scores.exactSubjectMatch ?? 0, 35);
      scores.visualEditorScore = Math.min(scores.visualEditorScore ?? 0, 60);
      scores.entityMatch = Math.min(scores.entityMatch ?? 0, 35);
      // Keep raw/atmosphere reserves; drop nameless Google junk from the library.
      const namesPerson = textMentionsPerson(titleLock.mainSubject, [
        candidate.title,
        candidate.snippet,
        candidate.queryUsed,
        candidate.urlOrPath,
        ...(candidate.relatedEntities || []),
        ...(j.matchedEntities || []),
      ]);
      if (!namesPerson) {
        approved = false;
        warnings.push("judge_fallback rejected — no celebrity name evidence");
      }
    }

    judgments.push({
      candidateId: j.candidateId,
      approved,
      scores,
      reason: j.editorReason || "",
      matchedEntities: j.matchedEntities || [],
      warnings: [...new Set(warnings)],
      editorDecision: j.editorDecision || (approved ? "approve" : "reject"),
      editorReason: j.editorReason || "",
      isTextHeavy,
    });
  }

  const seen = new Set(judgments.map((j) => j.candidateId));
  for (const c of limited) {
    if (seen.has(c.candidateId)) continue;
    const isRaw = isRawFootageSource(c.source);
    judgments.push({
      candidateId: c.candidateId,
      approved: isRaw,
      scores: toSharedScores(
        {
          candidateId: c.candidateId,
          editorDecision: isRaw ? "reserve" : "reject",
          editorReason: "Omitted from model response",
          visualEditorScore: isRaw ? Number(c.metadata?.qualityScore) || 68 : 40,
          titleSupportScore: 60,
          narrationMatchScore: 60,
          instantClarityScore: 65,
          exactSubjectMatch: 50,
          horizontalUsability: horizontalScore(c),
          documentaryUsefulness: 60,
          textHeavyPenalty: 15,
          watermarkRisk: 10,
          alteredTextRisk: 10,
          wrongContextRisk: 25,
          reusePotential: 55,
        },
        horizontalScore(c)
      ),
      reason: "Omitted from holistic response",
      matchedEntities: c.relatedEntities || [],
      warnings: ["omitted_by_model"],
      editorDecision: isRaw ? "reserve" : "reject",
      editorReason: "Omitted from model response",
    });
  }

  await writeJson(jobDataFile("editor-gpt-judgment", job.jobId), {
    jobId: job.jobId,
    policy: "documentary_editor_brain_holistic_once",
    mode: "holistic_editor_once",
    editorNotes: gpt.editorNotes || "",
    rawFootageShareTarget: gpt.rawFootageShareTarget || "",
    poolSummary: { total: limited.length, rawFootage: rawCount, imagesAndOther: imageCount },
    judgedCount: judgments.length,
    judgments,
  });
  await writeJson(jobDataFile("mystery-v1-gpt55-judgment", job.jobId), {
    jobId: job.jobId,
    policy: "documentary_editor_brain_holistic_once",
    judgedCount: judgments.length,
    judgments,
  });
  await writeJson(jobDataFile("visual-intelligence-gpt55-judgment", job.jobId), {
    jobId: job.jobId,
    mode: "holistic_editor_once",
    judgedCount: judgments.length,
    judgments,
  });

  return judgments;
}
