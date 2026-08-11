export type LibraryMediaType = "image" | "raw_footage" | "trusted_clip";

/** Royal emotion/context tags + freeform space topic tags */
export type LibraryCategory = string;

export interface LibraryAsset {
  /** Stable id for product integration, e.g. royal-v1-king-charles-img-0042 */
  assetId: string;
  number: number;
  niche: string;
  nicheSlug: string;
  person: string;
  personSlug: string;
  /** Optional parent group (e.g. "Mars & Rovers" for Space niche) */
  group?: string;
  mediaType: LibraryMediaType;
  category: LibraryCategory;
  categories: LibraryCategory[];
  r2Key: string;
  thumbKey?: string;
  width?: number;
  height?: number;
  sourceUrl?: string;
  sourcePageUrl?: string;
  /** SHA-256 of uploaded bytes, used to avoid duplicate library images */
  contentHash?: string;
  queryUsed?: string;
  title?: string;
  /** Human-readable clip description for UI / editors */
  description?: string;
  /** When a vision model wrote the editor description */
  visionDescribedAt?: string;
  /** Model id used for visionDescribedAt */
  visionModel?: string;
  /** Clip timing in source video when known */
  startTime?: number;
  endTime?: number;
  duration?: number;
  createdAt: string;
}

export interface PersonLibraryCounts {
  images: number;
  /** Legacy YouTube/raw ingest clips */
  raw_footage: number;
  /** Uploaded trusted packs (merged into raw clips in UI) */
  trusted_clips: number;
  /** raw_footage + trusted_clips — single "raw clips" total */
  raw_clips: number;
  byCategory: Partial<Record<string, number>>;
}

export interface PersonLibraryIndex {
  niche: string;
  nicheSlug: string;
  person: string;
  personSlug: string;
  /** Parent classification group */
  group?: string;
  updatedAt: string;
  counts: PersonLibraryCounts;
  assets: LibraryAsset[];
}

export interface NicheLibraryIndex {
  niche: string;
  nicheSlug: string;
  updatedAt: string;
  people: Array<{
    person: string;
    personSlug: string;
    images: number;
    raw_footage: number;
    trusted_clips?: number;
    raw_clips?: number;
    group?: string;
  }>;
}

export interface RootLibraryIndex {
  updatedAt: string;
  niches: Array<{
    niche: string;
    nicheSlug: string;
    peopleCount: number;
    images: number;
    raw_footage: number;
    trusted_clips?: number;
    raw_clips?: number;
  }>;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Video clips shown as one "raw clips" bucket in Media Library. */
export function isRawClipMediaType(mediaType: string | undefined): boolean {
  return mediaType === "raw_footage" || mediaType === "trusted_clip";
}

export function countLibraryAssets(assets: LibraryAsset[]): PersonLibraryCounts {
  const images = assets.filter((a) => a.mediaType === "image");
  const rawFootage = assets.filter((a) => a.mediaType === "raw_footage");
  const trusted = assets.filter((a) => a.mediaType === "trusted_clip");
  const byCategory: PersonLibraryCounts["byCategory"] = {};
  for (const a of assets) {
    byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  }
  return {
    images: images.length,
    raw_footage: rawFootage.length,
    trusted_clips: trusted.length,
    raw_clips: rawFootage.length + trusted.length,
    byCategory,
  };
}
