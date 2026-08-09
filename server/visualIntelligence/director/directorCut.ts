/**
 * Holistic director cut: after greedy beat→visual assignment, one AI pass
 * reviews the full sequence against script/title and swaps only when a better
 * approved-library visual clearly improves the cut.
 */
import { chatJson } from "../../openaiClient.js";
import { jobDataFile, writeJson } from "../../storage.js";
import { skipGptExceptJudge } from "../pipelineMode.js";
import { isRawFootageSource } from "../../rawFootage/youtubeRawCandidates.js";
import type {
  ApprovedVisual,
  JobRecord,
  TimelineScene,
  TitleLock,
  VisualBeat,
} from "../../../shared/visualIntelligence.js";

type DirectorSwap = {
  sceneId: string;
  approvedVisualId: string;
  reason: string;
};

function visualSummary(v: ApprovedVisual) {
  return {
    approvedVisualId: v.approvedVisualId,
    source: v.source,
    bestUseCase: (v.bestUseCase || "").slice(0, 140),
    matchedPeople: (v.matchedPeople || []).slice(0, 4),
    matchedPlaces: (v.matchedPlaces || []).slice(0, 4),
    matchedObjects: (v.matchedObjects || []).slice(0, 4),
    matchedScriptSubjects: (v.matchedScriptSubjects || []).slice(0, 6),
    visualEditorScore: v.visualEditorScore ?? v.confidenceScores?.visualEditorScore,
    titleSupportScore: v.titleSupportScore ?? v.confidenceScores?.titleSupportScore,
    warnings: (v.warnings || []).slice(0, 3),
    mediaType: v.mediaType || (isRawFootageSource(v.source) ? "raw_footage" : "image"),
  };
}

function applySwap(
  scene: TimelineScene,
  visual: ApprovedVisual,
  reason: string
): TimelineScene {
  return {
    ...scene,
    selectedVisualId: visual.approvedVisualId,
    approvedVisualId: visual.approvedVisualId,
    source: visual.source,
    reasonSelected: `Director cut: ${reason}`,
    confidence: Math.min(
      1,
      Math.max(scene.confidence || 0.6, (visual.visualEditorScore || 70) / 100)
    ),
    confidenceScores: visual.confidenceScores,
    queryPackId: visual.queryPackId,
    warnings: [...new Set([...(scene.warnings || []), ...(visual.warnings || []), "director_cut_swap"])],
    needsBetterVisual: false,
    matchType:
      scene.matchType === "needs_better_visual" ? "good_context" : scene.matchType || "good_context",
    whyThisIsAppropriate: reason,
    rawFootageUsed: isRawFootageSource(visual.source),
    isTextHeavy: visual.isTextHeavy,
  };
}

/**
 * Director reviews the assembled cut. Only swaps within the approved library.
 * Never invents cards. Skips when efficient/cheap modes are on.
 */
export async function runDirectorCut(params: {
  job: JobRecord;
  titleLock: TitleLock;
  beats: VisualBeat[];
  scenes: TimelineScene[];
  library: ApprovedVisual[];
}): Promise<{ scenes: TimelineScene[]; swapsApplied: number; notes: string }> {
  const { job, titleLock, beats, library } = params;
  let scenes = params.scenes.map((s) => ({ ...s }));

  if (skipGptExceptJudge() || library.length < 2 || scenes.length < 2) {
    await writeJson(jobDataFile("director-cut", job.jobId), {
      jobId: job.jobId,
      skipped: true,
      reason: "efficient mode or insufficient pool",
    });
    return { scenes, swapsApplied: 0, notes: "director cut skipped" };
  }

  const byId = new Map(library.map((v) => [v.approvedVisualId, v]));
  const beatById = new Map(beats.map((b) => [b.beatId, b]));

  // Sample evenly across the film so long VO still gets a full-arc review.
  const maxScenes = 90;
  const step = Math.max(1, Math.ceil(scenes.length / maxScenes));
  const sampled = scenes.filter((_, i) => i % step === 0).slice(0, maxScenes);

  let swaps: DirectorSwap[] = [];
  let notes = "";
  try {
    const result = await chatJson<{
      notes?: string;
      swaps?: DirectorSwap[];
      keepMostly?: boolean;
    }>({
      system: `You are the DOCUMENTARY DIRECTOR doing a final picture cut review.

You already have an assembled timeline and an approved visual library.
Your job: improve the STORY FLOW — not chase perfection.

Rules:
- Prefer KEEP. Only swap when the current visual is wrong, weak for this narration, or repeats too soon while a clearly better library visual exists.
- Never invent visuals. approvedVisualId MUST come from the provided library list.
- Identity/evidence beats: correct person/place/object beats atmosphere.
- Atmosphere beats: motion/texture/raw is fine if it supports the title promise.
- Do NOT swap a good-enough image just to be fancy.
- Max ${Math.min(18, Math.ceil(sampled.length * 0.22))} swaps.
- If the cut is mostly solid, return swaps: [] and explain briefly.

Return JSON:
{ notes: string, keepMostly: boolean, swaps: [{ sceneId, approvedVisualId, reason }] }`,
      user: JSON.stringify({
        title: job.title,
        niche: job.niche,
        titleLock: {
          mainSubject: titleLock.mainSubject,
          emotionalPromise: titleLock.emotionalPromise,
          expectedVisuals: titleLock.expectedVisuals,
          forbiddenDrift: titleLock.forbiddenDrift,
        },
        voiceoverDurationSec: job.voiceoverDurationSec,
        scenes: sampled.map((s) => {
          const beat = beatById.get(s.beatId);
          return {
            sceneId: s.sceneId,
            beatId: s.beatId,
            startTime: s.startTime,
            duration: s.duration,
            narrationText: (s.narrationText || "").slice(0, 160),
            viewerShouldSee: beat?.viewerShouldSee || s.viewerShouldSee,
            exactSubject: beat?.exactSubject || beat?.mustMatchEntity,
            visualRole: beat?.visualRole,
            currentVisualId: s.approvedVisualId || s.selectedVisualId,
            currentSource: s.source,
            matchType: s.matchType,
            needsBetterVisual: s.needsBetterVisual,
            warnings: (s.warnings || []).slice(0, 4),
          };
        }),
        library: library.slice(0, 120).map(visualSummary),
      }),
    });
    notes = result.notes || "";
    swaps = Array.isArray(result.swaps) ? result.swaps : [];
  } catch (err) {
    notes = `director cut failed: ${err instanceof Error ? err.message : String(err)}`;
    await writeJson(jobDataFile("director-cut", job.jobId), {
      jobId: job.jobId,
      skipped: true,
      reason: notes,
    });
    return { scenes, swapsApplied: 0, notes };
  }

  let swapsApplied = 0;
  const usedRecently = new Map<string, number>();
  scenes.forEach((s, i) => {
    const id = s.approvedVisualId || s.selectedVisualId;
    if (id) usedRecently.set(id, i);
  });

  for (const swap of swaps.slice(0, 18)) {
    const idx = scenes.findIndex((s) => s.sceneId === swap.sceneId);
    if (idx < 0) continue;
    const visual = byId.get(swap.approvedVisualId);
    if (!visual?.filePathOrUrl) continue;
    const currentId = scenes[idx].approvedVisualId || scenes[idx].selectedVisualId;
    if (visual.approvedVisualId === currentId) continue;

    const lastIdx = usedRecently.get(visual.approvedVisualId);
    if (lastIdx !== undefined && Math.abs(lastIdx - idx) < 2) continue;

    scenes[idx] = applySwap(scenes[idx], visual, swap.reason || "stronger director match");
    usedRecently.set(visual.approvedVisualId, idx);
    swapsApplied++;
  }

  await writeJson(jobDataFile("director-cut", job.jobId), {
    jobId: job.jobId,
    notes,
    proposedSwaps: swaps,
    swapsApplied,
  });
  await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), {
    jobId: job.jobId,
    scenes,
  });

  return { scenes, swapsApplied, notes };
}
