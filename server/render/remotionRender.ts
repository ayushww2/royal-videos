import path from "node:path";
import fs from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import {
  ROOT_DIR,
  config,
  optionalEnv,
  requireEnv,
  getRemotionAwsRegion,
  useRemotionLambda,
} from "../config.js";
import { toShotstackPublicUrl } from "./shotstackEffectMapper.js";
import { storageRenderUrl } from "./storageMedia.js";
import type { EffectTimelineEvent } from "../visualIntelligence/effectPlanner.js";
import type { TimelineScene, ApprovedVisual } from "../../shared/visualIntelligence.js";
import type { AwsRegion } from "@remotion/lambda-client";

const COMPOSITION_ID = "DocumentaryEdit";
const FPS = 30;
const LAMBDA_POLL_MS = 2500;

export type RemotionSfxEvent = {
  id: string;
  sfxId: string;
  /** Path under Remotion public/, e.g. sfx/royal/soft_whip.wav */
  publicPath: string;
  startTime: number;
  durationSec: number;
  volume: number;
  reason?: string;
  sceneId?: string;
};

export type RemotionMusicEvent = {
  id: string;
  musicId: string;
  /** Path under Remotion public/, e.g. music/royal/diana.mp3 */
  publicPath: string;
  startTime: number;
  durationSec: number;
  volume: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  reason?: string;
  role?: string;
};

export type RemotionGlitchEvent = {
  id: string;
  glitchId: string;
  /** Path under Remotion public/, e.g. overlays/glitch/glitch_line_burst.mp4 */
  publicPath: string;
  startTime: number;
  durationSec: number;
  volume: number;
  blendMode?: "screen" | "lighten" | "plus-lighter";
  reason?: string;
  sceneId?: string;
};

export type RemotionCinematicIntro = {
  enabled?: boolean;
  durationSec?: number;
  musicVolume?: number;
  shots?: Array<{
    src: string;
    line1: string;
    line2?: string;
    motion: "in" | "out";
    overlay?: string;
  }>;
};

export type RemotionInputProps = {
  scenes: Array<{
    sceneId: string;
    startTime: number;
    endTime: number;
    duration: number;
    imageUrl?: string;
    videoUrl?: string;
    videoStartSeconds?: number;
    cameraMotion?: "zoom_in" | "zoom_out" | "none";
    cameraIntensity?: number;
  }>;
  effectEvents: Array<{
    id: string;
    presetId: string;
    startFrame: number;
    durationFrames: number;
    layer?: number;
    tags?: string[];
    props: Record<string, unknown>;
  }>;
  sfxEvents?: RemotionSfxEvent[];
  musicEvents?: RemotionMusicEvent[];
  glitchEvents?: RemotionGlitchEvent[];
  fps?: number;
  voiceoverUrl?: string;
  cinematicIntro?: RemotionCinematicIntro;
};

let bundlePromise: Promise<string> | null = null;
const BUNDLE_VERSION = "doc-edit-v9-mystery-cinematic-intro";

async function getBundleLocation(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      await ensureBrowser();
      const entryPoint = path.join(ROOT_DIR, "remotion", "entry.tsx");
      const outDir = path.join(config.storagePath, ".remotion-bundle");
      const marker = path.join(outDir, ".bundle-version");
      await fs.mkdir(outDir, { recursive: true });
      let existing = "";
      try {
        existing = (await fs.readFile(marker, "utf8")).trim();
      } catch {
        existing = "";
      }
      if (existing !== BUNDLE_VERSION) {
        console.log(`[remotion] busting stale bundle (${existing || "none"} → ${BUNDLE_VERSION})`);
        await fs.rm(outDir, { recursive: true, force: true });
        await fs.mkdir(outDir, { recursive: true });
      }
      console.log("[remotion] bundling composition…");
      const location = await bundle({
        entryPoint,
        outDir,
        publicDir: path.join(ROOT_DIR, "remotion", "public"),
      });
      await fs.writeFile(marker, BUNDLE_VERSION, "utf8");
      console.log("[remotion] bundle ready:", location);
      return location;
    })().catch((err) => {
      bundlePromise = null;
      throw err;
    });
  }
  return bundlePromise;
}

/**
 * Media URL Lambda (and Shotstack) can fetch: R2 HTTPS, signed public routes, or PUBLIC_APP_URL/media.
 * Local absolute storage paths prefer signed /api/render-storage (works behind app auth).
 */
export function toRemotionPublicUrl(filePathOrUrl?: string): string | undefined {
  if (!filePathOrUrl) return undefined;
  if (/^https?:\/\//i.test(filePathOrUrl)) return filePathOrUrl;
  const signed = storageRenderUrl(filePathOrUrl);
  if (signed) return signed;
  return toShotstackPublicUrl(filePathOrUrl);
}

function rewriteUrlDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return toRemotionPublicUrl(value) || value;
  }
  if (Array.isArray(value)) {
    return value.map(rewriteUrlDeep);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteUrlDeep(v);
    }
    return out;
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlockedImageHost(url: string): boolean {
  // Allow loopback HTTP for local R2 media proxies during Remotion renders.
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) return false;
  return (
    /^http:\/\//i.test(url) ||
    /lookaside\./i.test(url) ||
    /fbsbx\.com/i.test(url) ||
    /instagram\.com\/seo\//i.test(url) ||
    /facebook\.com\/lookaside/i.test(url) ||
    /pauldavidsmith\.co\.uk/i.test(url) ||
    /tiktok\.com/i.test(url) ||
    /(?:^|[/.])tiktokcdn\./i.test(url) ||
    /pinimg\.com/i.test(url) ||
    /pinterest\./i.test(url) ||
    /lookaside\.fbsbx\.com/i.test(url)
  );
}

/** Recursively drop/replace blocked image URLs anywhere in effect props. */
function scrubBlockedUrlsDeep(value: unknown, fallback?: string): unknown {
  if (typeof value === "string") {
    if (isBlockedImageHost(value) || isVideoPath(value)) return fallback || undefined;
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => scrubBlockedUrlsDeep(item, fallback))
      .filter((item) => {
        if (item && typeof item === "object" && "src" in (item as object)) {
          return Boolean((item as { src?: unknown }).src);
        }
        return item !== undefined;
      });
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubBlockedUrlsDeep(v, fallback);
    }
    return out;
  }
  return value;
}

function parseRawStartSeconds(visual?: ApprovedVisual): number {
  const hay = `${visual?.bestUseCase || ""} ${visual?.candidateId || ""}`;
  const fromSnippet = hay.match(/start=([0-9.]+)/i);
  if (fromSnippet) return Number(fromSnippet[1]) || 0;
  const fromId = (visual?.candidateId || "").match(/rf-(\d+)/i);
  if (fromId) {
    const n = Number(fromId[1]);
    if (Number.isFinite(n) && n > 0) return (n - 1) * 3.5;
  }
  return 0;
}

function isVideoPath(url?: string): boolean {
  return !!url && /\.(mp4|webm|mov|mkv|m4v)(?:[?&#]|$)/i.test(url);
}

/** 4K / UHD remote MP4s (esp. Pexels) routinely OOM RunPod Remotion workers mid-render. */
function isHeavyRemoteVideo(url?: string): boolean {
  if (!url || !isVideoPath(url)) return false;
  return /uhd_|_4096_|_3840_2160_|_2560_1440_|\/\d+_3840_2160_/i.test(url);
}

function sceneImageUrl(
  scene: TimelineScene,
  libraryById: Map<string, ApprovedVisual>,
  fallbackUrl?: string
): string | undefined {
  const visual = libraryById.get(scene.approvedVisualId || scene.selectedVisualId);
  // Never feed Google/TikTok external fallbacks into Remotion — they abort the render.
  const externalJunk =
    scene.source === "google_image" ||
    String(scene.selectedVisualId || "").startsWith("external-") ||
    String(scene.approvedVisualId || "").startsWith("external-") ||
    String(visual?.source || "").includes("google");
  if (externalJunk) {
    const thumb =
      toRemotionPublicUrl(visual?.thumbnail) ||
      (visual?.thumbnail && /^https?:\/\//i.test(visual.thumbnail) ? visual.thumbnail : undefined);
    if (thumb && !isBlockedImageHost(thumb)) return thumb;
    return fallbackUrl && !isBlockedImageHost(fallbackUrl) ? fallbackUrl : undefined;
  }
  const raw = visual?.filePathOrUrl || visual?.thumbnail;
  const resolved =
    toRemotionPublicUrl(raw) || (raw && /^https?:\/\//i.test(raw) ? raw : undefined);
  if (resolved && !isBlockedImageHost(resolved)) return resolved;
  const thumb =
    toRemotionPublicUrl(visual?.thumbnail) ||
    (visual?.thumbnail && /^https?:\/\//i.test(visual.thumbnail) ? visual.thumbnail : undefined);
  if (thumb && !isBlockedImageHost(thumb)) return thumb;
  if (fallbackUrl && !isBlockedImageHost(fallbackUrl)) return fallbackUrl;
  return undefined;
}

export function buildRemotionInputProps(params: {
  scenes: TimelineScene[];
  libraryById: Map<string, ApprovedVisual>;
  effectEvents: EffectTimelineEvent[];
  sfxEvents?: RemotionSfxEvent[];
  musicEvents?: RemotionMusicEvent[];
  glitchEvents?: RemotionGlitchEvent[];
  voiceoverPath?: string;
  fps?: number;
  /** When true (default via REMOTION_IMAGES_ONLY), never emit scene videoUrl. */
  imagesOnly?: boolean;
  cinematicIntro?: RemotionCinematicIntro;
}): RemotionInputProps {
  const fps = params.fps || FPS;
  const imagesOnly =
    params.imagesOnly !== undefined
      ? params.imagesOnly
      : optionalEnv("REMOTION_IMAGES_ONLY") !== "0" &&
        optionalEnv("REMOTION_IMAGES_ONLY") !== "false";
  // Prefer any non-blocked library URL as a safe fallback when FB/CDN blocks Remotion.
  let safeFallback: string | undefined;
  for (const v of params.libraryById.values()) {
    if (v.source === "raw_footage" || v.source === "user_youtube_raw" || isVideoPath(v.filePathOrUrl)) continue;
    const u =
      toRemotionPublicUrl(v.filePathOrUrl) ||
      (v.filePathOrUrl && /^https?:\/\//i.test(v.filePathOrUrl) ? v.filePathOrUrl : undefined);
    if (u && !isBlockedImageHost(u) && !isVideoPath(u)) {
      safeFallback = u;
      break;
    }
  }

  const scenes = params.scenes
    .map((s, sceneIndex) => {
    const visual = params.libraryById.get(s.approvedVisualId || s.selectedVisualId);
    const mediaUrl = sceneImageUrl(s, params.libraryById, safeFallback);
    const isRawVideo =
      s.source === "raw_footage" ||
      s.source === "user_youtube_raw" ||
      visual?.source === "raw_footage" ||
      visual?.source === "user_youtube_raw" ||
      isVideoPath(visual?.filePathOrUrl) ||
      isVideoPath(mediaUrl);
    if (!mediaUrl && !safeFallback) {
      console.warn(`[remotion] skipping scene ${s.sceneId}: no safe media URL`);
      return null;
    }
    // Celebrity-style Ken Burns on stills: ~65% zoom_in, ~20% zoom_out, ~15% static.
    const stillMotionRoll = sceneIndex % 20;
    const stillCameraMotion: "zoom_in" | "zoom_out" | "none" =
      stillMotionRoll < 13 ? "zoom_in" : stillMotionRoll < 17 ? "zoom_out" : "none";

    const stillFromVideo =
      toRemotionPublicUrl(visual?.thumbnail) ||
      (visual?.thumbnail && /^https?:\/\//i.test(visual.thumbnail) && !isVideoPath(visual.thumbnail)
        ? visual.thumbnail
        : undefined) ||
      (mediaUrl && !isVideoPath(mediaUrl) ? mediaUrl : undefined) ||
      safeFallback;

    // Images-only mode: always demote clips to a still (thumbnail / safe fallback).
    if (imagesOnly) {
      if (!stillFromVideo) {
        console.warn(`[remotion] images-only: skip ${s.sceneId} — no still for video/source`);
        return null;
      }
      if (isRawVideo || isVideoPath(mediaUrl)) {
        console.warn(`[remotion] images-only: demoting video on ${s.sceneId} → still`);
      }
      return {
        sceneId: s.sceneId,
        startTime: s.startTime,
        endTime: s.endTime,
        duration: s.duration,
        imageUrl: stillFromVideo,
        cameraMotion: stillCameraMotion,
        cameraIntensity: 0.06,
      };
    }

    if (isRawVideo && mediaUrl) {
      // Refuse multi‑hundred‑MB 4K sources — they OOM serverless workers ~70%+ into long cuts.
      if (isHeavyRemoteVideo(mediaUrl)) {
        console.warn(
          `[remotion] demoting heavy remote video on ${s.sceneId} → still (${mediaUrl.slice(0, 80)}…)`
        );
        if (stillFromVideo) {
          return {
            sceneId: s.sceneId,
            startTime: s.startTime,
            endTime: s.endTime,
            duration: s.duration,
            imageUrl: stillFromVideo,
            cameraMotion: stillCameraMotion,
            cameraIntensity: 0.06,
          };
        }
      }
      return {
        sceneId: s.sceneId,
        startTime: s.startTime,
        endTime: s.endTime,
        duration: s.duration,
        videoUrl: mediaUrl,
        // Pre-cut user YouTube clips start at 0; uploaded raw chunks may seek into a longer file.
        videoStartSeconds:
          visual?.source === "user_youtube_raw" || s.source === "user_youtube_raw"
            ? 0
            : parseRawStartSeconds(visual),
        imageUrl: toRemotionPublicUrl(visual?.thumbnail) || undefined,
        cameraMotion: "none" as const,
        cameraIntensity: 0.06,
      };
    }
    return {
      sceneId: s.sceneId,
      startTime: s.startTime,
      endTime: s.endTime,
      duration: s.duration,
      imageUrl: mediaUrl || safeFallback,
      cameraMotion: stillCameraMotion,
      cameraIntensity: 0.06,
    };
  })
    .filter(Boolean) as RemotionInputProps["scenes"];

  const effectEvents = params.effectEvents
    .map((e) => {
    const rewritten = rewriteUrlDeep(e.props) as Record<string, unknown>;
    const cleaned = scrubBlockedUrlsDeep(rewritten, safeFallback) as Record<string, unknown>;
    // Drop blocked/video slide/image URLs so Remotion Img presets do not abort
    if (Array.isArray(cleaned.slides)) {
      cleaned.slides = (cleaned.slides as Array<Record<string, unknown>>).filter((slide) => {
        const src = String(slide.src || "");
        return src && !isBlockedImageHost(src) && !isVideoPath(src);
      });
    }
    for (const key of [
      "backgroundImage",
      "mainImage",
      "leftImageSrc",
      "rightImageSrc",
      "fromImageSrc",
      "toImageSrc",
    ]) {
      const value = cleaned[key];
      if (typeof value === "string" && (isBlockedImageHost(value) || isVideoPath(value))) {
        cleaned[key] = safeFallback || undefined;
      }
    }
    if (Array.isArray(cleaned.sideImages)) {
      cleaned.sideImages = (cleaned.sideImages as unknown[]).filter(
        (u) => typeof u === "string" && u && !isBlockedImageHost(u) && !isVideoPath(u)
      );
    }
    const scrubInstruction = (value: unknown): string => {
      const text = String(value || "").trim();
      if (!text) return "";
      if (/^(show|use|prefer|display|render)\b/i.test(text)) return "";
      if (/\b(narration-matching|footage or imagery|royal v2|royal documentary)\b/i.test(text)) {
        return "";
      }
      return text;
    };
    for (const key of [
      "primaryText",
      "secondaryText",
      "tagText",
      "locationTag",
      "text",
      "question",
      "subtext",
      "title",
      "subtitle",
      "kicker",
      "caption",
      "attribution",
      "context",
      "leftLabel",
      "rightLabel",
    ]) {
      if (key in cleaned) cleaned[key] = scrubInstruction(cleaned[key]);
    }
    if (Array.isArray(cleaned.slides)) {
      cleaned.slides = (cleaned.slides as Array<Record<string, unknown>>).map((slide) => ({
        ...slide,
        caption: scrubInstruction(slide.caption),
        kicker: scrubInstruction(slide.kicker),
      }));
    }
    return {
      id: e.id,
      presetId: e.presetId,
      startFrame: e.startFrame,
      durationFrames: e.durationFrames,
      layer: e.layer,
      tags: e.tags,
      props: {
        ...cleaned,
        showPresetLabel: false,
        _renderable: true,
      },
    };
  })
    .filter((e) => {
      const p = e.props as Record<string, unknown>;
      if (Array.isArray(p.slides) && (p.slides as unknown[]).length === 0) return false;
      if (e.presetId === "07_split_comparison_slideshow" && (!p.leftImageSrc || !p.rightImageSrc)) {
        return false;
      }
      if (e.presetId === "10_red_grid_archive_background" && !p.mainImage) return false;
      return true;
    });

  const voiceoverUrl =
    toRemotionPublicUrl(params.voiceoverPath) ||
    (params.voiceoverPath && /^https?:\/\//i.test(params.voiceoverPath)
      ? params.voiceoverPath
      : undefined);

  const sfxEvents = (params.sfxEvents || [])
    .filter((e) => e?.publicPath && Number.isFinite(e.startTime))
    .map((e) => ({
      id: e.id,
      sfxId: e.sfxId,
      publicPath: e.publicPath.replace(/^\/+/, ""),
      startTime: Math.max(0, e.startTime),
      durationSec: Math.max(0.2, Math.min(3, e.durationSec || 0.6)),
      volume: Math.max(0.05, Math.min(0.5, e.volume ?? 0.22)),
      reason: e.reason,
      sceneId: e.sceneId,
    }));

  const musicEvents = (params.musicEvents || [])
    .filter((e) => e?.publicPath && Number.isFinite(e.startTime))
    .slice(0, 3)
    .map((e) => ({
      id: e.id,
      musicId: e.musicId,
      publicPath: e.publicPath.replace(/^\/+/, ""),
      startTime: Math.max(0, e.startTime),
      durationSec: Math.max(20, Math.min(180, e.durationSec || 75)),
      volume: Math.max(0.05, Math.min(0.2, e.volume ?? 0.1)),
      fadeInSec: Math.max(0.5, Math.min(6, e.fadeInSec ?? 2.5)),
      fadeOutSec: Math.max(0.5, Math.min(8, e.fadeOutSec ?? 3.5)),
      reason: e.reason,
      role: e.role,
    }));

  const glitchEvents = (params.glitchEvents || [])
    .filter((e) => e?.publicPath && Number.isFinite(e.startTime))
    .slice(0, 200)
    .map((e) => ({
      id: e.id,
      glitchId: e.glitchId,
      publicPath: e.publicPath.replace(/^\/+/, ""),
      startTime: Math.max(0, e.startTime),
      durationSec: Math.max(0.4, Math.min(1.2, e.durationSec || 0.75)),
      volume: Math.max(0.05, Math.min(0.4, e.volume ?? 0.18)),
      blendMode: e.blendMode || "screen",
      reason: e.reason,
      sceneId: e.sceneId,
      darken: (e as { darken?: number }).darken,
      playbackRate: (e as { playbackRate?: number }).playbackRate,
    }));

  const cinematicIntro =
    params.cinematicIntro?.enabled && params.cinematicIntro.shots?.length
      ? {
          enabled: true as const,
          durationSec: params.cinematicIntro.durationSec || 7,
          musicVolume: params.cinematicIntro.musicVolume ?? 0.85,
          shots: params.cinematicIntro.shots
            .filter((s) => s?.src && s?.line1)
            .map((s) => ({
              src: s.src,
              line1: s.line1,
              line2: s.line2,
              motion: s.motion === "out" ? ("out" as const) : ("in" as const),
              overlay: s.overlay,
            })),
        }
      : undefined;

  return {
    scenes,
    effectEvents,
    sfxEvents,
    musicEvents,
    glitchEvents,
    fps,
    voiceoverUrl,
    cinematicIntro,
  };
}

export async function renderRemotionMp4OnLambda(params: {
  jobId: string;
  outputPath: string;
  inputProps: RemotionInputProps;
  onProgress?: (progress: number) => void;
}): Promise<{ outputPath: string; durationInFrames: number; renderId: string; outputUrl?: string }> {
  const { renderMediaOnLambda, getRenderProgress } = await import("@remotion/lambda/client");
  const { downloadMedia } = await import("@remotion/lambda");

  const region = getRemotionAwsRegion() as AwsRegion;
  const functionName = requireEnv("REMOTION_FUNCTION_NAME");
  const serveUrl = requireEnv("REMOTION_SERVE_URL");
  const inputProps = params.inputProps as unknown as Record<string, unknown>;

  console.log(
    `[remotion-lambda] starting job=${params.jobId} region=${region} function=${functionName}`
  );

  const { renderId, bucketName } = await renderMediaOnLambda({
    region,
    functionName,
    serveUrl,
    composition: COMPOSITION_ID,
    inputProps,
    codec: "h264",
    privacy: "public",
    downloadBehavior: { type: "play-in-browser" },
    chromiumOptions: {
      disableWebSecurity: true,
    },
  });

  console.log(`[remotion-lambda] renderId=${renderId} bucket=${bucketName}`);

  let durationInFrames = 0;
  let outputUrl: string | undefined;

  for (;;) {
    const progress = await getRenderProgress({
      renderId,
      bucketName,
      functionName,
      region,
    });

    if (progress.fatalErrorEncountered) {
      const detail =
        (progress.errors || [])
          .map((e) => {
            if (!e) return "";
            if (typeof e === "string") return e;
            if (typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
            return JSON.stringify(e);
          })
          .filter(Boolean)
          .join("; ") || "unknown Lambda render error";
      throw new Error(`Remotion Lambda render failed: ${detail}`);
    }

    params.onProgress?.(progress.overallProgress ?? 0);

    if (progress.done) {
      outputUrl = progress.outputFile || undefined;
      const meta = progress.renderMetadata as
        | { frameRange?: [number, number] | number[]; type?: string }
        | null
        | undefined;
      const range = meta?.frameRange;
      if (Array.isArray(range) && range.length >= 2) {
        durationInFrames = Math.max(0, Number(range[1]) - Number(range[0]) + 1);
      }
      break;
    }

    await sleep(LAMBDA_POLL_MS);
  }

  await fs.mkdir(path.dirname(params.outputPath), { recursive: true });

  try {
    await downloadMedia({
      region,
      bucketName,
      renderId,
      outPath: params.outputPath,
    });
    console.log(`[remotion-lambda] downloaded to ${params.outputPath}`);
  } catch (err) {
    // Fallback: fetch public S3 URL if downloadMedia fails
    if (!outputUrl) throw err;
    console.warn(
      `[remotion-lambda] downloadMedia failed, fetching outputFile URL:`,
      err instanceof Error ? err.message : err
    );
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`Failed to download Lambda output (${res.status}): ${outputUrl}`);
    await fs.writeFile(params.outputPath, Buffer.from(await res.arrayBuffer()));
  }

  return {
    outputPath: params.outputPath,
    durationInFrames,
    renderId,
    outputUrl,
  };
}

export async function renderRemotionMp4(params: {
  jobId: string;
  outputPath: string;
  inputProps: RemotionInputProps;
  onProgress?: (progress: number) => void;
}): Promise<{ outputPath: string; durationInFrames: number; renderId?: string; outputUrl?: string }> {
  if (useRemotionLambda()) {
    return renderRemotionMp4OnLambda(params);
  }

  const serveUrl = await getBundleLocation();
  const inputProps = params.inputProps;

  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
  });

  await fs.mkdir(path.dirname(params.outputPath), { recursive: true });

  const concurrency = Number(optionalEnv("REMOTION_CONCURRENCY") || "1");

  // Cap OffthreadVideo RAM — uncapped cache + multi‑hundred‑MB 4K Pexels
  // sources has been OOMing RunPod workers around ~74% of long renders.
  const cacheMb = Number(optionalEnv("REMOTION_OFFTHREAD_CACHE_MB") || "512");
  const offthreadVideoCacheSizeInBytes =
    Number.isFinite(cacheMb) && cacheMb > 0
      ? Math.round(cacheMb * 1024 * 1024)
      : 512 * 1024 * 1024;

  // Large stills + high concurrency can exceed Remotion's default ~30s
  // delayRender window mid-job; keep generous for dedicated 4090 renders.
  const timeoutInMilliseconds = Math.max(
    30_000,
    Number(optionalEnv("REMOTION_DELAY_RENDER_TIMEOUT_MS") || "180000") || 180_000
  );

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: params.outputPath,
    inputProps,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1,
    offthreadVideoCacheSizeInBytes,
    timeoutInMilliseconds,
    chromiumOptions: {
      disableWebSecurity: true,
      // Required for many Docker / RunPod images
      enableMultiProcessOnLinux: true,
    },
    onProgress: ({ progress }) => {
      params.onProgress?.(progress);
    },
  });

  return {
    outputPath: params.outputPath,
    durationInFrames: composition.durationInFrames,
  };
}
