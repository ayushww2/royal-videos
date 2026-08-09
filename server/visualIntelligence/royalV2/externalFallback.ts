import { createQueryPacks } from "../queryPacks.js";
import { collectCandidates } from "../candidateCollection.js";
import { filterCandidates } from "../candidateFiltering.js";
import { judgeCandidates } from "../gptJudge.js";
import { cheapPipeline, efficientPipeline } from "../pipelineMode.js";
import type {
  ApprovedVisual,
  GlobalContextReport,
  JobRecord,
  TimelineScene,
  VisualBeat,
  VisualCandidate,
} from "../../../shared/visualIntelligence.js";

function toExternalApproved(
  candidate: VisualCandidate,
  judgment: Awaited<ReturnType<typeof judgeCandidates>>[number],
  beats: VisualBeat[]
): ApprovedVisual | null {
  const blocked =
    /tiktok\.com|tiktokcdn\.|pinimg\.com|pinterest\.|lookaside\.|fbsbx\.com/i.test(
      candidate.urlOrPath || ""
    );
  const filePathOrUrl = blocked
    ? candidate.thumbnail && !/tiktok\.com|tiktokcdn\./i.test(candidate.thumbnail)
      ? candidate.thumbnail
      : ""
    : candidate.urlOrPath;
  if (!filePathOrUrl) return null;
  const related = beats.filter((beat) => candidate.relatedBeatIds.includes(beat.beatId));
  return {
    approvedVisualId: `external-${candidate.candidateId}`,
    candidateId: candidate.candidateId,
    source: candidate.source,
    filePathOrUrl,
    thumbnail: candidate.thumbnail,
    matchedPeople: judgment.matchedEntities.filter((entity) =>
      related.some((beat) => beat.mentionedPeople.includes(entity))
    ),
    matchedCompanies: [],
    matchedPlaces: judgment.matchedEntities.filter((entity) =>
      related.some((beat) => beat.mentionedPlaces.includes(entity))
    ),
    matchedEvents: [],
    matchedDocuments: [],
    matchedObjects: [],
    allowedBeatIds: candidate.relatedBeatIds,
    bestUseCase: judgment.reason,
    confidenceScores: judgment.scores,
    reuseLimit: 2,
    cropInstructions: "16:9 center-safe",
    durationRecommendation: 3.5,
    warnings: [...judgment.warnings, "External fallback after Royal Media Library miss"],
    supportsTitle: judgment.scores.topicRelevance >= 80,
  };
}

function exactSafe(beat: VisualBeat, visual: ApprovedVisual): boolean {
  if (beat.beatType === "exact_pair_or_group") {
    const required = beat.pairOrGroup || [];
    const matched = visual.matchedPeople.map((person) => person.toLowerCase());
    return required.length >= 2 && required.every((person) => matched.includes(person.toLowerCase()));
  }
  if (beat.beatType === "exact_person") {
    return (
      visual.confidenceScores.entityMatch >= 85 &&
      (visual.confidenceScores.wrongEntityRisk || 0) <= 20
    );
  }
  if (beat.beatType === "exact_place") {
    return (
      visual.confidenceScores.eventPlaceYearRelevance >= 85 &&
      (visual.confidenceScores.wrongEntityRisk || 0) <= 20
    );
  }
  return true;
}

export async function repairRoyalV2WithExternalSearch(params: {
  job: JobRecord;
  context: GlobalContextReport;
  beats: VisualBeat[];
  scenes: TimelineScene[];
}): Promise<{
  scenes: TimelineScene[];
  externalVisuals: ApprovedVisual[];
  searchesUsed: number;
  gptCallsUsed: number;
  repairedScenes: number;
}> {
  const weakSceneIds = new Set(
    params.scenes
      .filter((scene) => scene.needsBetterVisual || scene.confidence < 0.7)
      .map((scene) => scene.beatId)
  );
  const weakBeats = params.beats
    .filter((beat) => {
      if (!weakSceneIds.has(beat.beatId)) return false;
      // Library-first: never pull Google/TikTok junk for context/transition filler.
      return (
        beat.beatType === "exact_person" ||
        beat.beatType === "exact_pair_or_group" ||
        beat.beatType === "exact_place"
      );
    })
    .filter((beat) => {
      const scene = params.scenes.find((item) => item.beatId === beat.beatId);
      return Boolean(scene?.needsBetterVisual);
    })
    .slice(0, 0); // Disabled: external search was injecting TikTok/Pinterest URLs that crash Remotion.
  if (!weakBeats.length) {
    return { scenes: params.scenes, externalVisuals: [], searchesUsed: 0, gptCallsUsed: 0, repairedScenes: 0 };
  }

  const packs = await createQueryPacks(params.job, params.context, weakBeats);
  const collected = await collectCandidates(params.job, packs, weakBeats, []);
  const filtered = await filterCandidates(params.job.jobId, collected.candidates);
  const judgments = await judgeCandidates(params.job, params.context, weakBeats, filtered.kept);
  const byId = new Map(filtered.kept.map((candidate) => [candidate.candidateId, candidate]));
  const externalVisuals = judgments
    .filter((judgment) => judgment.approved)
    .map((judgment) => {
      const candidate = byId.get(judgment.candidateId);
      return candidate ? toExternalApproved(candidate, judgment, weakBeats) : null;
    })
    .filter((visual): visual is ApprovedVisual => Boolean(visual));

  const scenes = params.scenes.map((scene) => ({ ...scene, warnings: [...(scene.warnings || [])] }));
  const beatById = new Map(params.beats.map((beat) => [beat.beatId, beat]));
  const usage = new Map<string, number>();
  const lastUsed = new Map<string, number>();
  for (const scene of scenes.filter((item) => !item.needsBetterVisual)) {
    usage.set(scene.selectedVisualId, (usage.get(scene.selectedVisualId) || 0) + 1);
    lastUsed.set(scene.selectedVisualId, scene.startTime);
  }

  let repairedScenes = 0;
  for (const scene of scenes) {
    if (!scene.needsBetterVisual && scene.confidence >= 0.7) continue;
    const beat = beatById.get(scene.beatId);
    if (!beat) continue;
    const candidates = externalVisuals
      .filter((visual) => visual.allowedBeatIds.includes(beat.beatId))
      .filter((visual) => (usage.get(visual.approvedVisualId) || 0) < 2)
      .filter((visual) => scene.startTime - (lastUsed.get(visual.approvedVisualId) ?? -999) >= 60)
      .filter((visual) => exactSafe(beat, visual))
      .sort(
        (a, b) =>
          (b.confidenceScores.sceneMatch + b.confidenceScores.entityMatch) -
          (a.confidenceScores.sceneMatch + a.confidenceScores.entityMatch)
      );
    const selected = candidates[0];
    if (!selected) continue;
    scene.selectedVisualId = selected.approvedVisualId;
    scene.approvedVisualId = selected.approvedVisualId;
    scene.source = selected.source;
    scene.reasonSelected = `External fallback after no acceptable Royal Media Library match: ${selected.bestUseCase}`;
    scene.confidence = Math.min(
      1,
      (selected.confidenceScores.sceneMatch + selected.confidenceScores.entityMatch) / 200
    );
    scene.confidenceScores = selected.confidenceScores;
    scene.fallbackUsed = false;
    scene.needsBetterVisual = scene.confidence < 0.7;
    scene.matchType = exactSafe(beat, selected) ? "strong_match" : "related_context";
    scene.warnings = [
      ...new Set([
        ...scene.warnings.filter((warning) => !/needs better|wrong-person|specific place/i.test(warning)),
        ...selected.warnings,
      ]),
    ];
    scene.assistantSuggestionAvailable = scene.needsBetterVisual;
    usage.set(selected.approvedVisualId, (usage.get(selected.approvedVisualId) || 0) + 1);
    lastUsed.set(selected.approvedVisualId, scene.startTime);
    repairedScenes += 1;
  }

  return {
    scenes,
    externalVisuals,
    searchesUsed: collected.imageQueriesUsed,
    gptCallsUsed: cheapPipeline() || efficientPipeline() ? 0 : 2,
    repairedScenes,
  };
}

