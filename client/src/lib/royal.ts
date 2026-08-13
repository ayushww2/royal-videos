/** Royal-dedicated product surface helpers. */

export const ROYAL_JOB_NICHES = ["Royal v1", "Royal v2"] as const;

export function isRoyalJobNiche(niche: string | undefined | null): boolean {
  const n = String(niche || "");
  return n === "Royal v1" || n === "Royal v2";
}

export const ROYAL_MEDIA_NICHE_SLUG = "royal-family";
export const ROYAL_MEDIA_NICHE = "Royal Family";
