/**
 * Cheap vision-describe for War library — detailed UNIQUE captions via gpt-5.4-mini.
 *
 * Cost model (ContactBox ≈ OpenAI list for gpt-5.4-mini):
 *   input $0.75 / 1M · cached $0.075 / 1M · output $4.50 / 1M
 *   detail:low + 256px JPEG previews keep image tokens tiny.
 *
 * Expected: ~$0.0005–$0.0015 / image → ~$8–$25 for ~15.5k images.
 * Hard budget default $30.
 *
 * Usage:
 *   npx tsx --env-file=.env --env-file=.env.library scripts/describe-war-library.ts
 *   WAR_VISION_BUDGET_USD=30 WAR_VISION_CONCURRENCY=5 WAR_VISION_BATCH=8 npx tsx ...
 *   WAR_VISION_LIMIT=50 npx tsx ...   # smoke
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getOpenAI } from "../server/openaiClient.js";
import { ROOT_DIR } from "../server/config.js";
import { r2Configured, r2GetJson, r2GetObjectBuffer, r2PutJson } from "../server/library/r2.js";
import type { LibraryAsset, NicheLibraryIndex, PersonLibraryIndex } from "../server/library/types.js";
import { slugify } from "../server/library/types.js";

const NICHE_SLUG = "war";
const MODEL = process.env.WAR_VISION_MODEL?.trim() || "gpt-5.4-mini";
const BATCH_SIZE = Math.max(1, Math.min(16, Number(process.env.WAR_VISION_BATCH || 12)));
const CONCURRENCY = Math.max(1, Number(process.env.WAR_VISION_CONCURRENCY || 10));
/** How many topic folders to describe in parallel */
const PERSON_CONCURRENCY = Math.max(1, Number(process.env.WAR_VISION_PERSON_CONCURRENCY || 4));
const FLUSH_EVERY = Math.max(5, Number(process.env.WAR_VISION_FLUSH_EVERY || 48));
const FORCE = process.env.WAR_VISION_FORCE === "1";
const BUDGET_USD = Number(process.env.WAR_VISION_BUDGET_USD || 30);
const PREVIEW_WIDTH = Number(process.env.WAR_VISION_WIDTH || 192);
const LIMIT = Math.max(0, Number(process.env.WAR_VISION_LIMIT || 0));
const PROGRESS_PATH = path.join(ROOT_DIR, "storage", "war-vision-progress.json");

/** gpt-5.4-mini OpenAI list rates (ContactBox billed similarly). */
const RATE_IN = 0.75;
const RATE_CACHE = 0.075;
const RATE_OUT = 4.5;

type VisionResult = { description: string; tags: string[]; useFor: string };

type Progress = {
  done: Record<string, true>;
  failed: Record<string, string>;
  updatedAt: string;
  described: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  spentUsd: number;
  stoppedForBudget?: boolean;
};

class BudgetExceededError extends Error {
  constructor(spent: number) {
    super(`Budget cap reached: spent~$${spent.toFixed(2)} >= $${BUDGET_USD}`);
    this.name = "BudgetExceededError";
  }
}

function loadProgress(): Progress {
  try {
    if (fs.existsSync(PROGRESS_PATH)) {
      const p = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8")) as Progress;
      p.promptTokens = p.promptTokens || 0;
      p.cachedTokens = p.cachedTokens || 0;
      p.completionTokens = p.completionTokens || 0;
      p.spentUsd = p.spentUsd || 0;
      p.done = p.done || {};
      p.failed = p.failed || {};
      return p;
    }
  } catch {
    /* ignore */
  }
  return {
    done: {},
    failed: {},
    updatedAt: new Date().toISOString(),
    described: 0,
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    spentUsd: 0,
  };
}

function saveProgress(p: Progress): void {
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  p.updatedAt = new Date().toISOString();
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p), "utf8");
}

function calcSpend(prompt: number, cached: number, completion: number): number {
  const fresh = Math.max(0, prompt - cached);
  return (fresh / 1e6) * RATE_IN + (cached / 1e6) * RATE_CACHE + (completion / 1e6) * RATE_OUT;
}

function needsDescription(a: LibraryAsset): boolean {
  if (a.mediaType !== "image") return false;
  if (FORCE) return true;
  const desc = String(a.description || "");
  // Re-do if missing usage line so Media Library shows what it's for
  if (a.visionDescribedAt && String(a.visionModel || "").includes("detailed") && /use for:/i.test(desc)) {
    return false;
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
  // Skip ffmpeg when already small enough — biggest speed win
  if (input.byteLength <= 90_000) return input;
  const ffmpeg = findFfmpeg();
  const tmpIn = path.join(
    os.tmpdir(),
    `war-in-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${extHint}`
  );
  const tmpOut = path.join(
    os.tmpdir(),
    `war-out-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
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
        "12",
        "-frames:v",
        "1",
        tmpOut,
      ],
      { encoding: "utf8" }
    );
    if (res.status !== 0 || !fs.existsSync(tmpOut)) {
      if (input.length < 350_000) return input;
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
  const ext = /\.png$/i.test(asset.r2Key) || contentType?.includes("png")
    ? ".png"
    : /\.webp$/i.test(asset.r2Key) || contentType?.includes("webp")
      ? ".webp"
      : ".jpg";
  const jpeg = toJpegPreview(body, ext);
  return { b64: jpeg.toString("base64"), mime: "image/jpeg" };
}

async function describeBatch(
  topic: string,
  group: string,
  tags: string[],
  assets: LibraryAsset[],
  progress: Progress
): Promise<Map<string, VisionResult>> {
  if (progress.spentUsd >= BUDGET_USD) throw new BudgetExceededError(progress.spentUsd);

  const openai = getOpenAI();
  const visuals = await Promise.all(
    assets.map(async (a) => {
      const v = await loadVisualJpeg(a);
      return { asset: a, ...v };
    })
  );

  const hintLines = assets
    .map((a, i) => {
      const q = (a.queryUsed || "").slice(0, 80);
      const t = (a.title || "").slice(0, 80);
      return `image ${i}: queryHint="${q}" googleTitle="${t}"`;
    })
    .join("\n");

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `War documentary library topic: "${topic}" (group: ${group}). Known tags: ${tags.join(", ") || "none"}.

For EACH image in order (image 0 .. ${visuals.length - 1}) write:
1) description: 2 UNIQUE sentences (~35–70 words) of what is VISIBLE — subject, setting, action, distinctive details. Do not copy Google titles. Do not invent hull numbers/names unless readable.
2) useFor: one short line (12–28 words) telling an editor WHEN to use this still in a war documentary — concrete beat types, not vague praise.
   Good useFor examples:
   - "Iran navy confrontation openers; Strait of Hormuz tanker tension B-roll"
   - "F-35 takeoff / carrier aviation sequences; modern US airpower cutaways"
   - "Aftermath / explosion smoke bridges after strike narration"
   - "Map-alternative: real desert oil field pumpjack establishing shots"
3) tags: 3–6 short keywords

Do NOT reuse the same sentence stems across images in this batch.
Hints (may be wrong — trust the pixels):
${hintLines}

Return JSON only:
{"items":[{"index":0,"description":"two visual sentences...","useFor":"concrete editor usage...","tags":["ship","night"]}]}`,
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
    temperature: 0.35,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You write detailed unique war-documentary captions PLUS concrete 'use for' editor guidance. Return strict JSON only.",
      },
      { role: "user", content },
    ],
  });

  const usage = response.usage;
  const prompt = usage?.prompt_tokens || 0;
  const completion = usage?.completion_tokens || 0;
  const cached =
    (usage as { prompt_tokens_details?: { cached_tokens?: number } })?.prompt_tokens_details
      ?.cached_tokens || 0;
  const callCost = calcSpend(prompt, cached, completion);
  progress.promptTokens += prompt;
  progress.cachedTokens += cached;
  progress.completionTokens += completion;
  progress.spentUsd += callCost;
  if (progress.spentUsd >= BUDGET_USD) {
    throw new BudgetExceededError(progress.spentUsd);
  }

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: {
    items?: Array<{ index?: number; description?: string; useFor?: string; tags?: string[] }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON from vision model");
  }

  const out = new Map<string, VisionResult>();
  for (let i = 0; i < assets.length; i++) {
    const row =
      parsed.items?.find((x) => x.index === i) ||
      parsed.items?.[i] ||
      ({ description: "" } as { description?: string; useFor?: string; tags?: string[] });
    const visual = String(row.description || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\s+/g, " ");
    let useFor = String(row.useFor || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\s+/g, " ")
      .replace(/^use for:\s*/i, "");
    if (visual.length < 40) {
      throw new Error(`too-short caption for index ${i} (${assets[i].assetId}): ${visual}`);
    }
    if (useFor.length < 12) {
      useFor = `${topic} documentary B-roll; ${group} establishing / cutaway stills`;
    }
    // Single display string for Media Library UI
    const description = `${visual} Use for: ${useFor}`;
    out.set(assets[i].assetId, {
      description,
      useFor,
      tags: Array.isArray(row.tags) ? row.tags.map(String).slice(0, 8) : [],
    });
  }
  return out;
}

async function persistPerson(idx: PersonLibraryIndex): Promise<void> {
  const images = idx.assets.filter((a) => a.mediaType === "image");
  const byCategory: Record<string, number> = {};
  for (const a of images) byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  idx.updatedAt = new Date().toISOString();
  idx.counts = {
    images: images.length,
    raw_footage: idx.assets.filter((a) => a.mediaType === "raw_footage").length,
    byCategory,
  };
  await r2PutJson(`library/${NICHE_SLUG}/${idx.personSlug}/index.json`, idx);
  await r2PutJson(`library/${NICHE_SLUG}/${idx.personSlug}/manifest.json`, {
    person: idx.person,
    personSlug: idx.personSlug,
    niche: idx.niche,
    nicheSlug: idx.nicheSlug,
    group: idx.group,
    imageCount: idx.counts.images,
    assets: images.map((a) => ({
      assetId: a.assetId,
      number: a.number,
      category: a.category,
      categories: a.categories,
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

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker()));
}

class Mutex {
  private chain: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured");

  const niche = await r2GetJson<NicheLibraryIndex>(`library/${NICHE_SLUG}/index.json`);
  if (!niche?.people?.length) throw new Error("War niche empty — run collect-war-library first");

  const progress = loadProgress();
  let describedSession = 0;
  let skipped = 0;
  let failed = 0;
  let budgetStop = false;
  let limitedStop = false;

  const totalImages = niche.people.reduce((n, p) => n + (p.images || 0), 0);
  const already = Object.keys(progress.done).length;
  const remainingGuess = Math.max(0, totalImages - already);
  // Detailed captions ≈ $0.0008–$0.0015/image with mini+low detail; use $0.0015 for projection
  const projectedRemaining = remainingGuess * 0.0015;
  const projectedTotal = progress.spentUsd + projectedRemaining;

  console.log(
    `[war-vision] model=${MODEL} batch=${BATCH_SIZE} batchConcurrency=${CONCURRENCY} personConcurrency=${PERSON_CONCURRENCY} width=${PREVIEW_WIDTH}`
  );
  console.log(
    `[war-vision] images≈${totalImages} alreadyDone=${already} remaining≈${remainingGuess}`
  );
  console.log(
    `[war-vision] COST ESTIMATE: ~$${projectedRemaining.toFixed(2)} remaining · ~$${projectedTotal.toFixed(2)} all-in (cap $${BUDGET_USD})`
  );
  console.log(
    `[war-vision] rates gpt-5.4-mini: in $${RATE_IN}/1M · cache $${RATE_CACHE}/1M · out $${RATE_OUT}/1M · detail=low`
  );

  const people = niche.people.sort(
    (a, b) => (a.group || "").localeCompare(b.group || "") || a.person.localeCompare(b.person)
  );
  const progressMutex = new Mutex();

  await mapPool(people, PERSON_CONCURRENCY, async (personRow) => {
    if (budgetStop || progress.spentUsd >= BUDGET_USD) {
      budgetStop = true;
      return;
    }
    if (LIMIT > 0 && describedSession >= LIMIT) {
      limitedStop = true;
      return;
    }

    const idx = await r2GetJson<PersonLibraryIndex>(
      `library/${NICHE_SLUG}/${personRow.personSlug}/index.json`
    );
    if (!idx?.assets?.length) return;

    const seedTags = [
      ...new Set(
        idx.assets
          .flatMap((a) => a.categories || [])
          .filter(Boolean)
          .slice(0, 12)
      ),
    ];

    let todo = idx.assets.filter((a) => {
      if (!needsDescription(a)) {
        if (
          a.visionDescribedAt &&
          String(a.visionModel || "").includes("detailed") &&
          /use for:/i.test(String(a.description || ""))
        ) {
          progress.done[a.assetId] = true;
          skipped += 1;
        }
        return false;
      }
      // Needs (re)describe — clear stale done flag
      delete progress.done[a.assetId];
      return true;
    });

    if (LIMIT > 0) {
      const left = Math.max(0, LIMIT - describedSession);
      if (left <= 0) {
        limitedStop = true;
        return;
      }
      todo = todo.slice(0, left);
    }

    console.log(
      `[war-vision] ${personRow.group || ""} / ${personRow.person}: ${todo.length}/${idx.assets.length} to describe (spent~$${progress.spentUsd.toFixed(2)})`
    );
    if (!todo.length) {
      await persistPerson(idx);
      return;
    }

    let dirty = 0;
    const byId = new Map(idx.assets.map((a) => [a.assetId, a]));
    const personMutex = new Mutex();
    const batches = chunk(todo, BATCH_SIZE);

    try {
      await mapPool(batches, CONCURRENCY, async (batch) => {
        if (progress.spentUsd >= BUDGET_USD) throw new BudgetExceededError(progress.spentUsd);
        if (LIMIT > 0 && describedSession >= LIMIT) return;
        try {
          const results = await describeBatch(
            personRow.person,
            personRow.group || idx.group || "",
            seedTags.map(String),
            batch,
            progress
          );
          await personMutex.run(async () => {
            await progressMutex.run(async () => {
              for (const asset of batch) {
                const vision = results.get(asset.assetId);
                if (!vision) continue;
                const live = byId.get(asset.assetId);
                if (!live) continue;
                live.description = vision.description;
                live.visionDescribedAt = new Date().toISOString();
                live.visionModel = `${MODEL}-detailed`;
                const tagSet = new Set([...(live.categories || []), live.category].filter(Boolean));
                for (const t of vision.tags || []) {
                  const slug = slugify(String(t));
                  if (slug) tagSet.add(slug);
                }
                live.categories = [...tagSet];
                progress.done[asset.assetId] = true;
                delete progress.failed[asset.assetId];
                progress.described += 1;
                describedSession += 1;
                dirty += 1;
              }
              if (describedSession % 40 === 0 || dirty >= FLUSH_EVERY) {
                await persistPerson(idx);
                saveProgress(progress);
                dirty = 0;
                console.log(
                  `[war-vision] progress session=${describedSession} total=${progress.described} spent~$${progress.spentUsd.toFixed(2)} last=${batch[batch.length - 1]?.assetId}`
                );
              }
            });
          });
        } catch (err) {
          if (err instanceof BudgetExceededError) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          for (const a of batch) progress.failed[a.assetId] = msg.slice(0, 240);
          failed += batch.length;
          console.error(`[war-vision] batch fail ${personRow.person}: ${msg.slice(0, 200)}`);
        }
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        budgetStop = true;
        progress.stoppedForBudget = true;
        console.warn(`[war-vision] ${err.message}`);
      } else {
        throw err;
      }
    }

    await persistPerson(idx);
    await progressMutex.run(async () => saveProgress(progress));
    console.log(
      `[war-vision] saved ${personRow.person} (session=${describedSession} failed=${failed} spent~$${progress.spentUsd.toFixed(2)})`
    );
  });

  saveProgress(progress);
  const summary = {
    ok: !budgetStop,
    model: MODEL,
    imagesInNiche: totalImages,
    describedSession,
    describedTotal: progress.described,
    skipped,
    failed,
    spentUsd: Number(progress.spentUsd.toFixed(4)),
    promptTokens: progress.promptTokens,
    cachedTokens: progress.cachedTokens,
    completionTokens: progress.completionTokens,
    avgUsdPerImage:
      progress.described > 0 ? Number((progress.spentUsd / progress.described).toFixed(6)) : null,
    budgetCap: BUDGET_USD,
    stoppedForBudget: budgetStop,
    limitedStop,
    underBudget: progress.spentUsd < BUDGET_USD,
  };
  const summaryPath = path.join(ROOT_DIR, "storage", "war-vision-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[war-vision] summary → ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
