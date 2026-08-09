/**
 * Shared library + web image search for the AI editor (chat tools + HTTP).
 * Chat (Agent B) can import helpers even if route paths differ.
 */
import type { Express } from "express";
import type { LibraryAsset } from "../../library/types.js";
import { slugify } from "../../library/types.js";
import { loadJob } from "../../storage.js";
import {
  imageSearchConfigured,
  searchGoogleImages,
  type ImageSearchHit,
} from "../imageSearch.js";
import {
  loadRoyalLibraryAssets,
  royalAssetPreviewUrl,
  searchRoyalLibrary,
} from "./library.js";

export type EditorLibraryHit = {
  assetId: string;
  person: string;
  personSlug: string;
  mediaType: LibraryAsset["mediaType"];
  category: string;
  categories: string[];
  description?: string;
  title?: string;
  previewUrl: string;
  width?: number;
  height?: number;
  duration?: number;
};

export type EditorWebImageHit = {
  title: string;
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  source?: string;
  provider: "google_images";
};

export type EditorPersonTag = {
  person: string;
  personSlug: string;
  images: number;
  raw_footage: number;
  total: number;
};

export class EditorWebSearchUnavailableError extends Error {
  readonly missing: string[];
  readonly statusCode = 503;

  constructor(missing: string[]) {
    super(
      `Web image search unavailable. Set ${missing.join(" or ")} in the environment (SearchAPI Google Images).`
    );
    this.name = "EditorWebSearchUnavailableError";
    this.missing = missing;
  }
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

function matchesPerson(asset: LibraryAsset, person: string): boolean {
  const raw = person.trim().toLowerCase();
  if (!raw) return true;
  const slug = slugify(raw);
  return (
    asset.person.toLowerCase().includes(raw) ||
    asset.personSlug === slug ||
    asset.personSlug.includes(slug) ||
    asset.personSlug.includes(raw.replace(/\s+/g, "-"))
  );
}

function toLibraryHit(asset: LibraryAsset): EditorLibraryHit {
  return {
    assetId: asset.assetId,
    person: asset.person,
    personSlug: asset.personSlug,
    mediaType: asset.mediaType,
    category: asset.category,
    categories: asset.categories || [],
    description: asset.description,
    title: asset.title,
    previewUrl: royalAssetPreviewUrl(asset),
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
  };
}

export type SearchRoyalLibraryForEditorOptions = {
  q?: string;
  person?: string;
  mediaType?: "image" | "raw_footage";
  limit?: number;
};

/** Search the royal media library for the AI editor (text + optional person filter). */
export async function searchRoyalLibraryForEditor(
  options: SearchRoyalLibraryForEditorOptions = {}
): Promise<{ count: number; assets: EditorLibraryHit[] }> {
  const q = String(options.q || "").trim();
  const person = String(options.person || "").trim();
  const limit = clampLimit(options.limit, 20, 50);
  const mediaType =
    options.mediaType === "image" || options.mediaType === "raw_footage"
      ? options.mediaType
      : undefined;

  if (!q && !person) {
    throw new Error("q or person is required");
  }

  // When only person is set, browse that person's clips; otherwise text-search then filter.
  let assets: LibraryAsset[];
  if (q) {
    assets = await searchRoyalLibrary(q, { mediaType, limit: Math.min(100, limit * 3) });
    if (person) assets = assets.filter((a) => matchesPerson(a, person));
    assets = assets.slice(0, limit);
  } else {
    const all = await loadRoyalLibraryAssets();
    assets = all
      .filter((a) => matchesPerson(a, person))
      .filter((a) => !mediaType || a.mediaType === mediaType)
      .sort((a, b) => a.number - b.number)
      .slice(0, limit);
  }

  return { count: assets.length, assets: assets.map(toLibraryHit) };
}

export type BrowseRoyalLibraryForEditorOptions = {
  person?: string;
  mediaType?: "image" | "raw_footage";
  category?: string;
  limit?: number;
  offset?: number;
};

/** List person tags and optionally browse clips for a person (optional Phase D browse). */
export async function browseRoyalLibraryForEditor(
  options: BrowseRoyalLibraryForEditorOptions = {}
): Promise<{
  people: EditorPersonTag[];
  count: number;
  offset: number;
  limit: number;
  assets: EditorLibraryHit[];
}> {
  const person = String(options.person || "").trim();
  const category = String(options.category || "").trim().toLowerCase();
  const mediaType =
    options.mediaType === "image" || options.mediaType === "raw_footage"
      ? options.mediaType
      : undefined;
  const limit = clampLimit(options.limit, 24, 80);
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));

  const all = await loadRoyalLibraryAssets();
  const byPerson = new Map<string, EditorPersonTag>();
  for (const asset of all) {
    const key = asset.personSlug || slugify(asset.person);
    const row = byPerson.get(key) || {
      person: asset.person,
      personSlug: key,
      images: 0,
      raw_footage: 0,
      total: 0,
    };
    if (asset.mediaType === "image") row.images += 1;
    else row.raw_footage += 1;
    row.total += 1;
    byPerson.set(key, row);
  }

  const people = [...byPerson.values()].sort((a, b) => a.person.localeCompare(b.person));

  let filtered = all;
  if (person) filtered = filtered.filter((a) => matchesPerson(a, person));
  if (mediaType) filtered = filtered.filter((a) => a.mediaType === mediaType);
  if (category) {
    filtered = filtered.filter(
      (a) =>
        a.category.toLowerCase().includes(category) ||
        (a.categories || []).some((c) => c.toLowerCase().includes(category))
    );
  }

  filtered = filtered.sort((a, b) => a.number - b.number);
  const slice = filtered.slice(offset, offset + limit);

  return {
    people,
    count: filtered.length,
    offset,
    limit,
    assets: slice.map(toLibraryHit),
  };
}

/** True when SearchAPI (Google Images) is configured. */
export function webSearchForEditorConfigured(): {
  ok: boolean;
  missing: string[];
  message?: string;
} {
  const cfg = imageSearchConfigured();
  if (cfg.ok) return { ok: true, missing: [] };
  return {
    ok: false,
    missing: cfg.missing,
    message: `Web image search unavailable. Missing: ${cfg.missing.join(", ")}. Set SEARCHAPI_API_KEY for Google Images via SearchAPI.`,
  };
}

/**
 * Google Images via existing SearchAPI key.
 * Throws EditorWebSearchUnavailableError (map to HTTP 503) when key is missing.
 */
export async function searchWebImagesForEditor(
  query: string,
  limit = 8
): Promise<{ count: number; hits: EditorWebImageHit[]; provider: "google_images" }> {
  const q = String(query || "").trim();
  if (!q) throw new Error("q is required");

  const cfg = webSearchForEditorConfigured();
  if (!cfg.ok) {
    throw new EditorWebSearchUnavailableError(cfg.missing);
  }

  const hits = await searchGoogleImages(q, clampLimit(limit, 8, 20));
  return {
    count: hits.length,
    provider: "google_images",
    hits: hits.map(
      (h: ImageSearchHit): EditorWebImageHit => ({
        title: h.title,
        url: h.url,
        thumbnail: h.thumbnail,
        width: h.width,
        height: h.height,
        source: h.source,
        provider: "google_images",
      })
    ),
  };
}

/** Auth-gated job-scoped editor search routes (requireAuth already applied upstream). */
export function registerEditorSearchRoutes(app: Express): void {
  app.get("/api/jobs/:jobId/editor/library-search", async (req, res) => {
    try {
      const job = await loadJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });

      const mediaType =
        req.query.mediaType === "image" || req.query.mediaType === "raw_footage"
          ? req.query.mediaType
          : undefined;

      const result = await searchRoyalLibraryForEditor({
        q: String(req.query.q || ""),
        person: String(req.query.person || ""),
        mediaType,
        limit: Number(req.query.limit || 20),
      });
      res.json({ jobId: job.jobId, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("R2 Media Library")) {
        return res.status(503).json({ error: message, configured: false });
      }
      const status = message.includes("required") ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.get("/api/jobs/:jobId/editor/web-search", async (req, res) => {
    try {
      const job = await loadJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });

      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ error: "q is required" });

      const result = await searchWebImagesForEditor(q, Number(req.query.limit || 8));
      res.json({ jobId: job.jobId, ...result });
    } catch (err) {
      if (err instanceof EditorWebSearchUnavailableError) {
        return res.status(503).json({
          error: err.message,
          missing: err.missing,
          configured: false,
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("required") ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.get("/api/jobs/:jobId/editor/library-browse", async (req, res) => {
    try {
      const job = await loadJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });

      const mediaType =
        req.query.mediaType === "image" || req.query.mediaType === "raw_footage"
          ? req.query.mediaType
          : undefined;

      const result = await browseRoyalLibraryForEditor({
        person: String(req.query.person || ""),
        mediaType,
        category: String(req.query.category || ""),
        limit: Number(req.query.limit || 24),
        offset: Number(req.query.offset || 0),
      });
      res.json({ jobId: job.jobId, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("R2 Media Library")) {
        return res.status(503).json({ error: message, configured: false });
      }
      res.status(500).json({ error: message });
    }
  });
}
