/**
 * Backfill people[] on classified Royal assets without touching other labels.
 * Phase A: safe text from description. Phase B: vision-only people identification.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getOpenAI } from "../openaiClient.js";
import { config, optionalEnv } from "../config.js";
import { ROYAL_NICHE_SLUG, ROYAL_PEOPLE } from "./describeRoyal.js";
import {
  hasPeopleBackfill,
  normalizePeopleList,
  peopleBackfillTier,
  safeTextPeople,
} from "./royalPeopleText.js";
import { r2Configured, r2GetJson, r2GetObjectBuffer, r2PutJson } from "./r2.js";
import type { LibraryAsset, PersonLibraryIndex } from "./types.js";
import { countLibraryAssets, isRawClipMediaType, slugify } from "./types.js";

const MODEL = optionalEnv("ROYAL_VISION_MODEL") || config.openaiModel || "gpt-5.6-terra";
const BATCH_SIZE = Math.max(1, Math.min(8, Number(process.env.ROYAL_PEOPLE_BATCH || 6)));
const BATCH_CONCURRENCY = Math.max(
  1,
  Math.min(12, Number(process.env.ROYAL_PEOPLE_BATCH_CONCURRENCY || 4))
);
const DEFAULT_WORKERS = Math.max(1, Math.min(25, Number(process.env.ROYAL_PEOPLE_WORKERS || 8)));
const PREVIEW_WIDTH = Math.max(160, Number(process.env.ROYAL_VISION_WIDTH || 320));
const FLUSH_EVERY = Math.max(5, Number(process.env.ROYAL_PEOPLE_FLUSH_EVERY || 24));

export type BackfillRoyalPeopleProgress = {
  person: string;
  personSlug: string;
  textBackfilled: number;
  visionBackfilled: number;
  visionFailed: number;
  primaryOnly: number;
  skipped: number;
};

type ClassificationSnapshot = {
  person: string;
  description?: string;
  peopleType?: string;
  mood?: string;
  shot?: string;
  action?: string;
  context?: string;
  classifiedAt?: string;
  classifyModel?: string;
};

function isBackfillTarget(a: LibraryAsset): boolean {
  return (
    Boolean(a.classifiedAt && a.peopleType && a.mood && a.shot && a.action && a.context) &&
    (a.mediaType === "image" || isRawClipMediaType(a.mediaType))
  );
}

function snapshotClassification(asset: LibraryAsset): ClassificationSnapshot {
  return {
    person: asset.person,
    description: asset.description,
    peopleType: asset.peopleType,
    mood: asset.mood,
    shot: asset.shot,
    action: asset.action,
    context: asset.context,
    classifiedAt: asset.classifiedAt,
    classifyModel: asset.classifyModel,
  };
}

function assertClassificationUnchanged(before: ClassificationSnapshot, asset: LibraryAsset): void {
  const after = snapshotClassification(asset);
  for (const key of Object.keys(before) as Array<keyof ClassificationSnapshot>) {
    if (before[key] !== after[key]) {
      throw new Error(`classification field changed during people backfill: ${key}`);
    }
  }
}

function applyPeopleOnly(asset: LibraryAsset, people: string[], source: "text" | "vision"): boolean {
  const before = snapshotClassification(asset);
  const normalized = normalizePeopleList(people, asset.person);
  asset.people = normalized;
  asset.peopleBackfillAt = new Date().toISOString();
  asset.peopleBackfillSource = source;
  assertClassificationUnchanged(before, asset);
  return normalized.length <= 1;
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
  const tmpIn = path.join(os.tmpdir(), `ppl-in-${process.pid}-${Date.now()}${extHint}`);
  const tmpOut = path.join(os.tmpdir(), `ppl-out-${process.pid}-${Date.now()}.jpg`);
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
  if (asset.mediaType === "image") {
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
  if (asset.thumbKey) {
    const { body } = await r2GetObjectBuffer(asset.thumbKey);
    return { b64: toJpegPreview(body, ".jpg").toString("base64"), mime: "image/jpeg" };
  }
  const { body } = await r2GetObjectBuffer(asset.r2Key);
  const ffmpeg = findFfmpeg();
  const ext = /\.webm$/i.test(asset.r2Key) ? ".webm" : /\.mov$/i.test(asset.r2Key) ? ".mov" : ".mp4";
  const tmpIn = path.join(os.tmpdir(), `ppl-vid-${process.pid}-${Date.now()}${ext}`);
  const tmpOut = path.join(os.tmpdir(), `ppl-vid-out-${process.pid}-${Date.now()}.jpg`);
  try {
    fs.writeFileSync(tmpIn, body);
    spawnSync(ffmpeg, ["-y", "-ss", "0.4", "-i", tmpIn, "-frames:v", "1", "-q:v", "4", tmpOut], {
      encoding: "utf8",
    });
    const frame = fs.readFileSync(tmpOut);
    return { b64: toJpegPreview(frame, ".jpg").toString("base64"), mime: "image/jpeg" };
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

async function visionPeopleBatch(
  folderPerson: string,
  assets: LibraryAsset[]
): Promise<Map<string, string[]>> {
  const openai = getOpenAI();
  const visuals = await Promise.all(
    assets.map(async (a) => {
      const v = await loadVisualJpeg(a);
      return { asset: a, ...v };
    })
  );

  const roster = ROYAL_PEOPLE.join(", ");
  const hints = assets
    .map((a, i) => {
      const desc = (a.description || "").slice(0, 100);
      return `image ${i}: folderPerson="${folderPerson}" peopleType=${a.peopleType} description="${desc}"`;
    })
    .join("\n");

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `Identify ONLY clearly visible important people for a UK Royal Family documentary asset library.

Folder primary person (MUST be first in array): "${folderPerson}".

Allowed full names only from this roster:
${roster}

Rules:
- Return people[] for each image (index 0 .. ${visuals.length - 1})
- ALWAYS include folder primary person first
- Add another person ONLY if clearly identifiable with high confidence
- NEVER guess — if unsure, return only the folder person
- Do NOT classify mood, shot, action, or rewrite descriptions

Hints (may help, trust pixels):
${hints}

Return JSON only:
{"items":[{"index":0,"people":["${folderPerson}"]}]}`,
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
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You identify visible royals for people[] backfill only. Return strict JSON. Never guess identities.",
      },
      { role: "user", content },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: { items?: Array<{ index?: number; people?: string[] }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON from people vision backfill");
  }

  const out = new Map<string, string[]>();
  for (let i = 0; i < assets.length; i++) {
    const row = parsed.items?.find((x) => x.index === i) || parsed.items?.[i] || {};
    out.set(assets[i].assetId, normalizePeopleList(row.people, folderPerson));
  }
  return out;
}

async function persistPerson(idx: PersonLibraryIndex): Promise<void> {
  idx.updatedAt = new Date().toISOString();
  idx.counts = countLibraryAssets(idx.assets);
  await r2PutJson(`library/${ROYAL_NICHE_SLUG}/${idx.personSlug}/index.json`, idx);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const workers = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let next = 0;
  const runWorker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: workers }, () => runWorker()));
  return results;
}

export async function backfillRoyalPeoplePerson(params: {
  person: string;
  force?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<BackfillRoyalPeopleProgress> {
  if (!r2Configured()) throw new Error("R2 not configured");
  const person = params.person;
  const personSlug = slugify(person);
  const force = Boolean(params.force);
  const log = params.onProgress || console.log;

  const idx = await r2GetJson<PersonLibraryIndex>(
    `library/${ROYAL_NICHE_SLUG}/${personSlug}/index.json`
  );
  if (!idx?.assets?.length) throw new Error(`Person library missing: ${person}`);

  const progress: BackfillRoyalPeopleProgress = {
    person,
    personSlug,
    textBackfilled: 0,
    visionBackfilled: 0,
    visionFailed: 0,
    primaryOnly: 0,
    skipped: 0,
  };

  const byId = new Map(idx.assets.map((a) => [a.assetId, a]));
  const targets = idx.assets.filter((a) => isBackfillTarget(a));
  progress.skipped = targets.filter((a) => hasPeopleBackfill(a) && !force).length;

  const textTodo = targets.filter((a) => {
    if (hasPeopleBackfill(a) && !force) return false;
    return peopleBackfillTier(a) === "safe_text";
  });
  log(`[people-backfill] ${person}: phase A text todo=${textTodo.length}`);
  let sinceFlush = 0;
  for (const asset of textTodo) {
    const live = byId.get(asset.assetId);
    if (!live) continue;
    const people = safeTextPeople(live);
    if (!people?.length) continue;
    const primaryOnly = applyPeopleOnly(live, people, "text");
    progress.textBackfilled += 1;
    if (primaryOnly) progress.primaryOnly += 1;
    sinceFlush += 1;
    if (sinceFlush >= FLUSH_EVERY) {
      idx.assets = [...byId.values()];
      await persistPerson(idx);
      sinceFlush = 0;
    }
  }

  const visionTodo = targets.filter((a) => {
    const live = byId.get(a.assetId);
    if (!live) return false;
    if (hasPeopleBackfill(live) && !force) return false;
    return true;
  });
  log(`[people-backfill] ${person}: phase B vision todo=${visionTodo.length}`);
  const batches = chunk(visionTodo, BATCH_SIZE);
  for (const batchGroup of chunk(batches, BATCH_CONCURRENCY)) {
    const groupResults = await Promise.all(
      batchGroup.map(async (batch) => {
        try {
          return { batch, map: await visionPeopleBatch(person, batch), err: null as string | null };
        } catch (err) {
          return {
            batch,
            map: null as Map<string, string[]> | null,
            err: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    for (const { batch, map, err } of groupResults) {
      if (err || !map) {
        progress.visionFailed += batch.length;
        log(`[people-backfill] vision batch failed ${person}: ${err || "empty"}`);
        continue;
      }
      for (const asset of batch) {
        const live = byId.get(asset.assetId);
        const people = map.get(asset.assetId);
        if (!live || !people?.length) {
          progress.visionFailed += 1;
          continue;
        }
        const primaryOnly = applyPeopleOnly(live, people, "vision");
        progress.visionBackfilled += 1;
        if (primaryOnly) progress.primaryOnly += 1;
        sinceFlush += 1;
      }
    }
    if (sinceFlush >= FLUSH_EVERY) {
      idx.assets = [...byId.values()];
      await persistPerson(idx);
      sinceFlush = 0;
      log(
        `[people-backfill] flushed ${person} text=${progress.textBackfilled} vision=${progress.visionBackfilled}`
      );
    }
  }

  idx.assets = [...byId.values()];
  await persistPerson(idx);
  log(
    `[people-backfill] done ${person}: text=${progress.textBackfilled} vision=${progress.visionBackfilled} failed=${progress.visionFailed} primaryOnly=${progress.primaryOnly}`
  );
  return progress;
}

export async function backfillAllRoyalPeople(params?: {
  force?: boolean;
  people?: string[];
  workers?: number;
  onProgress?: (msg: string) => void;
}): Promise<BackfillRoyalPeopleProgress[]> {
  const list = params?.people?.length ? params.people : ([...ROYAL_PEOPLE] as unknown as string[]);
  const workers = Math.max(1, Math.min(25, Number(params?.workers || DEFAULT_WORKERS)));
  const log = params?.onProgress || console.log;
  log(`[people-backfill] starting ${list.length} people workers=${workers}`);
  return runPool(list, workers, async (person) => {
    try {
      return await backfillRoyalPeoplePerson({ person, force: params?.force, onProgress: log });
    } catch (err) {
      log(`[people-backfill] skip ${person}: ${err instanceof Error ? err.message : err}`);
      return {
        person,
        personSlug: slugify(person),
        textBackfilled: 0,
        visionBackfilled: 0,
        visionFailed: 0,
        primaryOnly: 0,
        skipped: 0,
      } satisfies BackfillRoyalPeopleProgress;
    }
  });
}

export async function auditRoyalPeopleBackfill(): Promise<{
  total: number;
  withPeople: number;
  textSource: number;
  visionSource: number;
  primaryOnly: number;
  missing: number;
}> {
  let total = 0;
  let withPeople = 0;
  let textSource = 0;
  let visionSource = 0;
  let primaryOnly = 0;
  for (const person of ROYAL_PEOPLE) {
    const idx = await r2GetJson<PersonLibraryIndex>(
      `library/${ROYAL_NICHE_SLUG}/${slugify(person)}/index.json`
    );
    if (!idx?.assets) continue;
    for (const a of idx.assets) {
      if (!isBackfillTarget(a)) continue;
      total += 1;
      if (a.people?.length) {
        withPeople += 1;
        if (a.peopleBackfillSource === "text") textSource += 1;
        if (a.peopleBackfillSource === "vision") visionSource += 1;
        if (a.people.length <= 1) primaryOnly += 1;
      }
    }
  }
  return { total, withPeople, textSource, visionSource, primaryOnly, missing: total - withPeople };
}
