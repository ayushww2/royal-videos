/**
 * Download-ready ingest: scan local MP4s, vision-label royal people,
 * cut unique 2–4s clips, upload to R2 Royal Family library.
 *
 * Usage:
 *   npx tsx --env-file=.env --env-file=.env.library scripts/ingest-royal-raw-footage.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { getOpenAI, chatJson } from "../server/openaiClient.js";
import { config } from "../server/config.js";
import { r2Configured, r2GetJson, r2PutJson, r2PutObject } from "../server/library/r2.js";
import type {
  LibraryAsset,
  LibraryCategory,
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "../server/library/types.js";
import { slugify } from "../server/library/types.js";

const NICHE = "Royal Family";
const NICHE_SLUG = slugify(NICHE);
const CLIP_MIN = 2;
const CLIP_MAX = 4;
const CLIP_LEN = 3;
const MAX_SAMPLES_PER_VIDEO = 55;
const VISION_BATCH = 8;
const VISION_CONCURRENCY = 4;
const CUT_CONCURRENCY = 6;
const UPLOAD_CONCURRENCY = 8;
const MIN_CONFIDENCE = 0.72;

const PEOPLE = [
  "Prince Harry",
  "Princess Catherine",
  "Queen Camilla",
  "Princess Anne",
  "Prince William",
  "Meghan Markle",
  "King Charles",
  "Princess Diana",
] as const;

type PersonName = (typeof PEOPLE)[number];

const PERSON_ALIASES: Record<PersonName, string[]> = {
  "Prince Harry": ["harry", "prince harry", "duke of sussex"],
  "Princess Catherine": [
    "catherine",
    "kate",
    "kate middleton",
    "princess of wales",
    "duchess of cambridge",
  ],
  "Queen Camilla": ["camilla", "queen camilla", "camilla parker bowles"],
  "Princess Anne": ["anne", "princess anne", "princess royal"],
  "Prince William": ["william", "prince william", "prince of wales", "duke of cambridge"],
  "Meghan Markle": ["meghan", "meghan markle", "duchess of sussex"],
  "King Charles": ["charles", "king charles", "charles iii", "prince charles"],
  "Princess Diana": [
    "diana",
    "princess diana",
    "lady diana",
    "diana spencer",
    "princess of wales diana",
  ],
};

const RAW_CATEGORIES: LibraryCategory[] = [
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

type FrameLabel = {
  t: number;
  people: PersonName[];
  category: LibraryCategory;
  confidence: number;
  usableRaw: boolean;
  notes?: string;
};

type ClipPlan = {
  person: PersonName;
  sourcePath: string;
  sourceId: string;
  start: number;
  end: number;
  category: LibraryCategory;
  confidence: number;
  frameHash: string;
};

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} failed (${code}): ${stderr.slice(-800)}`));
    });
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function ffprobeDuration(filePath: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return Number(stdout.trim()) || 0;
}

async function extractFrame(videoPath: string, t: number, outJpg: string): Promise<boolean> {
  try {
    await run("ffmpeg", [
      "-y",
      "-ss",
      String(Math.max(0, t)),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "5",
      "-vf",
      "scale=640:-2",
      outJpg,
    ]);
    const st = await fs.stat(outJpg);
    return st.size > 1500;
  } catch {
    return false;
  }
}

async function cutClip(videoPath: string, start: number, duration: number, outMp4: string): Promise<boolean> {
  try {
    await run("ffmpeg", [
      "-y",
      "-ss",
      String(start),
      "-i",
      videoPath,
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-an",
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",
      outMp4,
    ]);
    const st = await fs.stat(outMp4);
    return st.size > 8_000;
  } catch {
    return false;
  }
}

function normalizePerson(raw: string): PersonName | null {
  const s = raw.toLowerCase().trim();
  for (const person of PEOPLE) {
    if (s === person.toLowerCase()) return person;
    if (PERSON_ALIASES[person].some((a) => s === a || s.includes(a))) return person;
  }
  return null;
}

function normalizeCategory(raw: string): LibraryCategory {
  const s = raw.toLowerCase().trim().replace(/\s+/g, "_");
  if ((RAW_CATEGORIES as string[]).includes(s)) return s as LibraryCategory;
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

async function classifyBatch(
  frames: Array<{ t: number; b64: string }>
): Promise<FrameLabel[]> {
  if (!frames.length) return [];
  const openai = getOpenAI();
  const peopleList = PEOPLE.join(", ");
  const cats = RAW_CATEGORIES.join(", ");

  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    {
      type: "text",
      text: `You are labeling documentary frames of the British royal family for a RAW FOOTAGE library.
For EACH image in order, identify which of these people are CLEARLY visible (face recognizable):
${peopleList}

CRITICAL — set usableRaw=false (and people=[]) if the frame is NOT clean camera/archive footage:
- Photo placed on designed background (dark texture, matrix/grid, particles)
- White/cream bordered photo card, tilted collage, scrapbook look
- Orange/yellow banners, big headlines, lower-thirds, channel titles/text overlays
- Thumbnail/meme styling, watermarks with channel branding
- Slideshow slides / graphic composites

Only usableRaw=true when it looks like real film/video of the person.

Rules:
- Only list people who are clearly visible. If unsure, leave people empty.
- Prefer single primary person when one face dominates.
- category must be one of: ${cats}
- confidence 0-1 for the primary person match.
Return JSON only:
{"frames":[{"index":0,"people":["King Charles"],"category":"smiling","confidence":0.9,"usableRaw":true,"notes":"..."}]}`,
    },
  ];

  for (const f of frames) {
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${f.b64}` },
    });
  }

  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You identify British royals in frames and return strict JSON. Never invent people who are not visible.",
      },
      { role: "user", content },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: {
    frames?: Array<{
      index?: number;
      people?: string[];
      category?: string;
      confidence?: number;
      usableRaw?: boolean;
      notes?: string;
    }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return frames.map((f) => ({
      t: f.t,
      people: [],
      category: "other" as LibraryCategory,
      confidence: 0,
      usableRaw: false,
    }));
  }

  return frames.map((f, i) => {
    const row =
      parsed.frames?.find((x) => x.index === i) ||
      parsed.frames?.[i] ||
      ({ people: [], category: "other", confidence: 0, usableRaw: false } as const);
    const usableRaw = row.usableRaw !== false;
    const people = usableRaw
      ? (row.people || [])
          .map((p) => normalizePerson(p))
          .filter((p): p is PersonName => Boolean(p))
      : [];
    return {
      t: f.t,
      people: [...new Set(people)],
      category: normalizeCategory(String(row.category || "other")),
      confidence: Math.max(0, Math.min(1, Number(row.confidence ?? 0))),
      usableRaw,
      notes: row.notes,
    };
  });
}

function buildClipPlans(
  sourcePath: string,
  sourceId: string,
  labels: FrameLabel[]
): ClipPlan[] {
  const plans: ClipPlan[] = [];
  const usedRanges: Array<{ person: PersonName; start: number; end: number }> = [];
  const usedFrameHashes = new Set<string>();

  const byPerson = new Map<PersonName, FrameLabel[]>();
  for (const label of labels) {
    if (!label.usableRaw) continue;
    if (label.confidence < MIN_CONFIDENCE || !label.people.length) continue;
    for (const person of label.people) {
      const arr = byPerson.get(person) || [];
      arr.push(label);
      byPerson.set(person, arr);
    }
  }

  for (const [person, frames] of byPerson) {
    const sorted = [...frames].sort((a, b) => a.t - b.t);
    const picked: FrameLabel[] = [];
    for (const f of sorted) {
      const last = picked[picked.length - 1];
      if (last && f.t - last.t < CLIP_MAX) continue; // uniqueness: skip near-duplicates
      picked.push(f);
    }

    for (const f of picked) {
      let start = Math.max(0, f.t - CLIP_LEN / 2);
      let end = start + CLIP_LEN;
      if (end - start < CLIP_MIN) end = start + CLIP_MIN;
      if (end - start > CLIP_MAX) end = start + CLIP_MAX;

      const overlaps = usedRanges.some(
        (r) =>
          r.person === person &&
          !(end <= r.start + 0.15 || start >= r.end - 0.15)
      );
      if (overlaps) continue;

      const frameHash = createHash("sha1")
        .update(`${sourceId}|${person}|${f.t.toFixed(1)}|${f.category}`)
        .digest("hex")
        .slice(0, 12);
      if (usedFrameHashes.has(frameHash)) continue;
      usedFrameHashes.add(frameHash);

      usedRanges.push({ person, start, end });
      plans.push({
        person,
        sourcePath,
        sourceId,
        start,
        end,
        category: f.category,
        confidence: f.confidence,
        frameHash,
      });
    }
  }

  return plans;
}

async function loadOrCreatePersonIndex(person: PersonName): Promise<PersonLibraryIndex> {
  const personSlug = slugify(person);
  const key = `library/${NICHE_SLUG}/${personSlug}/index.json`;
  return (
    (await r2GetJson<PersonLibraryIndex>(key)) || {
      niche: NICHE,
      nicheSlug: NICHE_SLUG,
      person,
      personSlug,
      updatedAt: new Date().toISOString(),
      counts: { images: 0, raw_footage: 0, byCategory: {} },
      assets: [],
    }
  );
}

async function savePersonAndRollup(
  indexes: Map<PersonName, PersonLibraryIndex>
): Promise<void> {
  const peopleSummary: NicheLibraryIndex["people"] = [];

  for (const person of PEOPLE) {
    const idx = indexes.get(person);
    if (!idx) continue;
    const images = idx.assets.filter((a) => a.mediaType === "image");
    const raw = idx.assets.filter((a) => a.mediaType === "raw_footage");
    const byCategory: PersonLibraryIndex["counts"]["byCategory"] = {};
    for (const a of [...images, ...raw]) {
      byCategory[a.category] = (byCategory[a.category] || 0) + 1;
    }
    const out: PersonLibraryIndex = {
      ...idx,
      niche: NICHE,
      nicheSlug: NICHE_SLUG,
      updatedAt: new Date().toISOString(),
      counts: {
        images: images.length,
        raw_footage: raw.length,
        byCategory,
      },
      assets: idx.assets.sort((a, b) => a.assetId.localeCompare(b.assetId)),
    };
    await r2PutJson(`library/${NICHE_SLUG}/${out.personSlug}/index.json`, out);
    await r2PutJson(`library/${NICHE_SLUG}/${out.personSlug}/manifest.json`, {
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
        sourceUrl: a.sourceUrl,
      })),
    });
    peopleSummary.push({
      person: out.person,
      personSlug: out.personSlug,
      images: out.counts.images,
      raw_footage: out.counts.raw_footage,
    });
    indexes.set(person, out);
  }

  const nicheOut: NicheLibraryIndex = {
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    updatedAt: new Date().toISOString(),
    people: peopleSummary.sort((a, b) => a.person.localeCompare(b.person)),
  };
  await r2PutJson(`library/${NICHE_SLUG}/index.json`, nicheOut);

  // Also keep Royal v1 alias pointer for older UI defaults
  await r2PutJson(`library/royal-v1/index.json`, {
    ...nicheOut,
    niche: "Royal v1",
    nicheSlug: "royal-v1",
  });

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
  nicheMap.set("royal-v1", {
    niche: "Royal v1",
    nicheSlug: "royal-v1",
    peopleCount: nicheOut.people.length,
    images: nicheOut.people.reduce((n, p) => n + p.images, 0),
    raw_footage: nicheOut.people.reduce((n, p) => n + p.raw_footage, 0),
  });
  await r2PutJson("library/index.json", {
    updatedAt: new Date().toISOString(),
    niches: [...nicheMap.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  } satisfies RootLibraryIndex);
}

async function processVideo(
  videoPath: string,
  workRoot: string,
  indexes: Map<PersonName, PersonLibraryIndex>
): Promise<{ sourceId: string; labels: number; plans: number; uploaded: number }> {
  const sourceId = path.basename(videoPath, path.extname(videoPath));
  const framesDir = path.join(workRoot, "frames", sourceId);
  const clipsDir = path.join(workRoot, "clips", sourceId);
  await fs.mkdir(framesDir, { recursive: true });
  await fs.mkdir(clipsDir, { recursive: true });

  const duration = await ffprobeDuration(videoPath);
  console.log(`[scan] ${sourceId} duration=${duration.toFixed(1)}s`);

  const sampleEvery = Math.max(3, duration / MAX_SAMPLES_PER_VIDEO);
  const times: number[] = [];
  for (let t = 1; t < duration - 1; t += sampleEvery) times.push(Number(t.toFixed(2)));
  console.log(`[scan] ${sourceId} sampleEvery=${sampleEvery.toFixed(2)}s`);

  const framePaths: Array<{ t: number; jpg: string } | null> = await mapPool(
    times,
    10,
    async (t) => {
      const jpg = path.join(framesDir, `t-${String(Math.round(t * 10)).padStart(6, "0")}.jpg`);
      const ok = await extractFrame(videoPath, t, jpg);
      return ok ? { t, jpg } : null;
    }
  );
  const frames = framePaths.filter(Boolean) as Array<{ t: number; jpg: string }>;
  console.log(`[scan] ${sourceId} frames=${frames.length}`);

  const labels: FrameLabel[] = [];
  const batches: Array<Array<{ t: number; jpg: string }>> = [];
  for (let i = 0; i < frames.length; i += VISION_BATCH) {
    batches.push(frames.slice(i, i + VISION_BATCH));
  }

  await mapPool(batches, VISION_CONCURRENCY, async (batch) => {
    const withB64 = await Promise.all(
      batch.map(async (f) => ({
        t: f.t,
        b64: (await fs.readFile(f.jpg)).toString("base64"),
      }))
    );
    try {
      const result = await classifyBatch(withB64);
      labels.push(...result);
      const hits = result.filter((r) => r.usableRaw && r.people.length && r.confidence >= MIN_CONFIDENCE).length;
      console.log(`[vision] ${sourceId} batch@${batch[0].t}s hits=${hits}/${batch.length}`);
    } catch (err) {
      console.warn(`[vision] ${sourceId} batch failed:`, err instanceof Error ? err.message : err);
      for (const f of batch) {
        labels.push({ t: f.t, people: [], category: "other", confidence: 0, usableRaw: false });
      }
    }
  });

  labels.sort((a, b) => a.t - b.t);
  await fs.writeFile(
    path.join(workRoot, `${sourceId}-labels.json`),
    JSON.stringify(labels, null, 2),
    "utf8"
  );

  const plans = buildClipPlans(videoPath, sourceId, labels);
  console.log(`[cut] ${sourceId} planned clips=${plans.length}`);

  const cutResults = await mapPool(plans, CUT_CONCURRENCY, async (plan) => {
    const personSlug = slugify(plan.person);
    const dur = Math.min(CLIP_MAX, Math.max(CLIP_MIN, plan.end - plan.start));
    const localName = `${personSlug}-${plan.frameHash}.mp4`;
    const localPath = path.join(clipsDir, localName);
    const ok = await cutClip(plan.sourcePath, plan.start, dur, localPath);
    if (!ok) return null;
    const thumbPath = localPath.replace(/\.mp4$/i, ".jpg");
    await extractFrame(localPath, Math.min(0.4, dur / 2), thumbPath);
    return { plan, localPath, thumbPath, dur };
  });

  const ready = cutResults.filter(Boolean) as Array<{
    plan: ClipPlan;
    localPath: string;
    thumbPath: string;
    dur: number;
  }>;

  let uploaded = 0;
  await mapPool(ready, UPLOAD_CONCURRENCY, async (item) => {
    const { plan, localPath, thumbPath } = item;
    const personSlug = slugify(plan.person);
    let idx = indexes.get(plan.person);
    if (!idx) {
      idx = await loadOrCreatePersonIndex(plan.person);
      indexes.set(plan.person, idx);
    }

    const existingRaw = idx.assets.filter((a) => a.mediaType === "raw_footage");
    if (existingRaw.some((a) => a.queryUsed === plan.frameHash)) {
      return;
    }

    const number = existingRaw.length + 1;
    const assetId = `${NICHE_SLUG}-${personSlug}-raw-${String(number).padStart(4, "0")}-${plan.frameHash.slice(0, 6)}`;
    const r2Key = `library/${NICHE_SLUG}/${personSlug}/raw/${assetId}.mp4`;
    const thumbKey = `library/${NICHE_SLUG}/${personSlug}/raw/${assetId}.jpg`;

    const mp4 = await fs.readFile(localPath);
    await r2PutObject({
      key: r2Key,
      body: mp4,
      contentType: "video/mp4",
      metadata: {
        person: personSlug,
        category: plan.category,
        source: plan.sourceId,
        start: String(plan.start),
      },
    });

    try {
      const jpg = await fs.readFile(thumbPath);
      await r2PutObject({
        key: thumbKey,
        body: jpg,
        contentType: "image/jpeg",
      });
    } catch {
      // thumb optional
    }

    const asset: LibraryAsset = {
      assetId,
      number,
      niche: NICHE,
      nicheSlug: NICHE_SLUG,
      person: plan.person,
      personSlug,
      mediaType: "raw_footage",
      category: plan.category,
      categories: [plan.category],
      r2Key,
      thumbKey,
      sourceUrl: `https://www.youtube.com/watch?v=${plan.sourceId}`,
      queryUsed: plan.frameHash,
      title: `${plan.person} ${plan.start.toFixed(1)}s-${plan.end.toFixed(1)}s (${plan.category})`,
      createdAt: new Date().toISOString(),
    };

    idx.assets.push(asset);
    indexes.set(plan.person, idx);
    uploaded += 1;
    console.log(`[upload] ${assetId} conf=${plan.confidence.toFixed(2)} cat=${plan.category}`);
  });

  return { sourceId, labels: labels.length, plans: plans.length, uploaded };
}

async function main() {
  if (!r2Configured()) {
    throw new Error("R2 not configured. Load .env.library (R2_* vars).");
  }

  const workRoot = path.join(config.storagePath, "royal-raw");
  const sourcesDir = path.join(workRoot, "sources");
  await fs.mkdir(sourcesDir, { recursive: true });

  const only = (process.env.SOURCE_ID || "").trim();
  const onlySet = new Set(
    (process.env.SOURCE_IDS || "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const files = (await fs.readdir(sourcesDir))
    .filter((f) => /\.(mp4|mkv|webm|mov)$/i.test(f))
    .filter((f) => {
      const id = path.basename(f, path.extname(f));
      if (only) return id === only;
      if (onlySet.size) return onlySet.has(id);
      return true;
    })
    .map((f) => path.join(sourcesDir, f));

  if (!files.length) {
    throw new Error(`No videos in ${sourcesDir}. Download first.`);
  }

  console.log(`[ingest] videos=${files.length} niche=${NICHE}`);

  // Warm OpenAI + quick sanity
  await chatJson<{ ok: boolean }>({
    system: "Return JSON {\"ok\":true}",
    user: "ping",
  }).catch(() => ({ ok: true }));

  const indexes = new Map<PersonName, PersonLibraryIndex>();
  for (const person of PEOPLE) {
    indexes.set(person, await loadOrCreatePersonIndex(person));
  }

  // Process videos with limited parallelism (2) — vision-heavy
  const summaries = await mapPool(files, 2, async (file) => processVideo(file, workRoot, indexes));

  await savePersonAndRollup(indexes);

  const byPerson: Record<string, number> = {};
  for (const person of PEOPLE) {
    const idx = indexes.get(person);
    byPerson[person] = idx?.assets.filter((a) => a.mediaType === "raw_footage").length || 0;
  }

  const summary = {
    ok: true,
    niche: NICHE,
    nicheSlug: NICHE_SLUG,
    videos: summaries,
    rawFootageByPerson: byPerson,
    totalRaw: Object.values(byPerson).reduce((a, b) => a + b, 0),
  };
  await fs.writeFile(path.join(workRoot, "ingest-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
