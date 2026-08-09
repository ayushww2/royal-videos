import { chatJson } from "../../openaiClient.js";
import { jobDataFile, loadJob, readJson, saveJob, writeJson } from "../../storage.js";
import type { LibraryAsset } from "../../library/types.js";
import type {
  ApprovedVisual,
  RoyalAssistantAction,
  RoyalManagerSummary,
  TimelineScene,
  VisualBeat,
} from "../../../shared/visualIntelligence.js";
import { auditRoyalV2Repetition, buildRoyalV2ManagerSummary, replaceRoyalV2Scene } from "./assignment.js";
import { rankRoyalAssets } from "./candidates.js";
import { loadRoyalLibraryAssets, royalAssetPreviewUrl, searchRoyalLibrary } from "./library.js";
import { runFinalQA } from "../finalQA.js";
import { planEditingEffects } from "../effectPlanner.js";
import { skipGptExceptJudge } from "../pipelineMode.js";

const READ_ACTIONS = new Set([
  "show_alternatives",
  "explain_visual_choice",
  "search_royal_library",
  "find_person_assets",
  "find_place_assets",
  "find_context_assets",
  "show_unused_assets",
  "show_overused_assets",
  "prepare_manager_review_summary",
  "show_weak_scenes",
]);

const MUTATING_ACTIONS = new Set([
  "find_better_visual",
  "replace_visual",
  "mark_needs_review",
  "use_raw_clip",
  "use_image_instead",
  "fix_all_low_confidence_scenes",
  "fix_all_repeated_visuals",
  "fix_generic_context_on_exact_person_scenes",
  "increase_raw_footage_usage",
  "reduce_asset_repetition",
  "find_missing_exact_places",
]);

const ALL_ACTIONS = new Set([...READ_ACTIONS, ...MUTATING_ACTIONS]);

interface AssistantRequest {
  message?: string;
  action?: string;
  sceneId?: string;
  assetId?: string;
  query?: string;
  confirmed?: boolean;
}

interface AssistantResult {
  action: RoyalAssistantAction;
  message: string;
  alternatives?: Array<Record<string, unknown>>;
  summary?: RoyalManagerSummary;
  scenes?: TimelineScene[];
}

function inferLocalAction(message: string): string | undefined {
  const m = message.toLowerCase();
  if (/why.*(choose|clip|visual)|explain.*(choice|visual)/.test(m)) return "explain_visual_choice";
  if (/mark.*needs review/.test(m)) return "mark_needs_review";
  if (/top 10|weak scene|needs review/.test(m)) return "show_weak_scenes";
  if (/fix.*repeat|repair.*repeat/.test(m)) return "fix_all_repeated_visuals";
  if (/reduce.*(repeat|palace exterior)/.test(m)) return "reduce_asset_repetition";
  if (/increase.*raw|more raw|raw footage below/.test(m)) return "increase_raw_footage_usage";
  if (/repair.*low.confidence|fix.*low.confidence/.test(m)) return "fix_all_low_confidence_scenes";
  if (/repair.*exact person|generic.*exact person/.test(m)) {
    return "fix_generic_context_on_exact_person_scenes";
  }
  if (/missing.*place|exact.*place/.test(m)) return "find_missing_exact_places";
  if (/better visual|replace.*clip/.test(m)) return "find_better_visual";
  if (/alternative/.test(m)) return "show_alternatives";
  if (/review summary|manager summary/.test(m)) return "prepare_manager_review_summary";
  if (/search.*library|find.*assets?/.test(m)) return "search_royal_library";
  return undefined;
}

async function inferActionWithGpt(
  message: string,
  selectedScene: TimelineScene | undefined,
  summary: RoyalManagerSummary | null
): Promise<{ action: string; target?: string; reason?: string }> {
  const result = await chatJson<{ action?: string; target?: string; reason?: string }>({
    system: `You route a Royal v2 manager request to one safe action.
Allowed actions: ${[...ALL_ACTIONS].join(", ")}.
Never invent another action. Return JSON { action, target, reason }.`,
    user: JSON.stringify({
      message,
      selectedScene: selectedScene
        ? {
            sceneId: selectedScene.sceneId,
            beatType: selectedScene.beatType,
            mainPerson: selectedScene.mainPerson,
            place: selectedScene.specificPlace,
            warnings: selectedScene.warnings,
          }
        : null,
      summary,
    }),
  });
  return {
    action: ALL_ACTIONS.has(result.action || "") ? result.action! : "prepare_manager_review_summary",
    target: result.target,
    reason: result.reason,
  };
}

function assetResult(asset: LibraryAsset): Record<string, unknown> {
  return {
    assetId: asset.assetId,
    person: asset.person,
    group: asset.group,
    mediaType: asset.mediaType,
    category: asset.category,
    description: asset.description,
    previewUrl: royalAssetPreviewUrl(asset),
  };
}

async function appendAction(jobId: string, action: RoyalAssistantAction): Promise<void> {
  const file = jobDataFile("royal-v2-assistant-actions", jobId);
  const report =
    (await readJson<{ jobId: string; actions: RoyalAssistantAction[] }>(file)) ||
    { jobId, actions: [] };
  report.actions.push({ ...action, createdAt: new Date().toISOString() });
  await writeJson(file, { ...report, updatedAt: new Date().toISOString() });
}

async function saveTimelineState(
  job: NonNullable<Awaited<ReturnType<typeof loadJob>>>,
  scenes: TimelineScene[],
  approved: ApprovedVisual[],
  assets: LibraryAsset[],
  beats: VisualBeat[]
): Promise<RoyalManagerSummary> {
  const jobId = job.jobId;
  const counts = usedCounts(scenes);
  for (const scene of scenes) {
    scene.assetUsageCountVideo = counts.get(scene.selectedVisualId) || 0;
    scene.assetUsageCountCurrentMinute = scenes.filter(
      (other) =>
        other.selectedVisualId === scene.selectedVisualId &&
        Math.abs(other.startTime - scene.startTime) < 60
    ).length;
  }
  const violations = auditRoyalV2Repetition(scenes, assets);
  const libraryUrls = new Map(
    approved.map((visual) => [visual.approvedVisualId, visual.filePathOrUrl])
  );
  const effectReport = await planEditingEffects({ job, scenes, beats, libraryUrls });
  const effectsByScene = new Map<string, typeof effectReport.events>();
  for (const event of effectReport.events) {
    if (!event.sceneId) continue;
    const list = effectsByScene.get(event.sceneId) || [];
    list.push(event);
    effectsByScene.set(event.sceneId, list);
  }
  for (const scene of scenes) {
    scene.effects = (effectsByScene.get(scene.sceneId) || []).map((event) => ({
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
    }));
  }
  if (effectReport.events.length && !skipGptExceptJudge()) {
    job.gptCallsUsed = (job.gptCallsUsed || 0) + 1;
    job.estimatedCostUsd = Number(((job.gptCallsUsed || 0) * 0.02).toFixed(2));
  }
  await writeJson(jobDataFile("visual-intelligence-final-assignment", jobId), { jobId, scenes });
  await writeJson(jobDataFile("royal-v2-final-assignment", jobId), { jobId, scenes });
  await writeJson(jobDataFile("visual-intelligence-approved-library", jobId), {
    jobId,
    approved,
    source: "Royal Media Library on R2",
    updatedAt: new Date().toISOString(),
  });
  await writeJson(jobDataFile("royal-v2-repetition-audit", jobId), {
    jobId,
    violations,
    blockedViolations: violations.filter((item) => item.severity === "blocked").length,
    updatedAt: new Date().toISOString(),
  });
  const summary = buildRoyalV2ManagerSummary(jobId, scenes, violations);
  await writeJson(jobDataFile("royal-v2-manager-summary", jobId), summary);
  await writeJson(jobDataFile("royal-v2-raw-usage", jobId), {
    jobId,
    uniqueRawUsed: summary.uniqueRawUsed,
    rawSceneCount: summary.rawFootageScenes,
    totalScenes: summary.totalScenes,
    rawPercent: summary.rawFootagePercent,
    rawFootagePercent: summary.rawFootagePercent,
    rawByMinute: summary.rawScenesByMinute,
    rawScenesByMinute: summary.rawScenesByMinute,
    updatedAt: new Date().toISOString(),
  });
  await runFinalQA(jobId, scenes);
  return summary;
}

function usedCounts(scenes: TimelineScene[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const scene of scenes) {
    if (scene.selectedVisualId) usage.set(scene.selectedVisualId, (usage.get(scene.selectedVisualId) || 0) + 1);
  }
  return usage;
}

async function chooseAndReplace(params: {
  scene: TimelineScene;
  beat: VisualBeat;
  scenes: TimelineScene[];
  assets: LibraryAsset[];
  mediaType?: "image" | "raw_footage";
  requireExact?: boolean;
  requestedAssetId?: string;
}): Promise<{ scene: TimelineScene; approved: ApprovedVisual } | null> {
  const usage = usedCounts(params.scenes);
  const usedMinute = new Set(
    params.scenes
      .filter(
        (scene) =>
          scene.sceneId !== params.scene.sceneId &&
          Math.abs(scene.startTime - params.scene.startTime) < 60
      )
      .map((scene) => scene.selectedVisualId)
  );
  let candidates = rankRoyalAssets(params.assets, params.beat, usage, usedMinute).filter(
    (item) =>
      item.asset.assetId !== params.scene.selectedVisualId &&
      (usage.get(item.asset.assetId) || 0) < 1 &&
      !usedMinute.has(item.asset.assetId)
  );
  if (params.mediaType) candidates = candidates.filter((item) => item.asset.mediaType === params.mediaType);
  if (params.requireExact) {
    candidates = candidates.filter((item) =>
      params.beat.beatType === "exact_place"
        ? item.exactPlace
        : params.beat.beatType === "exact_pair_or_group"
          ? item.exactPair
          : item.exactPerson
    );
  }
  const asset = params.requestedAssetId
    ? params.assets.find((item) => item.assetId === params.requestedAssetId)
    : candidates[0]?.asset;
  if (!asset) return null;
  const replacement = await replaceRoyalV2Scene(params.scene, params.beat, asset, params.assets);
  replacement.scene = {
    ...replacement.scene,
    sceneId: params.scene.sceneId,
    effects: params.scene.effects,
  };
  return replacement;
}

export async function handleRoyalV2Assistant(
  jobId: string,
  request: AssistantRequest
): Promise<AssistantResult> {
  const job = await loadJob(jobId);
  if (!job || job.niche !== "Royal v2") throw new Error("Royal v2 job not found");
  const assignment = await readJson<{ scenes: TimelineScene[] }>(
    jobDataFile("visual-intelligence-final-assignment", jobId)
  );
  const beatReport = await readJson<{ beats: VisualBeat[] }>(
    jobDataFile("royal-v2-visual-plan", jobId)
  );
  const libraryReport = await readJson<{ approved: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", jobId)
  );
  const summary =
    (await readJson<RoyalManagerSummary>(jobDataFile("royal-v2-manager-summary", jobId))) || null;
  const scenes = assignment?.scenes || [];
  const beats = beatReport?.beats || [];
  const approved = libraryReport?.approved || [];
  const selected = scenes.find((scene) => scene.sceneId === request.sceneId);

  let actionName = request.action || inferLocalAction(request.message || "");
  let inferredReason = request.message || "Manager requested Royal v2 assistance";
  if (!actionName) {
    const inferred = await inferActionWithGpt(request.message || "", selected, summary);
    actionName = inferred.action;
    inferredReason = inferred.reason || inferredReason;
    job.gptCallsUsed = (job.gptCallsUsed || 0) + 1;
    job.estimatedCostUsd = Number(((job.gptCallsUsed || 0) * 0.02).toFixed(2));
    await saveJob(job);
  }
  if (!ALL_ACTIONS.has(actionName)) throw new Error(`Unsupported assistant action: ${actionName}`);

  const requiresConfirmation = MUTATING_ACTIONS.has(actionName);
  const action: RoyalAssistantAction = {
    action: actionName,
    target: request.sceneId || jobId,
    reason: inferredReason,
    before: selected || summary,
    after: null,
    requiresConfirmation,
    applied: false,
  };

  if (requiresConfirmation && job.timelineLock?.locked) {
    action.reason = "Timeline is locked. Unlock it with manager confirmation before changing scenes.";
    await appendAction(jobId, action);
    return { action, message: action.reason };
  }

  if (actionName === "prepare_manager_review_summary" || actionName === "show_weak_scenes") {
    action.after = summary;
    action.requiresConfirmation = false;
    await appendAction(jobId, action);
    return {
      action,
      message: summary
        ? `${summary.lowConfidenceScenes} low-confidence scenes; ${summary.repeatedVisualWarnings} repetition warnings.`
        : "Manager summary is not available yet.",
      summary: summary || undefined,
      scenes: scenes.filter((scene) => scene.needsBetterVisual || scene.confidence < 0.7).slice(0, 10),
    };
  }

  if (actionName === "explain_visual_choice") {
    if (!selected) throw new Error("Select a scene to explain");
    action.after = {
      reasonSelected: selected.reasonSelected,
      matchType: selected.matchType,
      confidence: selected.confidence,
      warnings: selected.warnings,
    };
    action.requiresConfirmation = false;
    await appendAction(jobId, action);
    return { action, message: selected.reasonSelected };
  }

  if (
    ["search_royal_library", "find_person_assets", "find_place_assets", "find_context_assets", "show_unused_assets"].includes(
      actionName
    )
  ) {
    const query =
      request.query ||
      request.message ||
      selected?.mainPerson ||
      selected?.specificPlace ||
      selected?.contextType ||
      "";
    const used = actionName === "show_unused_assets" ? new Set(scenes.map((scene) => scene.selectedVisualId)) : undefined;
    const assets = await searchRoyalLibrary(query, { limit: 20, unusedIds: used });
    action.after = assets.map((asset) => asset.assetId);
    action.requiresConfirmation = false;
    await appendAction(jobId, action);
    return { action, message: `Found ${assets.length} approved Royal Media Library assets.`, alternatives: assets.map(assetResult) };
  }

  if (actionName === "show_overused_assets") {
    const counts = [...usedCounts(scenes)]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([assetId, count]) => ({ assetId, count }));
    action.after = counts;
    action.requiresConfirmation = false;
    await appendAction(jobId, action);
    return { action, message: `${counts.length} assets have three or more uses.`, alternatives: counts };
  }

  const assets = await loadRoyalLibraryAssets();
  const beatById = new Map(beats.map((beat) => [beat.beatId, beat]));

  if (["show_alternatives", "find_better_visual"].includes(actionName) && !request.confirmed) {
    if (!selected) throw new Error("Select a scene first");
    const beat = beatById.get(selected.beatId);
    if (!beat) throw new Error("Scene beat not found");
    const alternatives = rankRoyalAssets(assets, beat, usedCounts(scenes), new Set())
      .filter((item) => item.asset.assetId !== selected.selectedVisualId)
      .slice(0, 10);
    action.after = alternatives.map((item) => item.asset.assetId);
    action.requiresConfirmation = actionName === "find_better_visual";
    await appendAction(jobId, action);
    return {
      action,
      message: `Found ${alternatives.length} alternatives. Confirm to apply the top choice.`,
      alternatives: alternatives.map((item) => ({ ...assetResult(item.asset), scores: item.scores })),
    };
  }

  if (requiresConfirmation && !request.confirmed) {
    action.after = "Pending manager confirmation";
    await appendAction(jobId, action);
    return { action, message: "This action changes the timeline. Confirm to apply it." };
  }

  const updated = [...scenes];
  const approvedById = new Map(approved.map((visual) => [visual.approvedVisualId, visual]));
  const replaceOne = async (
    scene: TimelineScene,
    options?: { mediaType?: "image" | "raw_footage"; requireExact?: boolean; requestedAssetId?: string }
  ): Promise<boolean> => {
    const beat = beatById.get(scene.beatId);
    if (!beat) return false;
    const replacement = await chooseAndReplace({
      scene,
      beat,
      scenes: updated,
      assets,
      ...options,
    });
    if (!replacement) return false;
    const index = updated.findIndex((item) => item.sceneId === scene.sceneId);
    updated[index] = replacement.scene;
    approvedById.set(replacement.approved.approvedVisualId, replacement.approved);
    return true;
  };

  let changed = 0;
  if (["replace_visual", "find_better_visual", "use_raw_clip", "use_image_instead"].includes(actionName)) {
    if (!selected) throw new Error("Select a scene first");
    changed += (await replaceOne(selected, {
      mediaType:
        actionName === "use_raw_clip" ? "raw_footage" : actionName === "use_image_instead" ? "image" : undefined,
      requestedAssetId: request.assetId,
    }))
      ? 1
      : 0;
  } else if (actionName === "mark_needs_review") {
    if (!selected) throw new Error("Select a scene first");
    const index = updated.findIndex((scene) => scene.sceneId === selected.sceneId);
    updated[index] = {
      ...selected,
      needsBetterVisual: true,
      assistantSuggestionAvailable: true,
      warnings: [...new Set([...(selected.warnings || []), "Needs Review"])],
    };
    job.sceneApprovals = { ...(job.sceneApprovals || {}), [selected.sceneId]: "rejected" };
    changed = 1;
  } else {
    const targets = updated.filter((scene) => {
      if (actionName === "fix_all_low_confidence_scenes") return scene.confidence < 0.7 || scene.needsBetterVisual;
      if (actionName === "fix_all_repeated_visuals" || actionName === "reduce_asset_repetition") {
        return scene.repeatDistanceWarning || scene.warnings.some((warning) => /repeat|overused/i.test(warning));
      }
      if (actionName === "fix_generic_context_on_exact_person_scenes") {
        return (
          ["exact_person", "exact_pair_or_group"].includes(scene.beatType || "") &&
          scene.matchType !== "exact_match"
        );
      }
      if (actionName === "find_missing_exact_places") {
        return scene.beatType === "exact_place" && scene.matchType !== "exact_match";
      }
      if (actionName === "increase_raw_footage_usage") {
        return !scene.rawFootageUsed && !["exact_person", "exact_pair_or_group", "exact_place"].includes(scene.beatType || "");
      }
      return false;
    });
    const limit = actionName === "increase_raw_footage_usage" ? Math.ceil(updated.length * 0.2) : targets.length;
    for (const scene of targets.slice(0, limit)) {
      const exact = ["fix_generic_context_on_exact_person_scenes", "find_missing_exact_places"].includes(actionName);
      const success = await replaceOne(scene, {
        mediaType: actionName === "increase_raw_footage_usage" ? "raw_footage" : undefined,
        requireExact: exact,
      });
      if (success) changed += 1;
    }
  }

  const nextSummary = await saveTimelineState(job, updated, [...approvedById.values()], assets, beats);
  job.timelineLock = undefined;
  job.status = "scene_review_ready";
  job.stats = {
    ...(job.stats || {
      visualBeats: beats.length,
      queryPacks: 0,
      braveQueriesUsed: 0,
      candidatesCollected: assets.length,
      candidatesFiltered: 0,
      gptJudged: 0,
      approvedLibrarySize: approvedById.size,
      finalScenes: updated.length,
      fallbackScenes: 0,
      wrongEntityWarnings: 0,
      repeatedVisualWarnings: 0,
    }),
    finalScenes: updated.length,
    fallbackScenes: nextSummary.lowConfidenceScenes,
    needsBetterVisualScenes: nextSummary.lowConfidenceScenes,
    repeatedVisualWarnings: nextSummary.repeatedVisualWarnings,
    rawFootagePercent: nextSummary.rawFootagePercent,
    exactPersonMatches: nextSummary.exactPersonScenes,
    exactPlaceMatches: nextSummary.exactPlaceScenes,
    weakScenes: nextSummary.lowConfidenceScenes,
  };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  action.after = { changedScenes: changed, summary: nextSummary };
  action.applied = true;
  await appendAction(jobId, action);
  return {
    action,
    message: changed ? `Applied ${actionName} to ${changed} scene(s).` : "No safe replacement was available.",
    summary: nextSummary,
  };
}

