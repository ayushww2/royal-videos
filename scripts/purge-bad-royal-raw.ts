/**
 * Purge bad Royal Family raw clips: graphic montages, title cards,
 * photo-on-background edits, orange text overlays, wrong people.
 *
 * npx tsx scripts/purge-bad-royal-raw.ts
 */
import { getOpenAI } from "../server/openaiClient.js";
import { config } from "../server/config.js";
import {
  r2Configured,
  r2GetJson,
  r2GetObjectBuffer,
  r2PutJson,
} from "../server/library/r2.js";
import type {
  LibraryAsset,
  LibraryCategory,
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "../server/library/types.js";

const NICHE = "Royal Family";
const NICHE_SLUG = "royal-family";
const BATCH = 10;
const CONCURRENCY = 5;

type Judge = {
  index: number;
  keep: boolean;
  reason: string;
  quality?: "clean_raw" | "graphic" | "title_overlay" | "wrong_person" | "low_quality" | "other_reject";
};

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()));
  return out;
}

async function judgeBatch(
  items: Array<{ assetId: string; person: string; b64: string }>
): Promise<Judge[]> {
  if (!items.length) return [];
  const openai = getOpenAI();
  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: `You are QA for a documentary RAW FOOTAGE library of British royals.

KEEP only if the frame looks like real camera footage / archival film of the named person (or clear group with them), with NO baked-in graphics.

REJECT (keep=false) if ANY of these:
- Photo placed on a designed background (dark texture, matrix/grid, particles, blurred bg)
- White/cream bordered photo card, tilted photo collage, scrapbook look
- Orange/yellow title banners, lower-thirds, big headlines, channel branding
- Text overlays, watermarks with channel names, meme/thumbnail styling
- Obviously AI/edited composite stills, slideshow slides
- Wrong person / random unrelated people as the main subject for the labeled person
- Mostly text/title cards

Labeled person for these frames (in order) is given in metadata.

Return JSON:
{"results":[{"index":0,"keep":true,"quality":"clean_raw","reason":"..."}]}
quality one of: clean_raw, graphic, title_overlay, wrong_person, low_quality, other_reject`,
    },
  ];

  for (let i = 0; i < items.length; i++) {
    content.push({
      type: "text",
      text: `Image ${i}: labeled person = ${items[i].person} (asset ${items[i].assetId})`,
    });
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${items[i].b64}` },
    });
  }

  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Strict documentary raw-footage QA. Prefer rejecting graphic YouTube edits. JSON only.",
      },
      { role: "user", content },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: { results?: Judge[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return items.map((_, index) => ({
      index,
      keep: true,
      reason: "parse_failed_keep",
      quality: "clean_raw",
    }));
  }

  return items.map((_, index) => {
    const row = parsed.results?.find((r) => r.index === index) || parsed.results?.[index];
    if (!row) {
      return { index, keep: true, reason: "missing_row_keep", quality: "clean_raw" as const };
    }
    return {
      index,
      keep: Boolean(row.keep),
      reason: String(row.reason || ""),
      quality: row.quality,
    };
  });
}

function renumberRaw(person: string, personSlug: string, raw: LibraryAsset[]): LibraryAsset[] {
  return raw
    .sort((a, b) => {
      const as = a.startTime ?? 0;
      const bs = b.startTime ?? 0;
      const srcA = a.sourceUrl || "";
      const srcB = b.sourceUrl || "";
      return srcA.localeCompare(srcB) || as - bs || a.createdAt.localeCompare(b.createdAt);
    })
    .map((a, i) => {
      const number = i + 1;
      const category = a.category;
      const start = a.startTime;
      const end = a.endTime;
      const timing =
        start != null && end != null ? ` at ${start.toFixed(1)}–${end.toFixed(1)}s` : "";
      const src = a.sourceUrl?.includes("v=")
        ? ` · source ${new URL(a.sourceUrl).searchParams.get("v")}`
        : "";
      return {
        ...a,
        number,
        assetId: `${NICHE_SLUG}-${personSlug}-raw-${String(number).padStart(4, "0")}`,
        title: `${person} #${number} · ${String(category).replace(/_/g, " ")}${
          start != null && end != null ? ` · ${start.toFixed(1)}–${end.toFixed(1)}s` : ""
        }`,
        description: `${person} — ${String(category).replace(/_/g, " ")} raw clip${timing}${src}`,
      };
    });
}

async function purgePerson(personSlug: string): Promise<{ person: string; before: number; kept: number; removed: number }> {
  const key = `library/${NICHE_SLUG}/${personSlug}/index.json`;
  const idx = await r2GetJson<PersonLibraryIndex>(key);
  if (!idx) throw new Error(`missing ${key}`);

  const images = idx.assets.filter((a) => a.mediaType === "image");
  const raw = idx.assets.filter((a) => a.mediaType === "raw_footage");
  const before = raw.length;

  const withThumbs: Array<{ asset: LibraryAsset; b64: string } | null> = await mapPool(
    raw,
    12,
    async (asset) => {
      const thumbKey =
        asset.thumbKey ||
        (asset.r2Key.toLowerCase().endsWith(".mp4") ? asset.r2Key.replace(/\.mp4$/i, ".jpg") : "");
      if (!thumbKey) return null;
      try {
        const { body } = await r2GetObjectBuffer(thumbKey);
        return { asset, b64: body.toString("base64") };
      } catch {
        return null;
      }
    }
  );

  const usable = withThumbs.filter(Boolean) as Array<{ asset: LibraryAsset; b64: string }>;
  const noThumbIds = new Set(
    raw.filter((a) => !usable.some((u) => u.asset.assetId === a.assetId || u.asset.r2Key === a.r2Key)).map((a) => a.r2Key)
  );

  const keepKeys = new Set<string>();
  // If no thumb, keep for now (don't mass-delete unknowns) — user asked to remove graphic ones we can see
  for (const a of raw) {
    if (noThumbIds.has(a.r2Key)) keepKeys.add(a.r2Key);
  }

  const batches: Array<Array<{ asset: LibraryAsset; b64: string }>> = [];
  for (let i = 0; i < usable.length; i += BATCH) batches.push(usable.slice(i, i + BATCH));

  await mapPool(batches, CONCURRENCY, async (batch) => {
    const payload = batch.map((b) => ({
      assetId: b.asset.assetId,
      person: idx.person,
      b64: b.b64,
    }));
    try {
      const judged = await judgeBatch(payload);
      for (let i = 0; i < batch.length; i++) {
        const j = judged[i];
        if (j?.keep) keepKeys.add(batch[i].asset.r2Key);
        else {
          console.log(
            `[purge] DROP ${idx.person} ${batch[i].asset.assetId} :: ${j?.quality || "reject"} :: ${j?.reason || ""}`
          );
        }
      }
    } catch (err) {
      console.warn(`[purge] batch failed, keeping batch:`, err instanceof Error ? err.message : err);
      for (const b of batch) keepKeys.add(b.asset.r2Key);
    }
  });

  const keptRaw = renumberRaw(
    idx.person,
    personSlug,
    raw.filter((a) => keepKeys.has(a.r2Key))
  );

  const byCategory: PersonLibraryIndex["counts"]["byCategory"] = {};
  for (const a of [...images, ...keptRaw]) {
    byCategory[a.category as LibraryCategory] = (byCategory[a.category as LibraryCategory] || 0) + 1;
  }

  const out: PersonLibraryIndex = {
    ...idx,
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    updatedAt: new Date().toISOString(),
    counts: {
      images: images.length,
      raw_footage: keptRaw.length,
      byCategory,
    },
    assets: [...images, ...keptRaw],
  };
  await r2PutJson(key, out);
  await r2PutJson(`library/${NICHE_SLUG}/${personSlug}/manifest.json`, {
    person: out.person,
    personSlug,
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
      r2Key: a.r2Key,
      thumbKey: a.thumbKey,
    })),
  });

  return { person: idx.person, before, kept: keptRaw.length, removed: before - keptRaw.length };
}

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured");
  const niche = await r2GetJson<NicheLibraryIndex>(`library/${NICHE_SLUG}/index.json`);
  if (!niche?.people?.length) throw new Error("No royal-family niche");

  const results = [];
  for (const p of niche.people) {
    console.log(`[purge] scanning ${p.person} (${p.raw_footage} raw)...`);
    results.push(await purgePerson(p.personSlug));
  }

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
  const map = new Map(root.niches.map((n) => [n.nicheSlug, n]));
  map.set(NICHE_SLUG, {
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    peopleCount: nicheOut.people.length,
    images: nicheOut.people.reduce((n, p) => n + p.images, 0),
    raw_footage: nicheOut.people.reduce((n, p) => n + p.raw_footage, 0),
  });
  await r2PutJson("library/index.json", {
    updatedAt: new Date().toISOString(),
    niches: [...map.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        results,
        removedTotal: results.reduce((n, r) => n + r.removed, 0),
        keptTotal: results.reduce((n, r) => n + r.kept, 0),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
