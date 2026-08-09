import { jobDataFile, loadJob, writeJson } from "../storage.js";
import { clampScore, matchTypeFromScore, type MatchType } from "./editorScores.js";
import { isRawFootageSource } from "../rawFootage/youtubeRawCandidates.js";
import {
  isStopwordSubject,
  textMentionsPerson,
} from "./contentSafety.js";
import { celebrityRecipeActive } from "./celebrityV1/referenceRecipe.js";
import type {
  ApprovedVisual,
  TimelineScene,
  TitleLock,
  VisualBeat,
} from "../../shared/visualIntelligence.js";

/** Default mix when uploaded file raw exists (legacy). */
const DEFAULT_RAW_TARGET_MIN = 0.3;
const DEFAULT_RAW_TARGET_MAX = 0.4;

export type EditorRawMixOptions = {
  /** When true, use user-YouTube band (~20% reduced by analysis) and never force weak fills. */
  useUserYoutubeMix?: boolean;
  targetMin?: number;
  targetMax?: number;
  qualityFloor?: number;
  rawTargetPercent?: number;
  effectiveRawTargetPercent?: number;
  rawReducedReason?: string;
};

function editorScore(visual: ApprovedVisual): number {
  return clampScore(
    visual.visualEditorScore ??
      visual.confidenceScores.visualEditorScore ??
      visual.confidenceScores.topicRelevance ??
      0
  );
}

function qualityOf(visual: ApprovedVisual): number {
  const metaQ = Number((visual as ApprovedVisual & { metadataQuality?: number }).metadataQuality);
  if (Number.isFinite(metaQ) && metaQ > 0) return metaQ;
  return clampScore(
    visual.confidenceScores.visualQuality ??
      visual.visualEditorScore ??
      visual.confidenceScores.visualEditorScore ??
      0
  );
}

function isVideoUrl(url?: string): boolean {
  return Boolean(url && /\.(mp4|webm|mov|mkv|m4v)(?:[?&#]|$)/i.test(url));
}

function scoreVisualForBeat(
  visual: ApprovedVisual,
  beat: VisualBeat,
  titleLock: TitleLock,
  rawBoost = 0
): number {
  let score = editorScore(visual) * 0.35;
  const s = visual.confidenceScores;
  score += clampScore(s.narrationMatchScore ?? s.sceneMatch) * 0.25;
  score += clampScore(s.titleSupportScore ?? s.topicRelevance) * 0.15;
  score += clampScore(s.instantClarityScore ?? s.visualQuality) * 0.1;
  score += clampScore(s.horizontalUsability ?? s.cropSafety16x9) * 0.1;
  score += clampScore(100 - (s.wrongContextRisk ?? s.wrongEntityRisk ?? 0)) * 0.05;

  const exactRaw = (beat.exactSubject || beat.mustMatchEntity || "").trim();
  const exact = exactRaw.toLowerCase();
  const personCentric =
    beat.visualRole === "main_subject" ||
    beat.beatType === "exact_person" ||
    Boolean(titleLock.mainSubject && exact.includes(titleLock.mainSubject.toLowerCase().split(/\s+/).pop() || ""));

  const captionParts = [
    ...visual.matchedPeople,
    ...visual.matchedPlaces,
    ...visual.matchedCompanies,
    ...visual.matchedEvents,
    ...visual.matchedDocuments,
    ...visual.matchedObjects,
    ...(visual.matchedScriptSubjects || []),
    visual.bestUseCase,
    visual.filePathOrUrl,
    visual.thumbnail,
  ];
  const namesPerson = textMentionsPerson(titleLock.mainSubject, captionParts);

  if (exact && !isStopwordSubject(exactRaw)) {
    const hay = captionParts.join(" ").toLowerCase();
    if (hay.includes(exact) || exact.split(/\s+/).some((w) => w.length > 3 && hay.includes(w))) {
      // Named-person face/caption match earns the boost; bare stopword crumbs do not.
      score += namesPerson || !personCentric ? 18 : 4;
    } else if (beat.visualRole === "main_subject" || beat.visualRole === "evidence") {
      score -= 18;
    }
  }

  // Google / web stills without the celebrity name must not look like "exact match".
  if (personCentric && !namesPerson && visual.source === "google_image") {
    score -= 28;
  } else if (namesPerson && personCentric) {
    score += 14;
  }

  const visualHay = `${visual.bestUseCase} ${(visual.matchedScriptSubjects || []).join(" ")}`.toLowerCase();
  if (titleLock.expectedVisuals.some((v) => visualHay.includes(v.toLowerCase()))) score += 8;
  if (titleLock.forbiddenDrift.some((d) => visualHay.includes(d.toLowerCase()))) score -= 25;

  if (isRawFootageSource(visual.source)) {
    score += 6 + rawBoost;
    if (beat.visualRole === "atmosphere" || beat.idealVisualType.includes("clip")) score += 8;
  }
  if (visual.isTextHeavy && beat.visualRole !== "document" && beat.visualRole !== "evidence") {
    score -= 20;
  }
  if (visual.allowedBeatIds.includes(beat.beatId)) score += 12;

  // Judge-outage soft reserves must never surface as Exact Match 90+.
  if ((visual.warnings || []).some((w) => /judge_fallback/i.test(w))) {
    score = Math.min(score, 68);
  }
  // Local celebrity name-lock must stay below Exact Match threshold.
  if (
    (visual.warnings || []).some((w) => /local_celebrity|soft_repair/i.test(w)) ||
    /local_celebrity_name_lock/i.test(visual.bestUseCase || "")
  ) {
    score = Math.min(score, 88);
  }

  return clampScore(score);
}

function whyAppropriate(visual: ApprovedVisual, beat: VisualBeat, matchType: MatchType): string {
  return `${matchType.replaceAll("_", " ")}: ${visual.bestUseCase || "clean real visual"} for “${(
    beat.viewerShouldSee ||
    beat.exactSubject ||
    beat.narrationText
  ).slice(0, 120)}”`;
}

function rawShare(scenes: TimelineScene[]): number {
  const total = scenes.reduce((n, s) => n + (s.duration || 0), 0) || 1;
  const raw = scenes
    .filter((s) => isRawFootageSource(s.source) || s.rawFootageUsed)
    .reduce((n, s) => n + (s.duration || 0), 0);
  return raw / total;
}

function buildScene(
  i: number,
  beat: VisualBeat,
  selected: ApprovedVisual,
  titleLock: TitleLock,
  scoreIn: number,
  warnings: string[],
  repeatDistanceWarning: boolean,
  niche?: string
): TimelineScene {
  let score100 = scoreIn;
  let matchType = matchTypeFromScore(score100);
  let needsBetterVisual = matchType === "needs_better_visual" || score100 < 60;

  // Celebrity recipe: never mint fake Exact Match (local/name-lock is Strong at best).
  if (celebrityRecipeActive(niche)) {
    const captionParts = [
      ...selected.matchedPeople,
      ...selected.matchedPlaces,
      selected.bestUseCase,
      selected.filePathOrUrl,
      selected.thumbnail,
      ...(selected.matchedScriptSubjects || []),
    ];
    const namesPerson = textMentionsPerson(titleLock.mainSubject, captionParts);
    const personBeat =
      beat.visualRole === "main_subject" ||
      Boolean(beat.exactSubject && titleLock.mainSubject);
    const localLock = (selected.warnings || []).some((w) =>
      /local_celebrity|judge_fallback|soft_repair|PIPELINE_CHEAP/i.test(w)
    ) || /local_celebrity_name_lock|Soft repair/i.test(selected.bestUseCase || "");
    // DoD: 0 fake Exact Match — demote all local/name-lock Exact → Strong.
    if (matchType === "exact_match") {
      matchType = "strong_match";
      score100 = Math.min(score100, 88);
      warnings.push("celebrity: demoted Exact Match → Strong (no vision-verified exact)");
    }
    if (personBeat && !namesPerson && !isRawFootageSource(selected.source)) {
      if (matchType === "strong_match") {
        matchType = score100 >= 80 ? "good_context" : "related_context";
        warnings.push("celebrity person-lock: no name evidence — demoted");
      }
      score100 = Math.min(score100, 78);
    }
    if (localLock) {
      score100 = Math.min(score100, 88);
    }
    if (i === 0 && personBeat && !namesPerson && !isRawFootageSource(selected.source)) {
      needsBetterVisual = true;
      warnings.push("celebrity opener: requires subject face / named person visual");
    }
  }

  if (score100 < 50) {
    needsBetterVisual = true;
    matchType = "needs_better_visual";
    warnings.push("below 50 editor score — needs better visual");
  } else if (score100 < 70) {
    needsBetterVisual = true;
    warnings.push("needs human review");
  }
  if ((selected.confidenceScores.wrongContextRisk ?? selected.confidenceScores.wrongEntityRisk) > 30) {
    warnings.push("possible wrong context");
  }
  if ((selected.confidenceScores.watermarkRisk ?? selected.confidenceScores.watermarkTextRisk) > 15) {
    warnings.push("possible watermark");
  }
  if ((selected.confidenceScores.horizontalUsability ?? selected.confidenceScores.cropSafety16x9) < 75) {
    warnings.push("portrait crop risk");
  }
  if (selected.isTextHeavy) warnings.push("text-heavy visual");
  warnings.push(...(selected.warnings || []));

  const whatMissing =
    matchType === "exact_match" || matchType === "strong_match"
      ? ""
      : beat.exactSubject || beat.mustShow?.[0] || "stronger exact subject match";

  return {
    sceneId: `scene-${i + 1}`,
    beatId: beat.beatId,
    startTime: beat.startTime,
    endTime: beat.endTime,
    duration: selected.isTextHeavy ? Math.max(beat.duration, 5) : beat.duration,
    narrationText: beat.narrationText,
    selectedVisualId: selected.approvedVisualId,
    approvedVisualId: selected.approvedVisualId,
    source: selected.source,
    reasonSelected: `Best appropriate real visual (${matchType.replaceAll("_", " ")}, score ${score100})`,
    confidence: Math.min(1, clampScore(score100) / 100),
    fallbackUsed: false,
    needsBetterVisual,
    matchType,
    viewerShouldSee: beat.viewerShouldSee || beat.idealVisual || "",
    whyThisMatchesTitle: selected.supportsTitle
      ? `Supports title: ${titleLock.mainSubject}`
      : "Partial title support — review",
    whyThisMatchesNarration:
      selected.bestUseCase ||
      `Matches narration focus: ${(beat.exactSubject || beat.narrationText).slice(0, 100)}`,
    whyThisIsAppropriate: whyAppropriate(selected, beat, matchType),
    whatIsMissing: whatMissing,
    repeatDistanceWarning,
    cropFraming: selected.cropInstructions || "16:9 center",
    transition: "cut",
    warnings: [...new Set(warnings)],
    queryPackId: selected.queryPackId,
    confidenceScores: selected.confidenceScores,
    isTextHeavy: selected.isTextHeavy,
    rawFootageUsed: isRawFootageSource(selected.source),
  };
}

function resolveMix(mix?: EditorRawMixOptions): {
  targetMin: number;
  targetMax: number;
  qualityFloor: number;
  forceFill: boolean;
  rawTargetPercent: number;
  effectiveRawTargetPercent: number;
  rawReducedReason?: string;
  useUserYoutubeMix: boolean;
} {
  if (mix?.useUserYoutubeMix) {
    const effective =
      typeof mix.effectiveRawTargetPercent === "number"
        ? Math.max(0, mix.effectiveRawTargetPercent / 100)
        : typeof mix.targetMin === "number"
          ? mix.targetMin
          : 0.2;
    const targetMin = typeof mix.targetMin === "number" ? mix.targetMin : effective * 0.8;
    const targetMax =
      typeof mix.targetMax === "number" ? mix.targetMax : Math.min(0.24, Math.max(targetMin, effective * 1.2));
    return {
      targetMin,
      targetMax,
      qualityFloor: mix.qualityFloor ?? 70,
      forceFill: false,
      rawTargetPercent: mix.rawTargetPercent ?? 20,
      effectiveRawTargetPercent: mix.effectiveRawTargetPercent ?? Number((effective * 100).toFixed(1)),
      rawReducedReason: mix.rawReducedReason,
      useUserYoutubeMix: true,
    };
  }
  return {
    targetMin: mix?.targetMin ?? DEFAULT_RAW_TARGET_MIN,
    targetMax: mix?.targetMax ?? DEFAULT_RAW_TARGET_MAX,
    qualityFloor: mix?.qualityFloor ?? 0,
    forceFill: true,
    rawTargetPercent: (mix?.rawTargetPercent ?? DEFAULT_RAW_TARGET_MIN * 100),
    effectiveRawTargetPercent:
      mix?.effectiveRawTargetPercent ?? (mix?.targetMin ?? DEFAULT_RAW_TARGET_MIN) * 100,
    rawReducedReason: mix?.rawReducedReason,
    useUserYoutubeMix: false,
  };
}

/** Celebrity DoD: ≤2 uses/asset, never back-to-back, prefer unused for diversity. */
const CELEBRITY_MAX_USES = 2;
/** Mystery v2 lock: max 2× / video (10–12 unique/min), never back-to-back, prefer ≥2 min gap. */
const MYSTERY_V2_MAX_USES = 2;
/** Prefer ~90s gap at ~4.5s holds ≈ 20 scenes (lenient vs strict 2 min). */
const MYSTERY_V2_MIN_GAP_SCENES = 20;
/** Midpoint of locked 10–12 unique stills per minute. */
const MYSTERY_V2_UNIQUE_PER_MIN = 11;

function maxUsesForVisual(
  visual: ApprovedVisual,
  celebrityMode: boolean,
  mysteryV2: boolean,
  hasRaw: boolean
): number {
  if (celebrityMode) return CELEBRITY_MAX_USES;
  if (mysteryV2) {
    if (isRawFootageSource(visual.source)) return 0; // images-only Mystery finals
    return Math.min(MYSTERY_V2_MAX_USES, Math.max(visual.reuseLimit || 2, 2));
  }
  if (hasRaw && isRawFootageSource(visual.source)) {
    return Math.max(visual.reuseLimit, 8);
  }
  return Math.max(visual.reuseLimit, 1);
}

/**
 * Assigns best appropriate REAL visuals from the approved library.
 * Default: hard-enforces ~30–40% raw when uploaded raw exists.
 * User YouTube mix: aims for ~20% (analysis-reduced), never pads with weak clips.
 */
export async function assembleEditorTimeline(
  jobId: string,
  beats: VisualBeat[],
  library: ApprovedVisual[],
  titleLock: TitleLock,
  mix?: EditorRawMixOptions
): Promise<TimelineScene[]> {
  const job = await loadJob(jobId);
  const niche = job?.niche;
  const celebrityMode = celebrityRecipeActive(niche);
  const mysteryV2 = niche === "Mystery v2";
  const resolved = resolveMix(mix);
  const reuseCount = new Map<string, number>();
  const lastUsedIndex = new Map<string, number>();
  const scenes: TimelineScene[] = [];
  let prevVisualId: string | undefined;

  const usable = library.filter(
    (v) =>
      v.source !== "fallback_card" &&
      !!v.filePathOrUrl &&
      !(v.warnings || []).some((w) => /soft_failed/i.test(w)) &&
      // Mystery v2 images-only — never assign video/raw clips.
      !(mysteryV2 && (isRawFootageSource(v.source) || v.mediaType === "video" || isVideoUrl(v.filePathOrUrl)))
  );
  const rawLibrary = usable.filter(
    (v) =>
      isRawFootageSource(v.source) &&
      (resolved.qualityFloor <= 0 || qualityOf(v) >= resolved.qualityFloor)
  );
  const hasRaw = !mysteryV2 && rawLibrary.length > 0;
  // Knopfler-length (~2.5min / 30 scenes): aim ≥15 unique; scale with beat count.
  const timelineSec = beats.length
    ? Math.max(
        beats[beats.length - 1]?.endTime || 0,
        beats.reduce((sum, b) => sum + (b.duration || 0), 0)
      )
    : 0;
  const uniqueTarget = celebrityMode
    ? Math.min(usable.length, Math.max(15, Math.ceil(beats.length * 0.55)))
    : mysteryV2
      ? Math.min(
          usable.length,
          Math.max(
            Math.ceil((timelineSec / 60) * MYSTERY_V2_UNIQUE_PER_MIN),
            Math.ceil(beats.length * 0.75)
          )
        )
      : 0;

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const uniqueSoFar = reuseCount.size;
    const needDiversity =
      (celebrityMode && uniqueSoFar < uniqueTarget) ||
      (mysteryV2 && uniqueSoFar < uniqueTarget);

    const ranked = usable
      .filter((v) => {
        const used = reuseCount.get(v.approvedVisualId) || 0;
        if (used >= maxUsesForVisual(v, celebrityMode, mysteryV2, hasRaw)) return false;
        // Hard ban back-to-back same asset.
        if ((celebrityMode || mysteryV2) && prevVisualId && v.approvedVisualId === prevVisualId) {
          return false;
        }
        if (mysteryV2) {
          const lastIdx = lastUsedIndex.get(v.approvedVisualId);
          if (lastIdx !== undefined && i - lastIdx < MYSTERY_V2_MIN_GAP_SCENES) return false;
        }
        return true;
      })
      .map((v) => {
        let score = scoreVisualForBeat(v, beat, titleLock, hasRaw ? 4 : 0);
        const used = reuseCount.get(v.approvedVisualId) || 0;
        if (celebrityMode || mysteryV2) {
          // Force diversity: unused assets beat mild score gaps.
          if (used === 0) score += needDiversity ? 22 : 10;
          else if (used >= 1) score -= mysteryV2 ? 8 : 12;
          const lastIdx = lastUsedIndex.get(v.approvedVisualId);
          if (lastIdx !== undefined && i - lastIdx < (mysteryV2 ? MYSTERY_V2_MIN_GAP_SCENES : 3)) {
            score -= mysteryV2 ? 40 : 25;
          }
          // Opener / person beats: require name evidence on stills.
          const personBeat =
            i === 0 ||
            beat.visualRole === "main_subject" ||
            beat.beatType === "exact_person";
          if (celebrityMode && personBeat && !isRawFootageSource(v.source)) {
            const namesPerson = textMentionsPerson(titleLock.mainSubject, [
              ...v.matchedPeople,
              ...v.matchedPlaces,
              v.bestUseCase,
              v.filePathOrUrl,
              v.thumbnail,
              ...(v.matchedScriptSubjects || []),
            ]);
            if (!namesPerson) score -= 40;
            else score += 18;
          }
        }
        return { v, score };
      })
      .sort((a, b) => b.score - a.score);

    // Prefer first unused visual within 8 pts of top score when diversity short.
    let pick = ranked[0];
    if ((celebrityMode || mysteryV2) && needDiversity && ranked.length > 1) {
      const top = ranked[0].score;
      const unused = ranked.find(
        (r) => (reuseCount.get(r.v.approvedVisualId) || 0) === 0 && top - r.score <= 8
      );
      if (unused) pick = unused;
    }

    let selected = pick?.v;
    let score100 = pick?.score ?? 0;

    if (!selected) {
      // Soften gap if pool exhausted, but never allow back-to-back for Mystery v2.
      const any = [...usable]
        .filter((v) => {
          if ((celebrityMode || mysteryV2) && v.approvedVisualId === prevVisualId) return false;
          const used = reuseCount.get(v.approvedVisualId) || 0;
          if (used >= maxUsesForVisual(v, celebrityMode, mysteryV2, hasRaw)) return false;
          return true;
        })
        .sort(
          (a, b) => scoreVisualForBeat(b, beat, titleLock) - scoreVisualForBeat(a, beat, titleLock)
        )[0];
      // Last resort: ignore max-use / gap — empty scenes cannot render. Only ban back-to-back.
      const lastResort =
        any ||
        [...usable]
          .filter((v) => !prevVisualId || v.approvedVisualId !== prevVisualId)
          .sort(
            (a, b) =>
              scoreVisualForBeat(b, beat, titleLock) - scoreVisualForBeat(a, beat, titleLock)
          )[0] ||
        usable[0];
      if (!lastResort) {
        scenes.push({
          sceneId: `scene-${i + 1}`,
          beatId: beat.beatId,
          startTime: beat.startTime,
          endTime: beat.endTime,
          duration: beat.duration,
          narrationText: beat.narrationText,
          selectedVisualId: "",
          approvedVisualId: undefined,
          source: "google_image",
          reasonSelected: "No approved real visual available — needs better visual",
          confidence: 0,
          fallbackUsed: false,
          needsBetterVisual: true,
          matchType: "needs_better_visual",
          viewerShouldSee: beat.viewerShouldSee || beat.idealVisual || "",
          whyThisMatchesTitle: "No visual found",
          whyThisMatchesNarration: "No visual found",
          whyThisIsAppropriate: "No clean real visual in library",
          whatIsMissing: beat.exactSubject || beat.viewerShouldSee || "exact subject visual",
          cropFraming: "16:9 center",
          transition: "cut",
          warnings: ["no visual", "needs better visual"],
        });
        continue;
      }
      selected = lastResort;
      score100 = scoreVisualForBeat(lastResort, beat, titleLock);
    }

    const warnings: string[] = [];
    if (!pick?.v) {
      warnings.push("emergency reuse — library smaller than scene count");
    }
    const prevIdx = lastUsedIndex.get(selected.approvedVisualId);
    let repeatDistanceWarning = false;
    if (prevIdx !== undefined && i - prevIdx < 3) {
      repeatDistanceWarning = true;
      warnings.push("repeated too close");
    }
    if ((celebrityMode || mysteryV2) && prevVisualId === selected.approvedVisualId) {
      warnings.push("back-to-back same asset (emergency pool exhaustion)");
      repeatDistanceWarning = true;
    }
    if (mysteryV2 && prevIdx !== undefined && i - prevIdx < MYSTERY_V2_MIN_GAP_SCENES) {
      warnings.push("reuse gap under ~2 min (pool pressure)");
      repeatDistanceWarning = true;
    }

    reuseCount.set(selected.approvedVisualId, (reuseCount.get(selected.approvedVisualId) || 0) + 1);
    lastUsedIndex.set(selected.approvedVisualId, i);
    prevVisualId = selected.approvedVisualId;
    scenes.push(
      buildScene(i, beat, selected, titleLock, score100, warnings, repeatDistanceWarning, niche)
    );
  }

  // Enforce raw duration share when quality raw exists
  if (hasRaw && scenes.length && resolved.targetMin > 0) {
    let share = rawShare(scenes);
    const beatById = new Map(beats.map((b) => [b.beatId, b]));
    const bandLabel = `${Math.round(resolved.targetMin * 100)}–${Math.round(resolved.targetMax * 100)}%`;

    if (share < resolved.targetMin) {
      const candidates = scenes
        .map((s, idx) => ({ s, idx, beat: beatById.get(s.beatId)! }))
        .filter(({ s, beat }) => {
          if (!beat) return false;
          if (isRawFootageSource(s.source)) return false;
          const exact = !!(beat.exactSubject || beat.mustMatchEntity);
          if (exact && (beat.visualRole === "main_subject" || beat.visualRole === "evidence")) return false;
          return true;
        })
        .sort((a, b) => {
          const roleScore = (r?: string) =>
            r === "atmosphere" || r === "supporting_context" ? 0 : r === "evidence" ? 2 : 1;
          return roleScore(a.beat.visualRole) - roleScore(b.beat.visualRole);
        });

      for (const { idx, beat } of candidates) {
        if (rawShare(scenes) >= resolved.targetMin) break;
        const prevId = scenes[idx - 1]?.approvedVisualId || scenes[idx - 1]?.selectedVisualId;
        const rawPick = rawLibrary
          .map((v) => ({
            v,
            score: scoreVisualForBeat(v, beat, titleLock, 20),
            used: reuseCount.get(v.approvedVisualId) || 0,
            q: qualityOf(v),
          }))
          .filter((x) => {
            if (!(x.q >= resolved.qualityFloor || !resolved.useUserYoutubeMix)) return false;
            if (x.used >= celebrityMaxUses(x.v, celebrityMode, true)) return false;
            if (celebrityMode && prevId && x.v.approvedVisualId === prevId) return false;
            return true;
          })
          .sort((a, b) => b.score - a.score || a.used - b.used)[0];
        if (!rawPick) break;
        const warnings = [`raw quota fill ${bandLabel}`];
        const prevIdx = lastUsedIndex.get(rawPick.v.approvedVisualId);
        const repeat = prevIdx !== undefined && idx - prevIdx < 3;
        if (repeat) warnings.push("repeated too close");
        reuseCount.set(rawPick.v.approvedVisualId, (reuseCount.get(rawPick.v.approvedVisualId) || 0) + 1);
        lastUsedIndex.set(rawPick.v.approvedVisualId, idx);
        scenes[idx] = buildScene(
          idx,
          beat,
          rawPick.v,
          titleLock,
          rawPick.score,
          warnings,
          repeat,
          niche
        );
        scenes[idx].reasonSelected = `Raw footage quota fill (${bandLabel})`;
      }

      // User YT mix: do not invent more raw if pool exhausted — effective target already reduced.
      if (!resolved.forceFill && rawShare(scenes) < resolved.targetMin) {
        // leave shortfall; report via share JSON
      }
    }

    share = rawShare(scenes);
    if (share > resolved.targetMax) {
      const rawScenes = scenes
        .map((s, idx) => ({ s, idx, beat: beatById.get(s.beatId)! }))
        .filter(({ s }) => isRawFootageSource(s.source))
        .sort((a, b) => (a.s.confidence || 0) - (b.s.confidence || 0));
      for (const { idx, beat } of rawScenes) {
        if (rawShare(scenes) <= resolved.targetMax) break;
        if (!beat) continue;
        if (beat.visualRole === "atmosphere") continue;
        const imagePick = usable
          .filter((v) => !isRawFootageSource(v.source))
          .map((v) => ({ v, score: scoreVisualForBeat(v, beat, titleLock) }))
          .sort((a, b) => b.score - a.score)[0];
        if (!imagePick) break;
        scenes[idx] = buildScene(
          idx,
          beat,
          imagePick.v,
          titleLock,
          imagePick.score,
          [`raw quota cap ${Math.round(resolved.targetMax * 100)}%`],
          false,
          niche
        );
      }
    }
  }

  const finalShare = Number((rawShare(scenes) * 100).toFixed(1));
  await writeJson(jobDataFile("editor-final-scene-assignment", jobId), { jobId, scenes });
  await writeJson(jobDataFile("visual-intelligence-final-assignment", jobId), { jobId, scenes });
  await writeJson(jobDataFile("mystery-v1-final-visual-assignment", jobId), { jobId, scenes });
  await writeJson(jobDataFile("raw-footage-timeline-share", jobId), {
    jobId,
    useUserYoutubeMix: resolved.useUserYoutubeMix,
    targetRawMinPercent: resolved.targetMin * 100,
    targetRawMaxPercent: resolved.targetMax * 100,
    rawTargetPercent: resolved.rawTargetPercent,
    effectiveRawTargetPercent: resolved.effectiveRawTargetPercent,
    rawReducedReason: resolved.rawReducedReason,
    actualRawPercent: finalShare,
    rawSceneCount: scenes.filter((s) => isRawFootageSource(s.source)).length,
    totalScenes: scenes.length,
    targetMet:
      !hasRaw ||
      resolved.targetMin <= 0 ||
      (finalShare >= resolved.targetMin * 100 - 0.5 && finalShare <= resolved.targetMax * 100 + 2),
  });

  return scenes;
}
