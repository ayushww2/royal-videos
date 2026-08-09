/**
 * Repair Royal Family raw footage indexes:
 * - unique sequential numbers per person
 * - ensure categories
 * - add descriptions + timing fields
 * - ensure thumbKey points at .jpg sibling
 *
 * npx tsx scripts/repair-royal-raw-index.ts
 */
import { r2Configured, r2GetJson, r2PutJson } from "../server/library/r2.js";
import type {
  LibraryAsset,
  LibraryCategory,
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "../server/library/types.js";

const NICHE = "Royal Family";
const NICHE_SLUG = "royal-family";

const VALID: LibraryCategory[] = [
  "portrait",
  "serious",
  "smiling",
  "laughing",
  "sad",
  "formal",
  "with_camilla",
  "with_william",
  "with_family",
  "wave",
  "speech",
  "military",
  "event",
  "other",
];

function normalizeCategory(raw?: string): LibraryCategory {
  const s = String(raw || "other")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  if ((VALID as string[]).includes(s)) return s as LibraryCategory;
  if (s.includes("smile")) return "smiling";
  if (s.includes("laugh")) return "laughing";
  if (s.includes("formal") || s.includes("ceremony")) return "formal";
  if (s.includes("military") || s.includes("uniform")) return "military";
  if (s.includes("speech") || s.includes("podium")) return "speech";
  if (s.includes("wave")) return "wave";
  if (s.includes("family")) return "with_family";
  if (s.includes("william")) return "with_william";
  if (s.includes("camilla")) return "with_camilla";
  if (s.includes("sad") || s.includes("solemn")) return "sad";
  if (s.includes("serious")) return "serious";
  if (s.includes("portrait") || s.includes("close")) return "portrait";
  if (s.includes("event") || s.includes("walkabout") || s.includes("crowd")) return "event";
  return "other";
}

function parseTiming(title?: string, description?: string): { start?: number; end?: number } {
  const text = `${title || ""} ${description || ""}`;
  const m = text.match(/(\d+(?:\.\d+)?)\s*s\s*[-–]\s*(\d+(?:\.\d+)?)\s*s/i);
  if (!m) return {};
  return { start: Number(m[1]), end: Number(m[2]) };
}

function sourceIdFromUrl(url?: string): string {
  if (!url) return "unknown-source";
  try {
    const u = new URL(url);
    return u.searchParams.get("v") || u.pathname.split("/").pop() || "unknown-source";
  } catch {
    return "unknown-source";
  }
}

function categoryPhrase(cat: LibraryCategory): string {
  return cat.replace(/_/g, " ");
}

function buildDescription(person: string, category: LibraryCategory, start?: number, end?: number, sourceId?: string): string {
  const timing =
    start != null && end != null ? ` at ${start.toFixed(1)}–${end.toFixed(1)}s` : "";
  const src = sourceId && sourceId !== "unknown-source" ? ` · source ${sourceId}` : "";
  return `${person} — ${categoryPhrase(category)} raw clip${timing}${src}`;
}

function sortKey(a: LibraryAsset): string {
  const t = parseTiming(a.title, a.description);
  const start = a.startTime ?? t.start ?? 999999;
  const src = sourceIdFromUrl(a.sourceUrl);
  return `${src}|${String(start).padStart(10, "0")}|${a.createdAt}|${a.assetId}`;
}

async function repairPerson(personSlug: string): Promise<{ person: string; raw: number }> {
  const key = `library/${NICHE_SLUG}/${personSlug}/index.json`;
  const idx = await r2GetJson<PersonLibraryIndex>(key);
  if (!idx) throw new Error(`Missing index ${key}`);

  const images = idx.assets.filter((a) => a.mediaType === "image");
  const raw = idx.assets
    .filter((a) => a.mediaType === "raw_footage")
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const repairedRaw: LibraryAsset[] = raw.map((a, i) => {
    const number = i + 1;
    const category = normalizeCategory(a.category);
    const timing = parseTiming(a.title, a.description);
    const startTime = a.startTime ?? timing.start;
    const endTime = a.endTime ?? timing.end;
    const duration =
      a.duration ??
      (startTime != null && endTime != null ? Math.max(0.1, endTime - startTime) : 3);
    const sourceId = sourceIdFromUrl(a.sourceUrl);
    const thumbKey =
      a.thumbKey ||
      (a.r2Key.toLowerCase().endsWith(".mp4") ? a.r2Key.replace(/\.mp4$/i, ".jpg") : undefined);
    const description = buildDescription(idx.person, category, startTime, endTime, sourceId);
    const title = `${idx.person} #${number} · ${categoryPhrase(category)}${
      startTime != null && endTime != null ? ` · ${startTime.toFixed(1)}–${endTime.toFixed(1)}s` : ""
    }`;

    // Keep physical R2 object keys stable; only normalize index metadata + display id.
    const assetId = `${NICHE_SLUG}-${personSlug}-raw-${String(number).padStart(4, "0")}`;

    return {
      ...a,
      assetId,
      number,
      niche: NICHE,
      nicheSlug: NICHE_SLUG,
      person: idx.person,
      personSlug,
      mediaType: "raw_footage",
      category,
      categories: [category],
      thumbKey,
      title,
      description,
      startTime,
      endTime,
      duration,
      sourceUrl: a.sourceUrl,
    };
  });

  const byCategory: PersonLibraryIndex["counts"]["byCategory"] = {};
  for (const a of [...images, ...repairedRaw]) {
    byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  }

  const out: PersonLibraryIndex = {
    ...idx,
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    personSlug,
    updatedAt: new Date().toISOString(),
    counts: {
      images: images.length,
      raw_footage: repairedRaw.length,
      byCategory,
    },
    assets: [...images, ...repairedRaw],
  };

  await r2PutJson(key, out);
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
      description: a.description,
      title: a.title,
      r2Key: a.r2Key,
      thumbKey: a.thumbKey,
      startTime: a.startTime,
      endTime: a.endTime,
      duration: a.duration,
      sourceUrl: a.sourceUrl,
    })),
  });

  console.log(`[repair] ${idx.person}: raw=${repairedRaw.length} numbered 1..${repairedRaw.length}`);
  return { person: idx.person, raw: repairedRaw.length };
}

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured");

  const niche =
    (await r2GetJson<NicheLibraryIndex>(`library/${NICHE_SLUG}/index.json`)) ||
    ({
      niche: NICHE,
      nicheSlug: NICHE_SLUG,
      updatedAt: "",
      people: [],
    } satisfies NicheLibraryIndex);

  const results = [];
  for (const p of niche.people) {
    results.push(await repairPerson(p.personSlug));
  }

  // Refresh niche rollup from repaired person indexes
  const people = [];
  for (const p of niche.people) {
    const idx = await r2GetJson<PersonLibraryIndex>(`library/${NICHE_SLUG}/${p.personSlug}/index.json`);
    if (!idx) continue;
    people.push({
      person: idx.person,
      personSlug: idx.personSlug,
      images: idx.counts.images,
      raw_footage: idx.counts.raw_footage,
    });
  }

  const nicheOut: NicheLibraryIndex = {
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    updatedAt: new Date().toISOString(),
    people: people.sort((a, b) => a.person.localeCompare(b.person)),
  };
  await r2PutJson(`library/${NICHE_SLUG}/index.json`, nicheOut);

  const root =
    (await r2GetJson<RootLibraryIndex>("library/index.json")) ||
    ({ updatedAt: "", niches: [] } satisfies RootLibraryIndex);
  const nicheMap = new Map(root.niches.map((n) => [n.nicheSlug, n]));
  nicheMap.set(NICHE_SLUG, {
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    peopleCount: nicheOut.people.length,
    images: nicheOut.people.reduce((n, p) => n + p.images, 0),
    raw_footage: nicheOut.people.reduce((n, p) => n + p.raw_footage, 0),
  });
  await r2PutJson("library/index.json", {
    updatedAt: new Date().toISOString(),
    niches: [...nicheMap.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  } satisfies RootLibraryIndex);

  console.log(
    JSON.stringify(
      {
        ok: true,
        people: results,
        totalRaw: results.reduce((n, r) => n + r.raw, 0),
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
