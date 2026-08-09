export type LibraryMediaType = "image" | "raw_footage";

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

export interface PersonLibraryIndex {
  niche: string;
  nicheSlug: string;
  person: string;
  personSlug: string;
  /** Parent classification group */
  group?: string;
  updatedAt: string;
  counts: {
    images: number;
    raw_footage: number;
    byCategory: Partial<Record<string, number>>;
  };
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
  }>;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
