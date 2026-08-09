/**
 * MASSIVE open War library builder — NOT the user's channel.
 * Sources:
 *   1) Internet Archive (public domain / archival military films)
 *   2) YouTube search (any channel except blocklisted personal IDs)
 *
 * Safe index merges (re-read before write) so it can run beside other collectors.
 *
 * Usage:
 *   npx tsx --env-file=.env --env-file=.env.library scripts/collect-war-open-library.ts
 *   WAR_OPEN_SOURCES=archive,youtube WAR_OPEN_PER_TOPIC=3 WAR_OPEN_CLIPS=10 WAR_OPEN_CONCURRENCY=4 npx tsx ...
 *   WAR_OPEN_LIMIT_TOPICS=8 npx tsx ...
 * Resume discovery + GPT quality filter @ 720p:
 *   WAR_OPEN_RESUME=1 WAR_OPEN_HEIGHT=720 WAR_OPEN_CONCURRENCY=6 npx tsx ...
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { getOpenAI } from "../server/openaiClient.js";
import { ROOT_DIR } from "../server/config.js";
import { r2Configured, r2GetJson, r2PutJson, r2PutObject } from "../server/library/r2.js";
import { WAR_TOPICS, rebuildWarNicheIndex } from "../server/library/collectWar.js";
import type {
  LibraryAsset,
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "../server/library/types.js";
import { slugify } from "../server/library/types.js";

type Topic = (typeof WAR_TOPICS)[number];

/** User-provided channel videos — never treat as "open" library sources */
const BLOCK_VIDEO_IDS = new Set([
  "ADwttWbjoSk",
  "T5cLizs0_hQ",
  "cTV01f6iWnM",
  "EUqJJld5Q_Y",
  "cwsgzvv3OPU",
  "_ntqfNC39tc",
  "q7mPAufXv6U",
  "lO7cmPozLA4",
]);

const WORK = path.resolve(ROOT_DIR, "storage", "war-open-library");
const SOURCES = (process.env.WAR_OPEN_SOURCES || "archive,youtube")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const PER_TOPIC = Math.max(1, Math.min(5, Number(process.env.WAR_OPEN_PER_TOPIC || 3)));
const CLIPS = Math.max(4, Number(process.env.WAR_OPEN_CLIPS || 10));
const SAMPLE_EVERY = Math.max(8, Number(process.env.WAR_OPEN_SAMPLE_EVERY || 20));
const MAX_FRAMES = Math.max(6, Number(process.env.WAR_OPEN_MAX_FRAMES || 12));
const CLIP_SEC = Math.max(2, Math.min(5, Number(process.env.WAR_OPEN_CLIP_SECONDS || 4)));
const MIN_CLIP_GAP = CLIP_SEC + 1.5;
const CONCURRENCY = Math.max(1, Number(process.env.WAR_OPEN_CONCURRENCY || 6));
const MODEL = process.env.WAR_RAW_MODEL?.trim() || "gpt-5.4-mini";
const BATCH = Math.max(4, Math.min(12, Number(process.env.WAR_RAW_VISION_BATCH || 10)));
const LIMIT_TOPICS = Math.max(0, Number(process.env.WAR_OPEN_LIMIT_TOPICS || 0));
const MAX_DUR = Number(process.env.WAR_OPEN_MAX_DURATION || 1200);
const MIN_DUR = Number(process.env.WAR_OPEN_MIN_DURATION || 45);
/** Skip GPT frame judge — evenly spaced unique cuts (much faster, lower quality). Off by default. */
const FAST = process.env.WAR_OPEN_FAST === "1" || process.env.WAR_OPEN_FAST === "true";
/** Reuse storage/war-open-discovered.json instead of re-searching. */
const RESUME = process.env.WAR_OPEN_RESUME !== "0";
const DISCOVERED_PATH = path.join(ROOT_DIR, "storage", "war-open-discovered.json");
/** Clip encode height — at least 720p for documentary use. */
const HEIGHT = Math.max(720, Math.min(1080, Number(process.env.WAR_OPEN_HEIGHT || 720)));

type Found = {
  id: string;
  title: string;
  url: string;
  source: "archive" | "youtube";
  topic: Topic;
  query: string;
};

type FrameLabel = {
  t: number;
  usableRaw: boolean;
  qualityScore: number;
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

function archiveQuery(topic: Topic): string {
  const core = topic.topic.replace(/[^\w\s-]/g, " ").trim();
  return `mediatype:(movies) AND (${core})`;
}

async function searchArchive(topic: Topic, n: number): Promise<Found[]> {
  const q = archiveQuery(topic);
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", q);
  url.searchParams.append("fl[]", "identifier");
  url.searchParams.append("fl[]", "title");
  url.searchParams.append("fl[]", "downloads");
  url.searchParams.append("sort[]", "downloads desc");
  url.searchParams.set("rows", String(n + 4));
  url.searchParams.set("page", "1");
  url.searchParams.set("output", "json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`archive search ${res.status}`);
  const data = (await res.json()) as {
    response?: { docs?: Array<{ identifier?: string; title?: string }> };
  };
  const out: Found[] = [];
  for (const d of data.response?.docs || []) {
    if (!d.identifier || !d.title) continue;
    const title = d.title.toLowerCase();
    if (/\b(minecraft|gameplay|cartoon|animation short)\b/i.test(title)) continue;
    out.push({
      id: `ia-${d.identifier}`,
      title: d.title,
      url: `https://archive.org/details/${d.identifier}`,
      source: "archive",
      topic,
      query: q,
    });
    if (out.length >= n) break;
  }
  return out;
}

async function searchYoutube(topic: Topic, n: number): Promise<Found[]> {
  const queries = [
    `${topic.topic} archival military footage`,
    `${topic.topic} documentary real footage navy OR air force OR combat`,
  ];
  const out: Found[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    if (out.length >= n) break;
    try {
      const { stdout } = await run("yt-dlp", [
        "--flat-playlist",
        "--skip-download",
        "-J",
        `ytsearch${n + 3}:${query}`,
      ]);
      const data = JSON.parse(stdout) as {
        entries?: Array<{ id?: string; title?: string }>;
      };
      for (const e of data.entries || []) {
        if (!e.id || !e.title) continue;
        if (BLOCK_VIDEO_IDS.has(e.id) || seen.has(e.id)) continue;
        const title = e.title.toLowerCase();
        if (/\b(reaction|minecraft|war thunder|gta|roblox)\b/i.test(title)) continue;
        seen.add(e.id);
        out.push({
          id: e.id,
          title: e.title,
          url: `https://www.youtube.com/watch?v=${e.id}`,
          source: "youtube",
          topic,
          query,
        });
        if (out.length >= n) break;
      }
    } catch (err) {
      console.warn(`[open] yt search fail ${topic.topic}`, err instanceof Error ? err.message.slice(0, 120) : err);
    }
  }
  return out;
}

async function discover(topics: Topic[]): Promise<Found[]> {
  const found: Found[] = [];
  const used = new Set<string>();
  const queue = [...topics];

  async function worker() {
    while (queue.length) {
      const topic = queue.shift();
      if (!topic) return;
      const bucket: Found[] = [];
      try {
        if (SOURCES.includes("archive")) {
          bucket.push(...(await searchArchive(topic, PER_TOPIC)));
        }
      } catch (err) {
        console.warn(`[open] archive fail ${topic.topic}`, err instanceof Error ? err.message.slice(0, 100) : err);
      }
      try {
        if (SOURCES.includes("youtube")) {
          bucket.push(...(await searchYoutube(topic, PER_TOPIC)));
        }
      } catch (err) {
        console.warn(`[open] youtube fail ${topic.topic}`, err instanceof Error ? err.message.slice(0, 100) : err);
      }

      let added = 0;
      for (const f of bucket) {
        if (used.has(f.id)) continue;
        used.add(f.id);
        found.push(f);
        added += 1;
      }
      console.log(`[open] discover ${topic.group} / ${topic.topic}: +${added}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, topics.length) }, () => worker()));
  return found;
}

async function download(found: Found, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const existing = (await fs.readdir(dir).catch(() => [])).find((f) =>
    /^source\.(mp4|mkv|webm|mov)$/i.test(f)
  );
  if (existing) return path.join(dir, existing);
  const outTemplate = path.join(dir, "source.%(ext)s");
  await run("yt-dlp", [
    "--no-playlist",
    "--no-write-subs",
    "--max-filesize",
    "500M",
    "--match-filter",
    `duration >= ${MIN_DUR} & duration <= ${MAX_DUR}`,
    "-f",
    `bv*[height<=${HEIGHT}]+ba/b[height<=${HEIGHT}]/best[height<=${HEIGHT}]/best`,
    "--merge-output-format",
    "mp4",
    "-o",
    outTemplate,
    found.url,
  ]);
  const files = await fs.readdir(dir);
  const video = files.find((f) => /^source\.(mp4|mkv|webm|mov)$/i.test(f));
  if (!video) throw new Error(`missing download ${found.id}`);
  return path.join(dir, video);
}

async function sampleFrame(input: string, t: number, outJpg: string): Promise<void> {
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
}

async function makeClip(input: string, output: string, start: number): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(start),
    "-i",
    input,
    "-t",
    String(CLIP_SEC),
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    `scale=-2:${HEIGHT},crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',setsar=1`,
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
    "0.4",
    "-i",
    input,
    "-frames:v",
    "1",
    "-q:v",
    "6",
    output,
  ]);
}

function titleLooksRelevant(topic: Topic, title: string): boolean {
  const hay = title.toLowerCase();
  if (/\b(minecraft|war thunder|gta|roblox|reaction|gameplay|c64|commodore)\b/i.test(hay)) {
    return false;
  }
  const keys = [
    topic.topic.toLowerCase(),
    ...topic.tags.map((t) => t.replace(/-/g, " ")),
    ...topic.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
  ];
  let hits = 0;
  for (const k of keys) {
    if (k.length > 2 && hay.includes(k)) hits += 1;
  }
  return hits >= 1;
}

function fastPickTimes(duration: number, count: number): number[] {
  const guard = Math.min(20, duration * 0.06);
  const usable = Math.max(CLIP_SEC * 2, duration - guard * 2);
  const n = Math.max(1, Math.min(count, Math.floor(usable / MIN_CLIP_GAP)));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(Number((guard + ((i + 0.5) / n) * usable).toFixed(2)));
  }
  return out;
}

async function classify(
  topic: Topic,
  frames: Array<{ t: number; b64: string }>
): Promise<FrameLabel[]> {
  if (!frames.length) return [];
  const openai = getOpenAI();
  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `War library topic "${topic.topic}" (${topic.group}). Tags: ${topic.tags.join(", ")}.

KEEP usableRaw=true only for REAL archival/camera footage clearly related to this topic.
REJECT map animations, yellow editor text, slideshows, unrelated content, games.

JSON: {"frames":[{"index":0,"usableRaw":true,"qualityScore":80,"tags":["ship"],"notes":"..."}]}`,
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
      { role: "system", content: "Filter open war archival footage. JSON only." },
      { role: "user", content },
    ],
  });
  let parsed: {
    frames?: Array<{
      index?: number;
      usableRaw?: boolean;
      qualityScore?: number;
      tags?: string[];
      notes?: string;
    }>;
  };
  try {
    parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  } catch {
    return frames.map((f) => ({ t: f.t, usableRaw: false, qualityScore: 0, tags: [] }));
  }
  return frames.map((f, i) => {
    const row = parsed.frames?.find((x) => x.index === i) || parsed.frames?.[i];
    const qualityScore = Math.max(0, Math.min(100, Number(row?.qualityScore ?? 0)));
    return {
      t: f.t,
      usableRaw: row?.usableRaw === true && qualityScore >= 55,
      qualityScore,
      tags: Array.isArray(row?.tags) ? row!.tags!.map(String).slice(0, 8) : [],
      notes: row?.notes ? String(row.notes) : undefined,
    };
  });
}

async function mergePersist(topic: Topic, newAssets: LibraryAsset[]): Promise<void> {
  const nicheSlug = "war";
  const personSlug = slugify(topic.topic);
  const key = `library/${nicheSlug}/${personSlug}/index.json`;
  const live =
    (await r2GetJson<PersonLibraryIndex>(key)) ||
    ({
      niche: "War",
      nicheSlug,
      person: topic.topic,
      personSlug,
      group: topic.group,
      updatedAt: new Date().toISOString(),
      counts: { images: 0, raw_footage: 0, byCategory: {} },
      assets: [],
    } satisfies PersonLibraryIndex);

  const map = new Map(live.assets.map((a) => [a.assetId, a]));
  for (const a of newAssets) map.set(a.assetId, a);
  live.assets = [...map.values()].sort((a, b) => a.number - b.number || a.assetId.localeCompare(b.assetId));
  const images = live.assets.filter((a) => a.mediaType === "image");
  const raw = live.assets.filter((a) => a.mediaType === "raw_footage");
  const byCategory: Record<string, number> = {};
  for (const a of live.assets) byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  live.counts = { images: images.length, raw_footage: raw.length, byCategory };
  live.group = live.group || topic.group;
  live.updatedAt = new Date().toISOString();
  await r2PutJson(key, live);
}

async function processOne(found: Found): Promise<{ clips: number; error?: string }> {
  const dir = path.join(WORK, found.source, found.id.replace(/[^\w.-]+/g, "_").slice(0, 80));
  console.log(`[open] ${found.source} → ${found.topic.topic} :: ${found.title.slice(0, 70)}`);

  // Cheap reject before download
  if (FAST && !titleLooksRelevant(found.topic, found.title) && found.source === "youtube") {
    return { clips: 0, error: "title-irrelevant" };
  }

  let sourcePath: string;
  try {
    sourcePath = await download(found, dir);
  } catch (err) {
    return { clips: 0, error: err instanceof Error ? err.message : String(err) };
  }
  const duration = await ffprobeDuration(sourcePath);
  if (duration < MIN_DUR) return { clips: 0, error: "short" };

  let picked: FrameLabel[] = [];

  if (FAST) {
    // Optional escape hatch only — evenly spaced cuts, no GPT
    picked = fastPickTimes(duration, CLIPS).map((t) => ({
      t,
      usableRaw: true,
      qualityScore: 70,
      tags: found.topic.tags.slice(0, 4),
      notes: "fast-mode evenly spaced cut",
    }));
  } else {
    const guard = Math.min(25, duration * 0.05);
    const step = Math.max(SAMPLE_EVERY, duration / Math.max(8, MAX_FRAMES));
    const ts: number[] = [];
    for (let t = guard; t < duration - guard; t += step) {
      ts.push(Number(t.toFixed(2)));
      if (ts.length >= MAX_FRAMES) break;
    }
    const framesDir = path.join(dir, "frames");
    await fs.mkdir(framesDir, { recursive: true });
    const frames: Array<{ t: number; b64: string }> = [];
    // Parallel frame extract
    await Promise.all(
      ts.map(async (t) => {
        const jpg = path.join(framesDir, `t${String(Math.floor(t)).padStart(5, "0")}.jpg`);
        try {
          await sampleFrame(sourcePath, t, jpg);
          frames.push({ t, b64: (await fs.readFile(jpg)).toString("base64") });
        } catch {
          /* skip */
        }
      })
    );
    frames.sort((a, b) => a.t - b.t);

    const labels: FrameLabel[] = [];
    for (let i = 0; i < frames.length; i += BATCH) {
      const batch = frames.slice(i, i + BATCH);
      try {
        labels.push(...(await classify(found.topic, batch)));
      } catch {
        for (const f of batch) labels.push({ t: f.t, usableRaw: false, qualityScore: 0, tags: [] });
      }
    }
    const usable = labels.filter((l) => l.usableRaw).sort((a, b) => b.qualityScore - a.qualityScore);
    for (const u of usable) {
      if (picked.length >= CLIPS) break;
      if (picked.some((p) => Math.abs(p.t - u.t) < MIN_CLIP_GAP)) continue;
      picked.push(u);
    }
  }

  const personSlug = slugify(found.topic.topic);
  const live = await r2GetJson<PersonLibraryIndex>(`library/war/${personSlug}/index.json`);
  let nextNum =
    Math.max(0, ...(live?.assets || []).filter((a) => a.mediaType === "raw_footage").map((a) => a.number), 0) +
    1;
  const seenHashes = new Set(
    (live?.assets || []).filter((a) => a.contentHash).map((a) => a.contentHash as string)
  );

  // Pre-allocate IDs so parallel encode/upload stays consistent
  const planned = picked.map((label) => {
    const number = nextNum++;
    return {
      label,
      number,
      assetId: `war-${personSlug}-open-${String(number).padStart(4, "0")}`,
      start: Math.max(0, label.t - CLIP_SEC / 2),
    };
  });

  const newAssets: LibraryAsset[] = [];
  const encodeConcurrency = 4;
  for (let i = 0; i < planned.length; i += encodeConcurrency) {
    const slice = planned.slice(i, i + encodeConcurrency);
    const built = await Promise.all(
      slice.map(async ({ label, number, assetId, start }) => {
        const clipPath = path.join(dir, `${assetId}.mp4`);
        const thumbPath = path.join(dir, `${assetId}.jpg`);
        try {
          await makeClip(sourcePath, clipPath, start);
          await makeThumb(clipPath, thumbPath);
        } catch {
          return null;
        }
        const mp4 = await fs.readFile(clipPath);
        const hash = createHash("md5").update(mp4).digest("hex").slice(0, 16);
        if (seenHashes.has(hash)) return null;
        seenHashes.add(hash);
        const thumb = await fs.readFile(thumbPath).catch(() => null);
        const r2Key = `library/war/${personSlug}/raw/${assetId}.mp4`;
        const thumbKey = `library/war/${personSlug}/thumbs/${assetId}.jpg`;
        await r2PutObject({ key: r2Key, body: mp4, contentType: "video/mp4" });
        if (thumb) await r2PutObject({ key: thumbKey, body: thumb, contentType: "image/jpeg" });
        return {
          assetId,
          number,
          niche: "War",
          nicheSlug: "war",
          person: found.topic.topic,
          personSlug,
          group: found.topic.group,
          mediaType: "raw_footage" as const,
          category: `open-${found.source}`,
          categories: [
            "youtube-raw",
            "open-library",
            found.source,
            FAST ? "fast-mode" : "vision-filtered",
            ...found.topic.tags.map(slugify),
            ...label.tags.map(slugify),
          ],
          r2Key,
          thumbKey: thumb ? thumbKey : undefined,
          sourceUrl: found.url,
          contentHash: hash,
          queryUsed: found.query,
          title: found.title.slice(0, 180),
          description: [
            `Open ${found.source} ${CLIP_SEC}s clip for "${found.topic.topic}" @ ${start.toFixed(1)}s.`,
            label.notes || "Public/archival documentary footage (not channel-owned).",
            `Use for: ${found.topic.topic} B-roll / cutaways in ${found.topic.group} sequences.`,
          ].join(" "),
          startTime: start,
          endTime: start + CLIP_SEC,
          duration: CLIP_SEC,
          createdAt: new Date().toISOString(),
        } satisfies LibraryAsset;
      })
    );
    for (const a of built) if (a) newAssets.push(a);
  }

  if (newAssets.length) await mergePersist(found.topic, newAssets);
  console.log(`[open] ${found.topic.topic}: +${newAssets.length} clips from ${found.source}`);
  return { clips: newAssets.length };
}

async function rebuild(): Promise<void> {
  await rebuildWarNicheIndex();
  const nicheSlug = "war";
  const niche =
    (await r2GetJson<NicheLibraryIndex>(`library/${nicheSlug}/index.json`)) || {
      niche: "War",
      nicheSlug,
      updatedAt: "",
      people: [],
    };
  const bySlug = new Map(niche.people.map((p) => [p.personSlug, p]));
  for (const t of WAR_TOPICS) {
    const personSlug = slugify(t.topic);
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
    (await r2GetJson<RootLibraryIndex>("library/index.json")) ||
    ({ updatedAt: "", niches: [] } satisfies RootLibraryIndex);
  const map = new Map(root.niches.map((n) => [n.nicheSlug, n]));
  map.set("war", {
    niche: "War",
    nicheSlug: "war",
    peopleCount: niche.people.length,
    images: niche.people.reduce((n, p) => n + p.images, 0),
    raw_footage: niche.people.reduce((n, p) => n + p.raw_footage, 0),
  });
  await r2PutJson("library/index.json", {
    updatedAt: new Date().toISOString(),
    niches: [...map.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  });
}

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured");
  await fs.mkdir(WORK, { recursive: true });
  let topics = [...WAR_TOPICS];
  if (LIMIT_TOPICS > 0) topics = topics.slice(0, LIMIT_TOPICS);

  console.log(
    `[open] MASSIVE open war library | topics=${topics.length} sources=${SOURCES.join("+")} perTopic~${PER_TOPIC} clips=${CLIPS}x${CLIP_SEC}s concurrency=${CONCURRENCY} fast=${FAST} height=${HEIGHT}`
  );
  console.log(`[open] excluding ${BLOCK_VIDEO_IDS.size} personal channel video IDs`);

  let found: Found[] = [];
  if (RESUME) {
    try {
      const cached = JSON.parse(await fs.readFile(DISCOVERED_PATH, "utf8")) as {
        found?: Found[];
        count?: number;
      };
      if (Array.isArray(cached.found) && cached.found.length) {
        found = cached.found;
        console.log(`[open] RESUME: loaded ${found.length} sources from ${DISCOVERED_PATH}`);
      }
    } catch {
      /* rediscover */
    }
  }
  if (!found.length) {
    found = await discover(topics);
    await fs.writeFile(
      DISCOVERED_PATH,
      JSON.stringify({ at: new Date().toISOString(), count: found.length, found }, null, 2)
    );
    console.log(`[open] discovered ${found.length} open sources`);
  }

  const queue = [...found];
  const results: Array<{ id: string; topic: string; source: string; clips: number; error?: string }> = [];

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      try {
        const r = await processOne(item);
        results.push({
          id: item.id,
          topic: item.topic.topic,
          source: item.source,
          clips: r.clips,
          error: r.error,
        });
      } catch (err) {
        results.push({
          id: item.id,
          topic: item.topic.topic,
          source: item.source,
          clips: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await rebuild();

  const summary = {
    ok: true,
    elapsedMin: Number(((Date.now() - started) / 60000).toFixed(1)),
    discovered: found.length,
    totalClips: results.reduce((n, r) => n + r.clips, 0),
    bySource: {
      archive: results.filter((r) => r.source === "archive").reduce((n, r) => n + r.clips, 0),
      youtube: results.filter((r) => r.source === "youtube").reduce((n, r) => n + r.clips, 0),
    },
    results,
  };
  const summaryPath = path.join(ROOT_DIR, "storage", "war-open-library-summary.json");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: summary.ok,
        elapsedMin: summary.elapsedMin,
        discovered: summary.discovered,
        totalClips: summary.totalClips,
        bySource: summary.bySource,
      },
      null,
      2
    )
  );
  console.log(`[open] summary → ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
