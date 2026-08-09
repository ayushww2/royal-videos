/**
 * Celebrity v1 permanent edit defaults — derived from human reference
 * YouTube Tp5kwT3785Y ("The Unseen" / Joel Osteen documentary style).
 *
 * User approval gate: once the user approves this recipe, every new
 * Celebrity v1 job uses these defaults automatically. No per-job toggle.
 * Env CELEBRITY_V1_REFERENCE_EDIT defaults ON (set false/0/off to disable).
 *
 * Measured from opener/mid/late 3-minute samples + frame review — see
 * storage/data/celebrity-v1-reference-recipe-Tp5kwT3785Y.json and
 * REFERENCE_RECIPE.md in this folder.
 */

export const CELEBRITY_V1_REFERENCE_VIDEO_ID = "Tp5kwT3785Y";
export const CELEBRITY_V1_REFERENCE_URL =
  "https://www.youtube.com/watch?v=Tp5kwT3785Y";

/** Measured pacing from scene-detect (thresh≈0.22, merged <0.45s). */
export const CELEBRITY_V1_RECIPE = {
  referenceVideoId: CELEBRITY_V1_REFERENCE_VIDEO_ID,
  referenceUrl: CELEBRITY_V1_REFERENCE_URL,
  channel: "The Unseen",
  title: "Things Aren't Looking Good For Pastor Joel Osteen",
  fullDurationSec: 2048,

  /** Cuts per minute — opener ~9.7, mid ~13, late ~11.3 → aim ~11. */
  cutsPerMinute: { min: 9, target: 11, max: 13 },

  /** Hold length seconds — median ~4.4–5.2, avg ~4.5–6. */
  holdSec: { min: 3.5, target: 5.0, max: 7.5, p25: 2.8, p75: 7.0 },

  /**
   * Motion / archival video vs stills (duration share).
   * Reference is heavily archival talking-head video (~55–70% motion).
   * With user YouTube raw we target a practical 25–38% band (user jobs often ask 20–30%).
   */
  rawFootagePercent: { min: 22, target: 30, max: 38, referenceEstimate: 60 },

  /** Classic name/date lower-thirds are sparse; corner name IDs are common. */
  lowerThirdsPerMinute: { min: 0.3, target: 0.6, max: 1.0 },
  lowerThirdStyle: "classic_blue_white_bottom_left_sparse",
  cornerNameId: true,

  /** Ken Burns on stills; subtle push-in on hero portraits; zoom-out rare. */
  zoom: {
    stillsKenBurns: true,
    zoomInShare: 0.65,
    zoomOutShare: 0.2,
    staticShare: 0.15,
    intensity: 0.06,
  },

  /** Hard cuts dominate; dissolves almost never; split/framed presentation occasional. */
  transitions: {
    cut: 0.92,
    dissolve: 0.03,
    splitOrFramed: 0.05,
  },

  /** Effect moments per minute (LT + presentations + rare reveal) — not packed. */
  effectsPerMinute: { min: 1.5, target: 2.5, max: 3.5 },

  opener: {
    preferSubjectFace: true,
    preferArchivalOrInterview: true,
    forbidWrongPerson: true,
    forbidOffensiveGesture: true,
    maxHoldSec: 8,
  },

  textOnScreen: {
    dynamicCaptions: "bold_white_all_caps_black_outline_center",
    nameId: "top_left_small_white",
    yearMarker: "bottom_left_blue_box_sparse",
  },

  musicSfxFeel: "bed_under_vo_sparse_hits_no_wall_to_wall_sfx",
} as const;

export type CelebrityV1Recipe = typeof CELEBRITY_V1_RECIPE;

function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return defaultOn;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return defaultOn;
}

/** Default ON — permanent Celebrity v1 behavior after user approval. */
export function isCelebrityV1ReferenceEditEnabled(): boolean {
  return envFlag("CELEBRITY_V1_REFERENCE_EDIT", true);
}

export function isCelebrityV1Job(niche: string | undefined | null): boolean {
  return niche === "Celebrity v1";
}

export function celebrityRecipeActive(niche: string | undefined | null): boolean {
  return isCelebrityV1Job(niche) && isCelebrityV1ReferenceEditEnabled();
}

/** Target beat / scene hold for Celebrity VO clock. */
export function celebrityTargetHoldSec(): number {
  return CELEBRITY_V1_RECIPE.holdSec.target;
}

export function celebrityHoldClamp(duration: number): number {
  const { min, max } = CELEBRITY_V1_RECIPE.holdSec;
  return Math.max(min, Math.min(max, duration));
}

/** Raw mix band when Celebrity recipe is active and YouTube raw exists. */
export function celebrityRawMixBand(effectivePercent0to100?: number): {
  targetMin: number;
  targetMax: number;
  rawTargetPercent: number;
  effectiveRawTargetPercent: number;
} {
  const recipe = CELEBRITY_V1_RECIPE.rawFootagePercent;
  const base = recipe.target;
  const effective =
    typeof effectivePercent0to100 === "number" && effectivePercent0to100 > 0
      ? Math.max(recipe.min, Math.min(recipe.max, effectivePercent0to100))
      : base;
  return {
    targetMin: recipe.min / 100,
    targetMax: recipe.max / 100,
    rawTargetPercent: base,
    effectiveRawTargetPercent: Number(effective.toFixed(1)),
  };
}

export function celebrityLowerThirdGapSec(): number {
  // ~0.6 LT/min → gap ≈ 100s; first subject intro can land earlier (~35s).
  return 35;
}

/** Hard cap on classic lower-thirds for a cut of this length. */
export function celebrityMaxLowerThirds(durationSec: number): number {
  const perMin = CELEBRITY_V1_RECIPE.lowerThirdsPerMinute.max;
  return Math.max(2, Math.min(8, Math.ceil((durationSec / 60) * perMin)));
}

export function celebrityEffectsPerMinuteCap(): number {
  return CELEBRITY_V1_RECIPE.effectsPerMinute.max;
}
