/**
 * Merge Royal v1 + Royal Family into Royal Family without data loss.
 * - Images from royal-v1 (and any images in royal-family) land under royal-family
 * - Raw footage from royal-family (and any raw in royal-v1) kept under royal-family
 * - Physical R2 objects stay in place; indexes point at existing r2Keys
 * - royal-v1 becomes a pointer/alias to the same merged people counts
 *
 * Usage: npx tsx scripts/merge-royal-niches.ts
 */
import { r2Configured, r2GetJson, r2PutJson } from "../server/library/r2.js";
import type {
  LibraryAsset,
  LibraryCategory,
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "../server/library/types.js";

const TARGET_NICHE = "Royal Family";
const TARGET_SLUG = "royal-family";
const SOURCE_SLUG = "royal-v1";

function dedupeKey(a: LibraryAsset): string {
  if (a.r2Key) return `r2:${a.r2Key}`;
  if (a.sourceUrl) return `url:${a.mediaType}:${a.sourceUrl}`;
  return `id:${a.assetId}`;
}

function rebuildCounts(assets: LibraryAsset[]): PersonLibraryIndex["counts"] {
  const images = assets.filter((a) => a.mediaType === "image");
  const raw = assets.filter((a) => a.mediaType === "raw_footage");
  const byCategory: PersonLibraryIndex["counts"]["byCategory"] = {};
  for (const a of assets) {
    const cat = (a.category || "other") as LibraryCategory;
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }
  return {
    images: images.length,
    raw_footage: raw.length,
    byCategory,
  };
}

function renumberByType(person: string, personSlug: string, assets: LibraryAsset[]): LibraryAsset[] {
  const images = assets
    .filter((a) => a.mediaType === "image")
    .sort((a, b) => (a.number || 0) - (b.number || 0) || a.createdAt.localeCompare(b.createdAt));
  const raw = assets
    .filter((a) => a.mediaType === "raw_footage")
    .sort((a, b) => {
      const sa = a.startTime ?? 0;
      const sb = b.startTime ?? 0;
      return (a.sourceUrl || "").localeCompare(b.sourceUrl || "") || sa - sb || a.createdAt.localeCompare(b.createdAt);
    });

  const outImages = images.map((a, i) => {
    const number = i + 1;
    return {
      ...a,
      number,
      niche: TARGET_NICHE,
      nicheSlug: TARGET_SLUG,
      person,
      personSlug,
      assetId: `${TARGET_SLUG}-${personSlug}-img-${String(number).padStart(4, "0")}`,
    };
  });

  const outRaw = raw.map((a, i) => {
    const number = i + 1;
    const category = a.category || "other";
    const start = a.startTime;
    const end = a.endTime;
    const timing =
      start != null && end != null ? ` at ${start.toFixed(1)}–${end.toFixed(1)}s` : "";
    let src = "";
    try {
      if (a.sourceUrl) src = ` · source ${new URL(a.sourceUrl).searchParams.get("v") || ""}`;
    } catch {
      /* ignore */
    }
    return {
      ...a,
      number,
      niche: TARGET_NICHE,
      nicheSlug: TARGET_SLUG,
      person,
      personSlug,
      assetId: `${TARGET_SLUG}-${personSlug}-raw-${String(number).padStart(4, "0")}`,
      title:
        a.title ||
        `${person} #${number} · ${String(category).replace(/_/g, " ")}${
          start != null && end != null ? ` · ${start.toFixed(1)}–${end.toFixed(1)}s` : ""
        }`,
      description:
        a.description ||
        `${person} — ${String(category).replace(/_/g, " ")} raw clip${timing}${src}`,
    };
  });

  return [...outImages, ...outRaw];
}

async function discoverPeople(): Promise<Array<{ person: string; personSlug: string }>> {
  // Fast path: niche indexes only (avoid listing every image/raw object under library/)
  const peopleMap = new Map<string, { person: string; personSlug: string }>();
  for (const slug of [TARGET_SLUG, SOURCE_SLUG] as const) {
    const niche = await r2GetJson<NicheLibraryIndex>(`library/${slug}/index.json`);
    for (const p of niche?.people || []) {
      if (!p.personSlug) continue;
      peopleMap.set(p.personSlug, { person: p.person, personSlug: p.personSlug });
    }
  }
  return [...peopleMap.values()].sort((a, b) => a.person.localeCompare(b.person));
}

async function loadPerson(nicheSlug: string, personSlug: string): Promise<PersonLibraryIndex | null> {
  return r2GetJson<PersonLibraryIndex>(`library/${nicheSlug}/${personSlug}/index.json`);
}

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured");

  const targetNiche =
    (await r2GetJson<NicheLibraryIndex>(`library/${TARGET_SLUG}/index.json`)) || {
      niche: TARGET_NICHE,
      nicheSlug: TARGET_SLUG,
      updatedAt: "",
      people: [],
    };
  const sourceNiche =
    (await r2GetJson<NicheLibraryIndex>(`library/${SOURCE_SLUG}/index.json`)) || {
      niche: "Royal v1",
      nicheSlug: SOURCE_SLUG,
      updatedAt: "",
      people: [],
    };

  // Discover from actual person indexes (niche lists can be stale/incomplete)
  const discovered = await discoverPeople();
  const peopleMap = new Map<string, { person: string; personSlug: string }>();
  for (const p of discovered) peopleMap.set(p.personSlug, p);
  for (const p of [...targetNiche.people, ...sourceNiche.people]) {
    if (!peopleMap.has(p.personSlug)) {
      peopleMap.set(p.personSlug, { person: p.person, personSlug: p.personSlug });
    }
  }

  console.log(`[merge] people to merge (${peopleMap.size}): ${[...peopleMap.keys()].join(", ")}`);

  const mergedPeople: NicheLibraryIndex["people"] = [];
  const report: Array<{
    person: string;
    fromFamily: { images: number; raw: number };
    fromV1: { images: number; raw: number };
    merged: { images: number; raw: number };
  }> = [];

  for (const { person, personSlug } of [...peopleMap.values()].sort((a, b) =>
    a.person.localeCompare(b.person)
  )) {
    const fam = await loadPerson(TARGET_SLUG, personSlug);
    const v1 = await loadPerson(SOURCE_SLUG, personSlug);

    const famAssets = fam?.assets || [];
    const v1Assets = v1?.assets || [];

    const fromFamily = {
      images: famAssets.filter((a) => a.mediaType === "image").length,
      raw: famAssets.filter((a) => a.mediaType === "raw_footage").length,
    };
    const fromV1 = {
      images: v1Assets.filter((a) => a.mediaType === "image").length,
      raw: v1Assets.filter((a) => a.mediaType === "raw_footage").length,
    };

    const byKey = new Map<string, LibraryAsset>();
    // Prefer target (royal-family) first, then add v1 missing ones
    for (const a of famAssets) byKey.set(dedupeKey(a), a);
    for (const a of v1Assets) {
      const k = dedupeKey(a);
      if (!byKey.has(k)) byKey.set(k, a);
    }

    const mergedAssets = renumberByType(person, personSlug, [...byKey.values()]);
    const counts = rebuildCounts(mergedAssets);

    const out: PersonLibraryIndex = {
      niche: TARGET_NICHE,
      nicheSlug: TARGET_SLUG,
      person,
      personSlug,
      updatedAt: new Date().toISOString(),
      counts,
      assets: mergedAssets,
    };

    // Write canonical index under royal-family
    await r2PutJson(`library/${TARGET_SLUG}/${personSlug}/index.json`, out);
    await r2PutJson(`library/${TARGET_SLUG}/${personSlug}/manifest.json`, {
      person,
      personSlug,
      niche: TARGET_NICHE,
      nicheSlug: TARGET_SLUG,
      imageCount: counts.images,
      rawFootageCount: counts.raw_footage,
      assets: mergedAssets.map((a) => ({
        assetId: a.assetId,
        number: a.number,
        mediaType: a.mediaType,
        category: a.category,
        description: a.description,
        title: a.title,
        r2Key: a.r2Key,
        thumbKey: a.thumbKey,
        sourceUrl: a.sourceUrl,
      })),
    });

    // Mirror same merged catalog under royal-v1 so old paths still resolve
    const v1Mirror: PersonLibraryIndex = {
      ...out,
      niche: "Royal v1",
      nicheSlug: SOURCE_SLUG,
    };
    await r2PutJson(`library/${SOURCE_SLUG}/${personSlug}/index.json`, v1Mirror);

    mergedPeople.push({
      person,
      personSlug,
      images: counts.images,
      raw_footage: counts.raw_footage,
    });

    report.push({
      person,
      fromFamily,
      fromV1,
      merged: { images: counts.images, raw: counts.raw_footage },
    });

    console.log(
      `[merge] ${person}: family img/raw=${fromFamily.images}/${fromFamily.raw} + v1 ${fromV1.images}/${fromV1.raw} => ${counts.images}/${counts.raw_footage}`
    );
  }

  const nicheOut: NicheLibraryIndex = {
    niche: TARGET_NICHE,
    nicheSlug: TARGET_SLUG,
    updatedAt: new Date().toISOString(),
    people: mergedPeople,
  };
  await r2PutJson(`library/${TARGET_SLUG}/index.json`, nicheOut);

  // Keep royal-v1 niche index as alias with same people/counts
  await r2PutJson(`library/${SOURCE_SLUG}/index.json`, {
    niche: "Royal v1",
    nicheSlug: SOURCE_SLUG,
    updatedAt: new Date().toISOString(),
    people: mergedPeople,
    aliasOf: TARGET_SLUG,
    note: "Merged into Royal Family — same assets",
  });

  const root =
    (await r2GetJson<RootLibraryIndex>("library/index.json")) ||
    ({ updatedAt: "", niches: [] } satisfies RootLibraryIndex);

  await r2PutJson("library/index.merge-backup.json", {
    backedUpAt: new Date().toISOString(),
    previous: root,
  });

  const images = mergedPeople.reduce((n, p) => n + p.images, 0);
  const raw = mergedPeople.reduce((n, p) => n + p.raw_footage, 0);

  // Preserve non-royal niches (e.g. space)
  const otherNiches = (root.niches || []).filter(
    (n) => n.nicheSlug !== TARGET_SLUG && n.nicheSlug !== SOURCE_SLUG
  );

  await r2PutJson("library/index.json", {
    updatedAt: new Date().toISOString(),
    niches: [
      {
        niche: TARGET_NICHE,
        nicheSlug: TARGET_SLUG,
        peopleCount: mergedPeople.length,
        images,
        raw_footage: raw,
      },
      ...otherNiches,
    ].sort((a, b) => a.niche.localeCompare(b.niche)),
  } satisfies RootLibraryIndex);

  for (const r of report) {
    if (r.merged.images < r.fromFamily.images || r.merged.images < r.fromV1.images) {
      throw new Error(`Image regression for ${r.person}`);
    }
    if (r.merged.raw < r.fromFamily.raw || r.merged.raw < r.fromV1.raw) {
      throw new Error(`Raw regression for ${r.person}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        niche: TARGET_NICHE,
        people: mergedPeople.length,
        images,
        raw_footage: raw,
        report,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
