import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { config, ROOT_DIR } from "../config.js";
import { getOpenAI } from "../openaiClient.js";
import { writeJson, readJson } from "../storage.js";
import { deletePersonLibraryAssets } from "./deleteAssets.js";
import { loadNicheLibrary, loadPersonLibrary } from "./collectImages.js";
import { r2Configured, r2GetObjectBuffer } from "./r2.js";
import type { LibraryAsset } from "./types.js";

export const ROYAL_PRUNE_NICHE_SLUG = "royal-family";
const BATCH = 6;
const CONCURRENCY = 4;
export const MAX_SOLO_PORTRAITS = 5;

/** High-profile royals: cap solo headshots, keep iconic group/action shots only. */
export const ROYAL_ICONIC_PRUNE_TEN = [
  "prince-louis",
  "prince-george",
  "princess-charlotte",
  "sir-timothy-laurence",
  "princess-eugenie",
  "prince-edward",
  "sophie-duchess-of-edinburgh",
  "prince-andrew",
  "zara-tindall",
  "laura-lopes",
] as const;

export type RoyalPruneOptions = {
  execute: boolean;
  minImages: number;
  personSlug?: string;
  personSlugs?: string[];
  limit?: number;
  maxSoloPortraits?: number;
};

export type PersonPruneResult = {
  person: string;
  personSlug: string;
  before: number;
  after: number;
  deleted: number;
  stats?: Record<string, number>;
};

export type RoyalPruneJobStatus = {
  jobId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  options: RoyalPruneOptions;
  currentPerson?: string;
  completedPeople: number;
  totalPeople: number;
  summary: PersonPruneResult[];
  error?: string;
};

type StillKind = "multi_person" | "solo_action" | "solo_portrait" | "wrong_person" | "junk";

type StillJudge = {
  index: number;
  kind: StillKind;
  keep: boolean;
  portrait_quality?: number;
  iconic_score?: number;
  reason?: string;
};

const jobs = new Map<string, RoyalPruneJobStatus>();

function jobPath(jobId: string): string {
  return path.join(config.dataPath, "royal-prune-jobs", `${jobId}.json`);
}

async function persistJob(job: RoyalPruneJobStatus): Promise<void> {
  jobs.set(job.jobId, job);
  await writeJson(jobPath(job.jobId), job);
}

export async function getRoyalPruneJob(jobId: string): Promise<RoyalPruneJobStatus | null> {
  const mem = jobs.get(jobId);
  if (mem) return mem;
  return readJson<RoyalPruneJobStatus>(jobPath(jobId));
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${code}: ${err.slice(-400)}`))
    );
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, i: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker())
  );
  return out;
}

async function previewForVision(body: Buffer, r2Key: string): Promise<{ b64: string; mime: string } | null> {
  const lower = r2Key.toLowerCase();
  const ext = lower.endsWith(".png") ? "png" : lower.endsWith(".webp") ? "webp" : "jpg";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  if (body.length <= 900_000) {
    return { b64: body.toString("base64"), mime };
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "royal-prune-"));
  try {
    const inPath = path.join(tmp, `in.${ext}`);
    const outPath = path.join(tmp, "out.jpg");
    await fs.writeFile(inPath, body);
    await run("ffmpeg", ["-y", "-i", inPath, "-vf", "scale=640:-1", "-q:v", "8", outPath]);
    const out = await fs.readFile(outPath);
    return { b64: out.toString("base64"), mime: "image/jpeg" };
  } catch {
    return null;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function judgeStillBatch(
  person: string,
  items: Array<{ assetId: string; b64: string; mime: string }>
): Promise<StillJudge[]> {
  if (!items.length) return [];
  const openai = getOpenAI();
  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" } }
  > = [
    {
      type: "text",
      text: `British royal documentary STILL photo QA for person: ${person}.
Viewers expect high-quality, varied footage — not repetitive solo headshots.

Classify each image (in order):

kind:
- multi_person: another adult clearly visible with the named person (group, couple, family, officials).
- solo_action: ONLY the named person visible BUT clear public action (wave, speech, walkabout, arrival, ceremony, salute).
- solo_portrait: ONLY the named person, static portrait/headshot/standing alone — repetitive solo spam.
- wrong_person: main face is NOT ${person}.
- junk: watermark, meme text, thumbnail graphic, unusable blur.

Scores (0-100):
- portrait_quality: for solo_portrait — iconic documentary usefulness (lighting, expression, framing).
- iconic_score: for multi_person and solo_action — would this still look strong in a royal documentary? Penalize blurry, awkward, duplicate paparazzi, tiny face, bad crop.

keep rules:
- wrong_person, junk: keep=false.
- solo_portrait: keep=true only for the best candidates (we cap to 5 in code); still score portrait_quality.
- multi_person / solo_action: keep=true only if iconic_score >= 55 and genuinely usable; else keep=false.
- Be strict on boring duplicate solo portraits — keep=false when kind=solo_portrait unless top-tier.

Return JSON:
{"results":[{"index":0,"kind":"multi_person","keep":true,"portrait_quality":0,"iconic_score":72,"reason":"..."}]}

If unsure solo_action vs solo_portrait, prefer solo_action when there is clear action.
Speech/wave/formal ceremony solo = solo_action NOT solo_portrait.`,
    },
  ];

  for (let i = 0; i < items.length; i++) {
    content.push({ type: "text", text: `Image ${i}: assetId=${items[i].assetId}` });
    content.push({
      type: "image_url",
      image_url: { url: `data:${items[i].mime};base64,${items[i].b64}`, detail: "low" },
    });
  }

  const response = await openai.chat.completions.create({
    model: process.env.ROYAL_PRUNE_VISION_MODEL?.trim() || config.openaiModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Strict JSON. Remove solo portrait spam; never delete clear group or action shots.",
      },
      { role: "user", content },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: { results?: StillJudge[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return items.map((_, index) => ({
      index,
      kind: "solo_portrait" as const,
      keep: true,
      reason: "parse_failed_keep",
    }));
  }

  return items.map((_, index) => {
    const row = parsed.results?.find((r) => r.index === index) || parsed.results?.[index];
    if (!row) {
      return { index, kind: "solo_portrait" as const, keep: true, reason: "missing_row_keep" };
    }
    const iconic =
      typeof row.iconic_score === "number"
        ? row.iconic_score
        : typeof row.portrait_quality === "number"
          ? row.portrait_quality
          : 50;
    return {
      index,
      kind: (row.kind || "solo_portrait") as StillKind,
      keep: Boolean(row.keep),
      portrait_quality: typeof row.portrait_quality === "number" ? row.portrait_quality : iconic,
      iconic_score: iconic,
      reason: String(row.reason || ""),
    };
  });
}

function filterPruneTargets(
  people: Array<{ personSlug: string; images: number }>,
  options: RoyalPruneOptions
) {
  if (options.personSlug) {
    const row = people.filter((p) => p.personSlug === options.personSlug);
    if (!row.length) throw new Error(`Person not found: ${options.personSlug}`);
    return row;
  }
  if (options.personSlugs?.length) {
    const want = new Set(options.personSlugs.map((s) => s.trim().toLowerCase()).filter(Boolean));
    const row = people.filter((p) => want.has(p.personSlug));
    if (!row.length) throw new Error(`No matching people for slugs: ${[...want].join(", ")}`);
    return row;
  }
  return people.filter((p) => p.images >= options.minImages);
}

function decideDeletes(
  assets: LibraryAsset[],
  judges: Map<string, StillJudge>,
  maxSolo: number
): { deleteIds: string[]; stats: Record<string, number> } {
  const stats: Record<string, number> = {
    multi_person: 0,
    solo_action: 0,
    solo_portrait: 0,
    wrong_person: 0,
    junk: 0,
    solo_portrait_kept: 0,
    solo_portrait_dropped: 0,
    missing_judge_keep: 0,
  };

  const deleteIds = new Set<string>();
  const soloPortraits: Array<{ asset: LibraryAsset; quality: number }> = [];

  for (const asset of assets) {
    const j = judges.get(asset.assetId);
    if (!j) {
      stats.missing_judge_keep++;
      continue;
    }
    stats[j.kind] = (stats[j.kind] || 0) + 1;

    if (j.kind === "wrong_person" || j.kind === "junk") {
      if (!j.keep) deleteIds.add(asset.assetId);
      continue;
    }
    if (j.kind === "multi_person" || j.kind === "solo_action") {
      if (!j.keep) deleteIds.add(asset.assetId);
      continue;
    }
    if (j.kind === "solo_portrait") {
      if (!j.keep) {
        stats.solo_portrait_dropped++;
        deleteIds.add(asset.assetId);
        continue;
      }
      soloPortraits.push({ asset, quality: j.portrait_quality ?? 50 });
    }
  }

  soloPortraits.sort(
    (a, b) =>
      b.quality - a.quality ||
      (b.asset.width || 0) * (b.asset.height || 0) - (a.asset.width || 0) * (a.asset.height || 0)
  );
  soloPortraits.forEach((row, i) => {
    if (i < maxSolo) stats.solo_portrait_kept++;
    else {
      stats.solo_portrait_dropped++;
      deleteIds.add(row.asset.assetId);
    }
  });

  return { deleteIds: [...deleteIds], stats };
}

export async function pruneRoyalPersonImages(
  personSlug: string,
  options: Pick<RoyalPruneOptions, "execute" | "limit" | "maxSoloPortraits">
): Promise<PersonPruneResult> {
  const maxSolo = options.maxSoloPortraits ?? MAX_SOLO_PORTRAITS;
  const idx = await loadPersonLibrary(ROYAL_PRUNE_NICHE_SLUG, personSlug);
  if (!idx) throw new Error(`Missing person index: ${personSlug}`);

  let images = idx.assets.filter((a) => a.mediaType === "image");
  if (options.limit && options.limit > 0) images = images.slice(0, options.limit);

  const loaded = await mapPool(images, 16, async (asset) => {
    try {
      const { body } = await r2GetObjectBuffer(asset.r2Key);
      const preview = await previewForVision(body, asset.r2Key);
      if (!preview) return null;
      return { asset, ...preview };
    } catch {
      return null;
    }
  });

  const usable = loaded.filter(Boolean) as Array<{ asset: LibraryAsset; b64: string; mime: string }>;
  const judges = new Map<string, StillJudge>();

  const batches: typeof usable[] = [];
  for (let i = 0; i < usable.length; i += BATCH) batches.push(usable.slice(i, i + BATCH));

  await mapPool(batches, CONCURRENCY, async (batch) => {
    try {
      const results = await judgeStillBatch(idx.person, batch);
      for (let i = 0; i < batch.length; i++) {
        judges.set(batch[i].asset.assetId, results[i]);
      }
    } catch (err) {
      console.warn("[prune]", idx.person, err instanceof Error ? err.message : err);
      for (const row of batch) {
        judges.set(row.asset.assetId, {
          index: 0,
          kind: "solo_portrait",
          keep: true,
          reason: "vision_error_keep",
        });
      }
    }
  });

  for (const asset of images) {
    if (!judges.has(asset.assetId)) {
      judges.set(asset.assetId, {
        index: 0,
        kind: "solo_portrait",
        keep: true,
        reason: "no_preview_keep",
      });
    }
  }

  const { deleteIds, stats } = decideDeletes(images, judges, maxSolo);
  console.log(`[prune] ${idx.person}: would delete ${deleteIds.length}/${images.length}`, stats);

  if (options.execute && deleteIds.length) {
    for (let i = 0; i < deleteIds.length; i += 200) {
      await deletePersonLibraryAssets(ROYAL_PRUNE_NICHE_SLUG, personSlug, deleteIds.slice(i, i + 200));
    }
  }

  return {
    person: idx.person,
    personSlug,
    before: images.length,
    after: images.length - deleteIds.length,
    deleted: deleteIds.length,
    stats,
  };
}

export async function runRoyalSolePortraitPrune(options: RoyalPruneOptions): Promise<PersonPruneResult[]> {
  if (!r2Configured()) throw new Error("R2 not configured");

  const niche = await loadNicheLibrary(ROYAL_PRUNE_NICHE_SLUG);
  if (!niche) throw new Error("Royal niche index missing");

  const targets = filterPruneTargets(niche.people, options);

  const summary: PersonPruneResult[] = [];
  for (const row of targets) {
    summary.push(
      await pruneRoyalPersonImages(row.personSlug, {
        execute: options.execute,
        limit: options.limit,
        maxSoloPortraits: options.maxSoloPortraits,
      })
    );
  }

  const outPath = path.join(ROOT_DIR, "storage", "prune-royal-sole-portraits-summary.json");
  await writeJson(outPath, { at: new Date().toISOString(), options, summary });
  return summary;
}

export function startRoyalPruneJob(options: RoyalPruneOptions): RoyalPruneJobStatus {
  const jobId = randomUUID();
  const job: RoyalPruneJobStatus = {
    jobId,
    status: "running",
    startedAt: new Date().toISOString(),
    options,
    completedPeople: 0,
    totalPeople: 0,
    summary: [],
  };
  void (async () => {
    try {
      await persistJob(job);
      const niche = await loadNicheLibrary(ROYAL_PRUNE_NICHE_SLUG);
      if (!niche) throw new Error("Royal niche index missing");
      const targets = filterPruneTargets(niche.people, options);
      job.totalPeople = targets.length;
      await persistJob(job);

      for (const row of targets) {
        job.currentPerson = row.person;
        await persistJob(job);
        const result = await pruneRoyalPersonImages(row.personSlug, {
          execute: options.execute,
          limit: options.limit,
          maxSoloPortraits: options.maxSoloPortraits,
        });
        job.summary.push(result);
        job.completedPeople++;
        await persistJob(job);
      }
      job.status = "completed";
      job.finishedAt = new Date().toISOString();
      job.currentPerson = undefined;
      await persistJob(job);
      await writeJson(path.join(ROOT_DIR, "storage", "prune-royal-sole-portraits-summary.json"), {
        at: job.finishedAt,
        jobId,
        options,
        summary: job.summary,
      });
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = new Date().toISOString();
      await persistJob(job);
    }
  })();

  jobs.set(jobId, job);
  return job;
}
