/**
 * ContactBox vision scan of Royal Context Assets (ctx-* folders).
 * Removes images that are not usable UK Royal Family documentary B-roll.
 */
import { r2Configured, r2DeleteObject, r2GetJson, r2GetObjectBuffer, r2PutJson } from "./r2.js";
import type { LibraryAsset, NicheLibraryIndex, PersonLibraryIndex, RootLibraryIndex } from "./types.js";
import { countLibraryAssets } from "./types.js";
import { gateRoyalContextCandidates, toContextJpegPreview } from "./gateRoyalContext.js";
import {
  ROYAL_CONTEXT_CATEGORIES,
  ROYAL_CONTEXT_GROUP,
  type RoyalContextCategoryDef,
} from "./royalContextQueries.js";

const NICHE = "Royal Family";
const NICHE_SLUG = "royal-family";

export type ScanContextRejectReason =
  | "not_usable"
  | "heuristic"
  | "duplicate"
  | "vision_error";

export type ScanRoyalContextProgress = {
  category: string;
  personSlug: string;
  examined: number;
  kept: number;
  removed: number;
  reasons: Record<ScanContextRejectReason, number>;
  removedNumbers: number[];
};

function personIndexKey(personSlug: string): string {
  return `library/${NICHE_SLUG}/${personSlug}/index.json`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Cheap rejects before ContactBox vision. */
export function heuristicRejectContext(asset: LibraryAsset): string | null {
  const hay = `${asset.title || ""} ${asset.description || ""} ${asset.sourceUrl || ""} ${asset.sourcePageUrl || ""} ${asset.searchQuery || ""} ${asset.queryUsed || ""}`.toLowerCase();

  if (/\b(meme|reddit|r\/|clickbait|ai generated|stock vector|clipart|cartoon)\b/i.test(hay)) {
    return "meme/junk source";
  }
  if (/\b(gettyimages|shutterstock|alamy|istockphoto|dreamstime|depositphotos)\b/i.test(hay)) {
    return "stock watermark source";
  }
  if (/\b(white house|oval office|capitol hill|president of the united states|trump rally)\b/i.test(hay)) {
    return "US politics unrelated";
  }
  if (/\bprince edward island\b|\bpei\b|edward island national/i.test(hay)) {
    return "prince edward island not royal";
  }
  if (/\bjack the ripper\b/i.test(hay)) {
    return "off-topic tabloid history";
  }
  if (/\betsy\b|\bebay\b|\bstockcake\b/i.test(asset.sourceUrl || "")) {
    return "consumer marketplace stock";
  }
  if (/\b(corporate office|open plan office|startup workspace)\b/i.test(hay)) {
    return "corporate office unrelated";
  }
  if (/\b(glacier|scientific logbook|microscopy)\b/i.test(hay) && !/\b(royal|palace|archive|document)\b/i.test(hay)) {
    return "off-topic scientific/unrelated";
  }
  return null;
}

async function loadAssetPreview(asset: LibraryAsset): Promise<Buffer> {
  const { body, contentType } = await r2GetObjectBuffer(asset.r2Key);
  const ext =
    /\.png$/i.test(asset.r2Key) || contentType?.includes("png")
      ? ".png"
      : /\.webp$/i.test(asset.r2Key) || contentType?.includes("webp")
        ? ".webp"
        : ".jpg";
  return toContextJpegPreview(body, ext);
}

async function persistIndexes(idx: PersonLibraryIndex): Promise<void> {
  const { niche, nicheSlug, person, personSlug, assets, group } = idx;
  const counts = countLibraryAssets(assets);
  const personIndex: PersonLibraryIndex = {
    ...idx,
    updatedAt: new Date().toISOString(),
    counts,
    assets: assets.sort((a, b) => a.number - b.number || a.assetId.localeCompare(b.assetId)),
  };
  await r2PutJson(personIndexKey(personSlug), personIndex);

  const nicheIdx =
    (await r2GetJson<NicheLibraryIndex>(`library/${nicheSlug}/index.json`)) ||
    ({ niche, nicheSlug, updatedAt: "", people: [] } satisfies NicheLibraryIndex);
  const peopleMap = new Map(nicheIdx.people.map((p) => [p.personSlug, p]));
  peopleMap.set(personSlug, {
    person,
    personSlug,
    images: counts.images,
    raw_footage: counts.raw_footage,
    trusted_clips: counts.trusted_clips,
    raw_clips: counts.raw_clips,
    group: group || peopleMap.get(personSlug)?.group || ROYAL_CONTEXT_GROUP,
  });
  const nicheOut: NicheLibraryIndex = {
    niche,
    nicheSlug,
    updatedAt: new Date().toISOString(),
    people: [...peopleMap.values()].sort((a, b) => a.person.localeCompare(b.person)),
  };
  await r2PutJson(`library/${nicheSlug}/index.json`, nicheOut);

  const root =
    (await r2GetJson<RootLibraryIndex>("library/index.json")) ||
    ({ updatedAt: "", niches: [] } satisfies RootLibraryIndex);
  const nicheMap = new Map(root.niches.map((n) => [n.nicheSlug, n]));
  nicheMap.set(nicheSlug, {
    niche,
    nicheSlug,
    peopleCount: nicheOut.people.length,
    images: nicheOut.people.reduce((n, p) => n + p.images, 0),
    raw_footage: nicheOut.people.reduce((n, p) => n + (p.raw_footage || 0), 0),
    trusted_clips: nicheOut.people.reduce((n, p) => n + (p.trusted_clips || 0), 0),
    raw_clips: nicheOut.people.reduce(
      (n, p) => n + (p.raw_clips ?? (p.raw_footage || 0) + (p.trusted_clips || 0)),
      0
    ),
  });
  await r2PutJson("library/index.json", {
    updatedAt: new Date().toISOString(),
    niches: [...nicheMap.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  });
}

async function deleteAssetObjects(asset: LibraryAsset): Promise<void> {
  try {
    await r2DeleteObject(asset.r2Key);
  } catch (err) {
    console.warn(`[context-scan] r2 delete failed ${asset.r2Key}`, err);
  }
  if (asset.thumbKey) {
    try {
      await r2DeleteObject(asset.thumbKey);
    } catch {
      /* ignore */
    }
  }
}

export async function scanRoyalContextCategory(params: {
  categorySlug?: string;
  categoryName?: string;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<ScanRoyalContextProgress> {
  if (!r2Configured()) throw new Error("R2 not configured");
  const log = params.onProgress || console.log;
  const dryRun = Boolean(params.dryRun);

  const def: RoyalContextCategoryDef | undefined = ROYAL_CONTEXT_CATEGORIES.find(
    (c) =>
      (params.categorySlug && c.personSlug === params.categorySlug) ||
      (params.categoryName && c.category === params.categoryName)
  );
  if (!def) throw new Error(`Unknown context category: ${params.categorySlug || params.categoryName}`);

  const idx = await r2GetJson<PersonLibraryIndex>(personIndexKey(def.personSlug));
  if (!idx?.assets?.length) {
    return {
      category: def.category,
      personSlug: def.personSlug,
      examined: 0,
      kept: 0,
      removed: 0,
      reasons: { not_usable: 0, heuristic: 0, duplicate: 0, vision_error: 0 },
      removedNumbers: [],
    };
  }

  const images = idx.assets.filter((a) => a.mediaType === "image");
  const remove = new Map<string, { reason: ScanContextRejectReason; detail: string }>();
  const seenHash = new Set<string>();
  const seenUrl = new Set<string>();
  const keepIds = new Set<string>();

  for (const a of images) {
    if (a.contentHash && seenHash.has(a.contentHash)) {
      remove.set(a.assetId, { reason: "duplicate", detail: "same content hash" });
      continue;
    }
    if (a.sourceUrl && seenUrl.has(a.sourceUrl)) {
      remove.set(a.assetId, { reason: "duplicate", detail: "same source url" });
      continue;
    }
    const heur = heuristicRejectContext(a);
    if (heur) {
      remove.set(a.assetId, { reason: "heuristic", detail: heur });
      continue;
    }
    if (a.contentHash) seenHash.add(a.contentHash);
    if (a.sourceUrl) seenUrl.add(a.sourceUrl);
    keepIds.add(a.assetId);
  }

  const toVision = images.filter((a) => keepIds.has(a.assetId));
  log(
    `[context-scan] ${def.category}: ${images.length} stills, heuristic/dup-drop=${remove.size}, contactbox=${toVision.length}`
  );

  for (const batch of chunk(toVision, 6)) {
    try {
      const previews = await Promise.all(batch.map((a) => loadAssetPreview(a)));
      const gateInput = batch.map((a, i) => ({
        jpeg: previews[i],
        queryDef: {
          subcategory: a.subcategory || a.category || "Unknown",
          visualType: a.visualType || "context",
          query: a.searchQuery || a.queryUsed || a.description || "",
        },
        category: def.category,
      }));
      const rows = await gateRoyalContextCandidates(def.category, gateInput);
      for (let i = 0; i < batch.length; i++) {
        const asset = batch[i];
        const row = rows[i];
        if (!row?.ok) {
          remove.set(asset.assetId, {
            reason: "not_usable",
            detail: row?.rejectReason || "vision rejected",
          });
          keepIds.delete(asset.assetId);
          continue;
        }
        if (row.description) asset.description = row.description;
        if (row.visualType) asset.visualType = row.visualType;
      }
      log(`[context-scan] ${def.category}: batch done kept=${keepIds.size} removed=${remove.size}`);
    } catch (err) {
      for (const asset of batch) {
        remove.set(asset.assetId, {
          reason: "vision_error",
          detail: err instanceof Error ? err.message : String(err),
        });
        keepIds.delete(asset.assetId);
      }
      log(`[context-scan] batch failed ${def.category}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const removedAssets = images.filter((a) => remove.has(a.assetId));
  const keptImages = images.filter((a) => !remove.has(a.assetId));
  const others = idx.assets.filter((a) => a.mediaType !== "image");

  const reasons: Record<ScanContextRejectReason, number> = {
    not_usable: 0,
    heuristic: 0,
    duplicate: 0,
    vision_error: 0,
  };
  for (const info of remove.values()) reasons[info.reason] += 1;

  const progress: ScanRoyalContextProgress = {
    category: def.category,
    personSlug: def.personSlug,
    examined: images.length,
    kept: keptImages.length,
    removed: removedAssets.length,
    reasons,
    removedNumbers: removedAssets.map((a) => a.number).sort((a, b) => a - b),
  };

  if (!dryRun && removedAssets.length) {
    idx.assets = [...keptImages, ...others];
    idx.group = ROYAL_CONTEXT_GROUP;
    await persistIndexes(idx);
    for (const asset of removedAssets) {
      await deleteAssetObjects(asset);
    }
  }

  log(
    `[context-scan] done ${def.category}: kept=${progress.kept} removed=${progress.removed} ` +
      `vision=${reasons.not_usable} heur=${reasons.heuristic} dup=${reasons.duplicate} err=${reasons.vision_error}`
  );
  return progress;
}

export async function scanAllRoyalContextAssets(params?: {
  categories?: string[];
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<ScanRoyalContextProgress[]> {
  const log = params?.onProgress || console.log;
  const list = params?.categories?.length
    ? ROYAL_CONTEXT_CATEGORIES.filter(
        (c) => params.categories!.includes(c.category) || params.categories!.includes(c.personSlug)
      )
    : ROYAL_CONTEXT_CATEGORIES;

  log(`[context-scan] starting scan: ${list.length} categories`);
  const out: ScanRoyalContextProgress[] = [];
  for (const def of list) {
    try {
      out.push(
        await scanRoyalContextCategory({
          categorySlug: def.personSlug,
          dryRun: params?.dryRun,
          onProgress: log,
        })
      );
    } catch (err) {
      log(`[context-scan] skip ${def.category}: ${err instanceof Error ? err.message : err}`);
    }
  }
  const totalRemoved = out.reduce((n, r) => n + r.removed, 0);
  const totalKept = out.reduce((n, r) => n + r.kept, 0);
  log(`[context-scan] scan finished kept=${totalKept} removed=${totalRemoved}`);
  return out;
}
