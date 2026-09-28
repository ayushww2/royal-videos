import type {
  LibraryAsset,
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "./types.js";
import { countLibraryAssets } from "./types.js";
import { r2DeleteObject, r2GetJson, r2PutJson } from "./r2.js";
import { loadPersonLibrary } from "./collectImages.js";
import { clearRoyalLibraryCache } from "../visualIntelligence/royalV2/library.js";

function personIndexKey(nicheSlug: string, personSlug: string): string {
  return `library/${nicheSlug}/${personSlug}/index.json`;
}

function nicheIndexKey(nicheSlug: string): string {
  return `library/${nicheSlug}/index.json`;
}

function rootIndexKey(): string {
  return `library/index.json`;
}

function rebuildPersonIndex(personIndex: PersonLibraryIndex, assets: LibraryAsset[]): PersonLibraryIndex {
  return {
    ...personIndex,
    updatedAt: new Date().toISOString(),
    counts: countLibraryAssets(assets),
    assets: assets.sort((a, b) => a.number - b.number || a.assetId.localeCompare(b.assetId)),
  };
}

/** Write person index + niche/root aggregates (no merge — for deletes). */
async function publishPersonLibraryIndex(mergedIndex: PersonLibraryIndex): Promise<void> {
  const { niche, nicheSlug, person, personSlug } = mergedIndex;

  await r2PutJson(personIndexKey(nicheSlug, personSlug), mergedIndex);

  const nicheIdx =
    (await r2GetJson<NicheLibraryIndex>(nicheIndexKey(nicheSlug))) ||
    ({
      niche,
      nicheSlug,
      updatedAt: "",
      people: [],
    } satisfies NicheLibraryIndex);

  const peopleMap = new Map(nicheIdx.people.map((p) => [p.personSlug, p]));
  peopleMap.set(personSlug, {
    person,
    personSlug,
    images: mergedIndex.counts.images,
    raw_footage: mergedIndex.counts.raw_footage,
    trusted_clips: mergedIndex.counts.trusted_clips,
    raw_clips: mergedIndex.counts.raw_clips,
    group: peopleMap.get(personSlug)?.group,
  });
  const nicheOut: NicheLibraryIndex = {
    niche,
    nicheSlug,
    updatedAt: new Date().toISOString(),
    people: [...peopleMap.values()].sort((a, b) => a.person.localeCompare(b.person)),
  };
  await r2PutJson(nicheIndexKey(nicheSlug), nicheOut);

  const root =
    (await r2GetJson<RootLibraryIndex>(rootIndexKey())) ||
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
  await r2PutJson(rootIndexKey(), {
    updatedAt: new Date().toISOString(),
    niches: [...nicheMap.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  } satisfies RootLibraryIndex);

  const images = mergedIndex.assets.filter((a) => a.mediaType === "image");
  await r2PutJson(`library/${nicheSlug}/${personSlug}/manifest.json`, {
    person,
    personSlug,
    niche,
    nicheSlug,
    imageCount: mergedIndex.counts.images,
    rawFootageCount: mergedIndex.counts.raw_footage,
    trustedClipCount: mergedIndex.counts.trusted_clips,
    rawClipCount: mergedIndex.counts.raw_clips,
    assets: images.map((a) => ({
      assetId: a.assetId,
      number: a.number,
      category: a.category,
      r2Key: a.r2Key,
      width: a.width,
      height: a.height,
    })),
  });
}

export async function deletePersonLibraryAssets(
  nicheSlug: string,
  personSlug: string,
  assetIds: string[]
): Promise<{ deleted: number; notFound: number; errors: string[] }> {
  const idx = await loadPersonLibrary(nicheSlug, personSlug);
  if (!idx) throw new Error("Person library not found");

  const idSet = new Set(assetIds.map((id) => String(id).trim()).filter(Boolean));
  if (!idSet.size) return { deleted: 0, notFound: 0, errors: [] };

  const toRemove = idx.assets.filter((a) => idSet.has(a.assetId));
  const notFound = idSet.size - toRemove.length;
  const errors: string[] = [];

  for (const asset of toRemove) {
    for (const key of [asset.r2Key, asset.thumbKey]) {
      if (!key || !key.startsWith("library/")) continue;
      try {
        await r2DeleteObject(key);
      } catch (err) {
        errors.push(
          `${asset.assetId} (${key}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  const remaining = idx.assets.filter((a) => !idSet.has(a.assetId));
  const mergedIndex = rebuildPersonIndex(idx, remaining);
  await publishPersonLibraryIndex(mergedIndex);
  clearRoyalLibraryCache();

  return { deleted: toRemove.length, notFound, errors };
}
