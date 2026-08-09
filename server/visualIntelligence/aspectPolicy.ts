/** Documentary aspect policy: prefer horizontal 16:9 / 4:3; reject portrait/square for web picks. */

export const ASPECT_16_9 = 16 / 9;
export const ASPECT_4_3 = 4 / 3;

const RATIO_TOLERANCE = 0.14;

export type AllowedAspectLabel = "16:9" | "4:3" | "wide";

export function aspectRatioLabel(width: number, height: number): AllowedAspectLabel | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  if (width <= height) return null;

  const ratio = width / height;
  const near = (target: number) => Math.abs(ratio - target) / target <= RATIO_TOLERANCE;
  const d169 = Math.abs(ratio - ASPECT_16_9);
  const d43 = Math.abs(ratio - ASPECT_4_3);

  if (near(ASPECT_16_9) && (!near(ASPECT_4_3) || d169 <= d43)) return "16:9";
  if (near(ASPECT_4_3)) return "4:3";
  // Other landscape / wide documentary frames are allowed but scored lower
  if (ratio >= 1.2 && ratio <= 2.4) return "wide";
  return null;
}

export function isAllowedHorizontalAspect(
  dimensions?: { width?: number; height?: number } | null
): { ok: boolean; label?: AllowedAspectLabel; reason?: string; ratio?: number } {
  // Google often omits width/height — keep candidates; judge/crop can handle later.
  if (!dimensions?.width || !dimensions?.height) {
    return { ok: true, label: "wide", reason: "missing dimensions — allowed with crop review" };
  }
  const { width, height } = dimensions;
  if (width <= 0 || height <= 0) {
    return { ok: false, reason: "invalid dimensions" };
  }
  const ratio = width / height;
  if (width <= height) {
    return { ok: false, reason: "not horizontal (portrait/square)", ratio };
  }
  const label = aspectRatioLabel(width, height);
  if (!label) {
    return {
      ok: false,
      reason: `aspect ${ratio.toFixed(3)} not usable horizontal (prefer 16:9 or 4:3)`,
      ratio,
    };
  }
  return { ok: true, label, ratio };
}
