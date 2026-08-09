/**
 * Shared documentary DIRECTOR pipeline for Celebrity / Mystery / Space.
 *
 * Flow:
 * 1) Title lock + full-script visual map (understand the film)
 * 2) Editor beats on VO clock (~3–5s meaning windows)
 * 3) Director Google query packs (identity/evidence-first)
 * 4) Collect ALL candidates (images + optional raw) before judging
 * 5) Soft filter (keep pool alive — missing dimensions warn, don't kill)
 * 6) Holistic editor judge on the full pool
 * 7) Approved library → greedy timeline assemble
 * 8) Director cut (sequence-level swaps from library only)
 * 9) Soft repair ONLY clearly wrong/empty scenes (targeted Google)
 * 10) Effects + final QA
 */
import { analyzeGlobalContext } from "../globalContext.js";
import { createTitleLock } from "../titleLock.js";
import { createFullScriptVisualMap } from "../fullScriptVisualMap.js";
import { createEditorVisualBeats } from "../editorBeats.js";
import { collectCandidates } from "../candidateCollection.js";
import { filterCandidates } from "../candidateFiltering.js";
import { mysterySoftFilter } from "../mysteryV1/softFilter.js";
import { celebritySoftFilter } from "../celebrityV1/softFilter.js";
import { editorJudgeCandidates } from "../editorJudge.js";
import {
  buildMysteryApprovedLibrary,
  assembleMysteryTimeline,
  saveMysteryCandidatePool,
} from "../mysteryV1/library.js";
import { buildApprovedLibrary } from "../approvedLibrary.js";
import { assembleTimeline } from "../timelineAssembly.js";
import { indexMysteryRawFootage } from "../mysteryV1/rawFootage.js";
import { indexRawFootage } from "../../rawFootage/indexRawFootage.js";
import {
  rawMixOptionsFromJob,
  userYoutubeClipsToCandidates,
} from "../../rawFootage/youtubeRawCandidates.js";
import { detectImportantEntities } from "../entityDetection.js";
import { planEditingEffects } from "../effectPlanner.js";
import { runFinalQA } from "../finalQA.js";
import { runMysteryFinalQA } from "../mysteryV1/qa.js";
import { createDirectorQueryPacks } from "./directorQueries.js";
import { runDirectorCut } from "./directorCut.js";
import { softRepairBrokenScenes } from "./softRepair.js";
import { createMysteryV2VisualPlan } from "../mysteryV2/visualPlan.js";
import { collectMysteryAiStills } from "../mysteryV2/collectAiStills.js";
import { persistMysteryV2Effects } from "../mysteryV2/effectDensity.js";
import { buildMysteryIntroPlan } from "../mysteryV2/introPlan.js";
import { loadJob, saveJob, readJson, writeJson, jobDataFile } from "../../storage.js";
import { clampScore } from "../editorScores.js";
import {
  celebrityRecipeActive,
} from "../celebrityV1/referenceRecipe.js";
import {
  persistCelebrityBeats,
  rewindowCelebrityBeats,
} from "../celebrityV1/beats.js";
import { enforceCelebrityDiversity } from "../celebrityV1/diversityPass.js";
import { extractCelebritySubjectFromTitle } from "../titleLock.js";
import { getJobTargetDurationSec } from "../jobDuration.js";
import {
  assignWarBeatsFromLibrary,
  type WarLibraryAssignResult,
} from "../warV1/assignFromLibrary.js";
import type {
  FullScriptVisualMap,
  GlobalContextReport,
  JobRecord,
  PipelineStats,
  TitleLock,
  VisualBeat,
  VisualCandidate,
} from "../../../shared/visualIntelligence.js";

async function loadExistingContext(jobId: string): Promise<GlobalContextReport | null> {
  return readJson<GlobalContextReport>(jobDataFile("visual-intelligence-global-context", jobId));
}
async function loadExistingTitleLock(jobId: string): Promise<TitleLock | null> {
  return readJson<TitleLock>(jobDataFile("title-lock", jobId));
}
async function loadExistingVisualMap(jobId: string): Promise<FullScriptVisualMap | null> {
  return readJson<FullScriptVisualMap>(jobDataFile("full-script-visual-map", jobId));
}
async function loadExistingBeats(jobId: string): Promise<VisualBeat[] | null> {
  const editor = await readJson<{ beats: VisualBeat[] }>(jobDataFile("editor-visual-beats", jobId));
  if (editor?.beats?.length) return editor.beats;
  const generic = await readJson<{ beats: VisualBeat[] }>(
    jobDataFile("visual-intelligence-beats", jobId)
  );
  return generic?.beats?.length ? generic.beats : null;
}

export async function runDirectorPipeline(jobId: string): Promise<JobRecord> {
  const job = await loadJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const isMystery = job.niche === "Mystery v1" || job.niche === "Mystery v2";
  const isMysteryV2 = job.niche === "Mystery v2";
  const isCelebrityRecipe = celebrityRecipeActive(job.niche);
  const isWar = job.niche === "War v1";

  const update = async (status: JobRecord["status"], patch?: Partial<JobRecord>) => {
    if (status !== "failed") job.lastSuccessfulStatus = status;
    job.status = status;
    job.updatedAt = new Date().toISOString();
    Object.assign(job, patch || {});
    await saveJob(job);
  };

  try {
    await update("analyzing_full_script", { error: undefined });

    let titleLock = await loadExistingTitleLock(job.jobId);
    if (!titleLock) titleLock = await createTitleLock(job);
    // Celebrity: repair stopword / title-crumb mainSubject (e.g. "At 96, the tragedy…").
    if (isCelebrityRecipe) {
      const extracted = extractCelebritySubjectFromTitle(job.title);
      const current = (titleLock.mainSubject || "").trim();
      const looksBad =
        !current ||
        current.split(/\s+/).length < 2 ||
        /^at\b/i.test(current) ||
        current.length > 80;
      if (extracted && (looksBad || !current.toLowerCase().includes(extracted.toLowerCase().split(/\s+/).pop() || ""))) {
        titleLock = {
          ...titleLock,
          mainSubject: extracted,
          centralObjectOrPlace: titleLock.centralObjectOrPlace || extracted,
        };
        await writeJson(jobDataFile("title-lock", job.jobId), {
          ...titleLock,
          repairedFromTitle: true,
        });
        console.log(`[celebrityV1] titleLock mainSubject → ${extracted}`);
      }
    }

    let visualMap = await loadExistingVisualMap(job.jobId);
    if (!visualMap) visualMap = await createFullScriptVisualMap(job, titleLock);

    let context = await loadExistingContext(job.jobId);
    if (!context) context = await analyzeGlobalContext(job);

    await update("creating_visual_beats");
    let beats = await loadExistingBeats(job.jobId);
    if (!beats?.length) beats = await createEditorVisualBeats(job, titleLock, visualMap, context);
    if (isCelebrityRecipe && beats?.length) {
      const targetDur = getJobTargetDurationSec(job);
      const rewindowed = rewindowCelebrityBeats(beats, targetDur);
      if (rewindowed.length !== beats.length || rewindowed[0]?.duration !== beats[0]?.duration) {
        console.log(
          `[celebrityV1] rewindow beats ${beats.length}@~${(beats[0]?.duration || 0).toFixed(1)}s → ${rewindowed.length}@~${(rewindowed[0]?.duration || 0).toFixed(1)}s`
        );
        beats = rewindowed;
        await persistCelebrityBeats(job, beats);
      }
    }
    await detectImportantEntities(job, beats);

    let rawChunkCandidates: VisualCandidate[] = [];
    if (job.userYoutubeRawIngest?.clips?.length) {
      rawChunkCandidates.push(...userYoutubeClipsToCandidates(job, beats));
    }
    if (job.rawFootagePaths?.length) {
      if (isMystery) {
        const raw = await indexMysteryRawFootage(job, beats);
        rawChunkCandidates.push(...raw.candidates);
      } else {
        rawChunkCandidates.push(...(await indexRawFootage(job, beats)));
      }
    }

    // War v1: GPT scans R2 library first; Google only for weak / missing beats.
    let warLib: WarLibraryAssignResult | null = null;
    if (isWar) {
      await update("collecting_visual_candidates");
      warLib = await assignWarBeatsFromLibrary({ job, beats, titleLock });
    }

    await update("creating_query_packs");
    let packs;
    let mysteryAiStills: Awaited<ReturnType<typeof createMysteryV2VisualPlan>>["aiStills"] = [];
    if (isMysteryV2) {
      const plan = await createMysteryV2VisualPlan({ job, titleLock, visualMap, beats });
      packs = plan.googlePacks;
      mysteryAiStills = plan.aiStills;
    } else {
      packs = await createDirectorQueryPacks(job, titleLock, visualMap, beats, {
        confusingSimilarEntities: context.confusingSimilarEntities,
        forbiddenEntities: context.forbiddenEntities,
        onlyBeatIds: warLib?.weakBeatIds?.length ? warLib.weakBeatIds : undefined,
      });
    }

    await update("collecting_visual_candidates");
    const collected = await collectCandidates(job, packs, beats, rawChunkCandidates);
    let candidates = collected.candidates;
    let imageQueriesUsed = collected.imageQueriesUsed;
    if (isMysteryV2 && mysteryAiStills.length) {
      const uniqueUrls = new Set(candidates.map((c) => c.urlOrPath).filter(Boolean)).size;
      // Pool already rich → light AI mix only so we can judge/render ASAP.
      const maxGenerate =
        uniqueUrls >= 350
          ? Math.min(12, mysteryAiStills.length)
          : Math.min(42, mysteryAiStills.length);
      console.log(
        `[mysteryV2] AI generate cap=${maxGenerate} (uniquePool=${uniqueUrls} plannedAi=${mysteryAiStills.length})`
      );
      const aiCands = await collectMysteryAiStills({
        job,
        aiStills: mysteryAiStills,
        maxGenerate,
      });
      candidates = [...candidates, ...aiCands];
      console.log(
        `[mysteryV2] AI stills added=${aiCands.length}/${mysteryAiStills.length} totalCandidates=${candidates.length}`
      );
    }
    if (warLib?.candidates?.length) {
      const seen = new Set(candidates.map((c) => c.candidateId));
      for (const c of warLib.candidates) {
        if (!seen.has(c.candidateId)) {
          candidates.push(c);
          seen.add(c.candidateId);
        }
      }
    }
    if (isMystery) await saveMysteryCandidatePool(job.jobId, candidates, imageQueriesUsed);

    const filtered = isMystery
      ? await mysterySoftFilter(job.jobId, candidates)
      : isCelebrityRecipe
        ? await celebritySoftFilter({
            jobId: job.jobId,
            candidates,
            beats,
            titleLock,
          })
        : await filterCandidates(job.jobId, candidates);

    // Keep War library GPT picks in the judge pool even if soft filter dropped them.
    let judgePool = filtered.kept;
    if (warLib?.candidates?.length) {
      const keptIds = new Set(judgePool.map((c) => c.candidateId));
      for (const c of warLib.candidates) {
        if (!keptIds.has(c.candidateId)) {
          judgePool.push(c);
          keptIds.add(c.candidateId);
        }
      }
    }

    await update("judging_candidates");
    let judgments = await editorJudgeCandidates(
      job,
      titleLock,
      visualMap,
      beats,
      judgePool
    );
    if (warLib?.judgments?.length) {
      const byId = new Map(judgments.map((j) => [j.candidateId, j]));
      for (const j of warLib.judgments) {
        byId.set(j.candidateId, j);
      }
      judgments = [...byId.values()];
    }

    await update("building_approved_visual_library");
    let library = isMystery
      ? await buildMysteryApprovedLibrary(job.jobId, judgePool, judgments, beats, titleLock)
      : await buildApprovedLibrary(job.jobId, judgePool, judgments, beats);

    if (warLib?.approved?.length) {
      const warBeatIds = new Set(warLib.assignedBeatIds);
      const warVisualIds = new Set(warLib.approved.map((a) => a.approvedVisualId));
      library = [
        ...warLib.approved,
        ...library.filter(
          (a) =>
            !warVisualIds.has(a.approvedVisualId) &&
            !(a.allowedBeatIds || []).some((id) => warBeatIds.has(id))
        ),
      ];
      await writeJson(jobDataFile("visual-intelligence-approved-library", job.jobId), {
        jobId: job.jobId,
        approved: library,
        warLibrarySeeded: warLib.approved.length,
        weakBeatIds: warLib.weakBeatIds,
      });
    }

    await update("assembling_timeline");
    let scenes = isMystery
      ? await assembleMysteryTimeline(job.jobId, beats, library, titleLock)
      : await assembleTimeline(job.jobId, beats, library, titleLock);

    // Director sequence pass — AI as picture editor
    const cut = await runDirectorCut({ job, titleLock, beats, scenes, library });
    scenes = cut.scenes;

    // Soft repair only wrong/empty scenes
    await update("weak_scene_repair");
    const repair = await softRepairBrokenScenes({
      job,
      titleLock,
      beats,
      scenes,
      library,
      maxRepairs: isCelebrityRecipe
        ? Math.min(6, Math.max(2, Math.ceil(scenes.length * 0.05)))
        : Math.min(10, Math.max(3, Math.ceil(scenes.length * 0.08))),
    });
    scenes = repair.scenes;
    library = repair.library;

    if (isCelebrityRecipe) {
      const diversity = enforceCelebrityDiversity({
        scenes,
        library,
        beats,
        titleLock,
      });
      scenes = diversity.scenes;
      console.log(
        `[celebrityV1] diversity pass swaps=${diversity.swaps} unique=${diversity.uniqueCount}/${scenes.length}`
      );
      await writeJson(jobDataFile("celebrity-v1-diversity-pass", job.jobId), {
        jobId: job.jobId,
        swaps: diversity.swaps,
        uniqueCount: diversity.uniqueCount,
        sceneCount: scenes.length,
      });
    }

    const libraryUrls = new Map<string, string>();
    for (const v of library) {
      if (v.filePathOrUrl) libraryUrls.set(v.approvedVisualId, v.filePathOrUrl);
    }

    await update("effect_planning");
    let effectEvents;
    let glitchEvents: Array<Record<string, unknown>> = [];
    let introPlan: Awaited<ReturnType<typeof buildMysteryIntroPlan>> | null = null;
    if (isMysteryV2) {
      const density = await persistMysteryV2Effects({
        jobId: job.jobId,
        title: job.title,
        scenes,
        beats,
        titleLock,
        libraryUrls,
      });
      effectEvents = density.events;
      glitchEvents = density.glitchEvents as unknown as Array<Record<string, unknown>>;
      introPlan = await buildMysteryIntroPlan({
        jobId: job.jobId,
        title: job.title,
        scenes,
        libraryUrls,
      });
    } else {
      const effectReport = await planEditingEffects({
        job,
        scenes,
        beats,
        titleLock,
        libraryUrls,
      });
      effectEvents = effectReport.events;
    }

    const effectsByScene = new Map<string, typeof effectEvents>();
    for (const ev of effectEvents) {
      if (!ev.sceneId) continue;
      const list = effectsByScene.get(ev.sceneId) || [];
      list.push(ev);
      effectsByScene.set(ev.sceneId, list);
    }

    const scenesWithEffects = scenes.map((s) => ({
      ...s,
      effects: (effectsByScene.get(s.sceneId) || []).map((e) => ({
        id: e.id,
        presetId: e.presetId,
        reason: e.reason,
        durationFrames: e.durationFrames,
        startFrame: e.startFrame,
        props: e.props,
        blocksSubtitles: e.blocksSubtitles,
        tags: e.tags,
        renderProvider: "remotion" as const,
        renderable: true,
        simplified: false,
        renderReason: e.props?._renderReason ? String(e.props._renderReason) : undefined,
        renderWarning: e.props?._renderWarning ? String(e.props._renderWarning) : undefined,
      })),
    }));

    await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), {
      jobId: job.jobId,
      scenes: scenesWithEffects,
      effectEvents,
      glitchEvents,
      cinematicIntro: introPlan || undefined,
      director: { cutNotes: cut.notes, swapsApplied: cut.swapsApplied, repaired: repair.repaired },
    });

    const qa = isMystery
      ? await runMysteryFinalQA(job.jobId, scenesWithEffects)
      : await runFinalQA(job.jobId, scenesWithEffects);

    const mix = rawMixOptionsFromJob(job);
    const rawDuration = scenesWithEffects
      .filter((s) => s.rawFootageUsed || s.source === "user_youtube_raw" || s.source === "raw_footage")
      .reduce((n, s) => n + (s.duration || 0), 0);
    const totalDuration = scenesWithEffects.reduce((n, s) => n + (s.duration || 0), 0) || 1;
    const editorScores = scenesWithEffects.map((s) =>
      clampScore((s.confidenceScores?.visualEditorScore ?? s.confidence * 100) as number)
    );
    const avg =
      editorScores.length > 0
        ? Math.round(editorScores.reduce((a, b) => a + b, 0) / editorScores.length)
        : 0;

    const stats: PipelineStats = {
      visualBeats: beats.length,
      queryPacks: packs.length,
      braveQueriesUsed: imageQueriesUsed,
      imageQueriesUsed,
      candidatesCollected: candidates.length,
      candidatesFiltered: filtered.rejected.length,
      gptJudged: judgments.length,
      approvedLibrarySize: library.length,
      finalScenes: scenesWithEffects.length,
      fallbackScenes: scenesWithEffects.filter((s) => s.needsBetterVisual).length,
      needsBetterVisualScenes: scenesWithEffects.filter((s) => s.needsBetterVisual).length,
      wrongEntityWarnings: scenesWithEffects.filter((s) =>
        s.warnings.some((w) => w.toLowerCase().includes("wrong"))
      ).length,
      repeatedVisualWarnings: scenesWithEffects.filter((s) => s.repeatDistanceWarning).length,
      averageEditorScore: avg,
      exactMatchScenes: scenesWithEffects.filter((s) => s.matchType === "exact_match").length,
      strongMatchScenes: scenesWithEffects.filter((s) => s.matchType === "strong_match").length,
      goodContextScenes: scenesWithEffects.filter((s) => s.matchType === "good_context").length,
      relatedContextScenes: scenesWithEffects.filter((s) => s.matchType === "related_context").length,
      rawFootagePercent: Number(((rawDuration / totalDuration) * 100).toFixed(1)),
      rawTargetPercent: mix?.rawTargetPercent,
      effectiveRawTargetPercent: mix?.effectiveRawTargetPercent,
      rawReducedReason: mix?.rawReducedReason,
      weakScenes: scenesWithEffects.filter((s) => s.needsBetterVisual).length,
    };

    const approvals: Record<string, "approved" | "rejected" | "pending"> = {};
    for (const s of scenesWithEffects) {
      const ves = clampScore(s.confidenceScores?.visualEditorScore ?? 0);
      const confScore = clampScore(
        typeof s.confidence === "number" ? s.confidence * 100 : 0
      );
      // Prefer assembly confidence when judge soft-fallback floors visualEditorScore at ~60.
      const score = clampScore(
        (s.warnings || []).some((w) => /judge_fallback/i.test(w))
          ? Math.max(ves, confScore)
          : ves || confScore
      );
      const unsafe = (s.warnings || []).some((w) =>
        /content_safety|offensive|middle.?finger|nsfw|soft_failed/i.test(w)
      );
      const matchOk =
        s.matchType === "exact_match" ||
        s.matchType === "strong_match" ||
        s.matchType === "good_context" ||
        (s.matchType === "related_context" && (s.rawFootageUsed || score >= 66));
      const openerRisk =
        s.sceneId === "scene-1" &&
        (s.warnings || []).some((w) => /opener|person-lock|wrong/i.test(w));
      // Celebrity recipe: soft-approve safe person beats so jobs are render-ready.
      // Mystery v2: no human scene review — auto-approve unless content-safety fail.
      if (isMysteryV2 && !unsafe) {
        approvals[s.sceneId] = "approved";
      } else if (isCelebrityRecipe && !unsafe && !openerRisk && score >= 62 && matchOk) {
        approvals[s.sceneId] = "approved";
      } else {
        approvals[s.sceneId] = "pending";
      }
    }

    await update("ready_for_scene_review", {
      stats,
      sceneApprovals: approvals,
      render: { status: "idle" },
      error: qa.canRender ? undefined : `QA critical issues: ${qa.criticalIssues.join("; ")}`,
    });

    // Mystery v2: auto-queue RunPod when ready (MYSTERY_V2_AUTO_RENDER=1, default on).
    const mysteryAutoRender = process.env.MYSTERY_V2_AUTO_RENDER !== "0";
    if (isMysteryV2 && mysteryAutoRender && qa.canRender) {
      try {
        const { renderJob } = await import("../../render/renderJob.js");
        console.log(`[mysteryV2] auto-queue RunPod render for ${job.jobId}`);
        void renderJob(job.jobId, { force: true }).catch((err) => {
          console.error(`[mysteryV2] auto-render failed ${job.jobId}`, err);
        });
      } catch (err) {
        console.warn(
          `[mysteryV2] auto-render import failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return job;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.error = message;
    job.updatedAt = new Date().toISOString();
    await saveJob(job);
    throw err;
  }
}
