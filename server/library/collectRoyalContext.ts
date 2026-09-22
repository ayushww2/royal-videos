/**
 * Collect Royal Context Assets — max 200 SearchAPI queries, ContactBox vision before save.
 * Never writes into People folders (ctx-* slugs only).
 */
import crypto from "node:crypto";
import { getSearchApiKey } from "../config.js";
import { persistPersonLibraryIndexes } from "./collectImages.js";
import { gateRoyalContextCandidates, toContextJpegPreview } from "./gateRoyalContext.js";
import {
  assertRoyalContextSearchBudget,
  ROYAL_CONTEXT_CATEGORIES,
  ROYAL_CONTEXT_GROUP,
  type ContextQueryDef,
  type RoyalContextCategoryDef,
} from "./royalContextQueries.js";
import { r2GetJson, r2PutJson, r2PutObject } from "./r2.js";
import type { LibraryAsset, PersonLibraryIndex } from "./types.js";
import { countLibraryAssets, slugify } from "./types.js";

const NICHE = "Royal Family";
const NICHE_SLUG = "royal-family";
const MAX_SAVES_PER_QUERY = Math.max(1, Math.min(6, Number(process.env.ROYAL_CONTEXT_MAX_SAVE_PER_QUERY || 4)));

const BAD_HOSTS = [
  "gettyimages",
  "alamy",
  "shutterstock",
  "istockphoto",
  "dreamstime",
  "depositphotos",
  "123rf",
  "adobe.stock",
  "ytimg.com",
  "fbsbx",
  "lookaside",
];

const BAD_TITLE = ["meme", "thumbnail", "clickbait", "watermark", "stock photo", "cartoon", "ai generated"];

interface GoogleImageItem {
  title?: string;
  original?: { link?: string; width?: number; height?: number };
  source?: { name?: string; link?: string };
}

export type CollectRoyalContextProgress = {
  category: string;
  personSlug: string;
  searchesRun: number;
  candidatesDownloaded: number;
  visionApproved: number;
  visionRejected: number;
  saved: number;
  skippedDuplicate: number;
  skippedHeuristic: number;
};

interface GoogleSearchContext {
  seenUrls: Set<string>;
  seenHashes: Set<string>;
}

interface DownloadCandidate {
  item: GoogleImageItem;
  url: string;
  buf: Buffer;
  contentType: string;
  contentHash: string;
  queryDef: ContextQueryDef;
}

async function googleImageSearch(query: string, num = 14): Promise<GoogleImageItem[]> {
  const key = getSearchApiKey();
  const url = new URL("https://www.searchapi.io/api/v1/search");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "uk");
  url.searchParams.set("safe", "active");
  url.searchParams.set("size", "large");
  url.searchParams.set("aspect_ratio", "wide");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SearchAPI ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const data = (await res.json()) as { images?: GoogleImageItem[]; images_results?: GoogleImageItem[] };
  return (data.images || data.images_results || []).slice(0, num);
}

function looksCleanContext(item: GoogleImageItem): boolean {
  const link = item.original?.link || "";
  const title = (item.title || "").toLowerCase();
  const page = (item.source?.link || "").toLowerCase();
  const hay = `${link} ${title} ${page}`.toLowerCase();
  if (!/^https?:\/\//i.test(link)) return false;
  if (BAD_HOSTS.some((h) => hay.includes(h))) return false;
  if (BAD_TITLE.some((t) => title.includes(t))) return false;
  if (/\b(white house|oval office|capitol hill|president of the united states|trump rally)\b/i.test(hay)) {
    return false;
  }
  if (/\b(corporate office|open plan office|startup workspace)\b/i.test(title)) return false;
  const w = item.original?.width || 0;
  const h = item.original?.height || 0;
  if (w && h) {
    if (w < 800 || h < 450) return false;
    if (w / h < 1.2) return false;
    if (w / h > 2.8) return false;
  }
  return true;
}

async function downloadImage(url: string): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DocumentaryVideoFactory/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 35_000 || ab.byteLength > 12_000_000) return null;
    return { buf: Buffer.from(ab), contentType };
  } catch {
    return null;
  }
}

function personIndexKey(personSlug: string): string {
  return `library/${NICHE_SLUG}/${personSlug}/index.json`;
}

function loadSeenFromAssets(assets: LibraryAsset[]): { urls: Set<string>; hashes: Set<string> } {
  const urls = new Set<string>();
  const hashes = new Set<string>();
  for (const a of assets) {
    if (a.sourceUrl) urls.add(a.sourceUrl);
    if (a.contentHash) hashes.add(a.contentHash);
  }
  return { urls, hashes };
}

async function loadCategoryIndex(def: RoyalContextCategoryDef): Promise<PersonLibraryIndex> {
  return (
    (await r2GetJson<PersonLibraryIndex>(personIndexKey(def.personSlug))) ||
    ({
      niche: NICHE,
      nicheSlug: NICHE_SLUG,
      person: def.category,
      personSlug: def.personSlug,
      group: ROYAL_CONTEXT_GROUP,
      updatedAt: new Date().toISOString(),
      counts: countLibraryAssets([]),
      assets: [],
    } satisfies PersonLibraryIndex)
  );
}

/** Collect one Royal Context category (uses queries from catalog). */
export async function collectRoyalContextCategory(params: {
  categorySlug?: string;
  categoryName?: string;
  searchContext?: GoogleSearchContext;
  onProgress?: (msg: string) => void;
}): Promise<CollectRoyalContextProgress> {
  const log = params.onProgress || console.log;
  const def =
    ROYAL_CONTEXT_CATEGORIES.find(
      (c) =>
        (params.categorySlug && c.personSlug === params.categorySlug) ||
        (params.categoryName && c.category === params.categoryName)
    ) || null;
  if (!def) throw new Error(`Unknown context category: ${params.categorySlug || params.categoryName}`);

  const idx = await loadCategoryIndex(def);
  const localSeen = loadSeenFromAssets(idx.assets);
  const seenUrls = params.searchContext?.seenUrls || localSeen.urls;
  const seenHashes = params.searchContext?.seenHashes || localSeen.hashes;

  const progress: CollectRoyalContextProgress = {
    category: def.category,
    personSlug: def.personSlug,
    searchesRun: 0,
    candidatesDownloaded: 0,
    visionApproved: 0,
    visionRejected: 0,
    saved: 0,
    skippedDuplicate: 0,
    skippedHeuristic: 0,
  };

  let assets = [...idx.assets];
  let nextNum = Math.max(0, ...assets.filter((a) => a.mediaType === "image").map((a) => a.number), 0) + 1;
  let searchesUsed = 0;

  for (const queryDef of def.queries) {
    searchesUsed += 1;
    progress.searchesRun += 1;
    log(`[royal-context] ${def.category}: ${queryDef.query}`);

    let results: GoogleImageItem[] = [];
    try {
      results = await googleImageSearch(queryDef.query, 14);
    } catch (err) {
      log(`[royal-context] search fail: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const downloads: DownloadCandidate[] = [];
    for (const item of results) {
      if (downloads.length >= 8) break;
      if (!looksCleanContext(item)) {
        progress.skippedHeuristic += 1;
        continue;
      }
      const url = item.original?.link || "";
      if (!url || seenUrls.has(url)) {
        progress.skippedDuplicate += 1;
        continue;
      }
      const downloaded = await downloadImage(url);
      if (!downloaded) continue;
      const contentHash = crypto.createHash("sha256").update(downloaded.buf).digest("hex");
      if (seenHashes.has(contentHash)) {
        progress.skippedDuplicate += 1;
        seenUrls.add(url);
        continue;
      }
      seenUrls.add(url);
      downloads.push({
        item,
        url,
        buf: downloaded.buf,
        contentType: downloaded.contentType,
        contentHash,
        queryDef,
      });
    }

    if (!downloads.length) continue;

    progress.candidatesDownloaded += downloads.length;
    const gateInput = downloads.map((d) => {
      const ext = d.contentType.includes("png") ? ".png" : d.contentType.includes("webp") ? ".webp" : ".jpg";
      return {
        jpeg: toContextJpegPreview(d.buf, ext),
        queryDef: d.queryDef,
        category: def.category,
      };
    });

    let gateRows;
    try {
      gateRows = await gateRoyalContextCandidates(def.category, gateInput);
    } catch (err) {
      log(`[royal-context] vision gate failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    let savedThisQuery = 0;
    for (let i = 0; i < downloads.length; i++) {
      if (savedThisQuery >= MAX_SAVES_PER_QUERY) break;
      const row = gateRows[i];
      const d = downloads[i];
      if (!row?.ok) {
        progress.visionRejected += 1;
        continue;
      }
      progress.visionApproved += 1;
      seenHashes.add(d.contentHash);

      const ext = d.contentType.includes("png") ? "png" : d.contentType.includes("webp") ? "webp" : "jpg";
      const assetId = `${NICHE_SLUG}-${def.personSlug}-img-${String(nextNum).padStart(4, "0")}`;
      const r2Key = `library/${NICHE_SLUG}/${def.personSlug}/images/${assetId}.${ext}`;
      const subcatSlug = slugify(d.queryDef.subcategory);

      await r2PutObject({
        key: r2Key,
        body: d.buf,
        contentType: d.contentType,
        metadata: { group: slugify(ROYAL_CONTEXT_GROUP), category: def.personSlug },
      });

      const asset: LibraryAsset = {
        assetId,
        number: nextNum,
        niche: NICHE,
        nicheSlug: NICHE_SLUG,
        person: def.category,
        personSlug: def.personSlug,
        group: ROYAL_CONTEXT_GROUP,
        mediaType: "image",
        category: d.queryDef.subcategory,
        categories: [d.queryDef.subcategory, subcatSlug, slugify(ROYAL_CONTEXT_GROUP)],
        r2Key,
        width: d.item.original?.width,
        height: d.item.original?.height,
        sourceUrl: d.url,
        sourcePageUrl: d.item.source?.link,
        contentHash: d.contentHash,
        searchQuery: d.queryDef.query,
        subcategory: d.queryDef.subcategory,
        visualType: row.visualType || d.queryDef.visualType,
        title: d.item.title,
        description: row.description || `${d.queryDef.subcategory} for UK royal documentary context.`,
        queryUsed: d.queryDef.query,
        createdAt: new Date().toISOString(),
      };
      assets.push(asset);
      nextNum += 1;
      savedThisQuery += 1;
      progress.saved += 1;
    }

    if (progress.saved > 0 && progress.saved % 20 === 0) {
      const personIndex = {
        ...idx,
        person: def.category,
        personSlug: def.personSlug,
        group: ROYAL_CONTEXT_GROUP,
        assets,
        updatedAt: new Date().toISOString(),
        counts: countLibraryAssets(assets),
      };
      await persistPersonLibraryIndexes(personIndex);
      log(`[royal-context] flushed ${def.category} saved=${progress.saved}`);
    }
  }

  const personIndex: PersonLibraryIndex = {
    ...idx,
    person: def.category,
    personSlug: def.personSlug,
    group: ROYAL_CONTEXT_GROUP,
    assets,
    updatedAt: new Date().toISOString(),
    counts: countLibraryAssets(assets),
  };
  await persistPersonLibraryIndexes(personIndex);
  log(
    `[royal-context] done ${def.category}: searches=${searchesUsed} saved=${progress.saved} rejected=${progress.visionRejected} dup=${progress.skippedDuplicate}`
  );
  return progress;
}

/** Run full 200-query Royal Context build sequentially by category. */
export async function collectAllRoyalContextAssets(params?: {
  categories?: string[];
  onProgress?: (msg: string) => void;
}): Promise<CollectRoyalContextProgress[]> {
  assertRoyalContextSearchBudget();
  const log = params?.onProgress || console.log;
  const list = params?.categories?.length
    ? ROYAL_CONTEXT_CATEGORIES.filter(
        (c) => params.categories!.includes(c.category) || params.categories!.includes(c.personSlug)
      )
    : ROYAL_CONTEXT_CATEGORIES;

  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  for (const def of ROYAL_CONTEXT_CATEGORIES) {
    const idx = await loadCategoryIndex(def);
    const local = loadSeenFromAssets(idx.assets);
    for (const u of local.urls) seenUrls.add(u);
    for (const h of local.hashes) seenHashes.add(h);
  }

  log(`[royal-context] starting build: ${list.length} categories, max 200 searches total`);
  const out: CollectRoyalContextProgress[] = [];
  for (const def of list) {
    out.push(
      await collectRoyalContextCategory({
        categorySlug: def.personSlug,
        searchContext: { seenUrls, seenHashes },
        onProgress: log,
      })
    );
  }
  log(`[royal-context] build finished saved=${out.reduce((n, r) => n + r.saved, 0)}`);
  return out;
}
