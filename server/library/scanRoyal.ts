/**
 * ContactBox vision scan of Royal Media stills.
 * Removes images that are the wrong subject, have baked-in text/memes,
 * or are byte-duplicates. Unique clean person photos are kept.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getOpenAI } from "../openaiClient.js";
import { config, optionalEnv } from "../config.js";
import { r2Configured, r2DeleteObject, r2GetJson, r2GetObjectBuffer, r2PutJson } from "./r2.js";
import type { LibraryAsset, NicheLibraryIndex, PersonLibraryIndex, RootLibraryIndex } from "./types.js";
import { countLibraryAssets, slugify } from "./types.js";
import { loadNicheLibrary } from "./collectImages.js";
import { ROYAL_NICHE, ROYAL_NICHE_SLUG, ROYAL_PEOPLE } from "./describeRoyal.js";

const MODEL = optionalEnv("ROYAL_VISION_MODEL") || config.openaiModel || "gpt-5.6-terra";
const BATCH_SIZE = Math.max(1, Math.min(8, Number(process.env.ROYAL_SCAN_BATCH || 6)));
const PREVIEW_WIDTH = Math.max(160, Number(process.env.ROYAL_VISION_WIDTH || 320));

export type ScanRejectReason = "wrong_person" | "has_text" | "duplicate" | "heuristic";

export type ScanRoyalProgress = {
  person: string;
  personSlug: string;
  examined: number;
  kept: number;
  removed: number;
  reasons: Record<ScanRejectReason, number>;
  removedNumbers: number[];
};

type VisionRow = {
  index: number;
  isPerson: boolean;
  hasText: boolean;
  description: string;
};

function personIndexKey(nicheSlug: string, personSlug: string): string {
  return `library/${nicheSlug}/${personSlug}/index.json`;
}

function findFfmpeg(): string {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], {
    encoding: "utf8",
  });
  const line = (which.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (line && fs.existsSync(line)) return line;
  return "ffmpeg";
}

function toJpegPreview(input: Buffer, extHint: string): Buffer {
  if (input.byteLength <= 160_000) return input;
  const ffmpeg = findFfmpeg();
  const tmpIn = path.join(
    os.tmpdir(),
    `scan-in-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${extHint}`
  );
  const tmpOut = path.join(
    os.tmpdir(),
    `scan-out-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
  );
  try {
    fs.writeFileSync(tmpIn, input);
    const res = spawnSync(
      ffmpeg,
      ["-y", "-i", tmpIn, "-vf", `scale='min(${PREVIEW_WIDTH},iw)':-2`, "-q:v", "8", "-frames:v", "1", tmpOut],
      { encoding: "utf8" }
    );
    if (res.status !== 0 || !fs.existsSync(tmpOut)) {
      if (input.length < 500_000) return input;
      throw new Error(res.stderr?.slice(0, 300) || "ffmpeg preview failed");
    }
    return fs.readFileSync(tmpOut);
  } finally {
    try {
      fs.unlinkSync(tmpIn);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(tmpOut);
    } catch {
      /* ignore */
    }
  }
}

async function loadVisualJpeg(asset: LibraryAsset): Promise<{ b64: string; mime: string }> {
  const { body, contentType } = await r2GetObjectBuffer(asset.r2Key);
  const ext =
    /\.png$/i.test(asset.r2Key) || contentType?.includes("png")
      ? ".png"
      : /\.webp$/i.test(asset.r2Key) || contentType?.includes("webp")
        ? ".webp"
        : ".jpg";
  const jpeg = toJpegPreview(body, ext);
  return { b64: jpeg.toString("base64"), mime: "image/jpeg" };
}

/** Cheap title/url rejects before ContactBox — PEI landscapes, reddit memes, etc. */
export function heuristicReject(person: string, asset: LibraryAsset): string | null {
  const hay = `${asset.title || ""} ${asset.description || ""} ${asset.sourceUrl || ""} ${asset.sourcePageUrl || ""} ${asset.queryUsed || ""}`.toLowerCase();
  const p = person.toLowerCase();

  if (/\b(meme|reddit|r\/|watermarked|clickbait|ai generated|stock vector|clipart)\b/i.test(hay)) {
    return "meme/text source";
  }
  if (/\bprince edward island\b|\bpei\b|lookphotos|red earth prince edward|national park.*edward island|edward island national/i.test(hay)) {
    return "prince edward island landscape";
  }
  if (
    /\b(yosemite|bushkill|cathedral rocks|waterfall|mountain range|coast path|landscape photography)\b/i.test(hay) &&
    !/\b(prince|king|queen|princess|duchess|duke|royal)\b/i.test(hay)
  ) {
    return "landscape stock";
  }
  if (p.includes("edward") && /\bisland\b/.test(hay) && !/\b(duke of edinburgh|earl of wessex|sophie)\b/.test(hay)) {
    return "edward island not the prince";
  }
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function scanBatch(person: string, assets: LibraryAsset[]): Promise<Map<string, VisionRow>> {
  const openai = getOpenAI();
  const visuals = await Promise.all(
    assets.map(async (a) => {
      const v = await loadVisualJpeg(a);
      return { asset: a, ...v };
    })
  );

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `You are scanning a Royal documentary stills library folder for "${person}" via ContactBox vision.

For EACH image (image 0 .. ${visuals.length - 1}):
1) isPerson: true ONLY if ${person} is visibly a main subject (face/body recognizable). false for landscapes, buildings, maps, animals, crowds without them, Prince Edward Island scenery, or a different person.
2) hasText: true if the photo has baked-in meme captions, large overlay sentences, news chyrons, stamps, or heavy watermarks covering the picture. Small photo-credit bugs in a corner are OK (hasText=false).
3) description: one short sentence of what is actually visible.

Return JSON only:
{"items":[{"index":0,"isPerson":true,"hasText":false,"description":"..."}]}`,
    },
  ];
  for (const v of visuals) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${v.mime};base64,${v.b64}`, detail: "low" },
    });
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You audit royal-person photo libraries. Reject landscapes, wrong people, and images with overlay text. Return strict JSON only.",
      },
      { role: "user", content },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: { items?: Array<Partial<VisionRow>> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON from ContactBox vision");
  }

  const out = new Map<string, VisionRow>();
  for (let i = 0; i < assets.length; i++) {
    const row = parsed.items?.find((x) => x.index === i) || parsed.items?.[i] || {};
    out.set(assets[i].assetId, {
      index: i,
      isPerson: Boolean(row.isPerson),
      hasText: Boolean(row.hasText),
      description: String(row.description || "").trim(),
    });
  }
  return out;
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
  await r2PutJson(personIndexKey(nicheSlug, personSlug), personIndex);

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
    group: group || peopleMap.get(personSlug)?.group,
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
    console.warn(`[library-scan] r2 delete failed ${asset.r2Key}`, err);
  }
  if (asset.thumbKey) {
    try {
      await r2DeleteObject(asset.thumbKey);
    } catch {
      /* ignore */
    }
  }
}

export async function scanRoyalPerson(params: {
  person: string;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<ScanRoyalProgress> {
  if (!r2Configured()) throw new Error("R2 not configured");
  const person = params.person;
  const personSlug = slugify(person);
  const log = params.onProgress || console.log;
  const dryRun = Boolean(params.dryRun);

  const idx = await r2GetJson<PersonLibraryIndex>(personIndexKey(ROYAL_NICHE_SLUG, personSlug));
  if (!idx?.assets?.length) throw new Error(`Person library missing: ${person}`);

  const images = idx.assets.filter((a) => a.mediaType === "image");
  const keepIds = new Set<string>();
  const remove = new Map<string, { reason: ScanRejectReason; detail: string }>();
  const seenHash = new Set<string>();
  const seenUrl = new Set<string>();

  for (const a of images) {
    if (a.contentHash && seenHash.has(a.contentHash)) {
      remove.set(a.assetId, { reason: "duplicate", detail: "same content hash" });
      continue;
    }
    if (a.sourceUrl && seenUrl.has(a.sourceUrl)) {
      remove.set(a.assetId, { reason: "duplicate", detail: "same source url" });
      continue;
    }
    const heur = heuristicReject(person, a);
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
    `[library-scan] ${person}: ${images.length} stills, heuristic-drop=${remove.size}, contactbox=${toVision.length} model=${MODEL}`
  );

  for (const batch of chunk(toVision, BATCH_SIZE)) {
    try {
      const rows = await scanBatch(person, batch);
      for (const asset of batch) {
        const row = rows.get(asset.assetId);
        if (!row) {
          remove.set(asset.assetId, { reason: "wrong_person", detail: "vision miss" });
          keepIds.delete(asset.assetId);
          continue;
        }
        if (row.hasText) {
          remove.set(asset.assetId, { reason: "has_text", detail: row.description || "overlay text" });
          keepIds.delete(asset.assetId);
          continue;
        }
        if (!row.isPerson) {
          remove.set(asset.assetId, { reason: "wrong_person", detail: row.description || "not the person" });
          keepIds.delete(asset.assetId);
          continue;
        }
        if (row.description) asset.description = row.description;
        asset.visionDescribedAt = new Date().toISOString();
        asset.visionModel = MODEL;
      }
      log(`[library-scan] ${person}: batch done kept=${keepIds.size} removed=${remove.size}`);
    } catch (err) {
      log(`[library-scan] batch failed ${person}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const removedAssets = images.filter((a) => remove.has(a.assetId));
  const keptImages = images.filter((a) => !remove.has(a.assetId));
  const others = idx.assets.filter((a) => a.mediaType !== "image");

  const reasons: Record<ScanRejectReason, number> = {
    wrong_person: 0,
    has_text: 0,
    duplicate: 0,
    heuristic: 0,
  };
  for (const info of remove.values()) reasons[info.reason] += 1;

  const progress: ScanRoyalProgress = {
    person,
    personSlug,
    examined: images.length,
    kept: keptImages.length,
    removed: removedAssets.length,
    reasons,
    removedNumbers: removedAssets.map((a) => a.number).sort((a, b) => a - b),
  };

  if (!dryRun) {
    idx.assets = [...keptImages, ...others];
    await persistIndexes(idx);
    for (const asset of removedAssets) {
      await deleteAssetObjects(asset);
    }
  }

  log(
    `[library-scan] done ${person}: kept=${progress.kept} removed=${progress.removed} ` +
      `wrong=${reasons.wrong_person} text=${reasons.has_text} dup=${reasons.duplicate} heur=${reasons.heuristic}` +
      (progress.removedNumbers.includes(5) || progress.removedNumbers.includes(28)
        ? ` dropped#=${progress.removedNumbers.filter((n) => n === 5 || n === 22 || n === 26 || n === 27 || n === 28).join(",")}`
        : "")
  );
  return progress;
}

export async function scanAllRoyalPeople(params?: {
  dryRun?: boolean;
  people?: string[];
  onProgress?: (msg: string) => void;
}): Promise<ScanRoyalProgress[]> {
  const niche = await loadNicheLibrary(ROYAL_NICHE_SLUG);
  const fromNiche = (niche?.people || [])
    .filter((p) => !String(p.personSlug).startsWith("topic-"))
    .map((p) => p.person);
  const people = params?.people?.length ? params.people : fromNiche.length ? fromNiche : [...ROYAL_PEOPLE];
  const out: ScanRoyalProgress[] = [];
  for (const person of people) {
    try {
      out.push(await scanRoyalPerson({ person, dryRun: params?.dryRun, onProgress: params?.onProgress }));
    } catch (err) {
      params?.onProgress?.(`[library-scan] skip ${person}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return out;
}

void ROYAL_NICHE;
