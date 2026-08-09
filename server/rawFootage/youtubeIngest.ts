/**
 * Cloud-safe YouTube raw ingest: yt-dlp download → vision sample → 3–5s cuts → R2/job storage.
 * Designed to run on a RunPod ingest worker (cookies file / proxy), not on the app host.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { getOpenAI } from "../openaiClient.js";
import { config, optionalEnv } from "../config.js";
import { r2Configured, r2PutObject, mediaLibraryPublicBase } from "../library/r2.js";
import { jobDir, writeJson } from "../storage.js";
import { extractYoutubeVideoId } from "./youtubeUrls.js";
import type {
  NicheStyle,
  UserYoutubeRawClip,
  UserYoutubeRawIngestResult,
} from "../../shared/visualIntelligence.js";
import {
  USER_YOUTUBE_RAW_BASE_TARGET,
} from "../../shared/visualIntelligence.js";

const CLIP_MIN = 3;
const CLIP_MAX = 5;
const CLIP_LEN = 4;
const MAX_SAMPLES_PER_VIDEO = 36;
const MAX_CLIPS_PER_VIDEO = 40;
const MAX_DOWNLOAD_HEIGHT = 480;
/** Early-exit once we have enough usable seconds for ~20% of a typical job (+ buffer). */
const DEFAULT_TARGET_USABLE_SEC = 180;
const QUALITY_FLOOR = 70;

type FrameLabel = {
  t: number;
  usableRaw: boolean;
  qualityScore: number;
  topics: string[];
  notes?: string;
};

type ClipPlan = {
  videoId: string;
  sourceUrl: string;
  sourcePath: string;
  start: number;
  end: number;
  qualityScore: number;
  topics: string[];
  notes?: string;
  frameHash: string;
};

export type YoutubeIngestProgress = {
  stage: string;
  message: string;
  percent?: number;
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
      else reject(new Error(`${cmd} failed (${code}): ${stderr.slice(-1200)}`));
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
      "-vf",
      `scale=-2:${MAX_DOWNLOAD_HEIGHT}`,
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

function cookiesPath(): string | undefined {
  return optionalEnv("YT_COOKIES_PATH") || optionalEnv("YOUTUBE_COOKIES_PATH");
}

function proxyArg(): string | undefined {
  return optionalEnv("YTDLP_PROXY") || optionalEnv("HTTPS_PROXY") || optionalEnv("HTTP_PROXY");
}

async function downloadYoutubeVideo(url: string, outDir: string): Promise<string> {
  const cookie = cookiesPath();
  const proxy = proxyArg();
  const clients = ["android", "tv", "web", "ios"];
  let lastErr: unknown;
  const outTemplate = path.join(outDir, "source.%(ext)s");

  for (let i = 0; i < clients.length; i++) {
    const args = [
      "-f",
      `bestvideo[height<=${MAX_DOWNLOAD_HEIGHT}]+bestaudio/best[height<=${MAX_DOWNLOAD_HEIGHT}]/best`,
      "--merge-output-format",
      "mp4",
      "-o",
      outTemplate,
      "--no-playlist",
      "--extractor-args",
      `youtube:player_client=${clients[i]}`,
    ];
    if (cookie) args.push("--cookies", cookie);
    if (proxy) args.push("--proxy", proxy);
    args.push(url);
    try {
      await run("yt-dlp", args);
      const expected = path.join(outDir, "source.mp4");
      try {
        await fs.stat(expected);
        return expected;
      } catch {
        /* fall through */
      }
      const entries = await fs.readdir(outDir);
      const any = entries.find((e) => /^source\./i.test(e) && /\.(mp4|mkv|webm)$/i.test(e));
      if (any) return path.join(outDir, any);
      throw new Error("yt-dlp finished but no media file found");
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function classifyFrames(
  niche: NicheStyle,
  jobTitle: string,
  frames: Array<{ t: number; b64: string }>
): Promise<FrameLabel[]> {
  if (!frames.length) return [];
  const openai = getOpenAI();
  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: `You are labeling RAW documentary footage frames for a "${niche}" video titled "${jobTitle}".
For EACH image in order, decide if it is usable as B-roll / atmosphere / motion raw footage.

Set usableRaw=false when the frame is:
- Text overlays, thumbnails, memes, channel branding, lower-thirds, slideshow graphics
- Pure talking-head interview with no useful visual context (unless niche is Celebrity and face is clear documentary value)
- Black/empty/extremely blurry frames

Set usableRaw=true for clean camera/archive/cinematic footage that could cut into a documentary.

Also return:
- qualityScore 0-100 (clarity, composition, documentary usefulness)
- topics: short tags (people, places, objects, mood) relevant to ${niche}
- notes: brief

Return JSON only:
{"frames":[{"index":0,"usableRaw":true,"qualityScore":82,"topics":["crowd","night"],"notes":"..."}]}`,
    },
  ];
  for (const f of frames) {
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.b64}` } });
  }

  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You judge documentary raw footage frames and return strict JSON.",
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
      topics?: string[];
      notes?: string;
    }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return frames.map((f) => ({ t: f.t, usableRaw: false, qualityScore: 0, topics: [] }));
  }

  return frames.map((f, i) => {
    const row = parsed.frames?.find((x) => x.index === i) || parsed.frames?.[i];
    const qualityScore = Math.max(0, Math.min(100, Number(row?.qualityScore ?? 0)));
    const usableRaw = row?.usableRaw !== false && qualityScore >= 45;
    return {
      t: f.t,
      usableRaw,
      qualityScore,
      topics: Array.isArray(row?.topics) ? row!.topics!.map(String).slice(0, 8) : [],
      notes: row?.notes ? String(row.notes) : undefined,
    };
  });
}

function buildClipPlans(
  sourceUrl: string,
  videoId: string,
  sourcePath: string,
  duration: number,
  labels: FrameLabel[]
): ClipPlan[] {
  const usable = labels
    .filter((l) => l.usableRaw && l.qualityScore >= QUALITY_FLOOR)
    .sort((a, b) => b.qualityScore - a.qualityScore);
  const plans: ClipPlan[] = [];
  const usedStarts: number[] = [];

  for (const label of usable) {
    if (plans.length >= MAX_CLIPS_PER_VIDEO) break;
    let start = Math.max(0, label.t - CLIP_LEN / 2);
    let end = Math.min(duration, start + CLIP_LEN);
    if (end - start < CLIP_MIN) {
      start = Math.max(0, end - CLIP_MIN);
    }
    if (end - start > CLIP_MAX) end = start + CLIP_MAX;
    if (end - start < CLIP_MIN) continue;

    if (usedStarts.some((s) => Math.abs(s - start) < CLIP_MIN + 0.5)) continue;
    usedStarts.push(start);

    const frameHash = createHash("md5")
      .update(`${videoId}:${start.toFixed(2)}:${end.toFixed(2)}`)
      .digest("hex")
      .slice(0, 12);

    plans.push({
      videoId,
      sourceUrl,
      sourcePath,
      start,
      end,
      qualityScore: label.qualityScore,
      topics: label.topics,
      notes: label.notes,
      frameHash,
    });
  }
  return plans;
}

function computeUsableScore(params: {
  usableClipCount: number;
  meanQuality: number;
  topicCoverage: number;
  usableDurationSec: number;
  targetUsableSec: number;
}): number {
  const countPart = Math.min(1, params.usableClipCount / 12);
  const qualityPart = Math.min(1, params.meanQuality / 100);
  const topicPart = Math.min(1, params.topicCoverage);
  const durationPart = Math.min(1, params.usableDurationSec / Math.max(30, params.targetUsableSec * 0.6));
  return Math.max(
    0,
    Math.min(1, countPart * 0.35 + qualityPart * 0.3 + topicPart * 0.15 + durationPart * 0.2)
  );
}

async function uploadClip(params: {
  jobId: string;
  videoId: string;
  clipId: string;
  localMp4: string;
  localThumb?: string;
}): Promise<{ filePathOrUrl: string; thumbnail?: string; r2Key?: string; thumbKey?: string }> {
  const body = await fs.readFile(params.localMp4);
  const thumbBody = params.localThumb ? await fs.readFile(params.localThumb).catch(() => null) : null;

  if (r2Configured()) {
    const r2Key = `jobs/${params.jobId}/raw/${params.videoId}/${params.clipId}.mp4`;
    await r2PutObject({ key: r2Key, body, contentType: "video/mp4" });
    let thumbKey: string | undefined;
    if (thumbBody) {
      thumbKey = `jobs/${params.jobId}/raw/${params.videoId}/${params.clipId}.jpg`;
      await r2PutObject({ key: thumbKey, body: thumbBody, contentType: "image/jpeg" });
    }
    const base = mediaLibraryPublicBase()?.replace(/\/$/, "");
    const filePathOrUrl = base ? `${base}/${r2Key}` : r2Key;
    const thumbnail = base && thumbKey ? `${base}/${thumbKey}` : params.localThumb;
    return { filePathOrUrl, thumbnail, r2Key, thumbKey };
  }

  // Fallback: keep under job storage (still produced by the worker, not the PC UI path)
  const destDir = path.join(jobDir(params.jobId), "youtube-raw-clips", params.videoId);
  await fs.mkdir(destDir, { recursive: true });
  const destMp4 = path.join(destDir, `${params.clipId}.mp4`);
  await fs.copyFile(params.localMp4, destMp4);
  let destThumb: string | undefined;
  if (params.localThumb) {
    destThumb = path.join(destDir, `${params.clipId}.jpg`);
    await fs.copyFile(params.localThumb, destThumb).catch(() => undefined);
  }
  return { filePathOrUrl: destMp4, thumbnail: destThumb };
}

export async function ingestUserYoutubeRaw(params: {
  jobId: string;
  niche: NicheStyle;
  title: string;
  urls: string[];
  targetDurationSec?: number;
  onProgress?: (p: YoutubeIngestProgress) => void | Promise<void>;
}): Promise<UserYoutubeRawIngestResult> {
  const { jobId, niche, title, urls } = params;
  const report = params.onProgress || (async () => undefined);
  const workRoot = path.join(config.storagePath, "youtube-raw-ingest", jobId);
  await fs.mkdir(workRoot, { recursive: true });

  const targetUsableSec = Math.max(
    60,
    Math.min(
      DEFAULT_TARGET_USABLE_SEC,
      Math.round((params.targetDurationSec || 600) * USER_YOUTUBE_RAW_BASE_TARGET * 1.4)
    )
  );

  const allPlans: ClipPlan[] = [];
  const topicSet = new Set<string>();
  let sampledUsable = 0;

  for (let u = 0; u < urls.length; u++) {
    const url = urls[u];
    const videoId = extractYoutubeVideoId(url) || `vid${u + 1}`;
    await report({
      stage: "download",
      message: `Downloading ${videoId} (${u + 1}/${urls.length})`,
      percent: Math.round((u / urls.length) * 40),
    });

    const vidDir = path.join(workRoot, videoId);
    await fs.mkdir(vidDir, { recursive: true });

    let sourcePath: string;
    try {
      sourcePath = await downloadYoutubeVideo(url, vidDir);
    } catch (err) {
      await report({
        stage: "download",
        message: `Download failed for ${videoId}: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const duration = await ffprobeDuration(sourcePath);
    if (duration < CLIP_MIN) continue;

    await report({
      stage: "analyze",
      message: `Analyzing frames for ${videoId}`,
      percent: 40 + Math.round((u / urls.length) * 25),
    });

    const sampleCount = Math.min(MAX_SAMPLES_PER_VIDEO, Math.max(8, Math.floor(duration / 8)));
    const times: number[] = [];
    for (let i = 0; i < sampleCount; i++) {
      times.push(Math.min(duration - 0.5, (duration * (i + 0.5)) / sampleCount));
    }

    const labeled: FrameLabel[] = [];
    for (let i = 0; i < times.length; i += 6) {
      const batchTimes = times.slice(i, i + 6);
      const frames: Array<{ t: number; b64: string }> = [];
      for (const t of batchTimes) {
        const jpg = path.join(vidDir, `frame-${Math.round(t * 10)}.jpg`);
        if (!(await extractFrame(sourcePath, t, jpg))) continue;
        const b64 = (await fs.readFile(jpg)).toString("base64");
        frames.push({ t, b64 });
      }
      const labels = await classifyFrames(niche, title, frames);
      labeled.push(...labels);
      for (const l of labels) {
        if (l.usableRaw) {
          sampledUsable++;
          for (const t of l.topics) topicSet.add(t.toLowerCase());
        }
      }
    }

    allPlans.push(...buildClipPlans(url, videoId, sourcePath, duration, labeled));

    const plannedSec = allPlans.reduce((n, p) => n + (p.end - p.start), 0);
    if (plannedSec >= targetUsableSec) {
      await report({
        stage: "analyze",
        message: `Early-exit: enough usable footage (~${Math.round(plannedSec)}s)`,
        percent: 70,
      });
      break;
    }
  }

  await report({ stage: "cut", message: `Cutting ${allPlans.length} clips`, percent: 75 });

  const clips: UserYoutubeRawClip[] = [];
  for (let i = 0; i < allPlans.length; i++) {
    const plan = allPlans[i];
    const clipId = `uyt-${plan.frameHash}`;
    const cutDir = path.join(workRoot, plan.videoId, "clips");
    await fs.mkdir(cutDir, { recursive: true });
    const localMp4 = path.join(cutDir, `${clipId}.mp4`);
    const localThumb = path.join(cutDir, `${clipId}.jpg`);
    const ok = await cutClip(plan.sourcePath, plan.start, plan.end - plan.start, localMp4);
    if (!ok) continue;
    await extractFrame(plan.sourcePath, plan.start + (plan.end - plan.start) / 2, localThumb);

    const uploaded = await uploadClip({
      jobId,
      videoId: plan.videoId,
      clipId,
      localMp4,
      localThumb,
    });

    clips.push({
      clipId,
      sourceUrl: plan.sourceUrl,
      videoId: plan.videoId,
      filePathOrUrl: uploaded.filePathOrUrl,
      thumbnail: uploaded.thumbnail,
      r2Key: uploaded.r2Key,
      thumbKey: uploaded.thumbKey,
      startTime: plan.start,
      endTime: plan.end,
      duration: plan.end - plan.start,
      qualityScore: plan.qualityScore,
      usableRaw: true,
      topics: plan.topics,
      notes: plan.notes,
    });

    if ((i + 1) % 5 === 0) {
      await report({
        stage: "cut",
        message: `Uploaded ${i + 1}/${allPlans.length} clips`,
        percent: 75 + Math.round(((i + 1) / Math.max(1, allPlans.length)) * 20),
      });
    }
  }

  const usableDurationSec = clips.reduce((n, c) => n + c.duration, 0);
  const meanQuality = clips.length
    ? clips.reduce((n, c) => n + c.qualityScore, 0) / clips.length
    : 0;
  const topicCoverage = Math.min(1, topicSet.size / 8);
  const usableScore = computeUsableScore({
    usableClipCount: clips.length,
    meanQuality,
    topicCoverage,
    usableDurationSec,
    targetUsableSec,
  });

  const rawTargetPercent = USER_YOUTUBE_RAW_BASE_TARGET * 100;
  let effectiveRawTargetPercent = Number((rawTargetPercent * usableScore).toFixed(1));
  let rawReducedReason: string | undefined;
  if (clips.length === 0) {
    effectiveRawTargetPercent = 0;
    rawReducedReason = "no usable clips after analysis";
  } else if (usableScore < 0.95) {
    if (meanQuality < QUALITY_FLOOR) rawReducedReason = "quality floor";
    else if (clips.length < 6) rawReducedReason = "low usable yield";
    else if (topicCoverage < 0.35) rawReducedReason = "topic mismatch";
    else rawReducedReason = "usable score below ideal";
  }

  const result: UserYoutubeRawIngestResult = {
    clips,
    analysisSummary: `Analyzed ${urls.length} URL(s); ${sampledUsable} usable sample frames; ${clips.length} clips (${usableDurationSec.toFixed(1)}s). meanQuality=${meanQuality.toFixed(1)}; usableScore=${usableScore.toFixed(2)}.`,
    usableDurationSec: Number(usableDurationSec.toFixed(2)),
    meanQuality: Number(meanQuality.toFixed(1)),
    topicCoverage: Number(topicCoverage.toFixed(2)),
    usableScore: Number(usableScore.toFixed(3)),
    rawTargetPercent,
    effectiveRawTargetPercent,
    rawReducedReason,
    completedAt: new Date().toISOString(),
  };

  await writeJson(path.join(jobDir(jobId), "youtube-raw-ingest.json"), result);
  await report({ stage: "done", message: result.analysisSummary, percent: 100 });
  return result;
}
