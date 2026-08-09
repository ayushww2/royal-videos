import { loadNicheLibrary, loadPersonLibrary } from "../../library/collectImages.js";
import { r2Configured } from "../../library/r2.js";
import type { LibraryAsset } from "../../library/types.js";
import path from "node:path";
import { config } from "../../config.js";
import { readJson, writeJson } from "../../storage.js";
import { signLibraryRenderKey } from "../../library/routes.js";

const ROYAL_NICHE_SLUG = "royal-family";
const CACHE_TTL_MS = 5 * 60_000;
const DISK_CACHE_TTL_MS = 60 * 60_000;

let cache: { loadedAt: number; assets: LibraryAsset[] } | null = null;
let loadingPromise: Promise<LibraryAsset[]> | null = null;

export function royalAssetUrl(asset: LibraryAsset): string {
  const direct = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (direct) return `${direct}/${asset.r2Key.split("/").map(encodeURIComponent).join("/")}`;
  const app = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const route = `/api/media-library/render-asset?key=${encodeURIComponent(asset.r2Key)}&token=${signLibraryRenderKey(asset.r2Key)}`;
  return app ? `${app}${route}` : route;
}

export function royalAssetPreviewUrl(asset: LibraryAsset): string {
  const key = asset.thumbKey || asset.r2Key;
  return `/api/media-library/asset?key=${encodeURIComponent(key)}`;
}

export async function loadRoyalLibraryAssets(force = false): Promise<LibraryAsset[]> {
  if (!force && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.assets;

  // Memory/disk entry may be older than CACHE_TTL; keep serving it when R2 is offline.
  if (!force && cache?.assets?.length && !r2Configured()) {
    return cache.assets;
  }

  const diskCachePath = path.join(config.dataPath, "royal-v2-library-cache.json");
  if (!force && !cache) {
    const disk = await readJson<{ loadedAt: number; assets: LibraryAsset[] }>(diskCachePath);
    if (disk?.assets?.length) {
      const fresh = Date.now() - disk.loadedAt < DISK_CACHE_TTL_MS;
      // Prefer fresh disk cache; also allow stale disk when R2 is unavailable (local/dev).
      if (fresh || !r2Configured()) {
        // Reset memory TTL clock so subsequent requests don't fall through to R2.
        cache = { loadedAt: Date.now(), assets: disk.assets };
        return cache.assets;
      }
    }
  }

  if (!r2Configured()) {
    throw new Error("Royal v2 requires the configured R2 Media Library");
  }

  if (!force && loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const niche = await loadNicheLibrary(ROYAL_NICHE_SLUG);
    if (!niche) throw new Error(`R2 library index not found: library/${ROYAL_NICHE_SLUG}/index.json`);

    const indexes = await Promise.all(
      niche.people.map((entry) => loadPersonLibrary(ROYAL_NICHE_SLUG, entry.personSlug))
    );
    const byId = new Map<string, LibraryAsset>();
    for (const index of indexes) {
      for (const asset of index?.assets || []) byId.set(asset.assetId, asset);
    }

    const assets = [...byId.values()];
    cache = { loadedAt: Date.now(), assets };
    await writeJson(diskCachePath, cache);
    return assets;
  })();
  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export function clearRoyalLibraryCache(): void {
  cache = null;
  loadingPromise = null;
}

function searchable(asset: LibraryAsset): string {
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

export async function searchRoyalLibrary(
  query: string,
  options?: { mediaType?: "image" | "raw_footage"; limit?: number; unusedIds?: Set<string> }
): Promise<LibraryAsset[]> {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((x) => x.length > 1);
  const assets = await loadRoyalLibraryAssets();
  return assets
    .filter((asset) => !options?.mediaType || asset.mediaType === options.mediaType)
    .filter((asset) => !options?.unusedIds || !options.unusedIds.has(asset.assetId))
    .map((asset) => {
      const hay = searchable(asset);
      const score = terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0);
      return { asset, score };
    })
    .filter((item) => item.score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score || a.asset.number - b.asset.number)
    .slice(0, Math.max(1, Math.min(100, options?.limit || 20)))
    .map((item) => item.asset);
}

