import path from "node:path";
import { config } from "../../config.js";
import { loadNicheLibrary, loadPersonLibrary } from "../../library/collectImages.js";
import { r2Configured } from "../../library/r2.js";
import type { LibraryAsset } from "../../library/types.js";
import { signLibraryRenderKey } from "../../library/routes.js";
import { readJson, writeJson } from "../../storage.js";

const WAR_NICHE_SLUG = "war";
const CACHE_TTL_MS = 5 * 60_000;
const DISK_CACHE_TTL_MS = 60 * 60_000;

let cache: { loadedAt: number; assets: LibraryAsset[] } | null = null;
let loadingPromise: Promise<LibraryAsset[]> | null = null;

export function warAssetUrl(asset: LibraryAsset): string {
  const direct = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (direct) return `${direct}/${asset.r2Key.split("/").map(encodeURIComponent).join("/")}`;
  const app = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const route = `/api/media-library/render-asset?key=${encodeURIComponent(asset.r2Key)}&token=${signLibraryRenderKey(asset.r2Key)}`;
  return app ? `${app}${route}` : route;
}

export function warAssetPreviewUrl(asset: LibraryAsset): string {
  const key = asset.thumbKey || asset.r2Key;
  return `/api/media-library/asset?key=${encodeURIComponent(key)}`;
}

export async function loadWarLibraryAssets(force = false): Promise<LibraryAsset[]> {
  if (!force && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.assets;

  if (!force && cache?.assets?.length && !r2Configured()) {
    return cache.assets;
  }

  const diskCachePath = path.join(config.dataPath, "war-v1-library-cache.json");
  if (!force && !cache) {
    const disk = await readJson<{ loadedAt: number; assets: LibraryAsset[] }>(diskCachePath);
    if (disk?.assets?.length) {
      const fresh = Date.now() - disk.loadedAt < DISK_CACHE_TTL_MS;
      if (fresh || !r2Configured()) {
        cache = { loadedAt: Date.now(), assets: disk.assets };
        return cache.assets;
      }
    }
  }

  if (!r2Configured()) {
    throw new Error("War v1 library-first requires configured R2 Media Library");
  }

  if (!force && loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const niche = await loadNicheLibrary(WAR_NICHE_SLUG);
    if (!niche) throw new Error(`R2 library index not found: library/${WAR_NICHE_SLUG}/index.json`);

    const indexes = await Promise.all(
      niche.people.map((entry) => loadPersonLibrary(WAR_NICHE_SLUG, entry.personSlug))
    );
    const byId = new Map<string, LibraryAsset>();
    for (const index of indexes) {
      for (const asset of index?.assets || []) byId.set(asset.assetId, asset);
    }

    const assets = [...byId.values()];
    cache = { loadedAt: Date.now(), assets };
    await writeJson(diskCachePath, cache);
    console.log(`[warV1] loaded library assets=${assets.length} topics=${niche.people.length}`);
    return assets;
  })();
  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export function clearWarLibraryCache(): void {
  cache = null;
  loadingPromise = null;
}

export function warAssetSearchText(asset: LibraryAsset): string {
  return [
    asset.person,
    asset.group,
    asset.category,
    ...(asset.categories || []),
    asset.title,
    asset.description,
    asset.queryUsed,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Prefer 20–30% raw by duration from the War library. */
export const WAR_RAW_TARGET_MIN = 0.2;
export const WAR_RAW_TARGET_MAX = 0.3;
export const WAR_RAW_TARGET = 0.25;
