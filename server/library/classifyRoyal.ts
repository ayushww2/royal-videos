/**
 * ContactBox vision classification for Royal Media stills and raw clips.
 * Assigns simple standardized labels for documentary editor asset filtering.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getOpenAI } from "../openaiClient.js";
import { config, optionalEnv } from "../config.js";
import { r2Configured, r2GetJson, r2GetObjectBuffer, r2PutJson } from "./r2.js";
import type {
  LibraryAsset,
  PersonLibraryIndex,
  RoyalAction,
  RoyalClassification,
  RoyalContext,
  RoyalMood,
  RoyalPeopleType,
  RoyalShot,
} from "./types.js";
import { countLibraryAssets, isRawClipMediaType, slugify } from "./types.js";
import { ROYAL_NICHE_SLUG, ROYAL_PEOPLE } from "./describeRoyal.js";

const MODEL = optionalEnv("ROYAL_VISION_MODEL") || config.openaiModel || "gpt-5.6-terra";
const BATCH_SIZE = Math.max(1, Math.min(8, Number(process.env.ROYAL_CLASSIFY_BATCH || 6)));
const BATCH_CONCURRENCY = Math.max(
  1,
  Math.min(12, Number(process.env.ROYAL_CLASSIFY_BATCH_CONCURRENCY || 4))
);
const DEFAULT_WORKERS = Math.max(1, Math.min(25, Number(process.env.ROYAL_CLASSIFY_WORKERS || 8)));
const PREVIEW_WIDTH = Math.max(160, Number(process.env.ROYAL_VISION_WIDTH || 320));
const FLUSH_EVERY = Math.max(5, Number(process.env.ROYAL_CLASSIFY_FLUSH_EVERY || 24));

const PEOPLE_TYPES = new Set<RoyalPeopleType>([
  "solo",
  "two_people",
  "family",
  "small_group",
  "crowd",
]);
const MOODS = new Set<RoyalMood>([
  "happy",
  "serious",
  "sad",
  "angry_tense",
  "emotional",
  "surprised",
  "neutral",
]);
const SHOTS = new Set<RoyalShot>(["close_up", "medium", "full_body", "wide"]);
const ACTIONS = new Set<RoyalAction>([
  "posing",
  "standing",
  "sitting",
  "walking",
  "waving",
  "smiling",
  "laughing",
  "speaking",
  "listening",
  "greeting",
  "shaking_hands",
  "hugging",
  "looking_down",
  "looking_away",
  "entering",
  "leaving",
  "vehicle",
  "ceremony",
  "crowd_interaction",
  "other",
]);
const CONTEXTS = new Set<RoyalContext>([
  "general",
  "royal_duty",
  "formal_event",
  "family",
  "relationship",
  "public_appearance",
  "speech_interview",
  "church_memorial",
  "celebration",
  "travel_arrival",
  "palace_residence",
  "press",
  "other",
]);

export type ClassifyRoyalProgress = {
  person: string;
  personSlug: string;
  examined: number;
  classified: number;
  skipped: number;
  failed: number;
};

const CLASSIFY_PROMPT = `# Royal Media Simple Classification Prompt

You are classifying Royal Family images and video clips for an automated documentary video editor.

The person's identity and the existing image/clip description will already be provided.

Your job is to assign a **small number of simple standardized labels**.

These labels will later be used to quickly reduce hundreds of assets into a small relevant pool before another AI chooses the exact best visual.

Do NOT overcomplicate the classification.

Do NOT classify dates, years, decades, clothing, colors, or unnecessary details.

Use only the categories below.

---

## 1. PEOPLE TYPE

Choose exactly one:

* \`solo\`
* \`two_people\`
* \`family\`
* \`small_group\`
* \`crowd\`

### Rules

\`solo\`
= only the main royal is meaningfully visible.

\`two_people\`
= main royal + one important person.

\`family\`
= several Royal Family members together.

\`small_group\`
= royal with several officials, staff, friends, clergy, etc.

\`crowd\`
= public crowd, press crowd, large gathering, or the royal is surrounded by many people.

---

## 2. MOOD

Choose exactly one MAIN mood:

* \`happy\`
* \`serious\`
* \`sad\`
* \`angry_tense\`
* \`emotional\`
* \`surprised\`
* \`neutral\`

### Rules

Use what is visually obvious.

\`happy\`
includes smiling, laughing, cheerful and warm.

\`serious\`
includes focused, concerned, thoughtful and stern.

\`sad\`
includes visibly unhappy, somber or grieving.

\`angry_tense\`
includes frustration, tension or obvious anger.

\`emotional\`
includes crying or very strong emotion.

\`surprised\`
includes shocked, startled or visibly surprised.

\`neutral\`
when there is no strong readable emotion.

Do not exaggerate expressions.

---

## 3. SHOT

Choose exactly one:

* \`close_up\`
* \`medium\`
* \`full_body\`
* \`wide\`

### Rules

\`close_up\`
= mainly face/head and shoulders.

\`medium\`
= roughly upper body or waist-up.

\`full_body\`
= most or all of the person's body is visible.

\`wide\`
= environment/event/location is a major part of the image.

---

## 4. ACTION

Choose the ONE action that best describes what the main person is doing.

Use one of:

* \`posing\`
* \`standing\`
* \`sitting\`
* \`walking\`
* \`waving\`
* \`smiling\`
* \`laughing\`
* \`speaking\`
* \`listening\`
* \`greeting\`
* \`shaking_hands\`
* \`hugging\`
* \`looking_down\`
* \`looking_away\`
* \`entering\`
* \`leaving\`
* \`vehicle\`
* \`ceremony\`
* \`crowd_interaction\`
* \`other\`

Choose the closest option.

Do not create new labels unless absolutely necessary.

---

## 5. CONTEXT

Choose exactly one broad context:

* \`general\`
* \`royal_duty\`
* \`formal_event\`
* \`family\`
* \`relationship\`
* \`public_appearance\`
* \`speech_interview\`
* \`church_memorial\`
* \`celebration\`
* \`travel_arrival\`
* \`palace_residence\`
* \`press\`
* \`other\`

---

# DESCRIPTION

Also produce one clear sentence describing exactly what is visible.

Keep the description factual and useful for media selection.

Avoid unnecessary details that would not help an editor select the asset.`;

function isClassifiableMedia(a: LibraryAsset): boolean {
  return a.mediaType === "image" || isRawClipMediaType(a.mediaType);
}

function needsClassification(a: LibraryAsset, force: boolean): boolean {
  if (!isClassifiableMedia(a)) return false;
  if (force) return true;
  return !(a.classifiedAt && a.peopleType && a.mood && a.shot && a.action && a.context);
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
    `classify-in-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${extHint}`
  );
  const tmpOut = path.join(
    os.tmpdir(),
    `classify-out-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
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

function extractVideoFrame(videoBody: Buffer, r2Key: string): Buffer {
  const ffmpeg = findFfmpeg();
  const ext = /\.webm$/i.test(r2Key)
    ? ".webm"
    : /\.mov$/i.test(r2Key)
      ? ".mov"
      : ".mp4";
  const tmpIn = path.join(
    os.tmpdir(),
    `classify-vid-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`
  );
  const tmpOut = path.join(
    os.tmpdir(),
    `classify-vid-out-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
  );
  try {
    fs.writeFileSync(tmpIn, videoBody);
    const res = spawnSync(
      ffmpeg,
      ["-y", "-ss", "0.4", "-i", tmpIn, "-frames:v", "1", "-q:v", "4", tmpOut],
      { encoding: "utf8" }
    );
    if (res.status !== 0 || !fs.existsSync(tmpOut)) {
      throw new Error(res.stderr?.slice(0, 300) || "ffmpeg frame extract failed");
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
    const jpeg = toJpegPreview(body, ".jpg");
    return { b64: jpeg.toString("base64"), mime: "image/jpeg" };
  }

  const { body } = await r2GetObjectBuffer(asset.r2Key);
  const frame = extractVideoFrame(body, asset.r2Key);
  const jpeg = toJpegPreview(frame, ".jpg");
  return { b64: jpeg.toString("base64"), mime: "image/jpeg" };
}

function pickEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  const v = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_") as T;
  return allowed.has(v) ? v : fallback;
}

function normalizePeople(raw: unknown, primary: string): string[] {
  const primaryTrim = primary.trim();
  const fromModel = Array.isArray(raw)
    ? raw.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const n = name.trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };
  push(primaryTrim);
  for (const name of fromModel) {
    if (name !== primaryTrim) push(name);
  }
  return out.length ? out : [primaryTrim];
}

function normalizeRow(row: Partial<RoyalClassification>, primary: string): RoyalClassification {
  const description = String(row.description || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ");
  return {
    people: normalizePeople(row.people, primary),
    people_type: pickEnum(row.people_type, PEOPLE_TYPES, "solo"),
    mood: pickEnum(row.mood, MOODS, "neutral"),
    shot: pickEnum(row.shot, SHOTS, "medium"),
    action: pickEnum(row.action, ACTIONS, "other"),
    context: pickEnum(row.context, CONTEXTS, "general"),
    description: description.length >= 12 ? description : "Royal media still for documentary selection.",
  };
}

function applyClassification(asset: LibraryAsset, row: RoyalClassification, model: string): void {
  asset.peopleType = row.people_type;
  asset.mood = row.mood;
  asset.shot = row.shot;
  asset.action = row.action;
  asset.context = row.context;
  asset.description = row.description;
  asset.people = normalizePeople(row.people, asset.person);
  asset.classifiedAt = new Date().toISOString();
  asset.classifyModel = model;
}

async function classifyBatch(
  person: string,
  assets: LibraryAsset[]
): Promise<Map<string, RoyalClassification>> {
  const openai = getOpenAI();
  const visuals = await Promise.all(
    assets.map(async (a) => {
      const v = await loadVisualJpeg(a);
      return { asset: a, ...v };
    })
  );

  const hintLines = assets
    .map((a, i) => {
      const kind = a.mediaType === "image" ? "image" : "video frame";
      const desc = (a.description || "").slice(0, 120);
      const t = (a.title || "").slice(0, 90);
      return `${kind} ${i}: title="${t}" existingDescription="${desc}" mediaType=${a.mediaType}`;
    })
    .join("\n");

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `${CLASSIFY_PROMPT}

Main royal person for ALL frames in this batch: "${person}".

Classify EACH visual (index 0 .. ${visuals.length - 1}). Images are stills; video entries are representative frames from raw clips.

Existing metadata (may be wrong — trust the pixels):
${hintLines}

Return JSON only with one object per visual:
{"items":[{"index":0,"people":["King Charles"],"people_type":"solo","mood":"happy","shot":"close_up","action":"smiling","context":"general","description":"One factual sentence."}]}

Also return \`people\`: an array of clearly identifiable important people visible. Always include the main folder person first. For solo shots use only that person. For two-person shots include both visible royals by full name when identifiable.`,
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
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You classify royal documentary media with simple standardized labels. Return strict JSON only.",
      },
      { role: "user", content },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: { items?: Array<Partial<RoyalClassification> & { index?: number }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON from classification model");
  }

  const out = new Map<string, RoyalClassification>();
  for (let i = 0; i < assets.length; i++) {
    const row =
      parsed.items?.find((x) => x.index === i) ||
      parsed.items?.[i] ||
      ({} as Partial<RoyalClassification>);
    out.set(assets[i].assetId, normalizeRow(row, person));
  }
  return out;
}

async function persistPerson(idx: PersonLibraryIndex): Promise<void> {
  idx.updatedAt = new Date().toISOString();
  idx.counts = countLibraryAssets(idx.assets);
  await r2PutJson(`library/${ROYAL_NICHE_SLUG}/${idx.personSlug}/index.json`, idx);
  await r2PutJson(`library/${ROYAL_NICHE_SLUG}/${idx.personSlug}/manifest.json`, {
    person: idx.person,
    personSlug: idx.personSlug,
    niche: idx.niche,
    nicheSlug: idx.nicheSlug,
    imageCount: idx.counts.images,
    assets: idx.assets
      .filter((a) => a.mediaType === "image" || isRawClipMediaType(a.mediaType))
      .map((a) => ({
        assetId: a.assetId,
        number: a.number,
        mediaType: a.mediaType,
        category: a.category,
        r2Key: a.r2Key,
        description: a.description,
        peopleType: a.peopleType,
        people: a.people,
        mood: a.mood,
        shot: a.shot,
        action: a.action,
        context: a.context,
        classifiedAt: a.classifiedAt,
        classifyModel: a.classifyModel,
      })),
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Run async tasks with a fixed worker pool. */
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

/** Classify images and raw clips for one royal person. Additive — never deletes assets. */
export async function classifyRoyalPerson(params: {
  person: string;
  force?: boolean;
  limit?: number;
  batchConcurrency?: number;
  onProgress?: (msg: string) => void;
}): Promise<ClassifyRoyalProgress> {
  if (!r2Configured()) throw new Error("R2 not configured");
  const person = params.person;
  const personSlug = slugify(person);
  const force = Boolean(params.force);
  const limit = Math.max(0, Number(params.limit || 0));
  const batchConcurrency = Math.max(
    1,
    Math.min(12, Number(params.batchConcurrency || BATCH_CONCURRENCY))
  );
  const log = params.onProgress || console.log;

  const idx = await r2GetJson<PersonLibraryIndex>(
    `library/${ROYAL_NICHE_SLUG}/${personSlug}/index.json`
  );
  if (!idx?.assets?.length) {
    throw new Error(`Person library missing: ${person}`);
  }

  let todo = idx.assets.filter((a) => needsClassification(a, force));
  if (limit > 0) todo = todo.slice(0, limit);

  const progress: ClassifyRoyalProgress = {
    person,
    personSlug,
    examined: todo.length,
    classified: 0,
    skipped: idx.assets.filter((a) => isClassifiableMedia(a) && !needsClassification(a, force)).length,
    failed: 0,
  };

  log(
    `[royal-classify] ${person}: todo=${todo.length} skipped=${progress.skipped} model=${MODEL} batchConcurrency=${batchConcurrency} (images+raw clips)`
  );
  let sinceFlush = 0;
  const byId = new Map(idx.assets.map((a) => [a.assetId, a]));
  const batches = chunk(todo, BATCH_SIZE);

  for (const batchGroup of chunk(batches, batchConcurrency)) {
    const groupResults = await Promise.all(
      batchGroup.map(async (batch) => {
        try {
          return { batch, results: await classifyBatch(person, batch), err: null as string | null };
        } catch (err) {
          return {
            batch,
            results: null as Map<string, RoyalClassification> | null,
            err: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    for (const { batch, results, err } of groupResults) {
      if (err || !results) {
        progress.failed += batch.length;
        log(`[royal-classify] batch failed ${person}: ${err || "empty results"}`);
        continue;
      }
      for (const asset of batch) {
        const row = results.get(asset.assetId);
        const live = byId.get(asset.assetId);
        if (!row || !live) {
          progress.failed += 1;
          continue;
        }
        applyClassification(live, row, MODEL);
        progress.classified += 1;
        sinceFlush += 1;
      }
    }

    if (sinceFlush >= FLUSH_EVERY) {
      idx.assets = [...byId.values()];
      await persistPerson(idx);
      sinceFlush = 0;
      log(`[royal-classify] flushed ${person} classified=${progress.classified}`);
    }
  }

  idx.assets = [...byId.values()];
  await persistPerson(idx);
  log(
    `[royal-classify] done ${person}: classified=${progress.classified} skipped=${progress.skipped} failed=${progress.failed}`
  );
  return progress;
}

/** Parallel classification for all known royal people (one worker per person). */
export async function classifyAllRoyalPeople(params?: {
  force?: boolean;
  limitPerPerson?: number;
  people?: string[];
  workers?: number;
  batchConcurrency?: number;
  onProgress?: (msg: string) => void;
}): Promise<ClassifyRoyalProgress[]> {
  const list =
    params?.people?.length ? params.people : ([...ROYAL_PEOPLE] as unknown as string[]);
  const workers = Math.max(1, Math.min(25, Number(params?.workers || DEFAULT_WORKERS)));
  const batchConcurrency = Math.max(
    1,
    Math.min(12, Number(params?.batchConcurrency || BATCH_CONCURRENCY))
  );
  const log = params?.onProgress || console.log;
  log(
    `[royal-classify] starting ${list.length} people with workers=${workers} batchConcurrency=${batchConcurrency}`
  );

  return runPool(list, workers, async (person) => {
    try {
      return await classifyRoyalPerson({
        person,
        force: params?.force,
        limit: params?.limitPerPerson,
        batchConcurrency,
        onProgress: log,
      });
    } catch (err) {
      log(`[royal-classify] skip ${person}: ${err instanceof Error ? err.message : err}`);
      return {
        person,
        personSlug: slugify(person),
        examined: 0,
        classified: 0,
        skipped: 0,
        failed: 0,
      } satisfies ClassifyRoyalProgress;
    }
  });
}
