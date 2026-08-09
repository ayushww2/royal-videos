import { jobDataFile, writeJson } from "../../storage.js";
import type { LibraryAsset } from "../../library/types.js";
import type {
  ApprovedVisual,
  RoyalManagerSummary,
  RoyalRepetitionViolation,
  TimelineScene,
  VisualBeat,
} from "../../../shared/visualIntelligence.js";
import {
  rankRoyalAssets,
  royalAssetFingerprint,
  scoreRoyalAsset,
  toApprovedRoyalVisual,
  type ScoredRoyalAsset,
} from "./candidates.js";
import { extractRoyalPeople } from "./taxonomy.js";
import {
  pickReasonForMatch,
  selectionIntentForBeat,
  violatesHardIdentity,
} from "./selectionRules.js";

/** Prefer never-reuse; emergency reuse only when library is exhausted for that beat. */
const PREFERRED_MAX = 1;
const SOFT_MAX = 1;
const HARD_MAX = 1;
const EMERGENCY_MAX = 2;
const MIN_REPEAT_DISTANCE_SECONDS = 120;
const EMERGENCY_REPEAT_DISTANCE_SECONDS = 240;
/** Target ~20% raw by duration (~70–90 unique clips for a ~22min / ~3s-beat job). */
const RAW_TARGET_PERCENT = 0.2;
const RAW_MIN_PERCENT = 0.16;
const RAW_MAX_PERCENT = 0.24;
/** Even spread: ~3–4 raw scenes per minute averaged; soft cap prevents early clumps. */
const RAW_TARGET_PER_MINUTE = 3.5;
const RAW_MAX_SCENES_PER_MINUTE = 5;
/** When later minutes are behind quota, allow one extra raw in that minute. */
const RAW_CATCHUP_PER_MINUTE = 6;
/** Nominal clip length for converting duration quota → scene count. */
const RAW_NOMINAL_CLIP_SECONDS = 3;

function isUnsafeLibraryUrl(url?: string): boolean {
  if (!url) return false;
  return (
    /tiktok\.com/i.test(url) ||
    /pinterest\./i.test(url) ||
    /pinimg\.com/i.test(url) ||
    /lookaside\./i.test(url) ||
    /fbsbx\.com/i.test(url) ||
    /instagram\.com\/seo\//i.test(url)
  );
}

function exactRequirementMet(item: ScoredRoyalAsset, beat: VisualBeat): boolean {
  if (beat.beatType === "exact_person") return item.exactPerson;
  if (beat.beatType === "exact_pair_or_group") return item.exactPair;
  if (beat.beatType === "exact_place") return item.exactPlace;
  return true;
}

function selectionWarnings(
  item: ScoredRoyalAsset,
  beat: VisualBeat,
  usage: number,
  requirementMet = exactRequirementMet(item, beat)
): string[] {
  const warnings: string[] = [];
  if (beat.beatType === "exact_person" && !requirementMet) {
    warnings.push("Wrong-person risk: exact person not shown");
  }
  if (beat.beatType === "exact_pair_or_group" && !requirementMet) {
    warnings.push("Couple/group beat but only one person shown repeatedly");
  }
  if (beat.beatType === "exact_place" && !requirementMet) {
    warnings.push("Specific place mentioned but selected visual is generic");
  }
  if (usage > PREFERRED_MAX) warnings.push("Overused in video");
  if (item.scores.finalMatchScore < 60) warnings.push("Weak Match");
  return warnings;
}

function sceneFromSelection(
  beat: VisualBeat,
  index: number,
  item: ScoredRoyalAsset,
  alternatives: ScoredRoyalAsset[],
  usageVideo: number,
  usageMinute: number,
  lastUsedTimestamp?: number,
  compositePairMatched = false
): TimelineScene {
  const requirementMet = compositePairMatched || exactRequirementMet(item, beat);
  const exact =
    ["exact_person", "exact_pair_or_group", "exact_place"].includes(beat.beatType || "") &&
    requirementMet;
  const warnings = selectionWarnings(item, beat, usageVideo, requirementMet);
  const needsBetterVisual = item.scores.finalMatchScore < 55 || !requirementMet;
  if (needsBetterVisual) warnings.push("Needs Review");
  const contextVisual = item.isContext && !exact;
  const selectionIntent = selectionIntentForBeat(beat);
  const pickReason = pickReasonForMatch({
    beat,
    exactPerson: item.exactPerson,
    exactPair: item.exactPair || compositePairMatched,
    exactPlace: item.exactPlace,
    isContext: contextVisual,
    score: item.scores.finalMatchScore,
    compositePair: compositePairMatched,
  });
  return {
    sceneId: `scene-${index + 1}`,
    beatId: beat.beatId,
    startTime: beat.startTime,
    endTime: beat.endTime,
    duration: beat.duration,
    narrationText: beat.narrationText,
    selectedVisualId: item.asset.assetId,
    approvedVisualId: item.asset.assetId,
    source: item.asset.mediaType === "raw_footage" ? "raw_footage" : "cached_approved",
    reasonSelected: compositePairMatched
      ? `Royal v2 split-screen library match for ${(beat.pairOrGroup || []).join(" and ")}`
      : exact
      ? `Royal v2 exact library match (${item.scores.finalMatchScore})`
      : contextVisual
        ? `Royal v2 approved context match (${item.scores.finalMatchScore})`
        : `Royal v2 closest approved library match (${item.scores.finalMatchScore})`,
    confidence: item.scores.finalMatchScore / 100,
    fallbackUsed: false,
    needsBetterVisual,
    matchType: exact
      ? "exact_match"
      : item.scores.finalMatchScore >= 75
        ? "strong_match"
        : contextVisual
          ? "good_context"
          : item.scores.finalMatchScore >= 55
            ? "related_context"
            : "needs_better_visual",
    viewerShouldSee: beat.visualNeed || beat.viewerShouldSee,
    whyThisMatchesTitle: compositePairMatched
      ? "Two exact individual Royal Media Library matches combined as a split screen"
      : exact
        ? "Exact approved Royal Media Library entity match"
        : "Royal context supports the story",
    whyThisMatchesNarration: item.asset.description || item.asset.title || item.asset.person,
    whyThisIsAppropriate: `${item.asset.mediaType} from ${item.asset.group || "Royal Media Library"}`,
    whatIsMissing: exact ? "" : beat.mainPerson || beat.specificPlace || (beat.pairOrGroup || []).join(" and "),
    repeatDistanceWarning: false,
    cropFraming: "16:9 center-safe",
    transition: "cut",
    warnings: [...new Set(warnings)],
    confidenceScores: toApprovedRoyalVisual(item, [beat.beatId]).confidenceScores,
    rawFootageUsed: item.asset.mediaType === "raw_footage",
    beatType: beat.beatType,
    mainPerson: beat.mainPerson,
    secondaryPeople: beat.secondaryPeople,
    pairOrGroup: beat.pairOrGroup,
    specificPlace: beat.specificPlace,
    contextType: beat.contextType,
    assetUsageCountVideo: usageVideo,
    assetUsageCountCurrentMinute: usageMinute,
    entityUsageCount: 1,
    nearDuplicateRisk: 0,
    lastUsedTimestamp,
    identityConfidence: compositePairMatched ? 95 : item.scores.identityConfidence,
    placeConfidence: item.scores.placeMatch,
    alternativeAssetIds: alternatives.map((alt) => alt.asset.assetId),
    rawFootageAvailable: alternatives.some((alt) => alt.asset.mediaType === "raw_footage"),
    assistantSuggestionAvailable:
      needsBetterVisual || item.scores.finalMatchScore < 70 || warnings.length > 0,
    selectionIntent,
    pickReason,
  };
}

function missingScene(beat: VisualBeat, index: number): TimelineScene {
  return {
    sceneId: `scene-${index + 1}`,
    beatId: beat.beatId,
    startTime: beat.startTime,
    endTime: beat.endTime,
    duration: beat.duration,
    narrationText: beat.narrationText,
    selectedVisualId: "",
    source: "cached_approved",
    reasonSelected: "No acceptable Royal Media Library visual available",
    confidence: 0,
    fallbackUsed: false,
    needsBetterVisual: true,
    matchType: "needs_better_visual",
    viewerShouldSee: beat.visualNeed,
    whatIsMissing: beat.mainPerson || beat.specificPlace || beat.visualNeed,
    warnings: ["Needs Better Visual", "No acceptable library asset"],
    beatType: beat.beatType,
    mainPerson: beat.mainPerson,
    secondaryPeople: beat.secondaryPeople,
    pairOrGroup: beat.pairOrGroup,
    specificPlace: beat.specificPlace,
    contextType: beat.contextType,
    assistantSuggestionAvailable: true,
    selectionIntent: selectionIntentForBeat(beat),
    pickReason: "no identity-safe library asset",
  };
}

export function auditRoyalV2Repetition(scenes: TimelineScene[], assets: LibraryAsset[]): RoyalRepetitionViolation[] {
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const uses = new Map<string, TimelineScene[]>();
  const fingerprints = new Map<string, TimelineScene[]>();
  const violations: RoyalRepetitionViolation[] = [];

  for (const scene of scenes) {
    if (!scene.selectedVisualId) continue;
    const prior = uses.get(scene.selectedVisualId) || [];
    const withinMinute = [...prior].reverse().find((item) => scene.startTime - item.startTime < 60);
    if (withinMinute) {
      violations.push({
        sceneId: scene.sceneId,
        assetId: scene.selectedVisualId,
        kind: "repeated_too_soon",
        severity: "blocked",
        previousSceneId: withinMinute.sceneId,
        message: "Repeated too soon: same asset used inside a 60-second window",
      });
      scene.repeatDistanceWarning = true;
      scene.warnings = [...new Set([...(scene.warnings || []), "Repeated too soon"])];
    }
    prior.push(scene);
    uses.set(scene.selectedVisualId, prior);

    const asset = assetById.get(scene.selectedVisualId);
    if (asset) {
      const fingerprint = royalAssetFingerprint(asset);
      const duplicatePrior = fingerprints.get(fingerprint) || [];
      const adjacent = duplicatePrior.find((item) => Math.abs(scene.startTime - item.startTime) < 10);
      if (adjacent && adjacent.selectedVisualId !== scene.selectedVisualId) {
        violations.push({
          sceneId: scene.sceneId,
          assetId: scene.selectedVisualId,
          kind: "near_duplicate",
          severity: "warning",
          previousSceneId: adjacent.sceneId,
          message: "Near duplicate visual used back-to-back",
        });
        scene.nearDuplicateRisk = 100;
        scene.warnings = [...new Set([...(scene.warnings || []), "Near duplicate"])];
      }
      duplicatePrior.push(scene);
      fingerprints.set(fingerprint, duplicatePrior);
    }
  }

  for (const [assetId, assetScenes] of uses) {
    if (assetScenes.length <= SOFT_MAX) continue;
    for (const scene of assetScenes.slice(SOFT_MAX)) {
      violations.push({
        sceneId: scene.sceneId,
        assetId,
        kind: "overused_in_video",
        severity: assetScenes.length > HARD_MAX ? "blocked" : "warning",
        message: `Overused in video: ${assetScenes.length} uses`,
      });
      scene.warnings = [...new Set([...(scene.warnings || []), "Overused in video"])];
    }
  }
  return violations;
}

function individualPersonBeat(beat: VisualBeat, person: string): VisualBeat {
  return {
    ...beat,
    beatType: "exact_person",
    mainPerson: person,
    secondaryPeople: [],
    pairOrGroup: [],
    mentionedPeople: [person],
    mustMatchEntity: person,
    exactSubject: person,
    mustShow: [person],
    visualNeed: `Show ${person}`,
  };
}

function assetEligible(
  item: ScoredRoyalAsset,
  beatStart: number,
  usage: Map<string, number>,
  lastUsedAt: Map<string, number>,
  fingerprintLastUsedAt: Map<string, number>,
  opts: { maxUses: number; minDistanceSec: number }
): boolean {
  const count = usage.get(item.asset.assetId) || 0;
  if (count >= opts.maxUses) return false;
  if (count > 0) {
    const previous = lastUsedAt.get(item.asset.assetId);
    if (previous !== undefined && beatStart - previous < opts.minDistanceSec) return false;
  }
  const similarAt = fingerprintLastUsedAt.get(item.fingerprint);
  if (similarAt !== undefined) {
    // Fingerprints must stay unique unless emergency reuse is allowed.
    if (opts.maxUses <= HARD_MAX) return false;
    if (beatStart - similarAt < opts.minDistanceSec) return false;
  }
  return true;
}

function rankEligibleAssets(
  assets: LibraryAsset[],
  beat: VisualBeat,
  usage: Map<string, number>,
  lastUsedAt: Map<string, number>,
  fingerprintLastUsedAt: Map<string, number>,
  options?: { includeEmergencyReuse?: boolean }
): ScoredRoyalAsset[] {
  const usedNearby = new Set(
    [...lastUsedAt]
      .filter(([, usedAt]) => beat.startTime - usedAt < MIN_REPEAT_DISTANCE_SECONDS)
      .map(([assetId]) => assetId)
  );
  const identitySafe = assets.filter((asset) => !violatesHardIdentity(asset, beat));
  const ranked = rankRoyalAssets(identitySafe, beat, usage, usedNearby).filter(
    (item) =>
      !isUnsafeLibraryUrl(item.asset.sourceUrl) &&
      !isUnsafeLibraryUrl(item.asset.sourcePageUrl) &&
      !violatesHardIdentity(item.asset, beat)
  );
  const unique = ranked.filter((item) =>
    assetEligible(item, beat.startTime, usage, lastUsedAt, fingerprintLastUsedAt, {
      maxUses: HARD_MAX,
      minDistanceSec: MIN_REPEAT_DISTANCE_SECONDS,
    })
  );
  const exactNeeded = ["exact_person", "exact_pair_or_group", "exact_place"].includes(
    beat.beatType || ""
  );
  const emergency = ranked.filter((item) => {
    if (violatesHardIdentity(item.asset, beat)) return false;
    if (exactNeeded && !exactRequirementMet(item, beat)) return false;
    return assetEligible(item, beat.startTime, usage, lastUsedAt, fingerprintLastUsedAt, {
      maxUses: EMERGENCY_MAX,
      minDistanceSec: EMERGENCY_REPEAT_DISTANCE_SECONDS,
    });
  });

  // When chasing raw quota, keep unique first but also surface far-apart emergency reuse.
  if (options?.includeEmergencyReuse) {
    const seen = new Set(unique.map((item) => item.asset.assetId));
    return [...unique, ...emergency.filter((item) => !seen.has(item.asset.assetId))];
  }
  if (unique.length) return unique;
  // Emergency: allow one reuse of an exact library match far away in the timeline.
  // Still never cross person identity locks.
  return emergency;
}

function compositePairCandidates(
  beat: VisualBeat,
  assets: LibraryAsset[],
  usage: Map<string, number>,
  lastUsedAt: Map<string, number>,
  fingerprintLastUsedAt: Map<string, number>
): ScoredRoyalAsset[] {
  const people = [...new Set(beat.pairOrGroup || [])].filter(
    (person) => person && person !== "British Royal Family"
  );
  if (people.length < 2) return [];
  const picks: ScoredRoyalAsset[] = [];
  for (const person of people.slice(0, 2)) {
    const personBeat = individualPersonBeat(beat, person);
    const eligible = rankEligibleAssets(
      assets,
      personBeat,
      usage,
      lastUsedAt,
      fingerprintLastUsedAt
    ).filter((item) => {
      if (!item.exactPerson || picks.some((existing) => existing.asset.assetId === item.asset.assetId)) {
        return false;
      }
      return true;
    });
    const pick =
      eligible.find((item) => {
        const assetPeople = extractRoyalPeople(
          [
            item.asset.person,
            item.asset.group,
            item.asset.category,
            ...(item.asset.categories || []),
            item.asset.title,
            item.asset.description,
            item.asset.queryUsed,
          ]
            .filter(Boolean)
            .join(" ")
        );
        return !people.some((other) => other !== person && assetPeople.includes(other));
      }) || eligible[0];
    if (!pick) return [];
    picks.push(pick);
  }
  return picks;
}

type RawRelaxLevel = "strict" | "relax" | "strongRelax";

function rawCandidateAppropriate(
  item: ScoredRoyalAsset,
  beat: VisualBeat,
  bestScore: number,
  options?: { relaxLevel?: RawRelaxLevel }
): boolean {
  if (item.asset.mediaType !== "raw_footage") return false;
  const level = options?.relaxLevel || "strict";
  const floor =
    level === "strongRelax"
      ? Math.max(32, bestScore - 38)
      : level === "relax"
        ? Math.max(38, bestScore - 30)
        : Math.max(45, bestScore - 22);
  if (item.scores.finalMatchScore < floor) return false;
  if (item.scores.qualityScore < (level === "strongRelax" ? 60 : 70)) return false;
  if (beat.beatType === "exact_person") {
    // Hard person lock still enforced via violatesHardIdentity; this only softens score floor.
    const identityFloor = level === "strongRelax" ? 68 : level === "relax" ? 75 : 85;
    return item.exactPerson && item.scores.identityConfidence >= identityFloor;
  }
  if (beat.beatType === "exact_pair_or_group") return item.exactPair || item.exactPerson;
  if (beat.beatType === "exact_place") return item.exactPlace;
  return item.scores.contextMatch >= (level === "strongRelax" ? 28 : level === "relax" ? 35 : 45);
}

function computeRawSchedule(totalDuration: number, beatCount: number) {
  const avgBeatDuration = totalDuration / Math.max(1, beatCount);
  const targetRawDuration = totalDuration * RAW_TARGET_PERCENT;
  const nominalClip = Math.min(
    RAW_NOMINAL_CLIP_SECONDS + 0.2,
    Math.max(2.5, avgBeatDuration)
  );
  const durationBasedTarget = Math.round(targetRawDuration / nominalClip);
  const paceBasedTarget = Math.round((totalDuration / 60) * RAW_TARGET_PER_MINUTE);
  // Blend duration quota with ~3–4/min pace → ~70–90 for a typical 22min job.
  const targetRawSceneCount = Math.max(
    1,
    Math.round(durationBasedTarget * 0.55 + paceBasedTarget * 0.45)
  );
  const rawIntervalSec = totalDuration / Math.max(1, targetRawSceneCount);
  return { targetRawDuration, targetRawSceneCount, rawIntervalSec, avgBeatDuration };
}

function minuteRawMapToRecord(map: Map<number, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([minute, count]) => [String(minute + 1), count])
  );
}

/**
 * Prefer unused unique raw first. Reuse only when unique pool is exhausted and still under quota.
 * Hard identity locks remain enforced by rankEligibleAssets / violatesHardIdentity.
 */
function pickRawCandidate(
  ranked: ScoredRoyalAsset[],
  beat: VisualBeat,
  bestScore: number,
  usedRawIds: Set<string>,
  options: { relaxLevel: RawRelaxLevel; allowReuse: boolean }
): ScoredRoyalAsset | undefined {
  const levels: RawRelaxLevel[] =
    options.relaxLevel === "strongRelax"
      ? ["strict", "relax", "strongRelax"]
      : options.relaxLevel === "relax"
        ? ["strict", "relax"]
        : ["strict"];

  // Always exhaust unique appropriate raw across relax levels before any reuse.
  for (const level of levels) {
    const unique = ranked.find(
      (item) =>
        !usedRawIds.has(item.asset.assetId) &&
        rawCandidateAppropriate(item, beat, bestScore, { relaxLevel: level })
    );
    if (unique) return unique;
  }
  if (!options.allowReuse) return undefined;
  for (const level of levels) {
    const reused = ranked.find((item) =>
      rawCandidateAppropriate(item, beat, bestScore, { relaxLevel: level })
    );
    if (reused) return reused;
  }
  return undefined;
}

export async function assembleRoyalV2Timeline(
  jobId: string,
  beats: VisualBeat[],
  assets: LibraryAsset[]
): Promise<{ scenes: TimelineScene[]; library: ApprovedVisual[]; violations: RoyalRepetitionViolation[] }> {
  const usage = new Map<string, number>();
  const lastUsedAt = new Map<string, number>();
  const fingerprintLastUsedAt = new Map<string, number>();
  const scenes: TimelineScene[] = [];
  const approved = new Map<string, ApprovedVisual>();
  const rawScenesByMinute = new Map<number, number>();
  const usedRawIds = new Set<string>();
  const totalDuration = Math.max(
    1,
    beats.reduce((n, beat) => n + Math.max(0.1, beat.duration), 0)
  );
  const { targetRawDuration, targetRawSceneCount, rawIntervalSec } = computeRawSchedule(
    totalDuration,
    beats.length
  );
  let rawDurationUsed = 0;
  let rawSceneCount = 0;
  let lastRawAt = -999;

  for (let index = 0; index < beats.length; index++) {
    const beat = beats[index];
    let ranked = rankEligibleAssets(assets, beat, usage, lastUsedAt, fingerprintLastUsedAt);

    const exactRanked = ranked.filter((item) => exactRequirementMet(item, beat));
    if (exactRanked.length) ranked = [...exactRanked, ...ranked.filter((item) => !exactRequirementMet(item, beat))];

    let compositePairMatched = false;
    if (beat.beatType === "exact_pair_or_group") {
      const pairPicks = compositePairCandidates(
        beat,
        assets,
        usage,
        lastUsedAt,
        fingerprintLastUsedAt
      );
      if (pairPicks.length >= 2) {
        compositePairMatched = true;
        ranked = [
          pairPicks[0],
          pairPicks[1],
          ...ranked.filter(
            (item) => !pairPicks.some((pick) => pick.asset.assetId === item.asset.assetId)
          ),
        ];
      }
    }

    if (!compositePairMatched && ranked[0]) {
      const minute = Math.floor(beat.startTime / 60);
      const rawCountThisMinute = rawScenesByMinute.get(minute) || 0;
      const progress = beat.startTime / totalDuration;
      const expectedRawCount = Math.floor(progress * targetRawSceneCount + 1e-6);
      const behindBy = expectedRawCount - rawSceneCount;
      const behindRawQuota = behindBy > 0;
      const severelyBehind = behindBy >= 2 && progress >= 0.35;
      const rawProgress = rawDurationUsed / Math.max(0.01, targetRawDuration);
      const aheadOfSchedule = rawProgress > progress + 0.04 || rawSceneCount > expectedRawCount + 1;
      const underGlobalCap =
        rawDurationUsed < totalDuration * RAW_MAX_PERCENT &&
        rawSceneCount < Math.ceil(targetRawSceneCount * 1.12);
      const minuteCap = severelyBehind ? RAW_CATCHUP_PER_MINUTE : RAW_MAX_SCENES_PER_MINUTE;
      const minuteAtPace =
        rawCountThisMinute >= Math.ceil(RAW_TARGET_PER_MINUTE) && !behindRawQuota;
      // Even cadence from target count; tighten spacing when ahead, loosen when catching up.
      const minGap = behindRawQuota
        ? rawIntervalSec * (severelyBehind ? 0.55 : 0.7)
        : rawIntervalSec * 0.9;
      const spaced = beat.startTime - lastRawAt >= minGap;
      const wantRaw =
        underGlobalCap &&
        !aheadOfSchedule &&
        !minuteAtPace &&
        rawCountThisMinute < minuteCap &&
        spaced &&
        (behindRawQuota ||
          rawDurationUsed / Math.max(1, beat.startTime + beat.duration) < RAW_TARGET_PERCENT);

      if (wantRaw) {
        const relaxLevel: RawRelaxLevel = severelyBehind
          ? "strongRelax"
          : behindRawQuota && progress >= 0.25
            ? "relax"
            : "strict";
        // Reuse only when still under ~20% and unique raw for this beat is exhausted.
        const allowReuse = behindRawQuota && rawDurationUsed < targetRawDuration;
        const rawPool = allowReuse
          ? rankEligibleAssets(assets, beat, usage, lastUsedAt, fingerprintLastUsedAt, {
              includeEmergencyReuse: true,
            })
          : ranked;
        const raw = pickRawCandidate(
          rawPool,
          beat,
          ranked[0].scores.finalMatchScore,
          usedRawIds,
          { relaxLevel, allowReuse }
        );
        if (raw) ranked = [raw, ...ranked.filter((item) => item.asset.assetId !== raw.asset.assetId)];
      } else if (
        (aheadOfSchedule ||
          rawCountThisMinute >= RAW_MAX_SCENES_PER_MINUTE ||
          rawDurationUsed >= totalDuration * RAW_MAX_PERCENT) &&
        ranked[0].asset.mediaType === "raw_footage"
      ) {
        const image = ranked.find(
          (item) =>
            item.asset.mediaType === "image" &&
            exactRequirementMet(item, beat) === exactRequirementMet(ranked[0], beat) &&
            item.scores.finalMatchScore >= ranked[0].scores.finalMatchScore - 15
        );
        if (image) ranked = [image, ...ranked.filter((item) => item.asset.assetId !== image.asset.assetId)];
      }
    }

    const selected = ranked[0];
    if (!selected) {
      scenes.push(missingScene(beat, index));
      continue;
    }

    const alternatives = ranked.slice(1, 9);
    const previousUse = lastUsedAt.get(selected.asset.assetId);
    const count = (usage.get(selected.asset.assetId) || 0) + 1;
    usage.set(selected.asset.assetId, count);
    lastUsedAt.set(selected.asset.assetId, beat.startTime);
    fingerprintLastUsedAt.set(selected.fingerprint, beat.startTime);
    const scene = sceneFromSelection(
      beat,
      index,
      selected,
      alternatives,
      count,
      1,
      previousUse,
      compositePairMatched
    );
    scenes.push(scene);
    if (selected.asset.mediaType === "raw_footage") {
      const minute = Math.floor(beat.startTime / 60);
      rawScenesByMinute.set(minute, (rawScenesByMinute.get(minute) || 0) + 1);
      rawDurationUsed += beat.duration;
      rawSceneCount += 1;
      usedRawIds.add(selected.asset.assetId);
      lastRawAt = beat.startTime;
    }

    const items = [selected, ...alternatives];
    for (const item of items) {
      const existing = approved.get(item.asset.assetId);
      const beatIds = [...new Set([...(existing?.allowedBeatIds || []), beat.beatId])];
      approved.set(item.asset.assetId, toApprovedRoyalVisual(item, beatIds));
    }
    if (index > 0 && index % 10 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  // Backfill toward ~20% raw duration, preferring minutes that are under pace and unique clips.
  if (rawDurationUsed < totalDuration * RAW_MIN_PERCENT) {
    const totalMinutes = Math.max(1, Math.ceil(totalDuration / 60));
    const candidates = scenes
      .map((scene, idx) => ({ scene, idx }))
      .filter(({ scene }) => !scene.rawFootageUsed && Boolean(scene.selectedVisualId))
      .sort((a, b) => {
        const minuteA = Math.floor(a.scene.startTime / 60);
        const minuteB = Math.floor(b.scene.startTime / 60);
        const countA = rawScenesByMinute.get(minuteA) || 0;
        const countB = rawScenesByMinute.get(minuteB) || 0;
        // Fill sparse minutes first so late runtime is not left empty.
        if (countA !== countB) return countA - countB;
        const weight = (scene: TimelineScene) =>
          ["exact_person", "exact_pair_or_group", "exact_place"].includes(scene.beatType || "")
            ? 1
            : 0;
        return weight(a.scene) - weight(b.scene) || a.scene.startTime - b.scene.startTime;
      });

    for (const { scene, idx } of candidates) {
      if (rawDurationUsed >= targetRawDuration || rawSceneCount >= targetRawSceneCount) break;
      const minute = Math.floor(scene.startTime / 60);
      const progress = scene.startTime / totalDuration;
      const behindLate = progress >= 0.35 && rawSceneCount < progress * targetRawSceneCount - 1;
      const minuteCap = behindLate ? RAW_CATCHUP_PER_MINUTE : RAW_MAX_SCENES_PER_MINUTE;
      if ((rawScenesByMinute.get(minute) || 0) >= minuteCap) continue;
      if (scene.startTime - lastRawAt < rawIntervalSec * 0.55) continue;
      const beat = beats.find((item) => item.beatId === scene.beatId);
      if (!beat) continue;
      const allowReuse = rawDurationUsed < targetRawDuration;
      const ranked = rankEligibleAssets(assets, beat, usage, lastUsedAt, fingerprintLastUsedAt, {
        includeEmergencyReuse: allowReuse,
      });
      const raw = pickRawCandidate(
        ranked.filter((item) => item.asset.assetId !== scene.selectedVisualId),
        beat,
        ranked[0]?.scores.finalMatchScore || 50,
        usedRawIds,
        {
          relaxLevel: behindLate || minute >= Math.floor(totalMinutes * 0.5) ? "strongRelax" : "relax",
          allowReuse,
        }
      );
      if (!raw) continue;

      const previousId = scene.selectedVisualId;
      if (previousId) usage.set(previousId, Math.max(0, (usage.get(previousId) || 1) - 1));
      const count = (usage.get(raw.asset.assetId) || 0) + 1;
      usage.set(raw.asset.assetId, count);
      lastUsedAt.set(raw.asset.assetId, beat.startTime);
      fingerprintLastUsedAt.set(raw.fingerprint, beat.startTime);

      const alternatives = ranked
        .filter((item) => item.asset.assetId !== raw.asset.assetId)
        .slice(0, 8);
      const nextScene = sceneFromSelection(
        beat,
        idx,
        raw,
        alternatives,
        count,
        1,
        lastUsedAt.get(previousId),
        false
      );
      nextScene.warnings = [
        ...new Set([...(nextScene.warnings || []), "Raw ~20% duration backfill"]),
      ];
      scenes[idx] = nextScene;
      approved.set(raw.asset.assetId, toApprovedRoyalVisual(raw, [beat.beatId]));
      rawScenesByMinute.set(minute, (rawScenesByMinute.get(minute) || 0) + 1);
      rawDurationUsed += beat.duration;
      rawSceneCount += 1;
      usedRawIds.add(raw.asset.assetId);
      lastRawAt = beat.startTime;
    }
  }

  const finalUsage = usedCountsForScenes(scenes);
  const entityUsage = new Map<string, number>();
  for (const scene of scenes) {
    if (scene.mainPerson) entityUsage.set(scene.mainPerson, (entityUsage.get(scene.mainPerson) || 0) + 1);
  }
  for (const scene of scenes) {
    scene.assetUsageCountVideo = finalUsage.get(scene.selectedVisualId) || 0;
    scene.assetUsageCountCurrentMinute = scenes.filter(
      (other) =>
        other.selectedVisualId === scene.selectedVisualId &&
        Math.abs(other.startTime - scene.startTime) < MIN_REPEAT_DISTANCE_SECONDS
    ).length;
    scene.entityUsageCount = scene.mainPerson ? entityUsage.get(scene.mainPerson) || 0 : 0;
  }

  const violations = auditRoyalV2Repetition(scenes, assets);
  const library = [...approved.values()];
  await writeJson(jobDataFile("visual-intelligence-approved-library", jobId), {
    jobId,
    approved: library,
    source: "Royal Media Library on R2",
    createdAt: new Date().toISOString(),
  });
  await writeJson(jobDataFile("royal-v2-final-assignment", jobId), { jobId, scenes });
  await writeJson(jobDataFile("visual-intelligence-final-assignment", jobId), { jobId, scenes });
  await writeJson(jobDataFile("royal-v2-repetition-audit", jobId), {
    jobId,
    rules: {
      sameAssetWindowSec: MIN_REPEAT_DISTANCE_SECONDS,
      emergencyWindowSec: EMERGENCY_REPEAT_DISTANCE_SECONDS,
      preferredMax: PREFERRED_MAX,
      softMax: SOFT_MAX,
      hardMax: HARD_MAX,
      emergencyMax: EMERGENCY_MAX,
      rawTargetPercent: RAW_TARGET_PERCENT,
      rawTargetSceneCount: targetRawSceneCount,
      rawIntervalSec: Number(rawIntervalSec.toFixed(2)),
      rawTargetPerMinute: RAW_TARGET_PER_MINUTE,
      rawMaxScenesPerMinute: RAW_MAX_SCENES_PER_MINUTE,
    },
    violations,
    blockedViolations: violations.filter((violation) => violation.severity === "blocked").length,
    createdAt: new Date().toISOString(),
  });
  const finalRawDuration = scenes
    .filter((scene) => scene.rawFootageUsed)
    .reduce((n, scene) => n + scene.duration, 0);
  const finalTotalDuration = scenes.reduce((n, scene) => n + scene.duration, 0);
  const finalRawPercent = Number(
    ((finalRawDuration / Math.max(1, finalTotalDuration)) * 100).toFixed(1)
  );
  const uniqueRawUsed = new Set(
    scenes.filter((scene) => scene.rawFootageUsed && scene.selectedVisualId).map((s) => s.selectedVisualId)
  ).size;
  const rawByMinute = minuteRawMapToRecord(
    scenes.reduce((map, scene) => {
      if (!scene.rawFootageUsed) return map;
      const minute = Math.floor(scene.startTime / 60);
      map.set(minute, (map.get(minute) || 0) + 1);
      return map;
    }, new Map<number, number>())
  );
  await writeJson(jobDataFile("royal-v2-raw-usage", jobId), {
    jobId,
    uniqueRawUsed,
    rawSceneCount: scenes.filter((scene) => scene.rawFootageUsed).length,
    totalScenes: scenes.length,
    rawPercent: finalRawPercent,
    rawFootagePercent: finalRawPercent,
    rawByMinute,
    rawScenesByMinute: rawByMinute,
    targetRawSceneCount,
    targetRawPercent: {
      minimum: RAW_MIN_PERCENT * 100,
      maximum: RAW_MAX_PERCENT * 100,
      target: RAW_TARGET_PERCENT * 100,
    },
    createdAt: new Date().toISOString(),
  });
  await writeJson(jobDataFile("royal-v2-selection-report", jobId), {
    jobId,
    createdAt: new Date().toISOString(),
    uniqueRawUsed,
    rawPercent: finalRawPercent,
    rawByMinute,
    targetRawSceneCount,
    scenes: scenes.map((scene) => ({
      sceneId: scene.sceneId,
      beatId: scene.beatId,
      beatType: scene.beatType,
      selectionIntent: scene.selectionIntent,
      pickReason: scene.pickReason,
      mainPerson: scene.mainPerson,
      specificPlace: scene.specificPlace,
      selectedVisualId: scene.selectedVisualId,
      matchType: scene.matchType,
      confidence: scene.confidence,
      needsBetterVisual: scene.needsBetterVisual,
      rawFootageUsed: scene.rawFootageUsed,
    })),
  });
  return { scenes, library, violations };
}

function usedCountsForScenes(scenes: TimelineScene[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const scene of scenes) {
    if (!scene.selectedVisualId) continue;
    counts.set(scene.selectedVisualId, (counts.get(scene.selectedVisualId) || 0) + 1);
  }
  return counts;
}

export function buildRoyalV2ManagerSummary(
  jobId: string,
  scenes: TimelineScene[],
  violations: RoyalRepetitionViolation[]
): RoyalManagerSummary {
  const totalDuration = scenes.reduce((n, scene) => n + scene.duration, 0);
  const rawDuration = scenes
    .filter((scene) => scene.rawFootageUsed)
    .reduce((n, scene) => n + scene.duration, 0);
  const attention = scenes
    .map((scene) => {
      const reasons = [
        scene.softApproval === "fail" ? "Soft approval fail (wrong person risk)" : "",
        scene.softApproval === "unsure" ? "Soft approval unsure" : "",
        scene.needsBetterVisual ? "Needs better visual" : "",
        scene.confidence < 0.7 ? "Low confidence" : "",
        scene.repeatDistanceWarning ? "Repeated too soon" : "",
        ...(scene.warnings || []),
      ].filter(Boolean);
      return { scene, reason: [...new Set(reasons)].join("; ") };
    })
    .filter((item) => item.reason)
    .sort((a, b) => {
      const rank = (s: TimelineScene) =>
        s.softApproval === "fail" ? 0 : s.softApproval === "unsure" ? 1 : 2;
      return rank(a.scene) - rank(b.scene) || a.scene.confidence - b.scene.confidence;
    })
    .slice(0, 10);

  const genericForExact = scenes.filter(
    (scene) =>
      ["exact_person", "exact_pair_or_group", "exact_place"].includes(scene.beatType || "") &&
      scene.matchType !== "exact_match"
  ).length;
  const rawPercent = Number(((rawDuration / Math.max(1, totalDuration)) * 100).toFixed(1));
  const uniqueRawUsed = new Set(
    scenes
      .filter((scene) => scene.rawFootageUsed && scene.selectedVisualId)
      .map((scene) => scene.selectedVisualId)
  ).size;
  const rawScenesByMinute = Object.fromEntries(
    [...new Set(scenes.map((scene) => Math.floor(scene.startTime / 60)))]
      .sort((a, b) => a - b)
      .map((minute) => [
        String(minute + 1),
        scenes.filter(
          (scene) => scene.rawFootageUsed && Math.floor(scene.startTime / 60) === minute
        ).length,
      ])
  );
  const rawCadenceMet =
    rawPercent >= RAW_MIN_PERCENT * 100 && rawPercent <= RAW_MAX_PERCENT * 100;
  const softFails = scenes.filter((scene) => scene.softApproval === "fail").length;
  const softUnsure = scenes.filter((scene) => scene.softApproval === "unsure").length;
  const softChecked = scenes.filter((scene) => Boolean(scene.softApproval)).length;

  const recommendedFixes: string[] = [];
  if (softFails) recommendedFixes.push(`Review ${softFails} soft-approval fail(s) — wrong person risk`);
  if (genericForExact) recommendedFixes.push(`Repair ${genericForExact} exact entity/place scenes`);
  if (violations.length) recommendedFixes.push(`Resolve ${violations.length} repetition warnings`);
  if (!rawCadenceMet) {
    recommendedFixes.push(
      `Aim for ~${Math.round(RAW_TARGET_PERCENT * 100)}% raw footage by duration (now ${rawPercent}%, uniqueRaw=${uniqueRawUsed})`
    );
  }
  if (!recommendedFixes.length) recommendedFixes.push("Review flagged scenes, then lock timeline");

  return {
    jobId,
    totalScenes: scenes.length,
    averageSceneDuration: Number((totalDuration / Math.max(1, scenes.length)).toFixed(2)),
    exactPersonScenes: scenes.filter(
      (scene) =>
        ["exact_person", "exact_pair_or_group"].includes(scene.beatType || "") &&
        scene.matchType === "exact_match"
    ).length,
    exactPlaceScenes: scenes.filter(
      (scene) => scene.beatType === "exact_place" && scene.matchType === "exact_match"
    ).length,
    contextScenes: scenes.filter((scene) =>
      ["media_or_palace_context", "emotional_context", "formal_or_court_context", "generic_transition"].includes(
        scene.beatType || ""
      )
    ).length,
    rawFootageScenes: scenes.filter((scene) => scene.rawFootageUsed).length,
    rawFootagePercent: rawPercent,
    uniqueRawUsed,
    rawScenesByMinute,
    rawCadenceMet,
    lowConfidenceScenes: scenes.filter((scene) => scene.confidence < 0.7 || scene.needsBetterVisual).length,
    repeatedVisualWarnings: violations.length,
    genericContextForExactScene: genericForExact,
    softApprovalFails: softFails,
    softApprovalUnsure: softUnsure,
    softApprovalChecked: softChecked,
    topScenesNeedingReview: attention.map(({ scene, reason }) => ({
      sceneId: scene.sceneId,
      startTime: scene.startTime,
      reason,
      confidence: scene.confidence,
    })),
    recommendedFixes,
    renderReady:
      softFails === 0 &&
      attention.length === 0 &&
      violations.every((item) => item.severity !== "blocked"),
    createdAt: new Date().toISOString(),
  };
}

export async function replaceRoyalV2Scene(
  scene: TimelineScene,
  beat: VisualBeat,
  asset: LibraryAsset,
  allAssets: LibraryAsset[]
): Promise<{ scene: TimelineScene; approved: ApprovedVisual }> {
  const item = scoreRoyalAsset(asset, beat);
  const alternatives = rankRoyalAssets(allAssets, beat, new Map(), new Set())
    .filter((candidate) => candidate.asset.assetId !== asset.assetId)
    .slice(0, 8);
  return {
    scene: sceneFromSelection(
      beat,
      Number(scene.sceneId.replace(/\D/g, "")) - 1,
      item,
      alternatives,
      scene.assetUsageCountVideo || 1,
      1,
      scene.lastUsedTimestamp
    ),
    approved: toApprovedRoyalVisual(item, [beat.beatId]),
  };
}

/**
 * Soft-approval fail → re-pick from library by description/person match (library only).
 */
export async function repairSoftApprovalFails(params: {
  scenes: TimelineScene[];
  beats: VisualBeat[];
  assets: LibraryAsset[];
  library: ApprovedVisual[];
}): Promise<{
  scenes: TimelineScene[];
  library: ApprovedVisual[];
  repairedCount: number;
}> {
  const { beats, assets } = params;
  const scenes = [...params.scenes];
  const approved = new Map(params.library.map((v) => [v.approvedVisualId, v]));
  const usage = usedCountsForScenes(scenes);
  const lastUsedAt = new Map<string, number>();
  const fingerprintLastUsedAt = new Map<string, number>();
  for (const scene of scenes) {
    if (scene.selectedVisualId) lastUsedAt.set(scene.selectedVisualId, scene.startTime);
  }
  let repairedCount = 0;

  for (let idx = 0; idx < scenes.length; idx++) {
    const scene = scenes[idx];
    if (scene.softApproval !== "fail") continue;
    const beat = beats.find((b) => b.beatId === scene.beatId);
    if (!beat) continue;
    const ranked = rankEligibleAssets(assets, beat, usage, lastUsedAt, fingerprintLastUsedAt).filter(
      (item) =>
        item.asset.assetId !== scene.selectedVisualId && !violatesHardIdentity(item.asset, beat)
    );
    // Prefer image alternatives that satisfy identity via description match.
    const pick =
      ranked.find(
        (item) =>
          item.asset.mediaType === "image" &&
          exactRequirementMet(item, beat) &&
          item.asset.assetId !== scene.selectedVisualId
      ) ||
      ranked.find(
        (item) =>
          exactRequirementMet(item, beat) && item.asset.assetId !== scene.selectedVisualId
      );
    if (!pick) continue;

    const previousId = scene.selectedVisualId;
    if (previousId) usage.set(previousId, Math.max(0, (usage.get(previousId) || 1) - 1));
    const count = (usage.get(pick.asset.assetId) || 0) + 1;
    usage.set(pick.asset.assetId, count);
    lastUsedAt.set(pick.asset.assetId, beat.startTime);
    fingerprintLastUsedAt.set(pick.fingerprint, beat.startTime);

    const next = sceneFromSelection(
      beat,
      idx,
      pick,
      ranked.filter((r) => r.asset.assetId !== pick.asset.assetId).slice(0, 8),
      count,
      1,
      lastUsedAt.get(previousId || "")
    );
    next.warnings = [
      ...new Set([
        ...(next.warnings || []).filter((w) => !/^Soft approval fail/i.test(w)),
        "Soft-approval library re-pick",
      ]),
    ];
    next.softApproval = undefined;
    next.softApprovalReason = undefined;
    next.needsBetterVisual = false;
    scenes[idx] = next;
    approved.set(pick.asset.assetId, toApprovedRoyalVisual(pick, [beat.beatId]));
    repairedCount += 1;
  }

  return { scenes, library: [...approved.values()], repairedCount };
}

