import { analyzeGlobalContext } from "../globalContext.js";
import { planEditingEffects } from "../effectPlanner.js";
import { planRoyalV2SceneSfx } from "./sfxPlanner.js";
import { planRoyalV2BackgroundMusic } from "./musicPlanner.js";
import { planRoyalV2GlitchOverlays } from "./glitchPlanner.js";
import { runFinalQA } from "../finalQA.js";
import { loadJob, saveJob, jobDataFile, writeJson } from "../../storage.js";
import { createRoyalV2Beats } from "./beats.js";
import { collectRoyalV2CandidatePool } from "./candidates.js";
import {
  assembleRoyalV2Timeline,
  auditRoyalV2Repetition,
  buildRoyalV2ManagerSummary,
  repairSoftApprovalFails,
} from "./assignment.js";
import { repairRoyalV2WithExternalSearch } from "./externalFallback.js";
import {
  runRoyalV2SoftApproval,
  shouldHoldAutoApproveForSoftFail,
  shouldHoldAutoApproveForSoftUnsure,
} from "./softApproval.js";
import { skipGptExceptJudge } from "../pipelineMode.js";
import type {
  JobRecord,
  PipelineStats,
  SoftApprovalReport,
  TimelineScene,
} from "../../../shared/visualIntelligence.js";

const STAGE_PROGRESS: Partial<Record<JobRecord["status"], number>> = {
  queued: 0,
  script_analysis: 8,
  beat_breakdown: 22,
  library_candidate_collection: 42,
  visual_assignment: 62,
  repetition_audit: 74,
  weak_scene_repair: 82,
  effect_planning: 90,
  scene_review_ready: 100,
};

function isCriticalFlaggedScene(scene: TimelineScene): boolean {
  if (!scene.selectedVisualId) return true;
  if (scene.confidence < 0.7 && scene.needsBetterVisual) return true;
  return (scene.warnings || []).some((warning) =>
    /wrong-person|Wrong-person|wrong place|Specific place mentioned|No acceptable library asset|invalid raw/i.test(
      warning
    )
  );
}

function isSafeAutoApproveScene(
  scene: TimelineScene,
  softReport?: SoftApprovalReport | null
): boolean {
  if (!scene.selectedVisualId || !scene.approvedVisualId) return false;
  if (isCriticalFlaggedScene(scene)) return false;
  if (softReport) {
    if (shouldHoldAutoApproveForSoftFail(scene, softReport)) return false;
    if (shouldHoldAutoApproveForSoftUnsure(scene, softReport)) return false;
  } else if (scene.softApproval === "fail") {
    return false;
  }
  // Auto-approve safe + warn-but-renderable scenes so bulk stays render-ready.
  return scene.confidence >= 0.7 || !scene.needsBetterVisual;
}

function attachEffects(
  scenes: TimelineScene[],
  events: Awaited<ReturnType<typeof planEditingEffects>>["events"]
): TimelineScene[] {
  const byScene = new Map<string, typeof events>();
  for (const event of events) {
    if (!event.sceneId) continue;
    const list = byScene.get(event.sceneId) || [];
    list.push(event);
    byScene.set(event.sceneId, list);
  }
  return scenes.map((scene) => ({
    ...scene,
    effects: (byScene.get(scene.sceneId) || []).map((event) => ({
      id: event.id,
      presetId: event.presetId,
      reason: event.reason,
      durationFrames: event.durationFrames,
      startFrame: event.startFrame,
      props: event.props,
      blocksSubtitles: event.blocksSubtitles,
      tags: event.tags,
      renderProvider: "remotion",
      renderable: event.props?._renderable !== false,
      simplified: event.props?._simplified === true,
      renderReason: event.props?._renderReason,
      renderWarning: event.props?._renderWarning,
    })),
  }));
}

export async function runRoyalV2Pipeline(jobId: string): Promise<JobRecord> {
  const job = await loadJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.niche !== "Royal v2") throw new Error("Royal v2 pipeline requires a Royal v2 job");
  const stageStarted = new Map<JobRecord["status"], number>();

  const update = async (status: JobRecord["status"], patch?: Partial<JobRecord>) => {
    const now = Date.now();
    const previous = job.status;
    const previousStart = stageStarted.get(previous);
    if (previousStart) {
      job.stageTimings = {
        ...(job.stageTimings || {}),
        [previous]: now - previousStart,
      };
    }
    stageStarted.set(status, now);
    job.lastSuccessfulStatus = status;
    job.status = status;
    job.progressPercent = STAGE_PROGRESS[status] ?? job.progressPercent ?? 0;
    job.stageStartedAt = new Date(now).toISOString();
    job.updatedAt = job.stageStartedAt;
    Object.assign(job, patch || {});
    await saveJob(job);
  };

  try {
    await update("script_analysis", { error: undefined, timelineLock: undefined });
    if (job.customEditInstructions?.trim()) {
      await writeJson(jobDataFile("custom-edit-instructions", job.jobId), {
        jobId: job.jobId,
        customEditInstructions: job.customEditInstructions.trim(),
        appliedAt: new Date().toISOString(),
        note: "Passed into Royal v2 planning context and knowledge editor",
      });
      console.log(
        `[royal-v2] custom edit instructions (${job.customEditInstructions.trim().length} chars) for ${job.jobId}`
      );
    }
    const context = await analyzeGlobalContext(job);
    if (!skipGptExceptJudge()) job.gptCallsUsed = (job.gptCallsUsed || 0) + 1;

    await update("beat_breakdown");
    const beatResult = await createRoyalV2Beats(job, context);
    job.gptCallsUsed = (job.gptCallsUsed || 0) + beatResult.gptCallsUsed;

    await update("library_candidate_collection");
    const { assets } = await collectRoyalV2CandidatePool(job.jobId, beatResult.beats);

    await update("visual_assignment");
    const assignment = await assembleRoyalV2Timeline(job.jobId, beatResult.beats, assets);
    let scenes = assignment.scenes;
    let library = assignment.library;
    let violations = assignment.violations;
    let externalSearchesUsed = 0;
    let externalAssetsUsed = 0;

    await update("repetition_audit");
    // Assignment enforces the 60-second and hard-five rules while selecting.
    // The saved audit verifies the final result and flags metadata near-duplicates.

    await update("weak_scene_repair");
    const external = await repairRoyalV2WithExternalSearch({
      job,
      context,
      beats: beatResult.beats,
      scenes,
    });
    if (external.repairedScenes) {
      scenes = external.scenes;
      library = [...library, ...external.externalVisuals];
      violations = auditRoyalV2Repetition(scenes, assets);
      await writeJson(jobDataFile("visual-intelligence-approved-library", job.jobId), {
        jobId: job.jobId,
        approved: library,
        source: "Royal Media Library first; external fallback only for weak scenes",
        createdAt: new Date().toISOString(),
      });
      await writeJson(jobDataFile("royal-v2-final-assignment", job.jobId), { jobId: job.jobId, scenes });
      await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), {
        jobId: job.jobId,
        scenes,
      });
      await writeJson(jobDataFile("royal-v2-repetition-audit", job.jobId), {
        jobId: job.jobId,
        violations,
        blockedViolations: violations.filter((item) => item.severity === "blocked").length,
        createdAt: new Date().toISOString(),
      });
    }
    externalSearchesUsed = external.searchesUsed;
    externalAssetsUsed = external.repairedScenes;
    job.gptCallsUsed = (job.gptCallsUsed || 0) + external.gptCallsUsed;
    await writeJson(jobDataFile("royal-v2-external-fallback", job.jobId), {
      jobId: job.jobId,
      weakScenesConsidered: assignment.scenes.filter((scene) => scene.needsBetterVisual).length,
      searchesUsed: external.searchesUsed,
      candidatesApproved: external.externalVisuals.length,
      repairedScenes: external.repairedScenes,
      createdAt: new Date().toISOString(),
    });

    await update("effect_planning");
    const urls = new Map(library.map((visual) => [visual.approvedVisualId, visual.filePathOrUrl]));
    const effectReport = await planEditingEffects({
      job,
      scenes,
      beats: beatResult.beats,
      libraryUrls: urls,
    });
    if (effectReport.events.length && !skipGptExceptJudge()) {
      job.gptCallsUsed = (job.gptCallsUsed || 0) + 1;
    }
    scenes = attachEffects(scenes, effectReport.events);

    // International Royal scene-change SFX (soft bed + GPT accents). Under VO.
    let sfxEvents: Awaited<ReturnType<typeof planRoyalV2SceneSfx>>["events"] = [];
    try {
      const sfxPlan = await planRoyalV2SceneSfx({
        scenes,
        effectEvents: effectReport.events,
      });
      sfxEvents = sfxPlan.events;
      job.gptCallsUsed = (job.gptCallsUsed || 0) + sfxPlan.gptCallsUsed;
      await writeJson(jobDataFile("royal-v2-sfx-plan", job.jobId), {
        jobId: job.jobId,
        ...sfxPlan.report,
        events: sfxEvents,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(
        `[royal-v2] sfx planning failed for ${job.jobId} (continuing):`,
        err instanceof Error ? err.message : String(err)
      );
    }

    // International Royal background music (sparse beds, max 3 tracks). Under VO.
    let musicEvents: Awaited<ReturnType<typeof planRoyalV2BackgroundMusic>>["events"] = [];
    try {
      const musicPlan = await planRoyalV2BackgroundMusic({ scenes });
      musicEvents = musicPlan.events;
      job.gptCallsUsed = (job.gptCallsUsed || 0) + musicPlan.gptCallsUsed;
      await writeJson(jobDataFile("royal-v2-music-plan", job.jobId), {
        jobId: job.jobId,
        ...musicPlan.report,
        events: musicEvents,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(
        `[royal-v2] music planning failed for ${job.jobId} (continuing):`,
        err instanceof Error ? err.message : String(err)
      );
    }

    // Sparse glitch overlays (~0.75s + sound) on chapter/crisis/reveal. Opt-in ROYAL_GLITCH.
    let glitchEvents: Awaited<ReturnType<typeof planRoyalV2GlitchOverlays>>["events"] = [];
    try {
      const glitchPlan = await planRoyalV2GlitchOverlays({
        scenes,
        effectEvents: effectReport.events,
      });
      glitchEvents = glitchPlan.events;
      // Avoid double-hit: drop soft scene-change SFX where a glitch already plays.
      if (glitchEvents.length && sfxEvents.length) {
        const glitchSceneIds = new Set(
          glitchEvents.map((g) => g.sceneId).filter(Boolean) as string[]
        );
        const before = sfxEvents.length;
        sfxEvents = sfxEvents.filter(
          (e) => !(e.sceneId && glitchSceneIds.has(e.sceneId) && e.reason === "scene_change_soft")
        );
        if (sfxEvents.length !== before) {
          await writeJson(jobDataFile("royal-v2-sfx-plan", job.jobId), {
            jobId: job.jobId,
            note: "soft SFX removed where glitch overlay plays",
            events: sfxEvents,
            createdAt: new Date().toISOString(),
          });
        }
      }
      await writeJson(jobDataFile("royal-v2-glitch-plan", job.jobId), {
        jobId: job.jobId,
        ...glitchPlan.report,
        events: glitchEvents,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(
        `[royal-v2] glitch planning failed for ${job.jobId} (continuing):`,
        err instanceof Error ? err.message : String(err)
      );
    }

    // Soft person-identity check after assignment (before final QA). Non-blocking by default.
    // Default: full check of all person/pair beats. PIPELINE_EFFICIENT samples ~20% (opt-in).
    // Fails → library-only re-pick by description (1–2 rounds), then re-check.
    let softReport: SoftApprovalReport | null = null;
    try {
      let soft = await runRoyalV2SoftApproval({
        jobId: job.jobId,
        scenes,
        library,
      });
      scenes = soft.scenes;
      softReport = soft.report;
      job.gptCallsUsed = (job.gptCallsUsed || 0) + soft.gptCallsUsed;

      const MAX_SOFT_REPAIR_ROUNDS = 2;
      const repairRounds: Array<{ round: number; repairedCount: number; remainingFails: number }> =
        [];
      for (let round = 1; round <= MAX_SOFT_REPAIR_ROUNDS; round++) {
        if ((softReport.failCount || 0) <= 0) break;
        const repaired = await repairSoftApprovalFails({
          scenes,
          beats: beatResult.beats,
          assets,
          library,
        });
        if (repaired.repairedCount <= 0) break;
        scenes = repaired.scenes;
        library = repaired.library;
        violations = auditRoyalV2Repetition(scenes, assets);
        soft = await runRoyalV2SoftApproval({
          jobId: job.jobId,
          scenes,
          library,
        });
        scenes = soft.scenes;
        softReport = soft.report;
        job.gptCallsUsed = (job.gptCallsUsed || 0) + soft.gptCallsUsed;
        repairRounds.push({
          round,
          repairedCount: repaired.repairedCount,
          remainingFails: softReport.failCount,
        });
      }
      if (repairRounds.length) {
        await writeJson(jobDataFile("royal-v2-soft-approval-repair", job.jobId), {
          jobId: job.jobId,
          rounds: repairRounds,
          repairedCount: repairRounds.reduce((n, r) => n + r.repairedCount, 0),
          remainingFails: softReport.failCount,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn(
        `[royal-v2] soft approval failed for ${job.jobId} (continuing):`,
        err instanceof Error ? err.message : String(err)
      );
    }

    await writeJson(jobDataFile("royal-v2-final-assignment", job.jobId), {
      jobId: job.jobId,
      scenes,
      effectEvents: effectReport.events,
      sfxEvents,
      musicEvents,
      glitchEvents,
      createdAt: new Date().toISOString(),
    });
    await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), {
      jobId: job.jobId,
      scenes,
      effectEvents: effectReport.events,
      sfxEvents,
      musicEvents,
      glitchEvents,
    });

    const qa = await runFinalQA(job.jobId, scenes);
    const summary = buildRoyalV2ManagerSummary(job.jobId, scenes, violations);
    await writeJson(jobDataFile("royal-v2-manager-summary", job.jobId), summary);
    await writeJson(jobDataFile("royal-v2-assistant-actions", job.jobId), {
      jobId: job.jobId,
      actions: [],
      updatedAt: new Date().toISOString(),
    });

    const rawScenes = scenes.filter((scene) => scene.rawFootageUsed);
    const exactPerson = scenes.filter(
      (scene) =>
        ["exact_person", "exact_pair_or_group"].includes(scene.beatType || "") &&
        scene.matchType === "exact_match"
    ).length;
    const exactPlace = scenes.filter(
      (scene) => scene.beatType === "exact_place" && scene.matchType === "exact_match"
    ).length;
    const stats: PipelineStats = {
      visualBeats: beatResult.beats.length,
      queryPacks: 0,
      braveQueriesUsed: 0,
      imageQueriesUsed: 0,
      candidatesCollected: assets.length,
      candidatesFiltered: 0,
      gptJudged: 0,
      approvedLibrarySize: library.length,
      finalScenes: scenes.length,
      fallbackScenes: scenes.filter((scene) => scene.needsBetterVisual).length,
      needsBetterVisualScenes: scenes.filter((scene) => scene.needsBetterVisual).length,
      wrongEntityWarnings: scenes.filter((scene) =>
        scene.warnings.some((warning) => /wrong-person|specific place/i.test(warning))
      ).length,
      repeatedVisualWarnings: violations.length,
      averageEditorScore: Number(
        (
          scenes.reduce((n, scene) => n + scene.confidence * 100, 0) /
          Math.max(1, scenes.length)
        ).toFixed(1)
      ),
      exactMatchScenes: scenes.filter((scene) => scene.matchType === "exact_match").length,
      rawFootagePercent: summary.rawFootagePercent,
      exactPersonMatches: exactPerson,
      exactPlaceMatches: exactPlace,
      weakScenes: summary.lowConfidenceScenes,
      overusedVisuals: violations.filter((item) => item.kind === "overused_in_video").length,
    };
    const approvals = Object.fromEntries(
      scenes.map((scene) => [
        scene.sceneId,
        isSafeAutoApproveScene(scene, softReport) ? ("approved" as const) : ("pending" as const),
      ])
    );
    const autoApproved = Object.values(approvals).filter((status) => status === "approved").length;
    const flagged = Object.values(approvals).filter((status) => status === "pending").length;
    await writeJson(jobDataFile("royal-v2-auto-approval", job.jobId), {
      jobId: job.jobId,
      autoApproved,
      flagged,
      totalScenes: scenes.length,
      softApprovalBlocked: softReport?.blockedAutoApprove || false,
      softApprovalFails: softReport?.failCount || 0,
      createdAt: new Date().toISOString(),
    });
    job.estimatedCostUsd = Number(((job.gptCallsUsed || 0) * 0.02).toFixed(2));

    await update("scene_review_ready", {
      stats,
      sceneApprovals: approvals,
      render: { status: "idle" },
      error: qa.canRender ? undefined : `QA requires review: ${qa.criticalIssues.join("; ")}`,
    });
    await writeJson(jobDataFile("royal-v2-manager-summary", job.jobId), {
      ...summary,
      softApprovalFails: softReport?.failCount || 0,
      softApprovalUnsure: softReport?.unsureCount || 0,
      softApprovalChecked: softReport?.checkedCount || 0,
      softApprovalBlockedAutoApprove: softReport?.blockedAutoApprove || false,
      stageTimingsMs: job.stageTimings || {},
      gptCallsUsed: job.gptCallsUsed || 0,
      estimatedCostUsd: job.estimatedCostUsd || 0,
      libraryAssetsUsed: new Set(scenes.map((scene) => scene.selectedVisualId).filter(Boolean)).size,
      externalAssetsUsed,
      externalSearchesUsed,
      assetRepetitionViolations: violations.length,
      assistantRepairs: 0,
      managerApprovals: autoApproved,
      autoApprovedScenes: autoApproved,
      flaggedScenes: flagged,
      renderReadiness: summary.renderReady,
    });
    return job;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.status = "failed";
    job.error = message;
    job.updatedAt = new Date().toISOString();
    await saveJob(job);
    throw error;
  }
}

