/**
 * Images-only Remotion harden: demote video → stills, mirror remote media to R2,
 * fail-closed preflight before RunPod burns GPU.
 */
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { optionalEnv } from "../config.js";
import {
  mediaLibraryPublicBase,
  r2Configured,
  r2PutObject,
} from "../library/r2.js";
import type { RemotionInputProps } from "./remotionRender.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DOWNLOAD_TIMEOUT_MS = 20_000;
const MIRROR_CONCURRENCY = 6;
/** Skip re-encode when already a compact JPEG. */
const SMALL_JPEG_MAX_BYTES = 400_000;

export function imagesOnlyEnabled(): boolean {
  const raw = optionalEnv("REMOTION_IMAGES_ONLY");
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true; // default ON — stable RunPod path
}

function isVideoUrl(url?: string): boolean {
  return !!url && /\.(mp4|webm|mov|mkv|m4v)(?:[?&#]|$)/i.test(url);
}

function isAudioUrl(url?: string, contentType?: string): boolean {
  if (contentType && /^audio\//i.test(contentType)) return true;
  return !!url && /\.(mp3|wav|m4a|aac|ogg)(?:[?&#]|$)/i.test(url);
}

function isImageBuffer(contentType: string, url: string): boolean {
  if (/^image\//i.test(contentType)) return true;
  return /\.(png|jpe?g|webp|gif|avif)(?:[?&#]|$)/i.test(url);
}

async function recompressStillToJpeg(buf: Buffer): Promise<Buffer | null> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dvf-still-"));
  const inPath = path.join(tmp, "in.bin");
  const outPath = path.join(tmp, "out.jpg");
  try {
    await fs.writeFile(inPath, buf);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          inPath,
          "-vf",
          "scale='min(1920,iw)':-2",
          "-frames:v",
          "1",
          "-q:v",
          "3",
          outPath,
        ],
        { windowsHide: true }
      );
      let err = "";
      child.stderr.on("data", (d) => {
        err += String(d);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(err.slice(0, 300) || `ffmpeg exit ${code}`));
      });
    });
    const out = await fs.readFile(outPath);
    if (out.byteLength < 1000) return null;
    return out;
  } catch (err) {
    console.warn(
      `[images-only] jpeg recompress failed:`,
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

function r2PublicBase(): string {
  return (optionalEnv("R2_PUBLIC_URL") || "").replace(/\/$/, "");
}

/** URL already served from our R2 public bucket (or empty path relative). */
export function isTrustedRemotionMediaUrl(url: string): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) {
    // Remotion public/ relative paths (sfx, music, glitch overlays) resolve on the worker.
    return !isVideoUrl(url) || /^(sfx|music|overlays)\//i.test(url);
  }
  const publicBase = r2PublicBase();
  if (publicBase && url.startsWith(publicBase + "/")) return true;
  // Signed app routes that stream from our storage (OK if PUBLIC_APP_URL is set).
  if (/\/api\/render-storage\?/i.test(url)) return true;
  if (/\/api\/media-library\/render-asset\?/i.test(url)) return true;
  return false;
}

function extFor(contentType: string, url: string): string {
  if (/png/i.test(contentType) || /\.png(?:$|\?)/i.test(url)) return "png";
  if (/webp/i.test(contentType) || /\.webp(?:$|\?)/i.test(url)) return "webp";
  if (/gif/i.test(contentType)) return "gif";
  if (/mp3|mpeg/i.test(contentType) || /\.mp3(?:$|\?)/i.test(url)) return "mp3";
  if (/wav/i.test(contentType)) return "wav";
  if (/mp4/i.test(contentType) || /\.mp4(?:$|\?)/i.test(url)) return "mp4";
  return "jpg";
}

async function downloadBuffer(
  url: string
): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { "User-Agent": UA, Accept: "*/*" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 1000) return null;
    return { buf, contentType };
  } catch {
    return null;
  }
}

async function mirrorUrlToR2(params: {
  jobId: string;
  url: string;
  cache: Map<string, string>;
}): Promise<string | null> {
  const { jobId, url, cache } = params;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (isTrustedRemotionMediaUrl(url) && !isVideoUrl(url)) return url;
  if (cache.has(url)) return cache.get(url)!;

  const publicBase = r2PublicBase();
  if (!publicBase || !r2Configured()) {
    throw new Error("R2 not configured — cannot mirror media for images-only render");
  }

  const dl = await downloadBuffer(url);
  if (!dl) {
    console.warn(`[images-only] mirror download failed: ${url.slice(0, 120)}`);
    return null;
  }
  // Never upload video as a scene still in images-only mode (audio/VO is OK).
  if (/^video\//i.test(dl.contentType) || (isVideoUrl(url) && !isAudioUrl(url, dl.contentType))) {
    console.warn(`[images-only] refusing to mirror video as still: ${url.slice(0, 100)}`);
    return null;
  }

  let body = dl.buf;
  let contentType = dl.contentType;
  let ext = extFor(dl.contentType, url);

  if (isImageBuffer(dl.contentType, url) && !isAudioUrl(url, dl.contentType)) {
    const alreadySmallJpeg =
      (/jpeg|jpg/i.test(dl.contentType) || /\.jpe?g(?:$|\?)/i.test(url)) &&
      dl.buf.byteLength <= SMALL_JPEG_MAX_BYTES;
    if (!alreadySmallJpeg) {
      const jpg = await recompressStillToJpeg(dl.buf);
      if (jpg) {
        console.log(
          `[images-only] recompress ${(dl.buf.byteLength / 1e6).toFixed(2)}MB -> ${(jpg.byteLength / 1e6).toFixed(2)}MB jpg ${url.slice(0, 80)}`
        );
        body = jpg;
        contentType = "image/jpeg";
        ext = "jpg";
      } else if (dl.buf.byteLength > SMALL_JPEG_MAX_BYTES) {
        // Never hand Remotion a multi‑hundred‑KB+/MB still that failed compress —
        // those are what kill delayRender mid-job.
        console.warn(
          `[images-only] dropping oversized still after recompress fail (${(dl.buf.byteLength / 1e6).toFixed(2)}MB): ${url.slice(0, 120)}`
        );
        return null;
      }
    }
  }

  const hash = crypto.createHash("sha1").update(body).digest("hex").slice(0, 16);
  const key = `render-assets/${jobId}/mirror/${hash}.${ext}`;
  await r2PutObject({
    key,
    body,
    contentType: /image\//i.test(contentType)
      ? contentType
      : ext === "mp3"
        ? "audio/mpeg"
        : "image/jpeg",
  });
  const mirrored = `${publicBase}/${key}`;
  cache.set(url, mirrored);
  return mirrored;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker())
  );
  return out;
}

/** Strip all scene videoUrl fields; keep imageUrl only. */
export function forceImagesOnlyScenes(props: RemotionInputProps): RemotionInputProps {
  const scenes = props.scenes.map((s) => {
    const imageUrl = s.imageUrl && !isVideoUrl(s.imageUrl) ? s.imageUrl : undefined;
    const { videoUrl: _v, videoStartSeconds: _vs, ...rest } = s;
    if (!imageUrl) {
      console.warn(`[images-only] scene ${s.sceneId} has no still after demote`);
    }
    return {
      ...rest,
      imageUrl,
      cameraMotion: s.cameraMotion && s.cameraMotion !== "none" ? s.cameraMotion : "zoom_in",
      cameraIntensity: s.cameraIntensity ?? 0.06,
    };
  });
  return { ...props, scenes };
}

function collectHttpsUrls(props: RemotionInputProps): string[] {
  const urls = new Set<string>();
  const add = (u?: string) => {
    if (u && /^https?:\/\//i.test(u)) urls.add(u);
  };
  for (const s of props.scenes) add(s.imageUrl);
  add(props.voiceoverUrl);
  for (const e of props.effectEvents || []) {
    const p = e.props || {};
    for (const key of [
      "backgroundImage",
      "mainImage",
      "leftImageSrc",
      "rightImageSrc",
      "fromImageSrc",
      "toImageSrc",
    ]) {
      if (typeof p[key] === "string") add(p[key] as string);
    }
    if (Array.isArray(p.sideImages)) {
      for (const u of p.sideImages) if (typeof u === "string") add(u);
    }
    if (Array.isArray(p.slides)) {
      for (const sl of p.slides as Array<{ src?: string }>) add(sl?.src);
    }
  }
  // Glitch/music/sfx publicPaths are usually relative; only mirror absolute https.
  for (const g of props.glitchEvents || []) add(g.publicPath);
  for (const m of props.musicEvents || []) add(m.publicPath);
  for (const s of props.sfxEvents || []) add(s.publicPath);
  for (const shot of props.cinematicIntro?.shots || []) add(shot.src);
  return [...urls];
}

function rewriteUrlInProps(props: RemotionInputProps, map: Map<string, string>): RemotionInputProps {
  const rw = (u?: string) => (u && map.has(u) ? map.get(u)! : u);
  return {
    ...props,
    voiceoverUrl: rw(props.voiceoverUrl),
    scenes: props.scenes.map((s) => ({ ...s, imageUrl: rw(s.imageUrl) })),
    effectEvents: (props.effectEvents || []).map((e) => {
      const p = { ...(e.props || {}) };
      for (const key of [
        "backgroundImage",
        "mainImage",
        "leftImageSrc",
        "rightImageSrc",
        "fromImageSrc",
        "toImageSrc",
      ]) {
        if (typeof p[key] === "string") p[key] = rw(p[key] as string);
      }
      if (Array.isArray(p.sideImages)) {
        p.sideImages = (p.sideImages as string[]).map((u) => rw(u) || u);
      }
      if (Array.isArray(p.slides)) {
        p.slides = (p.slides as Array<Record<string, unknown>>).map((sl) => ({
          ...sl,
          src: typeof sl.src === "string" ? rw(sl.src) : sl.src,
        }));
      }
      return { ...e, props: p };
    }),
    glitchEvents: (props.glitchEvents || []).map((g) => ({
      ...g,
      publicPath: rw(g.publicPath) || g.publicPath,
    })),
    musicEvents: (props.musicEvents || []).map((m) => ({
      ...m,
      publicPath: rw(m.publicPath) || m.publicPath,
    })),
    sfxEvents: (props.sfxEvents || []).map((s) => ({
      ...s,
      publicPath: rw(s.publicPath) || s.publicPath,
    })),
    cinematicIntro: props.cinematicIntro
      ? {
          ...props.cinematicIntro,
          shots: (props.cinematicIntro.shots || []).map((shot) => ({
            ...shot,
            src: rw(shot.src) || shot.src,
          })),
        }
      : undefined,
  };
}

export type HardenResult = {
  props: RemotionInputProps;
  mirrored: number;
  skippedTrusted: number;
  failedUrls: string[];
};

/**
 * After mirror: replace any remaining non-R2 HTTPS image with a trusted still
 * from the job so Remotion never fetches dead hosts at render time.
 */
export function scrubUntrustedMediaUrls(props: RemotionInputProps): {
  props: RemotionInputProps;
  replaced: number;
} {
  const pool = props.scenes
    .map((s) => s.imageUrl)
    .filter((u): u is string => !!u && isTrustedRemotionMediaUrl(u) && !isVideoUrl(u));
  if (!pool.length) {
    return { props, replaced: 0 };
  }
  let cursor = 0;
  let replaced = 0;
  const next = () => {
    const u = pool[cursor % pool.length];
    cursor += 1;
    return u;
  };
  const fix = (u?: string): string | undefined => {
    if (!u) return u;
    if (!/^https?:\/\//i.test(u)) return u; // relative public paths OK
    if (isTrustedRemotionMediaUrl(u) && !isVideoUrl(u)) return u;
    replaced += 1;
    return next();
  };

  const scenes = props.scenes.map((s) => ({
    ...s,
    imageUrl: fix(s.imageUrl) || next(),
    videoUrl: undefined,
  }));

  const effectEvents = (props.effectEvents || []).map((e) => {
    const p = { ...(e.props || {}) };
    for (const key of [
      "backgroundImage",
      "mainImage",
      "leftImageSrc",
      "rightImageSrc",
      "fromImageSrc",
      "toImageSrc",
    ]) {
      if (typeof p[key] === "string") p[key] = fix(p[key] as string);
    }
    if (Array.isArray(p.sideImages)) {
      p.sideImages = (p.sideImages as string[]).map((u) => fix(u) || next());
    }
    if (Array.isArray(p.slides)) {
      p.slides = (p.slides as Array<Record<string, unknown>>).map((sl) => ({
        ...sl,
        src: typeof sl.src === "string" ? fix(sl.src) || next() : sl.src,
      }));
    }
    return { ...e, props: p };
  });

  const cinematicIntro = props.cinematicIntro
    ? {
        ...props.cinematicIntro,
        shots: (props.cinematicIntro.shots || []).map((shot) => ({
          ...shot,
          src: fix(shot.src) || next(),
        })),
      }
    : undefined;

  // Voiceover must stay trusted — if not, leave for preflight (cannot invent audio).
  return {
    props: {
      ...props,
      scenes,
      effectEvents,
      cinematicIntro,
    },
    replaced,
  };
}

/**
 * Mirror every non-trusted HTTPS asset to R2 and rewrite props.
 * Call after forceImagesOnlyScenes.
 */
export async function mirrorRemotionPropsToR2(
  jobId: string,
  props: RemotionInputProps
): Promise<HardenResult> {
  if (!r2Configured() || !r2PublicBase()) {
    throw new Error("R2_PUBLIC_URL / R2 credentials required for images-only harden");
  }
  const cache = new Map<string, string>();
  const urls = collectHttpsUrls(props);
  let mirrored = 0;
  let skippedTrusted = 0;
  const failedUrls: string[] = [];

  await mapPool(urls, MIRROR_CONCURRENCY, async (url) => {
    const isVo = props.voiceoverUrl === url;
    // VO: keep trusted R2 audio as-is (never recompress). Non-R2 VO still mirrored.
    if (
      isVo &&
      isTrustedRemotionMediaUrl(url) &&
      r2PublicBase() &&
      url.startsWith(r2PublicBase() + "/")
    ) {
      skippedTrusted += 1;
      cache.set(url, url);
      return;
    }
    // Stills: always remirror through JPEG compress — even if already on R2 —
    // so multi‑MB PNGs cannot kill Remotion delayRender mid-job.
    if (isVideoUrl(url) && !isVo && !isAudioUrl(url)) {
      failedUrls.push(url);
      return;
    }
    if (isAudioUrl(url) && isTrustedRemotionMediaUrl(url) && !isVo) {
      skippedTrusted += 1;
      cache.set(url, url);
      return;
    }
    const out = await mirrorUrlToR2({ jobId, url, cache });
    if (out) {
      if (out !== url) mirrored += 1;
    } else {
      failedUrls.push(url);
    }
  });

  return {
    props: rewriteUrlInProps(props, cache),
    mirrored,
    skippedTrusted,
    failedUrls,
  };
}

export type PreflightIssue = { level: "critical" | "warn"; message: string };

/** Fail-closed checks before submitting to RunPod. */
export function preflightImagesOnlyProps(props: RemotionInputProps): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  if (!props.scenes.length) {
    issues.push({ level: "critical", message: "No scenes in inputProps" });
  }
  const missingStill = props.scenes.filter((s) => !s.imageUrl);
  if (missingStill.length) {
    issues.push({
      level: "critical",
      message: `${missingStill.length} scenes missing imageUrl (${missingStill
        .slice(0, 5)
        .map((s) => s.sceneId)
        .join(", ")})`,
    });
  }
  const withVideo = props.scenes.filter((s) => s.videoUrl);
  if (withVideo.length) {
    issues.push({
      level: "critical",
      message: `${withVideo.length} scenes still have videoUrl (images-only required)`,
    });
  }
  const badHosts: string[] = [];
  const consider = (u?: string) => {
    if (u && /^https?:\/\//i.test(u) && !isTrustedRemotionMediaUrl(u)) badHosts.push(u);
  };
  for (const s of props.scenes) consider(s.imageUrl);
  consider(props.voiceoverUrl);
  for (const e of props.effectEvents || []) {
    const p = e.props || {};
    for (const key of [
      "backgroundImage",
      "mainImage",
      "leftImageSrc",
      "rightImageSrc",
      "fromImageSrc",
      "toImageSrc",
    ]) {
      if (typeof p[key] === "string") consider(p[key] as string);
    }
    if (Array.isArray(p.sideImages)) {
      for (const u of p.sideImages) if (typeof u === "string") consider(u);
    }
    if (Array.isArray(p.slides)) {
      for (const sl of p.slides as Array<{ src?: string }>) consider(sl?.src);
    }
  }
  if (badHosts.length) {
    issues.push({
      level: "critical",
      message: `${badHosts.length} non-R2/non-trusted HTTPS URLs remain (e.g. ${badHosts[0].slice(0, 100)})`,
    });
  }
  if (!props.voiceoverUrl) {
    issues.push({ level: "warn", message: "No voiceoverUrl — silent render" });
  }
  const coverage = props.scenes.filter((s) => s.imageUrl).length / Math.max(1, props.scenes.length);
  if (coverage < 0.95) {
    issues.push({
      level: "critical",
      message: `Still coverage ${(coverage * 100).toFixed(0)}% — need ≥95% scenes with images`,
    });
  }
  return issues;
}

/**
 * VO clock vs timeline length. Timeline is derived from scene end times.
 */
export function preflightVoiceoverDuration(params: {
  props: RemotionInputProps;
  voiceoverDurationSec?: number;
  toleranceSec?: number;
}): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const tol = params.toleranceSec ?? 2;
  const vo = params.voiceoverDurationSec;
  if (!vo || !Number.isFinite(vo) || vo <= 0) {
    issues.push({ level: "warn", message: "job.voiceoverDurationSec missing — skip VO clock guard" });
    return issues;
  }
  const timelineEnd = params.props.scenes.reduce((m, s) => Math.max(m, s.endTime || 0), 0);
  if (timelineEnd <= 0) {
    issues.push({ level: "critical", message: "Timeline duration is 0" });
    return issues;
  }
  if (Math.abs(timelineEnd - vo) > Math.max(tol, vo * 0.02)) {
    issues.push({
      level: "critical",
      message: `VO/timeline mismatch: voiceover ${vo.toFixed(1)}s vs timeline ${timelineEnd.toFixed(1)}s (tol ${tol}s)`,
    });
  }
  return issues;
}

export function mediaLibraryOk(): boolean {
  return Boolean(mediaLibraryPublicBase());
}
