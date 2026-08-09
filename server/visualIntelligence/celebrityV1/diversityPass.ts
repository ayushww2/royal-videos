/**
 * Post-assembly / post-repair diversity hard pass for Celebrity v1.
 * Enforces ≤2 uses/asset, no back-to-back repeats, and prefers unused library picks.
 */
import type {
  ApprovedVisual,
  TimelineScene,
  TitleLock,
  VisualBeat,
} from "../../../shared/visualIntelligence.js";
import { isRawFootageSource } from "../../rawFootage/youtubeRawCandidates.js";
import { textMentionsPerson } from "../contentSafety.js";

const MAX_USES = 2;

function visualMentionsPerson(v: ApprovedVisual, person: string): boolean {
  return textMentionsPerson(person, [
    ...v.matchedPeople,
    ...v.matchedPlaces,
    v.bestUseCase,
    v.filePathOrUrl,
    v.thumbnail,
    ...(v.matchedScriptSubjects || []),
  ]);
}

function applyVisual(scene: TimelineScene, visual: ApprovedVisual, reason: string): TimelineScene {
  return {
    ...scene,
    selectedVisualId: visual.approvedVisualId,
    approvedVisualId: visual.approvedVisualId,
    source: visual.source,
    reasonSelected: reason,
    confidence: Math.min(0.92, Math.max(scene.confidence || 0.55, (visual.visualEditorScore || 70) / 100)),
    confidenceScores: visual.confidenceScores,
    needsBetterVisual: false,
    matchType:
      scene.matchType === "exact_match" || scene.matchType === "strong_match"
        ? "strong_match"
        : scene.matchType || "good_context",
    warnings: [
      ...new Set([
        ...(scene.warnings || []).filter(
          (w) => !/repeated|back-to-back|diversity/i.test(w)
        ),
        "celebrity_diversity_pass",
      ]),
    ],
    whyThisIsAppropriate: reason,
    rawFootageUsed: isRawFootageSource(visual.source),
    isTextHeavy: visual.isTextHeavy,
  };
}

export function enforceCelebrityDiversity(params: {
  scenes: TimelineScene[];
  library: ApprovedVisual[];
  beats: VisualBeat[];
  titleLock: TitleLock;
}): { scenes: TimelineScene[]; swaps: number; uniqueCount: number } {
  const { library, titleLock } = params;
  const scenes = params.scenes.map((s) => ({ ...s }));
  const usable = library.filter(
    (v) =>
      v.filePathOrUrl &&
      v.source !== "fallback_card" &&
      !(v.warnings || []).some((w) => /soft_failed/i.test(w))
  );
  if (!usable.length || !scenes.length) {
    return { scenes, swaps: 0, uniqueCount: 0 };
  }

  const person = titleLock.mainSubject || "";
  const uniqueTarget = Math.min(usable.length, Math.max(15, Math.ceil(scenes.length * 0.55)));
  let swaps = 0;

  // Multi-pass until stable or no candidates.
  for (let pass = 0; pass < 3; pass++) {
    const useCount = new Map<string, number>();
    for (const s of scenes) {
      const id = s.approvedVisualId || s.selectedVisualId;
      if (!id) continue;
      useCount.set(id, (useCount.get(id) || 0) + 1);
    }

    let changed = false;
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const id = s.approvedVisualId || s.selectedVisualId || "";
      const used = id ? useCount.get(id) || 0 : 99;
      const prevId =
        i > 0 ? scenes[i - 1].approvedVisualId || scenes[i - 1].selectedVisualId : undefined;
      const backToBack = Boolean(id && prevId && id === prevId);
      const overused = used > MAX_USES;
      const uniqueSoFar = useCount.size;
      const openerNeedsPerson =
        i === 0 &&
        person &&
        !isRawFootageSource(s.source) &&
        !visualMentionsPerson(
          usable.find((v) => v.approvedVisualId === id) ||
            ({
              matchedPeople: [],
              matchedPlaces: [],
              bestUseCase: s.whyThisMatchesNarration,
              filePathOrUrl: "",
              thumbnail: "",
              matchedScriptSubjects: [],
            } as unknown as ApprovedVisual),
          person
        );

      if (!backToBack && !overused && !openerNeedsPerson) continue;
      if (!overused && !backToBack && uniqueSoFar >= uniqueTarget && !openerNeedsPerson) continue;

      const ranked = usable
        .filter((v) => {
          const u = useCount.get(v.approvedVisualId) || 0;
          if (u >= MAX_USES) return false;
          if (prevId && v.approvedVisualId === prevId) return false;
          if (v.approvedVisualId === id) return false;
          return true;
        })
        .map((v) => {
          let score = 50;
          const u = useCount.get(v.approvedVisualId) || 0;
          if (u === 0) score += 30;
          if (visualMentionsPerson(v, person)) score += 25;
          if (i === 0 && visualMentionsPerson(v, person)) score += 20;
          if (isRawFootageSource(v.source)) score += 8;
          score += Math.min(20, (v.visualEditorScore || 60) / 5);
          return { v, score };
        })
        .sort((a, b) => b.score - a.score);

      const pick = ranked[0]?.v;
      if (!pick) continue;

      if (id) useCount.set(id, Math.max(0, (useCount.get(id) || 1) - 1));
      useCount.set(pick.approvedVisualId, (useCount.get(pick.approvedVisualId) || 0) + 1);
      scenes[i] = applyVisual(
        s,
        pick,
        `Celebrity diversity: unique cut (≤${MAX_USES}/asset, no back-to-back)`
      );
      swaps++;
      changed = true;
    }
    if (!changed) break;
  }

  const uniqueCount = new Set(
    scenes.map((s) => s.approvedVisualId || s.selectedVisualId).filter(Boolean)
  ).size;
  return { scenes, swaps, uniqueCount };
}
