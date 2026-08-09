/**
 * Thin public wrappers around SearchAPI Google Images / Pexels / Pixabay for knowledge editor tools.
 * Does not invent unpaid scraping — uses existing API keys only.
 */
import { getSearchApiKey, getPexelsKey, getPixabayKey, optionalEnv } from "../config.js";

export type ImageSearchHit = {
  title: string;
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  source?: string;
  provider: "google_images" | "pexels" | "pixabay";
};

export function imageSearchConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.SEARCHAPI_API_KEY?.trim()) missing.push("SEARCHAPI_API_KEY");
  return { ok: missing.length === 0, missing };
}

export async function searchGoogleImages(
  query: string,
  count = 8
): Promise<ImageSearchHit[]> {
  const key = getSearchApiKey();
  const url = new URL("https://www.searchapi.io/api/v1/search");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");
  url.searchParams.set("safe", "active");
  url.searchParams.set("size", "large");
  url.searchParams.set("aspect_ratio", "wide");

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Images (SearchAPI) error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    images?: Array<{
      title?: string;
      original?: { link?: string; width?: number; height?: number };
      thumbnail?: string;
      source?: { name?: string };
    }>;
  };
  return (data.images || []).slice(0, Math.min(count, 20)).map((img) => ({
    title: img.title || query,
    url: img.original?.link || "",
    thumbnail: img.thumbnail,
    width: img.original?.width,
    height: img.original?.height,
    source: img.source?.name,
    provider: "google_images" as const,
  })).filter((h) => h.url);
}

export async function searchPexelsImages(
  query: string,
  count = 6
): Promise<ImageSearchHit[]> {
  const key = getPexelsKey();
  if (!key) return [];
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${Math.min(count, 15)}`,
    { headers: { Authorization: key } }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    photos?: Array<{
      id: number;
      url: string;
      alt?: string;
      width: number;
      height: number;
      src?: { large?: string; medium?: string };
    }>;
  };
  return (data.photos || []).map((photo) => ({
    title: photo.alt || query,
    url: photo.src?.large || photo.src?.medium || photo.url,
    thumbnail: photo.src?.medium,
    width: photo.width,
    height: photo.height,
    source: "pexels",
    provider: "pexels" as const,
  }));
}

export async function searchPixabayImages(
  query: string,
  count = 6
): Promise<ImageSearchHit[]> {
  const key = getPixabayKey();
  if (!key) return [];
  const url = new URL("https://pixabay.com/api/");
  url.searchParams.set("key", key);
  url.searchParams.set("q", query.slice(0, 100));
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("orientation", "horizontal");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", String(Math.min(Math.max(count, 3), 15)));

  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    hits?: Array<{
      id: number;
      tags?: string;
      largeImageURL?: string;
      webformatURL?: string;
      previewURL?: string;
      imageWidth?: number;
      imageHeight?: number;
    }>;
  };
  return (data.hits || [])
    .map((hit) => ({
      title: hit.tags || query,
      url: hit.largeImageURL || hit.webformatURL || "",
      thumbnail: hit.previewURL || hit.webformatURL,
      width: hit.imageWidth,
      height: hit.imageHeight,
      source: "pixabay",
      provider: "pixabay" as const,
    }))
    .filter((h) => h.url);
}

async function searchFreeStockImages(
  query: string,
  count: number
): Promise<ImageSearchHit[]> {
  const [pexels, pixabay] = await Promise.all([
    searchPexelsImages(query, count),
    searchPixabayImages(query, count),
  ]);
  return [...pexels, ...pixabay].slice(0, count);
}

/** Prefer SearchAPI; fall back to Pexels/Pixabay when keys present and Google fails/empty. */
export async function searchExternalImages(
  query: string,
  count = 8
): Promise<{ hits: ImageSearchHit[]; note?: string }> {
  const cfg = imageSearchConfigured();
  if (!cfg.ok) {
    const free = await searchFreeStockImages(query, count);
    if (free.length) {
      return {
        hits: free,
        note: "SEARCHAPI_API_KEY missing; used Pexels/Pixabay",
      };
    }
    const stockMissing = [
      optionalEnv("PEXELS_API_KEY") ? "" : "PEXELS_API_KEY",
      optionalEnv("PIXABAY_API_KEY") ? "" : "PIXABAY_API_KEY",
    ].filter(Boolean);
    return {
      hits: [],
      note: `Image search unavailable. Missing: ${[...cfg.missing, ...stockMissing].join(", ")}`,
    };
  }
  try {
    const hits = await searchGoogleImages(query, count);
    if (hits.length) return { hits };
    const free = await searchFreeStockImages(query, count);
    return {
      hits: free,
      note: free.length ? "Google empty; used Pexels/Pixabay" : "No results",
    };
  } catch (err) {
    const free = await searchFreeStockImages(query, count);
    return {
      hits: free,
      note: `Google search failed: ${err instanceof Error ? err.message : String(err)}${
        free.length ? "; used Pexels/Pixabay" : ""
      }`,
    };
  }
}
