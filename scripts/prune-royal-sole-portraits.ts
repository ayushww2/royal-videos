/**
 * Vision prune for Royal Family still libraries (400+ images by default).
 * Keeps group/action shots; caps plain solo portraits at 10 per person.
 *
 *   npx tsx scripts/prune-royal-sole-portraits.ts --dry-run
 *   npx tsx scripts/prune-royal-sole-portraits.ts --execute
 *   npx tsx scripts/prune-royal-sole-portraits.ts --execute --min-images 350 --person king-charles
 */
import dotenv from "dotenv";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, ROOT_DIR } from "../server/config.js";
import { getOpenAI } from "../server/openaiClient.js";
import { deletePersonLibraryAssets } from "../server/library/deleteAssets.js";
import { loadNicheLibrary, loadPersonLibrary } from "../server/library/collectImages.js";
import { r2Configured, r2GetObjectBuffer } from "../server/library/r2.js";
import type { LibraryAsset } from "../server/library/types.js";

dotenv.config();
dotenv.config({ path: path.join(ROOT_DIR, ".env.library"), override: false });

const NICHE_SLUG = "royal-family";
const BATCH = 6;
const CONCURRENCY = 4;
const MAX_SOLO_PORTRAITS = 10;

type StillKind = "multi_person" | "solo_action" | "solo_portrait" | "wrong_person" | "junk";

type StillJudge = {
  index: number;
  kind: StillKind;
  keep: boolean;
  portrait_quality?: number;
  reason?: string;
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const execute = argv.includes("--execute") && !argv.includes("--dry-run");
  const minImages = Number(
    argv.find((a) => a.startsWith("--min-images="))?.split("=")[1] ||
      (argv.includes("--min-images") ? argv[argv.indexOf("--min-images") + 1] : "400")
  );
  const personSlug =
    argv.find((a) => a.startsWith("--person="))?.split("=")[1] ||
    (argv.includes("--person") ? argv[argv.indexOf("--person") + 1] : "");
  const limit = Number(
    argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ||
      (argv.includes("--limit") ? argv[argv.indexOf("--limit") + 1] : "0")
  );
  return {
    execute,
    minImages: Number.isFinite(minImages) ? minImages : 400,
    personSlug: personSlug?.trim() || "",
    limit: Number.isFinite(limit) ? limit : 0,
  };
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${code}: ${err.slice(-400)}`))));
  });
}

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

async function previewForVision(body: Buffer, r2Key: string): Promise<{ b64: string; mime: string } | null> {
  const lower = r2Key.toLowerCase();
  const ext = lower.endsWith(".png") ? "png" : lower.endsWith(".webp") ? "webp" : "jpg";
  const mime =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
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

Classify each image (in order):

kind:
- multi_person: another adult clearly visible with the named person (group, couple, family, officials). KEEP.
- solo_action: ONLY the named person visible BUT doing a clear public action (waving to crowd, speech/podium, walkabout, arrival, ceremony role, military salute). KEEP.
- solo_portrait: ONLY the named person, static portrait/headshot/standing alone with no clear action — repetitive "solo spam". Usually DELETE except best few.
- wrong_person: main face is NOT ${person}. DELETE.
- junk: heavy watermark, meme text, thumbnail graphic, obvious wrong subject. DELETE.

For solo_portrait set portrait_quality 0-100 (documentary usefulness, sharpness, neutral pose).

Return JSON:
{"results":[{"index":0,"kind":"solo_action","keep":true,"portrait_quality":0,"reason":"..."}]}

Be conservative: when unsure between solo_action and solo_portrait, prefer solo_action + keep:true.
Waving/speech/formal event solo = solo_action, NOT solo_portrait.`,
    },
  ];

  for (let i = 0; i < items.length; i++) {
    content.push({ type: "text", text: `Image ${i}: assetId=${items[i].assetId}` });
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${items[i].mime};base64,${items[i].b64}`,
        detail: "low",
      },
    });
  }

  const response = await openai.chat.completions.create({
    model: process.env.ROYAL_PRUNE_VISION_MODEL?.trim() || config.openaiModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Strict JSON. Protect usable documentary royals footage; remove solo portrait spam only when confident.",
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
    const kind = (row.kind || "solo_portrait") as StillKind;
    return {
      index,
      kind,
      keep: Boolean(row.keep),
      portrait_quality: typeof row.portrait_quality === "number" ? row.portrait_quality : 50,
      reason: String(row.reason || ""),
    };
  });
}

function decideDeletes(
  assets: LibraryAsset[],
  judges: Map<string, StillJudge>
): { keep: LibraryAsset[]; deleteIds: string[]; stats: Record<string, number> } {
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
      continue;
    }
    if (j.kind === "solo_portrait") {
      soloPortraits.push({ asset, quality: j.portrait_quality ?? 50 });
    }
  }

  soloPortraits.sort(
    (a, b) =>
      b.quality - a.quality ||
      (b.asset.width || 0) * (b.asset.height || 0) - (a.asset.width || 0) * (a.asset.height || 0)
  );
  soloPortraits.forEach((row, i) => {
    if (i < MAX_SOLO_PORTRAITS) stats.solo_portrait_kept++;
    else {
      stats.solo_portrait_dropped++;
      deleteIds.add(row.asset.assetId);
    }
  });

  const keep = assets.filter((a) => !deleteIds.has(a.assetId));
  return { keep, deleteIds: [...deleteIds], stats };
}

async function prunePerson(
  personSlug: string,
  options: { execute: boolean; limit: number }
): Promise<{ person: string; before: number; after: number; deleted: number }> {
  const idx = await loadPersonLibrary(NICHE_SLUG, personSlug);
  if (!idx) throw new Error(`Missing person index: ${personSlug}`);

  let images = idx.assets.filter((a) => a.mediaType === "image");
  if (options.limit > 0) images = images.slice(0, options.limit);

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
      console.warn(
        `[prune] vision batch failed ${idx.person}:`,
        err instanceof Error ? err.message : err
      );
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

  // Images we could not load → keep
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

  const { deleteIds, stats } = decideDeletes(images, judges);
  console.log(`[prune] ${idx.person} (${personSlug}) stats`, stats);
  console.log(`[prune] ${idx.person}: delete ${deleteIds.length} / ${images.length} stills`);

  if (options.execute && deleteIds.length) {
    for (let i = 0; i < deleteIds.length; i += 200) {
      const chunk = deleteIds.slice(i, i + 200);
      const result = await deletePersonLibraryAssets(NICHE_SLUG, personSlug, chunk);
      console.log(`[prune] deleted chunk ${result.deleted}`, result.errors?.length ? result.errors.slice(0, 3) : "");
    }
  }

  return {
    person: idx.person,
    before: images.length,
    after: images.length - deleteIds.length,
    deleted: deleteIds.length,
  };
}

async function main() {
  const args = parseArgs();
  if (!r2Configured()) {
    throw new Error("R2 not configured (.env.library or Railway vars)");
  }

  console.log(
    `[prune] mode=${args.execute ? "EXECUTE" : "DRY-RUN"} minImages=${args.minImages} maxSolo=${MAX_SOLO_PORTRAITS}`
  );

  const niche = await loadNicheLibrary(NICHE_SLUG);
  if (!niche) throw new Error("Royal niche index missing");

  let targets = niche.people.filter((p) => p.images >= args.minImages);
  if (args.personSlug) {
    targets = niche.people.filter((p) => p.personSlug === args.personSlug);
    if (!targets.length) throw new Error(`Person not found: ${args.personSlug}`);
  }

  console.log(
    `[prune] ${targets.length} people:`,
    targets.map((p) => `${p.person}(${p.images})`).join(", ")
  );

  const summary: Array<{ person: string; before: number; after: number; deleted: number }> = [];
  for (const row of targets) {
    summary.push(await prunePerson(row.personSlug, { execute: args.execute, limit: args.limit }));
  }

  const outPath = path.join(ROOT_DIR, "storage", "prune-royal-sole-portraits-summary.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), args, summary }, null, 2),
    "utf8"
  );
  console.log(`[prune] summary → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
