import crypto from "node:crypto";
import path from "node:path";
import { getSearchApiKey, getPexelsKey, getPixabayKey, config } from "../config.js";
import { jobDataFile, writeJson, readJson } from "../storage.js";
import type {
  JobRecord,
  QueryPack,
  VisualCandidate,
  VisualBeat,
} from "../../shared/visualIntelligence.js";
import { getJobCostLimits } from "./jobDuration.js";
import { isAllowedHorizontalAspect } from "./aspectPolicy.js";

interface GoogleImageResult {
  title?: string;
  original?: { link?: string; width?: number; height?: number };
  thumbnail?: string;
  source?: { name?: string; link?: string };
}

async function googleImageSearch(query: string, count: number): Promise<GoogleImageResult[]> {
  const key = getSearchApiKey();
  const url = new URL("https://www.searchapi.io/api/v1/search");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");
  url.searchParams.set("safe", "active");
  // Prefer large wide images; exact 16:9 / 4:3 enforced in filters
  url.searchParams.set("size", "large");
  url.searchParams.set("aspect_ratio", "wide");

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Google Images (SearchAPI) error ${res.status}: ${text}`);
      }
      const data = (await res.json()) as { images?: GoogleImageResult[] };
      return (data.images || []).slice(0, Math.min(count, 20));
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function pexelsSearch(query: string, count: number): Promise<VisualCandidate[]> {
  const key = getPexelsKey();
  if (!key) return [];
  const out: VisualCandidate[] = [];

  const imgRes = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${Math.min(count, 10)}`,
    { headers: { Authorization: key } }
  );
  if (imgRes.ok) {
    const data = (await imgRes.json()) as {
      photos?: Array<{
        id: number;
        url: string;
        alt?: string;
        width: number;
        height: number;
        src?: { large?: string; medium?: string };
      }>;
    };
    for (const photo of data.photos || []) {
      if (!isAllowedHorizontalAspect({ width: photo.width, height: photo.height }).ok) continue;
      out.push({
        candidateId: `pexels-img-${photo.id}`,
        source: "pexels_image",
        urlOrPath: photo.src?.large || photo.src?.medium || photo.url,
        sourcePageUrl: photo.url,
        title: photo.alt || query,
        dimensions: { width: photo.width, height: photo.height },
        detectedVisualType: "image",
        relatedEntities: [],
        relatedBeatIds: [],
      });
    }
  }

  const vidRes = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${Math.min(3, count)}`,
    { headers: { Authorization: key } }
  );
  if (vidRes.ok) {
    const data = (await vidRes.json()) as {
      videos?: Array<{
        id: number;
        url: string;
        duration: number;
        image?: string;
        video_files?: Array<{ link: string; width: number; height: number }>;
      }>;
    };
    for (const video of data.videos || []) {
      const file = video.video_files?.sort((a, b) => b.width - a.width)[0];
      if (!file) continue;
      if (!isAllowedHorizontalAspect({ width: file.width, height: file.height }).ok) continue;
      out.push({
        candidateId: `pexels-vid-${video.id}`,
        source: "pexels_clip",
        urlOrPath: file.link,
        sourcePageUrl: video.url,
        title: query,
        duration: video.duration,
        thumbnail: video.image,
        dimensions: { width: file.width, height: file.height },
        detectedVisualType: "video",
        relatedEntities: [],
        relatedBeatIds: [],
      });
    }
  }

  return out;
}

async function pixabaySearch(query: string, count: number): Promise<VisualCandidate[]> {
  const key = getPixabayKey();
  if (!key) return [];
  const out: VisualCandidate[] = [];
  const q = query.slice(0, 100);

  const imgUrl = new URL("https://pixabay.com/api/");
  imgUrl.searchParams.set("key", key);
  imgUrl.searchParams.set("q", q);
  imgUrl.searchParams.set("image_type", "photo");
  imgUrl.searchParams.set("orientation", "horizontal");
  imgUrl.searchParams.set("safesearch", "true");
  imgUrl.searchParams.set("per_page", String(Math.min(Math.max(count, 3), 10)));

  const imgRes = await fetch(imgUrl);
  if (imgRes.ok) {
    const data = (await imgRes.json()) as {
      hits?: Array<{
        id: number;
        pageURL?: string;
        tags?: string;
        largeImageURL?: string;
        webformatURL?: string;
        imageWidth?: number;
        imageHeight?: number;
        previewURL?: string;
      }>;
    };
    for (const hit of data.hits || []) {
      const width = hit.imageWidth || 0;
      const height = hit.imageHeight || 0;
      if (width && height && !isAllowedHorizontalAspect({ width, height }).ok) continue;
      const url = hit.largeImageURL || hit.webformatURL;
      if (!url) continue;
      out.push({
        candidateId: `pixabay-img-${hit.id}`,
        source: "pixabay_image",
        urlOrPath: url,
        sourcePageUrl: hit.pageURL,
        title: hit.tags || query,
        dimensions: width && height ? { width, height } : undefined,
        thumbnail: hit.previewURL || hit.webformatURL,
        detectedVisualType: "image",
        relatedEntities: [],
        relatedBeatIds: [],
      });
    }
  }

  const vidUrl = new URL("https://pixabay.com/api/videos/");
  vidUrl.searchParams.set("key", key);
  vidUrl.searchParams.set("q", q);
  vidUrl.searchParams.set("video_type", "film");
  vidUrl.searchParams.set("safesearch", "true");
  vidUrl.searchParams.set("per_page", String(Math.min(3, Math.max(count, 3))));

  const vidRes = await fetch(vidUrl);
  if (vidRes.ok) {
    const data = (await vidRes.json()) as {
      hits?: Array<{
        id: number;
        pageURL?: string;
        tags?: string;
        duration?: number;
        videos?: Record<
          string,
          { url?: string; width?: number; height?: number; thumbnail?: string }
        >;
      }>;
    };
    for (const hit of data.hits || []) {
      const files = hit.videos || {};
      const file =
        [files.medium, files.large, files.small, files.tiny].find((f) => f?.url) || undefined;
      if (!file?.url) continue;
      const width = file.width || 0;
      const height = file.height || 0;
      if (width && height && !isAllowedHorizontalAspect({ width, height }).ok) continue;
      out.push({
        candidateId: `pixabay-vid-${hit.id}`,
        source: "pixabay_clip",
        urlOrPath: file.url,
        sourcePageUrl: hit.pageURL,
        title: hit.tags || query,
        duration: hit.duration,
        thumbnail: file.thumbnail,
        dimensions: width && height ? { width, height } : undefined,
        detectedVisualType: "video",
        relatedEntities: [],
        relatedBeatIds: [],
      });
    }
  }

  return out;
}

function cacheKey(query: string): string {
  return crypto.createHash("sha1").update(query.toLowerCase().trim()).digest("hex");
}

export async function collectCandidates(
  job: JobRecord,
  packs: QueryPack[],
  beats: VisualBeat[],
  rawChunkCandidates: VisualCandidate[] = []
): Promise<{ candidates: VisualCandidate[]; imageQueriesUsed: number }> {
  const LIMITS = getJobCostLimits(job);
  const candidates: VisualCandidate[] = [];
  let imageQueriesUsed = 0;

  // 1) Raw footage chunks first (editor preference pool) — skipped for Mystery v2 images-only.
  if (job.niche !== "Mystery v2") {
    for (const c of rawChunkCandidates) {
      if (candidates.length >= LIMITS.maxCandidatesCollected) break;
      candidates.push(c);
    }
  }

  // 2) Uploaded assets
  for (const p of job.uploadedAssetPaths || []) {
    candidates.push({
      candidateId: `upload-${crypto.createHash("md5").update(p).digest("hex").slice(0, 8)}`,
      source: "uploaded_asset",
      urlOrPath: p,
      relatedEntities: [],
      relatedBeatIds: beats.map((b) => b.beatId),
      detectedVisualType: path.extname(p).match(/\.(mp4|mov|webm)$/i) ? "video" : "image",
    });
  }

  // Whole raw files only if no chunks were produced (non-video raw left out).
  // Mystery v2 is images-only — never seed video raw into the pool.
  if (!rawChunkCandidates.length && job.niche !== "Mystery v2") {
    for (const p of job.rawFootagePaths || []) {
      if (!/\.(mp4|mov|webm|mkv|m4v)$/i.test(p)) continue;
      candidates.push({
        candidateId: `raw-${crypto.createHash("md5").update(p).digest("hex").slice(0, 8)}`,
        source: "raw_footage",
        urlOrPath: p,
        relatedEntities: [],
        relatedBeatIds: beats.map((b) => b.beatId),
        detectedVisualType: "video",
      });
    }
  }

  // 3) Image / web search candidates
  let packIdx = 0;
  for (const pack of packs) {
    packIdx += 1;
    if (packIdx === 1 || packIdx % 15 === 0 || packIdx === packs.length) {
      console.log(
        `[candidateCollection] ${job.jobId} google-pack ${packIdx}/${packs.length} candidates=${candidates.length}`
      );
    }
    if (candidates.length >= LIMITS.maxCandidatesCollected) break;
    const isImageSearch =
      pack.sourceType === "google" ||
      pack.sourceType === "brave" ||
      pack.sourceType === "pexels" ||
      pack.sourceType === "pixabay";
    if (!isImageSearch) continue;

    if (
      imageQueriesUsed >= LIMITS.maxImageQueries &&
      (pack.sourceType === "google" || pack.sourceType === "brave")
    ) {
      continue;
    }

    const cachePath = path.join(config.storagePath, "cache", `google-${cacheKey(pack.query)}.json`);
    let googleResults = await readJson<GoogleImageResult[]>(cachePath);

    if (!googleResults && (pack.sourceType === "google" || pack.sourceType === "brave")) {
      try {
        googleResults = await googleImageSearch(pack.query, pack.maxCandidates);
        await writeJson(cachePath, googleResults);
        imageQueriesUsed += 1;
      } catch (err) {
        console.warn(
          `[candidateCollection] SearchAPI failed for "${pack.query}":`,
          err instanceof Error ? err.message : String(err)
        );
        googleResults = [];
      }
    }

    for (const item of googleResults || []) {
      if (candidates.length >= LIMITS.maxCandidatesCollected) break;
      const imageUrl = item.original?.link;
      if (!imageUrl) continue;
      const dimensions =
        item.original?.width && item.original?.height
          ? { width: item.original.width, height: item.original.height }
          : undefined;
      if (dimensions && !isAllowedHorizontalAspect(dimensions).ok) continue;
      candidates.push({
        candidateId: `google-${crypto.createHash("md5").update(imageUrl).digest("hex").slice(0, 10)}`,
        source: "google_image",
        urlOrPath: imageUrl,
        sourcePageUrl: item.source?.link,
        queryPackId: pack.queryPackId,
        queryUsed: pack.query,
        title: item.title,
        dimensions,
        thumbnail: item.thumbnail,
        detectedVisualType: "image",
        relatedEntities: [pack.entityContext].filter(Boolean),
        relatedBeatIds: pack.relatedBeatIds,
      });
    }

    const imagesOnly = job.niche === "Mystery v2";
    // Mystery v2: Google-first. Skip stock fillers once the pool is already rich.
    const mysteryPoolFat = imagesOnly && candidates.length >= 320;
    if (getPexelsKey() && !mysteryPoolFat) {
      const pexels = await pexelsSearch(pack.query, Math.min(imagesOnly ? 2 : 4, pack.maxCandidates));
      for (const c of pexels) {
        if (candidates.length >= LIMITS.maxCandidatesCollected) break;
        // Mystery v2: stills only — skip Pexels video clips.
        if (imagesOnly && (c.detectedVisualType === "video" || c.source === "pexels_clip")) {
          continue;
        }
        candidates.push({
          ...c,
          queryPackId: pack.queryPackId,
          queryUsed: pack.query,
          relatedEntities: [pack.entityContext].filter(Boolean),
          relatedBeatIds: pack.relatedBeatIds,
        });
      }
    }

    if (getPixabayKey() && !mysteryPoolFat) {
      try {
        const pixabay = await pixabaySearch(pack.query, Math.min(imagesOnly ? 2 : 4, pack.maxCandidates));
        for (const c of pixabay) {
          if (candidates.length >= LIMITS.maxCandidatesCollected) break;
          if (imagesOnly && (c.detectedVisualType === "video" || c.source === "pixabay_clip")) {
            continue;
          }
          candidates.push({
            ...c,
            queryPackId: pack.queryPackId,
            queryUsed: pack.query,
            relatedEntities: [pack.entityContext].filter(Boolean),
            relatedBeatIds: pack.relatedBeatIds,
          });
        }
      } catch (err) {
        console.warn(
          `[candidateCollection] Pixabay failed for "${pack.query}":`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  await writeJson(jobDataFile("visual-intelligence-candidate-pool", job.jobId), {
    jobId: job.jobId,
    imageQueriesUsed,
    rawChunks: rawChunkCandidates.length,
    candidates,
    note: "Full pool collected before holistic GPT editor judgment",
  });

  return { candidates, imageQueriesUsed };
}
