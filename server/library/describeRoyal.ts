/**
 * Vision-describe Royal Family library stills — short unique captions matching
 * existing Media Library style (gpt-5.6-terra one-liners), additive only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getOpenAI } from "../openaiClient.js";
import { config, optionalEnv } from "../config.js";
import { r2Configured, r2GetJson, r2GetObjectBuffer, r2PutJson } from "./r2.js";
import type { LibraryAsset, NicheLibraryIndex, PersonLibraryIndex } from "./types.js";
import { countLibraryAssets, slugify } from "./types.js";

export const ROYAL_NICHE = "Royal Family";
export const ROYAL_NICHE_SLUG = "royal-family";

const MODEL = optionalEnv("ROYAL_VISION_MODEL") || config.openaiModel || "gpt-5.6-terra";
const BATCH_SIZE = Math.max(1, Math.min(12, Number(process.env.ROYAL_VISION_BATCH || 8)));
const PREVIEW_WIDTH = Math.max(128, Number(process.env.ROYAL_VISION_WIDTH || 256));
const FLUSH_EVERY = Math.max(5, Number(process.env.ROYAL_VISION_FLUSH_EVERY || 24));

export type DescribeRoyalProgress = {
  person: string;
  personSlug: string;
  examined: number;
  described: number;
  skipped: number;
  failed: number;
  wrongPerson: number;
};

function needsDescription(a: LibraryAsset, force: boolean): boolean {
  if (a.mediaType !== "image") return false;
  if (force) return true;
  if (a.visionDescribedAt && String(a.visionModel || "").trim()) {
    const desc = String(a.description || "");
    // Keep existing good vision captions; redo template collect strings
    if (desc && !/collected for documentary/i.test(desc) && desc.length >= 20) return false;
  }
  return true;
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
  if (input.byteLength <= 120_000) return input;
  const ffmpeg = findFfmpeg();
  const tmpIn = path.join(
    os.tmpdir(),
    `royal-in-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${extHint}`
  );
  const tmpOut = path.join(
    os.tmpdir(),
    `royal-out-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
  );
  try {
    fs.writeFileSync(tmpIn, input);
    const res = spawnSync(
      ffmpeg,
      [
        "-y",
        "-i",
        tmpIn,
        "-vf",
        `scale='min(${PREVIEW_WIDTH},iw)':-2`,
        "-q:v",
        "10",
        "-frames:v",
        "1",
        tmpOut,
      ],
      { encoding: "utf8" }
    );
    if (res.status !== 0 || !fs.existsSync(tmpOut)) {
      if (input.length < 400_000) return input;
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

type VisionItem = {
  index: number;
  isPerson: boolean;
  description: string;
};

async function describeBatch(person: string, assets: LibraryAsset[]): Promise<Map<string, VisionItem>> {
  const openai = getOpenAI();
  const visuals = await Promise.all(
    assets.map(async (a) => {
      const v = await loadVisualJpeg(a);
      return { asset: a, ...v };
    })
  );

  const hintLines = assets
    .map((a, i) => {
      const q = (a.queryUsed || "").slice(0, 90);
      const t = (a.title || "").slice(0, 90);
      return `image ${i}: googleTitle="${t}" queryHint="${q}"`;
    })
    .join("\n");

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `Royal documentary library person folder: "${person}".

For EACH image (image 0 .. ${visuals.length - 1}):
1) isPerson: true only if ${person} (or clearly the same royal) is visibly present as a main subject. false for landscapes, buildings, crowds without them, wrong celebrities, or unrelated stock.
2) description: ONE short unique sentence (8–22 words), lowercase style like "king charles smiling in a blue suit outdoors". Name the person, setting, action, distinctive detail. Do not invent names on clothing. Do not copy Google titles. If isPerson=false, still describe what is visible briefly and start with "unrelated:".

Do NOT reuse the same sentence stem across images in this batch.
Hints (may be wrong — trust the pixels):
${hintLines}

Return JSON only:
{"items":[{"index":0,"isPerson":true,"description":"short unique caption"}]}`,
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
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You write short unique royal-person photo captions for a documentary media library. Return strict JSON only.",
      },
      { role: "user", content },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: { items?: Array<{ index?: number; isPerson?: boolean; description?: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON from vision model");
  }

  const out = new Map<string, VisionItem>();
  for (let i = 0; i < assets.length; i++) {
    const row =
      parsed.items?.find((x) => x.index === i) ||
      parsed.items?.[i] ||
      ({ description: "", isPerson: false } as { index?: number; isPerson?: boolean; description?: string });
    let description = String(row.description || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\s+/g, " ");
    if (description.length < 12) {
      description = `${person.toLowerCase()} documentary still ${assets[i].number}`;
    }
    out.set(assets[i].assetId, {
      index: i,
      isPerson: Boolean(row.isPerson),
      description,
    });
  }
  return out;
}

async function persistPerson(idx: PersonLibraryIndex): Promise<void> {
  const images = idx.assets.filter((a) => a.mediaType === "image");
  idx.updatedAt = new Date().toISOString();
  idx.counts = countLibraryAssets(idx.assets);
  await r2PutJson(`library/${ROYAL_NICHE_SLUG}/${idx.personSlug}/index.json`, idx);
  await r2PutJson(`library/${ROYAL_NICHE_SLUG}/${idx.personSlug}/manifest.json`, {
    person: idx.person,
    personSlug: idx.personSlug,
    niche: idx.niche,
    nicheSlug: idx.nicheSlug,
    imageCount: idx.counts.images,
    assets: images.map((a) => ({
      assetId: a.assetId,
      number: a.number,
      category: a.category,
      r2Key: a.r2Key,
      description: a.description,
      visionDescribedAt: a.visionDescribedAt,
      visionModel: a.visionModel,
    })),
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Describe images for one royal person. Additive — never deletes assets. */
export async function describeRoyalPerson(params: {
  person: string;
  force?: boolean;
  limit?: number;
  onProgress?: (msg: string) => void;
}): Promise<DescribeRoyalProgress> {
  if (!r2Configured()) throw new Error("R2 not configured");
  const person = params.person;
  const personSlug = slugify(person);
  const force = Boolean(params.force);
  const limit = Math.max(0, Number(params.limit || 0));
  const log = params.onProgress || console.log;

  const idx = await r2GetJson<PersonLibraryIndex>(
    `library/${ROYAL_NICHE_SLUG}/${personSlug}/index.json`
  );
  if (!idx?.assets?.length) {
    throw new Error(`Person library missing: ${person}`);
  }

  let todo = idx.assets.filter((a) => needsDescription(a, force));
  if (limit > 0) todo = todo.slice(0, limit);

  const progress: DescribeRoyalProgress = {
    person,
    personSlug,
    examined: todo.length,
    described: 0,
    skipped: idx.assets.filter((a) => a.mediaType === "image" && !needsDescription(a, force)).length,
    failed: 0,
    wrongPerson: 0,
  };

  log(`[royal-vision] ${person}: todo=${todo.length} skipped=${progress.skipped} model=${MODEL}`);
  let sinceFlush = 0;
  const byId = new Map(idx.assets.map((a) => [a.assetId, a]));

  for (const batch of chunk(todo, BATCH_SIZE)) {
    try {
      const results = await describeBatch(person, batch);
      for (const asset of batch) {
        const row = results.get(asset.assetId);
        const live = byId.get(asset.assetId);
        if (!row || !live) {
          progress.failed += 1;
          continue;
        }
        live.description = row.description;
        live.visionDescribedAt = new Date().toISOString();
        live.visionModel = MODEL;
        if (!row.isPerson) {
          progress.wrongPerson += 1;
          // Keep asset (do not delete) but mark clearly for editors
          if (!/^unrelated:/i.test(live.description)) {
            live.description = `unrelated: ${live.description}`;
          }
        } else {
          progress.described += 1;
        }
        sinceFlush += 1;
      }
      if (sinceFlush >= FLUSH_EVERY) {
        idx.assets = [...byId.values()];
        await persistPerson(idx);
        sinceFlush = 0;
        log(`[royal-vision] flushed ${person} described=${progress.described} wrong=${progress.wrongPerson}`);
      }
    } catch (err) {
      progress.failed += batch.length;
      log(`[royal-vision] batch failed ${person}: ${err instanceof Error ? err.message : err}`);
    }
  }

  idx.assets = [...byId.values()];
  await persistPerson(idx);
  log(
    `[royal-vision] done ${person}: described=${progress.described} wrong=${progress.wrongPerson} failed=${progress.failed}`
  );
  return progress;
}

export const ROYAL_PEOPLE = [
  "King Charles",
  "Queen Camilla",
  "Prince William",
  "Princess Catherine",
  "Prince George",
  "Princess Charlotte",
  "Prince Louis",
  "Prince Harry",
  "Meghan Markle",
  "Princess Diana",
  "Frances Shand Kydd",
  "Lady Sarah McCorquodale",
  "Lady Jane Fellowes",
  "Charles Spencer",
  "Princess Anne",
  "Sir Timothy Laurence",
  "Prince Edward",
  "Sophie Duchess of Edinburgh",
  "Prince Andrew",
  "Sarah Ferguson",
  "Princess Beatrice",
  "Princess Eugenie",
  "Zara Tindall",
  "Laura Lopes",
] as const;

/** Sequential describe for all known royal people. */
export async function describeAllRoyalPeople(params?: {
  force?: boolean;
  limitPerPerson?: number;
  onProgress?: (msg: string) => void;
}): Promise<DescribeRoyalProgress[]> {
  const out: DescribeRoyalProgress[] = [];
  for (const person of ROYAL_PEOPLE) {
    try {
      out.push(
        await describeRoyalPerson({
          person,
          force: params?.force,
          limit: params?.limitPerPerson,
          onProgress: params?.onProgress,
        })
      );
    } catch (err) {
      params?.onProgress?.(
        `[royal-vision] skip ${person}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  return out;
}

export async function loadRoyalNiche(): Promise<NicheLibraryIndex | null> {
  return r2GetJson<NicheLibraryIndex>(`library/${ROYAL_NICHE_SLUG}/index.json`);
}
