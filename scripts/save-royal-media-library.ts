/**
 * Stop-gap finalize: salvage unindexed R2 image/raw objects into person indexes,
 * then rebuild niche + root Media Library indexes.
 */
import "dotenv/config";
import { r2Configured, r2GetJson, r2ListPrefix, r2PutJson } from "../server/library/r2.js";
import type {
  LibraryAsset,
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "../server/library/types.js";
import { slugify } from "../server/library/types.js";

const NICHE = "Royal v1";
const NICHE_SLUG = "royal-v1";

const KNOWN_PEOPLE = [
  "King Charles",
  "Queen Camilla",
  "Prince William",
  "Princess Catherine",
  "Prince Harry",
  "Meghan Markle",
  "Princess Diana",
  "Princess Anne",
  "Prince George",
  "Princess Charlotte",
  "Prince Louis",
  "Prince Andrew",
  "Princess Beatrice",
  "Princess Eugenie",
  "Zara Tindall",
  "Sophie Duchess of Edinburgh",
  "Prince Edward",
  "Sarah Ferguson",
  "Sir Timothy Laurence",
  "Tom Parker Bowles",
  "Laura Lopes",
];

async function discoverPeople(): Promise<Array<{ person: string; personSlug: string }>> {
  const bySlug = new Map<string, string>();
  for (const person of KNOWN_PEOPLE) bySlug.set(slugify(person), person);

  const niche =
    (await r2GetJson<NicheLibraryIndex>(`library/${NICHE_SLUG}/index.json`)) ||
    ({ niche: NICHE, nicheSlug: NICHE_SLUG, updatedAt: "", people: [] } satisfies NicheLibraryIndex);
  for (const p of niche.people || []) {
    if (p.personSlug) bySlug.set(p.personSlug, p.person || p.personSlug);
  }

  // Discover folders that exist on R2 even if missing from niche index
  const keys = await r2ListPrefix(`library/${NICHE_SLUG}/`);
  for (const key of keys) {
    const m = key.match(new RegExp(`^library/${NICHE_SLUG}/([^/]+)/`));
    if (!m) continue;
    const personSlug = m[1];
    if (personSlug === "index.json" || !personSlug) continue;
    if (!bySlug.has(personSlug)) {
      const pretty = personSlug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      bySlug.set(personSlug, pretty);
    }
  }

  return [...bySlug.entries()]
    .map(([personSlug, person]) => ({ person, personSlug }))
    .sort((a, b) => a.person.localeCompare(b.person));
}

function emptyIndex(person: string, personSlug: string): PersonLibraryIndex {
  return {
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    person,
    personSlug,
    updatedAt: new Date().toISOString(),
    counts: { images: 0, raw_footage: 0, byCategory: {} },
    assets: [],
  };
}

function rebuildCounts(assets: LibraryAsset[]): PersonLibraryIndex["counts"] {
  const images = assets.filter((a) => a.mediaType === "image");
  const raw = assets.filter((a) => a.mediaType === "raw_footage");
  const byCategory: Record<string, number> = {};
  for (const a of assets) byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  return { images: images.length, raw_footage: raw.length, byCategory };
}

async function salvagePerson(person: string, personSlug: string): Promise<PersonLibraryIndex> {
  const existing =
    (await r2GetJson<PersonLibraryIndex>(`library/${NICHE_SLUG}/${personSlug}/index.json`)) ||
    emptyIndex(person, personSlug);

  const assets = [...(existing.assets || [])];
  const known = new Set(assets.map((a) => a.r2Key));
  let addedImages = 0;
  let addedRaw = 0;

  const imageKeys = await r2ListPrefix(`library/${NICHE_SLUG}/${personSlug}/images/`);
  for (const key of imageKeys) {
    if (known.has(key)) continue;
    const base = key.split("/").pop() || "";
    const m = base.match(/-img-(\d+)\.(jpe?g|png|webp)$/i);
    if (!m) continue;
    const number = Number(m[1]);
    const assetId = base.replace(/\.(jpe?g|png|webp)$/i, "");
    assets.push({
      assetId,
      number,
      niche: NICHE,
      nicheSlug: NICHE_SLUG,
      person,
      personSlug,
      mediaType: "image",
      category: "other",
      categories: ["other"],
      r2Key: key,
      description: `${person} image ${String(number).padStart(4, "0")} (index salvage).`,
      createdAt: new Date().toISOString(),
    });
    known.add(key);
    addedImages += 1;
  }

  const rawKeys = await r2ListPrefix(`library/${NICHE_SLUG}/${personSlug}/raw/`);
  for (const key of rawKeys) {
    if (!/\.mp4$/i.test(key)) continue;
    if (known.has(key)) continue;
    const base = key.split("/").pop() || "";
    const m = base.match(/-raw-(\d+)\.mp4$/i);
    if (!m) continue;
    const number = Number(m[1]);
    const assetId = base.replace(/\.mp4$/i, "");
    assets.push({
      assetId,
      number,
      niche: NICHE,
      nicheSlug: NICHE_SLUG,
      person,
      personSlug,
      mediaType: "raw_footage",
      category: "other",
      categories: ["other", "youtube-raw"],
      r2Key: key,
      thumbKey: key.replace(/\.mp4$/i, ".jpg"),
      description: `${person} raw clip ${String(number).padStart(4, "0")} (index salvage).`,
      createdAt: new Date().toISOString(),
    });
    known.add(key);
    addedRaw += 1;
  }

  const counts = rebuildCounts(assets);
  const out: PersonLibraryIndex = {
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    person,
    personSlug,
    updatedAt: new Date().toISOString(),
    counts,
    assets: assets.sort((a, b) => a.number - b.number || a.assetId.localeCompare(b.assetId)),
  };

  await r2PutJson(`library/${NICHE_SLUG}/${personSlug}/index.json`, out);
  await r2PutJson(`library/${NICHE_SLUG}/${personSlug}/manifest.json`, {
    person: out.person,
    personSlug: out.personSlug,
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    imageCount: out.counts.images,
    rawFootageCount: out.counts.raw_footage,
    assets: out.assets.map((a) => ({
      assetId: a.assetId,
      number: a.number,
      mediaType: a.mediaType,
      category: a.category,
      r2Key: a.r2Key,
      description: a.description,
      sourceUrl: a.sourceUrl,
    })),
  });

  console.log(
    `[save] ${person}: images=${out.counts.images} raw=${out.counts.raw_footage}` +
      (addedImages || addedRaw ? ` (+${addedImages} img, +${addedRaw} raw salvaged)` : "")
  );
  return out;
}

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured — check .env.library");

  const people = await discoverPeople();
  console.log(`[save] salvaging ${people.length} people under ${NICHE_SLUG}...`);

  const summary: NicheLibraryIndex["people"] = [];
  for (const { person, personSlug } of people) {
    const idx = await salvagePerson(person, personSlug);
    summary.push({
      person: idx.person,
      personSlug: idx.personSlug,
      images: idx.counts.images,
      raw_footage: idx.counts.raw_footage,
    });
  }

  summary.sort((a, b) => a.person.localeCompare(b.person));
  const nicheOut: NicheLibraryIndex = {
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    updatedAt: new Date().toISOString(),
    people: summary,
  };
  await r2PutJson(`library/${NICHE_SLUG}/index.json`, nicheOut);

  const totalImages = summary.reduce((n, p) => n + p.images, 0);
  const totalRaw = summary.reduce((n, p) => n + p.raw_footage, 0);

  const root =
    (await r2GetJson<RootLibraryIndex>("library/index.json")) ||
    ({ updatedAt: "", niches: [] } satisfies RootLibraryIndex);
  const nicheMap = new Map(root.niches.map((n) => [n.nicheSlug, n]));
  nicheMap.set(NICHE_SLUG, {
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    peopleCount: summary.length,
    images: totalImages,
    raw_footage: totalRaw,
  });
  await r2PutJson("library/index.json", {
    updatedAt: new Date().toISOString(),
    niches: [...nicheMap.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  } satisfies RootLibraryIndex);

  // Verify round-trip
  const verifyNiche = await r2GetJson<NicheLibraryIndex>(`library/${NICHE_SLUG}/index.json`);
  const verifyRoot = await r2GetJson<RootLibraryIndex>("library/index.json");
  if (!verifyNiche || !verifyRoot) throw new Error("Save verification failed — indexes missing after write");

  console.log("=== MEDIA LIBRARY SAVED ===");
  for (const p of summary) {
    console.log(`${p.person}: images=${p.images} raw=${p.raw_footage}`);
  }
  console.log(`PEOPLE=${summary.length}`);
  console.log(`TOTAL_IMAGES=${totalImages}`);
  console.log(`TOTAL_RAW=${totalRaw}`);
  console.log(`SAVED_AT=${nicheOut.updatedAt}`);
  console.log("VERIFY_OK=true");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
