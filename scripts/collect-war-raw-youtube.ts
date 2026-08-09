/**
 * War YouTube raw ingest from channel videos:
 * - Keep real Iran / ships / oil / military camera footage
 * - REJECT custom map animations, yellow editor text, graphic overlays
 * - Blur channel star logo (small square, top-right) on every kept clip
 *
 * Usage:
 *   npx tsx --env-file=.env --env-file=.env.library scripts/collect-war-raw-youtube.ts
 *   WAR_RAW_CONCURRENCY=3 WAR_RAW_CLIPS_PER_VIDEO=28 npx tsx ...
 */
import "dotenv/config";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { getOpenAI } from "../server/openaiClient.js";
import { optionalEnv, ROOT_DIR } from "../server/config.js";
import { r2Configured, r2GetJson, r2PutJson, r2PutObject } from "../server/library/r2.js";
import { WAR_TOPICS, rebuildWarNicheIndex } from "../server/library/collectWar.js";
import type {
  LibraryAsset,
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "../server/library/types.js";
import { slugify } from "../server/library/types.js";

type Source = {
  videoId: string;
  url: string;
  titleHint: string;
  /** Preferred war library topic folder */
  topic: string;
  group: string;
};

const SOURCES: Source[] = [
  {
    videoId: "ADwttWbjoSk",
    url: "https://www.youtube.com/watch?v=ADwttWbjoSk",
    titleHint: "Iran oil fields collapse",
    topic: "Iran oil fields raw",
    group: "Iran Military",
  },
  {
    videoId: "T5cLizs0_hQ",
    url: "https://www.youtube.com/watch?v=T5cLizs0_hQ",
    titleHint: "Iran fear / destroyed",
    topic: "Iran military raw",
    group: "Iran Military",
  },
  {
    videoId: "cTV01f6iWnM",
    url: "https://www.youtube.com/watch?v=cTV01f6iWnM",
    titleHint: "Iran / war footage",
    topic: "Iran ships and navy raw",
    group: "Iran Military",
  },
  {
    videoId: "EUqJJld5Q_Y",
    url: "https://www.youtube.com/watch?v=EUqJJld5Q_Y",
    titleHint: "Iran / military",
    topic: "Iran military raw",
    group: "Iran Military",
  },
  {
    videoId: "cwsgzvv3OPU",
    url: "https://www.youtube.com/watch?v=cwsgzvv3OPU",
    titleHint: "Iran / ships",
    topic: "Iran ships and navy raw",
    group: "Iran Military",
  },
  {
    videoId: "_ntqfNC39tc",
    url: "https://www.youtube.com/watch?v=_ntqfNC39tc",
    titleHint: "Iran / conflict",
    topic: "Iran conflict raw",
    group: "Iran Military",
  },
  {
    videoId: "q7mPAufXv6U",
    url: "https://www.youtube.com/watch?v=q7mPAufXv6U",
    titleHint: "Iran / navy",
    topic: "Iran ships and navy raw",
    group: "Iran Military",
  },
  {
    videoId: "lO7cmPozLA4",
    url: "https://www.youtube.com/watch?v=lO7cmPozLA4",
    titleHint: "Iran / war",
    topic: "Iran conflict raw",
    group: "Iran Military",
  },
];

const WORK_DIR = path.resolve(ROOT_DIR, "storage", "war-raw-ingest");
const CLIP_SECONDS = Math.max(2, Math.min(5, Number(process.env.WAR_RAW_CLIP_SECONDS || 4)));
const CLIPS_PER_VIDEO = Math.max(8, Number(process.env.WAR_RAW_CLIPS_PER_VIDEO || 28));
/** Min gap between clip starts so cuts stay unique / non-overlapping */
const MIN_CLIP_GAP = CLIP_SECONDS + 1.5;
const SAMPLE_EVERY = Math.max(4, Number(process.env.WAR_RAW_SAMPLE_EVERY || 8));
const CONCURRENCY = Math.max(1, Number(process.env.WAR_RAW_CONCURRENCY || 3));
const MODEL = process.env.WAR_RAW_MODEL?.trim() || "gpt-5.4-mini";
const BATCH = Math.max(4, Math.min(12, Number(process.env.WAR_RAW_VISION_BATCH || 8)));
/** Prefer starting near this second when URL has &t= (cTV01f6iWnM). */
const SEEK_HINTS: Record<string, number> = { cTV01f6iWnM: 585 };

type FrameLabel = {
  t: number;
  usableRaw: boolean;
  qualityScore: number;
  topicBucket: string;
  tags: string[];
  notes?: string;
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
      else reject(new Error(`${cmd} failed (${code}): ${stderr.slice(-1400)}`));
    });
  });
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

function cookiesArgs(): string[] {
  const envPath = optionalEnv("YT_COOKIES_PATH") || optionalEnv("YOUTUBE_COOKIES_PATH");
  const candidates = [
    envPath,
    path.resolve(ROOT_DIR, ".tmp-cookies.txt"),
    path.resolve(ROOT_DIR, ".tmp-cookies2.txt"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      if (fssync.existsSync(p) && fssync.statSync(p).size > 500) {
        return ["--cookies", p];
      }
    } catch {
      /* ignore */
    }
  }
  // Prefer no cookies first (public videos). Browser DB often locked on Windows.
  if (process.env.WAR_RAW_COOKIES_BROWSER?.trim()) {
    return ["--cookies-from-browser", process.env.WAR_RAW_COOKIES_BROWSER.trim()];
  }
  return [];
}

async function downloadSource(source: Source, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const outTemplate = path.join(dir, "source.%(ext)s");
  const attempts: string[][] = [
    cookiesArgs(),
    ["--cookies-from-browser", "edge"],
    ["--cookies-from-browser", "firefox"],
    [],
  ];
  let lastErr: unknown;
  for (const cookieArgs of attempts) {
    try {
      // clean partials
      const files = await fs.readdir(dir).catch(() => [] as string[]);
      for (const f of files) {
        if (/^source\./i.test(f)) await fs.unlink(path.join(dir, f)).catch(() => undefined);
      }
      const args = [
        "--no-playlist",
        "--no-write-subs",
        "--no-write-auto-subs",
        "--no-embed-subs",
        "--max-filesize",
        "700M",
        "-f",
        "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/best[height<=720]/best",
        "--merge-output-format",
        "mp4",
        "-o",
        outTemplate,
        ...cookieArgs,
        source.url,
      ];
      await run("yt-dlp", args);
      const after = await fs.readdir(dir);
      const video = after.find((f) => /^source\.(mp4|mkv|webm|mov)$/i.test(f));
      if (!video) throw new Error(`Downloaded file missing for ${source.videoId}`);
      return path.join(dir, video);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[war-raw] yt-dlp attempt failed (${cookieArgs.join(" ") || "no-cookies"}): ${msg.slice(0, 160)}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function sampleFrame(input: string, t: number, outJpg: string): Promise<string> {
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(t),
    "-i",
    input,
    "-frames:v",
    "1",
    "-vf",
    "scale='min(512,iw)':-2",
    "-q:v",
    "5",
    outJpg,
  ]);
  return outJpg;
}

/**
 * Small square cover over channel star logo (top-right).
 * Fixed coords after scale/crop to 1280x720 — delogo does not accept iw/ih exprs on this ffmpeg.
 */
function starLogoBlurFilter(): string {
  return [
    "scale=-2:720",
    "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)'",
    "setsar=1",
    "delogo=x=1160:y=22:w=95:h=95:show=0",
  ].join(",");
}

async function makeClip(input: string, output: string, start: number): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(start),
    "-i",
    input,
    "-t",
    String(CLIP_SECONDS),
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    starLogoBlurFilter(),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ]);
}

async function makeThumb(input: string, output: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-ss",
    "0.6",
    "-i",
    input,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    output,
  ]);
}

async function classifyBatch(
  source: Source,
  frames: Array<{ t: number; b64: string }>
): Promise<FrameLabel[]> {
  if (!frames.length) return [];
  const openai = getOpenAI();
  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `Label RAW war documentary frames from a YouTube video about "${source.titleHint}".

KEEP usableRaw=true ONLY for real camera / archive / news / satellite / drone / thermal footage of:
- Iran ships, IRGC boats, navy vessels, tankers, Strait of Hormuz shipping
- Oil fields, pumpjacks, refineries, fires, industrial sites
- Military aircraft, missiles, bases, soldiers, combat camera
- Clean B-roll of ports, deserts, seas relevant to Iran/conflict

REJECT usableRaw=false when the frame has EDITOR GRAPHICS:
- Custom animated maps (country highlight, ship icons on map, "IRAN" title cards)
- Yellow / neon editor text boxes, timestamps like "06:41 AM", lower-thirds headlines
- Thumbnail-style text, meme overlays, big channel branding panels
- Slideshow composites, motion graphics, CGI map flyovers
- Pure talking-head presenter with no useful B-roll

Tiny channel star watermark alone is OK (we blur it later) — do NOT reject only for a small corner star.

Also return:
- qualityScore 0-100
- topicBucket one of: iran-ships, iran-oil, iran-military, explosion-fire, shipping-hormuz, other-usable, reject
- tags: short list
- notes: brief

Return JSON:
{"frames":[{"index":0,"usableRaw":true,"qualityScore":80,"topicBucket":"iran-oil","tags":["pumpjack","desert"],"notes":"..."}]}`,
    },
  ];
  for (const f of frames) {
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${f.b64}`, detail: "low" },
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
          "You filter war documentary raw footage. Reject map animations and yellow editor text. Return strict JSON.",
      },
      { role: "user", content },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: {
    frames?: Array<{
      index?: number;
      usableRaw?: boolean;
      qualityScore?: number;
      topicBucket?: string;
      tags?: string[];
      notes?: string;
    }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return frames.map((f) => ({
      t: f.t,
      usableRaw: false,
      qualityScore: 0,
      topicBucket: "reject",
      tags: [],
    }));
  }

  return frames.map((f, i) => {
    const row = parsed.frames?.find((x) => x.index === i) || parsed.frames?.[i];
    const qualityScore = Math.max(0, Math.min(100, Number(row?.qualityScore ?? 0)));
    const bucket = String(row?.topicBucket || "other-usable");
    const usableRaw =
      row?.usableRaw === true && qualityScore >= 55 && bucket !== "reject";
    return {
      t: f.t,
      usableRaw,
      qualityScore,
      topicBucket: bucket,
      tags: Array.isArray(row?.tags) ? row!.tags!.map(String).slice(0, 8) : [],
      notes: row?.notes ? String(row.notes) : undefined,
    };
  });
}

function resolveTopic(source: Source, bucket: string): { topic: string; group: string } {
  if (bucket === "iran-ships" || bucket === "shipping-hormuz") {
    return { topic: "Iran ships and navy raw", group: "Iran Military" };
  }
  if (bucket === "iran-oil") {
    return { topic: "Iran oil fields raw", group: "Iran Military" };
  }
  if (bucket === "explosion-fire") {
    return { topic: "Iran explosion aftermath", group: "Iran Military" };
  }
  if (bucket === "iran-military") {
    return { topic: "Iran military raw", group: "Iran Military" };
  }
  return { topic: source.topic, group: source.group };
}

async function loadIndex(topic: string, group: string): Promise<PersonLibraryIndex> {
  const niche = "War";
  const nicheSlug = "war";
  const personSlug = slugify(topic);
  return (
    (await r2GetJson<PersonLibraryIndex>(`library/${nicheSlug}/${personSlug}/index.json`)) || {
      niche,
      nicheSlug,
      person: topic,
      personSlug,
      group,
      updatedAt: new Date().toISOString(),
      counts: { images: 0, raw_footage: 0, byCategory: {} },
      assets: [],
    }
  );
}

async function persistIndex(idx: PersonLibraryIndex): Promise<void> {
  const images = idx.assets.filter((a) => a.mediaType === "image");
  const raw = idx.assets.filter((a) => a.mediaType === "raw_footage");
  const byCategory: Record<string, number> = {};
  for (const a of idx.assets) byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  idx.counts = { images: images.length, raw_footage: raw.length, byCategory };
  idx.updatedAt = new Date().toISOString();
  await r2PutJson(`library/${idx.nicheSlug}/${idx.personSlug}/index.json`, idx);
  await r2PutJson(`library/${idx.nicheSlug}/${idx.personSlug}/manifest.json`, {
    person: idx.person,
    personSlug: idx.personSlug,
    niche: idx.niche,
    nicheSlug: idx.nicheSlug,
    group: idx.group,
    imageCount: idx.counts.images,
    rawCount: idx.counts.raw_footage,
    assets: idx.assets.map((a) => ({
      assetId: a.assetId,
      number: a.number,
      mediaType: a.mediaType,
      category: a.category,
      r2Key: a.r2Key,
      description: a.description,
    })),
  });
}

async function processSource(source: Source): Promise<{
  videoId: string;
  kept: number;
  rejected: number;
  clips: number;
}> {
  const dir = path.join(WORK_DIR, source.videoId);
  await fs.mkdir(dir, { recursive: true });
  console.log(`[war-raw] download ${source.videoId} (${source.titleHint})`);
  const sourcePath = await downloadSource(source, dir);
  const duration = await ffprobeDuration(sourcePath);
  console.log(`[war-raw] ${source.videoId} duration=${duration.toFixed(1)}s`);

  const seekHint = SEEK_HINTS[source.videoId] || 0;
  const guard = Math.min(20, duration * 0.03);
  const sampleTs: number[] = [];
  // Bias samples around seek hint if present
  if (seekHint > 0 && seekHint < duration - 30) {
    for (let t = Math.max(guard, seekHint - 60); t < Math.min(duration - guard, seekHint + 180); t += SAMPLE_EVERY) {
      sampleTs.push(Number(t.toFixed(2)));
    }
  }
  for (let t = guard; t < duration - guard; t += SAMPLE_EVERY) {
    const n = Number(t.toFixed(2));
    if (!sampleTs.some((x) => Math.abs(x - n) < 1)) sampleTs.push(n);
  }
  sampleTs.sort((a, b) => a - b);

  const framesDir = path.join(dir, "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const frames: Array<{ t: number; b64: string }> = [];
  for (const t of sampleTs.slice(0, 90)) {
    const jpg = path.join(framesDir, `t${String(Math.floor(t)).padStart(5, "0")}.jpg`);
    try {
      await sampleFrame(sourcePath, t, jpg);
      const buf = await fs.readFile(jpg);
      frames.push({ t, b64: buf.toString("base64") });
    } catch (err) {
      console.warn(`[war-raw] frame fail t=${t}`, err instanceof Error ? err.message : err);
    }
  }

  const labels: FrameLabel[] = [];
  for (let i = 0; i < frames.length; i += BATCH) {
    const batch = frames.slice(i, i + BATCH);
    try {
      const part = await classifyBatch(source, batch);
      labels.push(...part);
      const keep = part.filter((p) => p.usableRaw).length;
      console.log(
        `[war-raw] ${source.videoId} classify ${i + 1}-${i + batch.length}/${frames.length} keep=${keep}`
      );
    } catch (err) {
      console.error(`[war-raw] classify fail`, err instanceof Error ? err.message : err);
      for (const f of batch) {
        labels.push({
          t: f.t,
          usableRaw: false,
          qualityScore: 0,
          topicBucket: "reject",
          tags: [],
        });
      }
    }
  }

  const usable = labels
    .filter((l) => l.usableRaw && l.qualityScore >= 55)
    .sort((a, b) => b.qualityScore - a.qualityScore);
  const picked: FrameLabel[] = [];
  for (const u of usable) {
    if (picked.length >= CLIPS_PER_VIDEO) break;
    if (picked.some((p) => Math.abs(p.t - u.t) < MIN_CLIP_GAP)) continue;
    picked.push(u);
  }

  let clips = 0;
  const indexCache = new Map<string, PersonLibraryIndex>();

  for (const label of picked) {
    const dest = resolveTopic(source, label.topicBucket);
    const personSlug = slugify(dest.topic);
    let idx = indexCache.get(personSlug);
    if (!idx) {
      idx = await loadIndex(dest.topic, dest.group);
      indexCache.set(personSlug, idx);
    }

    const seenHashes = new Set(
      idx.assets.filter((a) => a.contentHash).map((a) => a.contentHash as string)
    );

    const nextNum =
      Math.max(0, ...idx.assets.filter((a) => a.mediaType === "raw_footage").map((a) => a.number), 0) +
      1;
    const assetId = `war-${personSlug}-raw-${String(nextNum).padStart(4, "0")}`;
    const start = Math.max(0, label.t - CLIP_SECONDS / 2);
    const clipPath = path.join(dir, `${assetId}.mp4`);
    const thumbPath = path.join(dir, `${assetId}.jpg`);
    try {
      await makeClip(sourcePath, clipPath, start);
      await makeThumb(clipPath, thumbPath);
    } catch (err) {
      console.warn(`[war-raw] clip fail ${assetId}`, err instanceof Error ? err.message : err);
      continue;
    }

    const mp4 = await fs.readFile(clipPath);
    const hash = createHash("md5").update(mp4).digest("hex").slice(0, 16);
    if (seenHashes.has(hash)) {
      console.log(`[war-raw] skip duplicate hash ${assetId}`);
      continue;
    }
    seenHashes.add(hash);
    const thumb = await fs.readFile(thumbPath).catch(() => null);
    const r2Key = `library/war/${personSlug}/raw/${assetId}.mp4`;
    const thumbKey = `library/war/${personSlug}/thumbs/${assetId}.jpg`;
    await r2PutObject({ key: r2Key, body: mp4, contentType: "video/mp4" });
    if (thumb) {
      await r2PutObject({ key: thumbKey, body: thumb, contentType: "image/jpeg" });
    }
    const description = [
      `Raw war clip from YouTube ${source.videoId} @ ${start.toFixed(1)}s (${CLIP_SECONDS}s).`,
      label.notes || `${label.topicBucket} documentary footage.`,
      "Channel star logo blurred (top-right). No custom map/text overlays.",
      label.tags.length ? `Tags: ${label.tags.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const asset: LibraryAsset = {
      assetId,
      number: nextNum,
      niche: "War",
      nicheSlug: "war",
      person: dest.topic,
      personSlug,
      group: dest.group,
      mediaType: "raw_footage",
      category: slugify(label.topicBucket),
      categories: [
        "youtube-raw",
        "star-logo-blurred",
        slugify(label.topicBucket),
        ...label.tags.map(slugify),
      ].filter(Boolean),
      r2Key,
      thumbKey: thumb ? thumbKey : undefined,
      sourceUrl: source.url,
      contentHash: hash,
      queryUsed: source.titleHint,
      title: source.titleHint,
      description,
      startTime: start,
      endTime: start + CLIP_SECONDS,
      duration: CLIP_SECONDS,
      createdAt: new Date().toISOString(),
    };
    idx.assets.push(asset);
    clips += 1;
  }

  for (const idx of indexCache.values()) {
    await persistIndex(idx);
  }

  return {
    videoId: source.videoId,
    kept: usable.length,
    rejected: labels.length - usable.length,
    clips,
  };
}

async function rebuildWarIndexIncludingRaw(): Promise<void> {
  await rebuildWarNicheIndex();
  const nicheSlug = "war";
  const niche =
    (await r2GetJson<NicheLibraryIndex>(`library/${nicheSlug}/index.json`)) || {
      niche: "War",
      nicheSlug,
      updatedAt: new Date().toISOString(),
      people: [],
    };
  const bySlug = new Map(niche.people.map((p) => [p.personSlug, p]));
  const extraTopics = [
    ...new Set(SOURCES.map((s) => s.topic)),
    "Iran oil fields raw",
    "Iran ships and navy raw",
    "Iran military raw",
    "Iran conflict raw",
  ];
  for (const topic of extraTopics) {
    const personSlug = slugify(topic);
    const idx = await r2GetJson<PersonLibraryIndex>(`library/${nicheSlug}/${personSlug}/index.json`);
    if (!idx) continue;
    bySlug.set(personSlug, {
      person: idx.person,
      personSlug: idx.personSlug,
      images: idx.counts.images,
      raw_footage: idx.counts.raw_footage,
      group: idx.group || "Iran Military",
    });
  }
  // Also keep all WAR_TOPICS already written by rebuildWarNicheIndex
  for (const t of WAR_TOPICS) {
    const personSlug = slugify(t.topic);
    if (bySlug.has(personSlug)) continue;
    const idx = await r2GetJson<PersonLibraryIndex>(`library/${nicheSlug}/${personSlug}/index.json`);
    if (!idx) continue;
    bySlug.set(personSlug, {
      person: idx.person,
      personSlug: idx.personSlug,
      images: idx.counts.images,
      raw_footage: idx.counts.raw_footage,
      group: idx.group || t.group,
    });
  }
  niche.people = [...bySlug.values()].sort(
    (a, b) => (a.group || "").localeCompare(b.group || "") || a.person.localeCompare(b.person)
  );
  niche.updatedAt = new Date().toISOString();
  await r2PutJson(`library/${nicheSlug}/index.json`, niche);

  const root =
    (await r2GetJson<RootLibraryIndex>(`library/index.json`)) ||
    ({ updatedAt: "", niches: [] } satisfies RootLibraryIndex);
  const map = new Map(root.niches.map((n) => [n.nicheSlug, n]));
  map.set("war", {
    niche: "War",
    nicheSlug: "war",
    peopleCount: niche.people.length,
    images: niche.people.reduce((n, p) => n + p.images, 0),
    raw_footage: niche.people.reduce((n, p) => n + p.raw_footage, 0),
  });
  await r2PutJson(`library/index.json`, {
    updatedAt: new Date().toISOString(),
    niches: [...map.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  });
}

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured");
  await fs.mkdir(WORK_DIR, { recursive: true });
  console.log(
    `[war-raw] sources=${SOURCES.length} clips/video<=${CLIPS_PER_VIDEO} sampleEvery=${SAMPLE_EVERY}s concurrency=${CONCURRENCY} model=${MODEL}`
  );
  console.log(`[war-raw] star logo: small top-right boxblur on every kept clip`);

  const queue = [...SOURCES];
  const results: Array<{ videoId: string; kept: number; rejected: number; clips: number; error?: string }> =
    [];

  async function worker(id: number) {
    while (queue.length) {
      const source = queue.shift();
      if (!source) return;
      try {
        console.log(`[w${id}] start ${source.videoId}`);
        const r = await processSource(source);
        results.push(r);
        console.log(`[w${id}] done ${source.videoId} clips=${r.clips} keptFrames=${r.kept}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[w${id}] fail ${source.videoId}`, msg.slice(0, 300));
        results.push({ videoId: source.videoId, kept: 0, rejected: 0, clips: 0, error: msg });
      }
    }
  }

  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
  await rebuildWarIndexIncludingRaw();

  const summary = {
    ok: results.every((r) => !r.error),
    elapsedMin: Number(((Date.now() - started) / 60000).toFixed(1)),
    totalClips: results.reduce((n, r) => n + r.clips, 0),
    results,
  };
  const summaryPath = path.join(ROOT_DIR, "storage", "war-raw-youtube-summary.json");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[war-raw] summary → ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
