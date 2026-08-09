/** Clamp helper — confidence/scores must never exceed 100. */
export function clampScore(n: unknown, fallback = 0): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function clamp01(n: unknown, fallback = 0): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, v));
}

export type MatchType =
  | "exact_match"
  | "strong_match"
  | "good_context"
  | "related_context"
  | "needs_better_visual";

export function matchTypeFromScore(score0to100: number): MatchType {
  const s = clampScore(score0to100);
  if (s >= 90) return "exact_match";
  if (s >= 80) return "strong_match";
  if (s >= 70) return "good_context";
  if (s >= 60) return "related_context";
  return "needs_better_visual";
}

export function matchTypeLabel(t: MatchType): string {
  switch (t) {
    case "exact_match":
      return "Exact Match";
    case "strong_match":
      return "Strong Match";
    case "good_context":
      return "Good Context";
    case "related_context":
      return "Related Context";
    default:
      return "Needs Better Visual";
  }
}
