/**
 * Mystery v2 Shotstack FX density + allowed catalog.
 * Default speeds only (no Fast/Slow) for clean documentary motion.
 */

export const MYSTERY_V2_SHOTSTACK_EFFECTS = [
  "zoomIn",
  "zoomOut",
  "slideRight",
  "slideLeft",
  "slideUp",
] as const;

export const MYSTERY_V2_SHOTSTACK_FILTERS = ["greyscale", "darken"] as const;

export const MYSTERY_V2_SHOTSTACK_TRANSITIONS = [
  "fade",
  "wipeLeft",
  "slideRight",
  "reveal",
  "zoom",
] as const;

export type MysteryV2ShotstackEffect = (typeof MYSTERY_V2_SHOTSTACK_EFFECTS)[number];
export type MysteryV2ShotstackFilter = (typeof MYSTERY_V2_SHOTSTACK_FILTERS)[number];
export type MysteryV2ShotstackTransition = (typeof MYSTERY_V2_SHOTSTACK_TRANSITIONS)[number];

/** Per-minute budgets — sparse documentary, hard cut is default. */
export const MYSTERY_V2_FX_DENSITY = {
  cutsPerMinute: { min: 9, target: 11, max: 13 },
  holdSec: { min: 3.5, target: 5.0, max: 7.5 },
  /** Motion effects on clips (zoom / slide). */
  motionEffectsPerMinute: { min: 4, target: 5, max: 6 },
  zoomInPerMinute: { min: 2, target: 2.5, max: 3 },
  zoomOutPerMinute: { min: 1, target: 1.5, max: 2 },
  slideEffectsPerMinute: { min: 0, target: 1, max: 2 },
  filtersPerMinute: { min: 0, target: 0.5, max: 1 },
  /** Named Shotstack transitions (not hard cuts). */
  transitionsPerMinute: { min: 1, target: 1.5, max: 2 },
  /** Custom film-burn / glitch overlays from our pack. */
  overlaysPerMinute: { min: 0.5, target: 0.75, max: 1 },
  /** Any fancy moment (motion + filter + transition + overlay). */
  effectMomentsPerMinute: { min: 3, target: 4, max: 5 },
  hardCutShare: 0.85,
} as const;

/** Map Slow/Fast pack variants → verified sandbox defaults. */
export const MYSTERY_V2_EFFECT_NORMALIZE: Record<string, string> = {
  zoomInSlow: "zoomIn",
  zoomInFast: "zoomIn",
  zoomOutSlow: "zoomOut",
  zoomOutFast: "zoomOut",
  slideLeftSlow: "slideLeft",
  slideLeftFast: "slideLeft",
  slideRightSlow: "slideRight",
  slideRightFast: "slideRight",
  slideUpSlow: "slideUp",
  slideUpFast: "slideUp",
};

export const MYSTERY_V2_TRANSITION_NORMALIZE: Record<string, string> = {
  fadeFast: "fade",
  fadeSlow: "fade",
  wipeLeftSlow: "wipeLeft",
  wipeLeftFast: "wipeLeft",
  wipeRightSlow: "wipeLeft",
  wipeRightFast: "wipeLeft",
  wipeRight: "wipeLeft",
  carouselLeft: "slideLeft",
  carouselLeftSlow: "slideLeft",
  carouselLeftFast: "slideLeft",
  carouselRight: "slideRight",
  carouselRightSlow: "slideRight",
  slideRightSlow: "slideRight",
  slideRightFast: "slideRight",
  slideLeftSlow: "slideLeft",
  slideLeftFast: "slideLeft",
  zoomSlow: "zoom",
  zoomFast: "zoom",
  revealSlow: "reveal",
  revealFast: "reveal",
};

export function normalizeMysteryEffect(effect?: string): string | undefined {
  if (!effect) return undefined;
  return MYSTERY_V2_EFFECT_NORMALIZE[effect] || effect;
}

export function normalizeMysteryTransition(t?: string): string | undefined {
  if (!t) return undefined;
  return MYSTERY_V2_TRANSITION_NORMALIZE[t] || t;
}
