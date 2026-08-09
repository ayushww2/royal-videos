/**
 * Discover + ingest YouTube raw clips for EVERY existing War library topic.
 * Relatable real footage only — reject map animations / yellow editor text.
 *
 * Usage:
 *   npx tsx --env-file=.env --env-file=.env.library scripts/collect-war-raw-all-topics.ts
 *   WAR_RAW_ALL_VIDEOS_PER_TOPIC=2 WAR_RAW_ALL_CLIPS=12 WAR_RAW_ALL_CONCURRENCY=4 npx tsx ...
 *   WAR_RAW_ALL_LIMIT_TOPICS=10 npx tsx ...  # smoke
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

const WORK_DIR = path.resolve(ROOT_DIR, "storage", "war-raw-all-topics");
const VIDEOS_PER_TOPIC = Math.max(1, Math.min(3, Number(process.env.WAR_RAW_ALL_VIDEOS_PER_TOPIC || 2)));
const CLIPS_PER_VIDEO = Math.max(4, Number(process.env.WAR_RAW_ALL_CLIPS || 12));
const SAMPLE_EVERY = Math.max(5, Number(process.env.WAR_RAW_ALL_SAMPLE_EVERY || 9));
const CLIP_SECONDS = Math.max(2, Math.min(5, Number(process.env.WAR_RAW_ALL_CLIP_SECONDS || 4)));
const MIN_CLIP_GAP = CLIP_SECONDS + 1.5;
const CONCURRENCY = Math.max(1, Number(process.env.WAR_RAW_ALL_CONCURRENCY || 4));
const MODEL = process.env.WAR_RAW_MODEL?.trim() || "gpt-5.4-mini";
const BATCH = Math.max(4, Math.min(10, Number(process.env.WAR_RAW_VISION_BATCH || 8)));
const LIMIT_TOPICS = Math.max(0, Number(process.env.WAR_RAW_ALL_LIMIT_TOPICS || 0));
const STAR_BLUR = process.env.WAR_RAW_STAR_BLUR === "1";
const MAX_DURATION = Number(process.env.WAR_RAW_ALL_MAX_DURATION || 1400); // ~23 min
const MIN_DURATION = Number(process.env.WAR_RAW_ALL_MIN_DURATION || 90);

type FoundVideo = {
  videoId: string;
  title: string;
  url: string;
  topic: Topic;
  searchQuery: string;
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

function searchQueriesForTopic(topic: Topic): string[] {
  const t = topic.topic;
  const tags = topic.tags.join(" ");
  return [
    `${t} archival footage documentary`,
    `${t} military real footage ${tags.split(" ")[0] || ""}`.trim(),
  ];
}

async function ytSearch(query: string, n: number): Promise<Array<{ id: string; title: string }>> {
  const { stdout } = await run("yt-dlp", [
    "--flat-playlist",
    "--skip-download",
    "-J",
    `ytsearch${n}:${query}`,
  ]);
  const data = JSON.parse(stdout) as {
    entries?: Array<{ id?: string; title?: string; ie_key?: string }>;
  };
  return (data.entries || [])
    .filter((e) => e.id && e.title)
    .map((e) => ({ id: String(e.id), title: String(e.title) }));
}

async function discoverVideos(topics: Topic[]): Promise<FoundVideo[]> {
  const found: FoundVideo[] = [];
  const usedIds = new Set<string>();
  const queue = [...topics];

  async function worker() {
    while (queue.length) {
      const topic = queue.shift();
      if (!topic) return;
      const queries = searchQueriesForTopic(topic);
      let added = 0;
      for (const q of queries) {
        if (added >= VIDEOS_PER_TOPIC) break;
        try {
          const hits = await ytSearch(q, VIDEOS_PER_TOPIC + 2);
          for (const h of hits) {
            if (added >= VIDEOS_PER_TOPIC) break;
            if (usedIds.has(h.id)) continue;
            // Skip obvious graphic/map/reaction titles
            const title = h.title.toLowerCase();
            if (/\b(reaction|explained with map|animation only|minecraft|war thunder|gta)\b/i.test(title)) {
              continue;
            }
            usedIds.add(h.id);
            found.push({
              videoId: h.id,
              title: h.title,
              url: `https://www.youtube.com/watch?v=${h.id}`,
              topic,
              searchQuery: q,
            });
            added += 1;
          }
          console.log(`[discover] ${topic.topic}: +${added} via "${q.slice(0, 50)}"`);
        } catch (err) {
          console.warn(
            `[discover] search fail ${topic.topic}:`,
            err instanceof Error ? err.message.slice(0, 140) : err
          );
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(6, topics.length) }, () => worker()));
  return found;
}

async function downloadVideo(videoId: string, url: string, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const outTemplate = path.join(dir, "source.%(ext)s");
  const existing = (await fs.readdir(dir).catch(() => [])).find((f) =>
    /^source\.(mp4|mkv|webm|mov)$/i.test(f)
  );
  if (existing) return path.join(dir, existing);

  await run("yt-dlp", [
    "--no-playlist",
    "--no-write-subs",
    "--no-write-auto-subs",
    "--no-embed-subs",
    "--max-filesize",
    "650M",
    "--match-filter",
    `duration >= ${MIN_DURATION} & duration <= ${MAX_DURATION}`,
    "-f",
    "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/best[height<=720]/best",
    "--merge-output-format",
    "mp4",
    "-o",
    outTemplate,
    url,
  ]);
  const files = await fs.readdir(dir);
  const video = files.find((f) => /^source\.(mp4|mkv|webm|mov)$/i.test(f));
  if (!video) throw new Error(`download missing ${videoId}`);
  return path.join(dir, video);
}

function videoFilter(): string {
  const base = [
    "scale=-2:720",
    "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)'",
    "setsar=1",
  ];
  if (STAR_BLUR) base.push("delogo=x=iw-120:y=22:w=95:h=95:show=0");
  return base.join(",");
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
    String(CLIP_SECONDS),
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    videoFilter(),
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
    "0.5",
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
      text: `Label frames for War library topic "${topic.topic}" (group: ${topic.group}, tags: ${topic.tags.join(", ")}).

KEEP usableRaw=true ONLY if the frame is REAL camera/archive/news/drone/thermal footage CLEARLY RELATED to "${topic.topic}".
Examples of related: ships, jets, drones, missiles, soldiers, bases, battlefields matching this topic.

REJECT usableRaw=false when:
- Custom animated maps, country highlights, ship icons on maps, title cards
- Yellow/neon editor text, lower-thirds headlines, meme overlays, slideshow graphics
- Unrelated lifestyle / random stock / wrong subject for this topic
- Pure talking-head with no useful B-roll of the topic

Return JSON:
{"frames":[{"index":0,"usableRaw":true,"qualityScore":80,"tags":["destroyer","ocean"],"notes":"..."}]}`,
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
          "Filter war documentary raw footage for topic relevance. Reject map animations and yellow editor text. JSON only.",
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
      tags?: string[];
      notes?: string;
    }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return frames.map((f) => ({ t: f.t, usableRaw: false, qualityScore: 0, tags: [] }));
  }

  return frames.map((f, i) => {
    const row = parsed.frames?.find((x) => x.index === i) || parsed.frames?.[i];
    const qualityScore = Math.max(0, Math.min(100, Number(row?.qualityScore ?? 0)));
    return {
      t: f.t,
      usableRaw: row?.usableRaw === true && qualityScore >= 58,
      qualityScore,
      tags: Array.isArray(row?.tags) ? row!.tags!.map(String).slice(0, 8) : [],
      notes: row?.notes ? String(row.notes) : undefined,
    };
  });
}

async function loadIndex(topic: Topic): Promise<PersonLibraryIndex> {
  const niche = "War";
  const nicheSlug = "war";
  const personSlug = slugify(topic.topic);
  return (
    (await r2GetJson<PersonLibraryIndex>(`library/${nicheSlug}/${personSlug}/index.json`)) || {
      niche,
      nicheSlug,
      person: topic.topic,
      personSlug,
      group: topic.group,
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
}

async function processFound(v: FoundVideo): Promise<{ clips: number; kept: number; error?: string }> {
  const dir = path.join(WORK_DIR, v.videoId);
  console.log(`[all] ${v.topic.topic} ← ${v.videoId} "${v.title.slice(0, 70)}"`);
  let sourcePath: string;
  try {
    sourcePath = await downloadVideo(v.videoId, v.url, dir);
  } catch (err) {
    return { clips: 0, kept: 0, error: err instanceof Error ? err.message : String(err) };
  }
  const duration = await ffprobeDuration(sourcePath);
  if (duration < MIN_DURATION) return { clips: 0, kept: 0, error: "too short" };

  const guard = Math.min(25, duration * 0.04);
  const sampleTs: number[] = [];
  for (let t = guard; t < duration - guard; t += SAMPLE_EVERY) {
    sampleTs.push(Number(t.toFixed(2)));
    if (sampleTs.length >= 70) break;
  }

  const framesDir = path.join(dir, "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const frames: Array<{ t: number; b64: string }> = [];
  for (const t of sampleTs) {
    const jpg = path.join(framesDir, `t${String(Math.floor(t)).padStart(5, "0")}.jpg`);
    try {
      await sampleFrame(sourcePath, t, jpg);
      frames.push({ t, b64: (await fs.readFile(jpg)).toString("base64") });
    } catch {
      /* skip */
    }
  }

  const labels: FrameLabel[] = [];
  for (let i = 0; i < frames.length; i += BATCH) {
    const batch = frames.slice(i, i + BATCH);
    try {
      labels.push(...(await classifyBatch(v.topic, batch)));
    } catch (err) {
      console.warn(`[all] classify fail`, err instanceof Error ? err.message.slice(0, 120) : err);
      for (const f of batch) labels.push({ t: f.t, usableRaw: false, qualityScore: 0, tags: [] });
    }
  }

  const usable = labels
    .filter((l) => l.usableRaw)
    .sort((a, b) => b.qualityScore - a.qualityScore);
  const picked: FrameLabel[] = [];
  for (const u of usable) {
    if (picked.length >= CLIPS_PER_VIDEO) break;
    if (picked.some((p) => Math.abs(p.t - u.t) < MIN_CLIP_GAP)) continue;
    picked.push(u);
  }

  const idx = await loadIndex(v.topic);
  let clips = 0;
  for (const label of picked) {
    const nextNum =
      Math.max(0, ...idx.assets.filter((a) => a.mediaType === "raw_footage").map((a) => a.number), 0) +
      1;
    const assetId = `war-${idx.personSlug}-raw-${String(nextNum).padStart(4, "0")}`;
    const start = Math.max(0, label.t - CLIP_SECONDS / 2);
    const clipPath = path.join(dir, `${assetId}.mp4`);
    const thumbPath = path.join(dir, `${assetId}.jpg`);
    try {
      await makeClip(sourcePath, clipPath, start);
      await makeThumb(clipPath, thumbPath);
    } catch {
      continue;
    }
    const mp4 = await fs.readFile(clipPath);
    const thumb = await fs.readFile(thumbPath).catch(() => null);
    const r2Key = `library/war/${idx.personSlug}/raw/${assetId}.mp4`;
    const thumbKey = `library/war/${idx.personSlug}/thumbs/${assetId}.jpg`;
    await r2PutObject({ key: r2Key, body: mp4, contentType: "video/mp4" });
    if (thumb) await r2PutObject({ key: thumbKey, body: thumb, contentType: "image/jpeg" });

    idx.assets.push({
      assetId,
      number: nextNum,
      niche: "War",
      nicheSlug: "war",
      person: idx.person,
      personSlug: idx.personSlug,
      group: idx.group,
      mediaType: "raw_footage",
      category: "youtube-raw",
      categories: [
        "youtube-raw",
        "topic-matched",
        ...v.topic.tags.map(slugify),
        ...label.tags.map(slugify),
      ],
      r2Key,
      thumbKey: thumb ? thumbKey : undefined,
      sourceUrl: v.url,
      contentHash: createHash("md5").update(mp4).digest("hex").slice(0, 16),
      queryUsed: v.searchQuery,
      title: v.title.slice(0, 180),
      description: [
        `Raw clip for topic "${v.topic.topic}" from YouTube ${v.videoId} @ ${start.toFixed(1)}s.`,
        label.notes || "Topic-matched documentary footage.",
        "Filtered: no custom map animations / yellow editor text.",
      ].join(" "),
      startTime: start,
      endTime: start + CLIP_SECONDS,
      duration: CLIP_SECONDS,
      createdAt: new Date().toISOString(),
    } satisfies LibraryAsset);
    clips += 1;
  }
  await persistIndex(idx);
  console.log(`[all] ${v.topic.topic}: clips=${clips} keptFrames=${usable.length}/${labels.length}`);
  return { clips, kept: usable.length };
}

async function rebuildRoot(): Promise<void> {
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
  await fs.mkdir(WORK_DIR, { recursive: true });

  let topics = [...WAR_TOPICS];
  if (LIMIT_TOPICS > 0) topics = topics.slice(0, LIMIT_TOPICS);

  console.log(
    `[all] topics=${topics.length} videos/topic=${VIDEOS_PER_TOPIC} clips/video=${CLIPS_PER_VIDEO} concurrency=${CONCURRENCY} starBlur=${STAR_BLUR}`
  );

  console.log(`[all] discovering YouTube videos…`);
  const found = await discoverVideos(topics);
  console.log(`[all] discovered ${found.length} unique videos`);
  await fs.writeFile(
    path.join(ROOT_DIR, "storage", "war-raw-all-discovered.json"),
    JSON.stringify({ at: new Date().toISOString(), count: found.length, found }, null, 2)
  );

  const queue = [...found];
  const results: Array<{
    videoId: string;
    topic: string;
    clips: number;
    kept: number;
    error?: string;
  }> = [];

  async function worker(id: number) {
    while (queue.length) {
      const v = queue.shift();
      if (!v) return;
      try {
        const r = await processFound(v);
        results.push({ videoId: v.videoId, topic: v.topic.topic, ...r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[w${id}] fail ${v.videoId}`, msg.slice(0, 200));
        results.push({
          videoId: v.videoId,
          topic: v.topic.topic,
          clips: 0,
          kept: 0,
          error: msg,
        });
      }
    }
  }

  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
  await rebuildRoot();

  const summary = {
    ok: true,
    elapsedMin: Number(((Date.now() - started) / 60000).toFixed(1)),
    topics: topics.length,
    videos: found.length,
    totalClips: results.reduce((n, r) => n + r.clips, 0),
    byGroup: Object.fromEntries(
      [...new Set(topics.map((t) => t.group))].map((g) => [
        g,
        {
          clips: results
            .filter((r) => topics.find((t) => t.topic === r.topic)?.group === g)
            .reduce((n, r) => n + r.clips, 0),
        },
      ])
    ),
    results,
  };
  const summaryPath = path.join(ROOT_DIR, "storage", "war-raw-all-topics-summary.json");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, results: undefined, resultCount: results.length }, null, 2));
  console.log(`[all] summary → ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
