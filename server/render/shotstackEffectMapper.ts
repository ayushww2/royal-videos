import { optionalEnv } from "../config.js";
import { jobDataFile, writeJson, readJson } from "../storage.js";
import type { ShotstackClip, ShotstackEdit } from "./shotstackClient.js";
import type { EffectTimelineEvent, SelectedPresetId } from "../visualIntelligence/effectPlanner.js";
import type { TimelineScene, ApprovedVisual } from "../../shared/visualIntelligence.js";
import path from "node:path";
import { config } from "../config.js";

export interface EffectMapEntry {
  effectId: string;
  presetId: string;
  renderable: boolean;
  simplified: boolean;
  shotstackClipsCreated: number;
  reason: string;
  warning?: string;
  renderProvider: "shotstack";
}

export interface EffectRenderabilityQa {
  jobId: string;
  plannedEffectsCount: number;
  renderableEffectsCount: number;
  skippedEffectsCount: number;
  simplifiedEffectsCount: number;
  effectsPerMinuteRenderable: number;
  cadenceMetFinalRender: boolean;
  entries: EffectMapEntry[];
  criticalIssues: string[];
  warnings: string[];
  checkedAt: string;
}

export interface ShotstackRenderAudit {
  jobId: string;
  baseVisualClipsCount: number;
  audioClipsCount: number;
  textOverlayClipsCount: number;
  slideshowImageSequenceClipsCount: number;
  transitionClipsCount: number;
  skippedEffectCount: number;
  renderableEffectCount: number;
  simplifiedEffectCount: number;
  matchedSceneReview: boolean;
  createdAt: string;
}

const FPS = 30;

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|mkv)(\?|$)/i.test(url);
}

export function toShotstackPublicUrl(filePathOrUrl?: string): string | undefined {
  if (!filePathOrUrl) return undefined;
  if (isHttp(filePathOrUrl)) return filePathOrUrl;
  const publicBase = optionalEnv("PUBLIC_APP_URL")?.replace(/\/$/, "");
  if (!publicBase) return undefined;
  // App-relative paths (signed library assets, /media/…, etc.) — needed for Shotstack + Lambda.
  if (filePathOrUrl.startsWith("/")) {
    return `${publicBase}${filePathOrUrl}`;
  }
  const normalized = path.resolve(filePathOrUrl);
  const storageRoot = path.resolve(config.storagePath);
  if (normalized.startsWith(storageRoot)) {
    const rel = normalized.slice(storageRoot.length).replace(/\\/g, "/").replace(/^\//, "");
    return `${publicBase}/media/${rel}`;
  }
  return undefined;
}

function titleClip(opts: {
  text: string;
  start: number;
  length: number;
  position?: string;
  size?: string;
  color?: string;
  background?: string;
  style?: string;
}): ShotstackClip {
  return {
    asset: {
      type: "title",
      text: opts.text,
      style: opts.style || "subtitle",
      color: opts.color || "#ffffff",
      size: opts.size || "small",
      background: opts.background || "#1E3F8F",
      position: opts.position || "bottomLeft",
    },
    start: opts.start,
    length: Math.max(1, opts.length),
  };
}

function imageClip(opts: {
  src: string;
  start: number;
  length: number;
  position?: string;
  scale?: number;
  opacity?: number;
  fit?: string;
  transition?: { in?: string; out?: string };
  effect?: string;
}): ShotstackClip {
  const clip: ShotstackClip = {
    asset: {
      type: "image",
      src: opts.src,
    },
    start: opts.start,
    length: Math.max(0.5, opts.length),
    fit: opts.fit || "cover",
  };
  if (opts.transition) clip.transition = opts.transition;
  if (opts.position) clip.position = opts.position;
  if (opts.scale) clip.scale = opts.scale;
  // Shotstack expects effect/opacity on the clip, not the image asset
  if (opts.effect) clip.effect = opts.effect;
  if (opts.opacity !== undefined) clip.opacity = opts.opacity;
  return clip;
}

/** Pack clips onto tracks with no time overlaps (Shotstack requirement). */
export function packClipsIntoTracks(clips: ShotstackClip[]): Array<{ clips: ShotstackClip[] }> {
  const sorted = [...clips].sort((a, b) => a.start - b.start || a.length - b.length);
  const tracks: ShotstackClip[][] = [];
  for (const clip of sorted) {
    const start = Number(clip.start.toFixed(3));
    const length = Number(Math.max(0.2, clip.length).toFixed(3));
    const normalized = { ...clip, start, length };
    let placed = false;
    for (const track of tracks) {
      const last = track[track.length - 1];
      if (last.start + last.length <= start + 0.001) {
        track.push(normalized);
        placed = true;
        break;
      }
    }
    if (!placed) tracks.push([normalized]);
  }
  return tracks.map((c) => ({ clips: c }));
}

function resolveMediaUrl(raw: unknown): string | undefined {
  const s = String(raw || "").trim();
  if (!s) return undefined;
  return toShotstackPublicUrl(s) || (isHttp(s) ? s : undefined);
}

function shortWords(text: string, max = 7): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, max)
    .join(" ");
}

type MapResult = {
  clips: ShotstackClip[];
  entry: EffectMapEntry;
};

function mapOneEffect(ev: EffectTimelineEvent, fps: number, videoEndSec: number): MapResult {
  const start = ev.startFrame / fps;
  const length = Math.max(0.8, ev.durationFrames / fps);
  const p = ev.props || {};
  const clips: ShotstackClip[] = [];
  const base: Omit<EffectMapEntry, "renderable" | "simplified" | "shotstackClipsCreated" | "reason" | "warning"> = {
    effectId: ev.id,
    presetId: ev.presetId,
    renderProvider: "shotstack",
  };

  if (start >= videoEndSec + 0.5) {
    return {
      clips: [],
      entry: {
        ...base,
        renderable: false,
        simplified: false,
        shotstackClipsCreated: 0,
        reason: "Effect starts after video end",
      },
    };
  }

  switch (ev.presetId as SelectedPresetId) {
    case "01_classic_blue_white_lower_third":
    case "29_classic_purple_white_lower_third": {
      const primary = String(p.primaryText || "").trim();
      const secondary = String(p.secondaryText || "").trim();
      if (!primary) {
        return {
          clips: [],
          entry: { ...base, renderable: false, simplified: false, shotstackClipsCreated: 0, reason: "Missing primaryText" },
        };
      }
      clips.push(
        titleClip({
          text: secondary ? `${primary}\n${secondary}` : primary,
          start,
          length: Math.min(4, Math.max(2.5, length)),
          position: "bottomLeft",
          size: "small",
          background: ev.presetId === "29_classic_purple_white_lower_third" ? "#4A2A6A" : "#1E3F8F",
          color: "#ffffff",
        })
      );
      return {
        clips,
        entry: {
          ...base,
          renderable: true,
          simplified: true,
          shotstackClipsCreated: clips.length,
          reason:
            ev.presetId === "29_classic_purple_white_lower_third"
              ? "Mapped to Shotstack title overlay (purple lower third)"
              : "Mapped to Shotstack title overlay (blue lower third)",
          warning: "Shotstack simplified version",
        },
      };
    }
    case "02_secondary_blue_lower_third": {
      const primary = String(p.primaryText || "").trim();
      const secondary = String(p.secondaryText || "").trim();
      if (!primary) {
        return {
          clips: [],
          entry: { ...base, renderable: false, simplified: false, shotstackClipsCreated: 0, reason: "Missing primaryText" },
        };
      }
      clips.push(
        titleClip({
          text: secondary ? `${primary}\n${secondary}` : primary,
          start,
          length: Math.min(4, Math.max(2.5, length)),
          position: "bottomLeft",
          size: "small",
          background: "#173C87",
          color: "#ffffff",
        })
      );
      return {
        clips,
        entry: {
          ...base,
          renderable: true,
          simplified: true,
          shotstackClipsCreated: clips.length,
          reason: "Mapped to Shotstack secondary lower-third title",
          warning: "Shotstack simplified version",
        },
      };
    }
    case "03_simple_text_overlay": {
      const text = shortWords(String(p.text || "").trim(), 7);
      if (!text) {
        return {
          clips: [],
          entry: { ...base, renderable: false, simplified: false, shotstackClipsCreated: 0, reason: "Missing text" },
        };
      }
      const secondary = String(p.secondaryText || "").trim();
      const posRaw = String(p.position || "bottom_center");
      const position =
        posRaw === "top_left"
          ? "topLeft"
          : posRaw === "bottom_left"
            ? "bottomLeft"
            : posRaw === "center"
              ? "center"
              : "bottom";
      clips.push(
        titleClip({
          text: secondary ? `${text}\n${shortWords(secondary, 8)}` : text,
          start,
          length: Math.min(4, Math.max(2.5, length)),
          position,
          size: "medium",
          background: "#000000",
          color: "#ffffff",
        })
      );
      return {
        clips,
        entry: {
          ...base,
          renderable: true,
          simplified: true,
          shotstackClipsCreated: clips.length,
          reason: "Mapped to Shotstack short title overlay",
          warning: "Shotstack simplified version",
        },
      };
    }
    case "04_glass_gallery_slideshow":
    case "05_archive_ribbon_slideshow":
    case "06_cinematic_stage_slideshow":
    case "21_royal_archive_slideshow":
    case "24_soft_glass_focus_slideshow":
    case "25_clean_zoom_frame_slideshow":
    case "26_minimal_blur_backdrop_slideshow":
    case "27_editorial_soft_pan_slideshow":
    case "28_crystal_stage_slideshow": {
      const slides = (p.slides as Array<{ src?: string; caption?: string; kicker?: string }> | undefined) || [];
      const urls = slides.map((s) => resolveMediaUrl(s.src)).filter(Boolean) as string[];
      if (!urls.length) {
        return {
          clips: [],
          entry: {
            ...base,
            renderable: false,
            simplified: false,
            shotstackClipsCreated: 0,
            reason: "Missing slideshow image URLs accessible to Shotstack",
          },
        };
      }
      const useUrls =
        ev.presetId === "06_cinematic_stage_slideshow" ||
        ev.presetId === "25_clean_zoom_frame_slideshow" ||
        ev.presetId === "28_crystal_stage_slideshow"
          ? urls.slice(0, 1)
          : urls.slice(0, 4);
      const seg = length / useUrls.length;
      useUrls.forEach((src, i) => {
        clips.push(
          imageClip({
            src,
            start: start + i * seg,
            length: Math.max(0.8, seg),
            fit: "cover",
            transition: { in: "fade", out: "fade" },
            effect:
              ev.presetId === "06_cinematic_stage_slideshow" ||
              ev.presetId === "25_clean_zoom_frame_slideshow"
                ? "zoomIn"
                : undefined,
          })
        );
      });
      const kicker = String(slides[0]?.kicker || p.kicker || "").trim();
      const caption = String(slides[0]?.caption || p.caption || "").trim();
      if (kicker || caption) {
        clips.push(
          titleClip({
            text: [kicker, caption].filter(Boolean).join("\n"),
            start,
            length: Math.min(length, 3.5),
            position: "bottom",
            size: "small",
            background: "#000000",
          })
        );
      }
      return {
        clips,
        entry: {
          ...base,
          renderable: true,
          simplified: true,
          shotstackClipsCreated: clips.length,
          reason:
            ev.presetId === "06_cinematic_stage_slideshow"
              ? "Mapped to Shotstack hero image hold (+ optional caption)"
              : "Mapped to Shotstack image sequence with fades",
          warning: "Shotstack simplified version",
        },
      };
    }
    case "07_split_comparison_slideshow": {
      const left = resolveMediaUrl(p.leftImageSrc);
      const right = resolveMediaUrl(p.rightImageSrc);
      if (!left || !right) {
        return {
          clips: [],
          entry: {
            ...base,
            renderable: false,
            simplified: false,
            shotstackClipsCreated: 0,
            reason: "Missing left/right comparison images",
          },
        };
      }
      const half = Math.max(2.5, length / 2);
      const leftLabel = String(p.leftLabel || "LEFT").trim();
      const rightLabel = String(p.rightLabel || "RIGHT").trim();
      clips.push(
        imageClip({ src: left, start, length: half, transition: { in: "fade", out: "fade" } }),
        titleClip({
          text: leftLabel,
          start,
          length: Math.min(2.5, half),
          position: "top",
          size: "small",
          background: "#000000",
        }),
        imageClip({
          src: right,
          start: start + half,
          length: half,
          transition: { in: "fade", out: "fade" },
        }),
        titleClip({
          text: rightLabel,
          start: start + half,
          length: Math.min(2.5, half),
          position: "top",
          size: "small",
          background: "#000000",
        })
      );
      return {
        clips,
        entry: {
          ...base,
          renderable: true,
          simplified: true,
          shotstackClipsCreated: clips.length,
          reason: "Mapped to sequential A/B comparison (Shotstack side-by-side limited)",
          warning: "Shotstack simplified version",
        },
      };
    }
    case "08_reveal_question":
    case "15_quote_only": {
      const q =
        ev.presetId === "15_quote_only"
          ? String(p.quote || p.text || "").trim()
          : String(p.question || p.primaryText || "").trim();
      if (!q) {
        return {
          clips: [],
          entry: {
            ...base,
            renderable: false,
            simplified: false,
            shotstackClipsCreated: 0,
            reason: ev.presetId === "15_quote_only" ? "Missing quote text" : "Missing question text",
          },
        };
      }
      const sub =
        ev.presetId === "15_quote_only"
          ? [String(p.attribution || "").trim(), String(p.context || "").trim()]
              .filter(Boolean)
              .join("\n")
          : String(p.secondaryText || p.subtext || "").trim();
      const bg = resolveMediaUrl(p.backgroundImage);
      if (bg) {
        clips.push(
          imageClip({
            src: bg,
            start,
            length: Math.min(5, Math.max(3, length)),
            fit: "cover",
            opacity: 0.35,
          })
        );
      }
      clips.push(
        titleClip({
          text: sub ? `${q}\n${sub}` : q,
          start,
          length: Math.min(5, Math.max(3, length)),
          position: "center",
          size: "large",
          background: "#000000",
          style: "minimal",
        })
      );
      return {
        clips,
        entry: {
          ...base,
          renderable: true,
          simplified: true,
          shotstackClipsCreated: clips.length,
          reason:
            ev.presetId === "15_quote_only"
              ? "Mapped to Shotstack centered quote title (+ optional bg)"
              : "Mapped to Shotstack centered reveal title (+ optional bg)",
          warning: "Shotstack simplified version",
        },
      };
    }
    case "09_glitch_cut_transition": {
      const from = resolveMediaUrl(p.fromImageSrc);
      const to = resolveMediaUrl(p.toImageSrc);
      if (!from || !to) {
        return {
          clips: [],
          entry: {
            ...base,
            renderable: false,
            simplified: false,
            shotstackClipsCreated: 0,
            reason: "Missing from/to images for transition",
          },
        };
      }
      const flash = Math.min(1.4, Math.max(0.9, length));
      const half = flash / 2;
      clips.push(
        imageClip({
          src: from,
          start,
          length: half,
          transition: { out: "fade" },
        }),
        imageClip({
          src: to,
          start: start + half,
          length: half,
          transition: { in: "fade" },
        }),
        titleClip({
          text: " ",
          start: start + half - 0.08,
          length: 0.16,
          position: "center",
          size: "large",
          background: "#ffffff",
          color: "#ffffff",
        })
      );
      return {
        clips,
        entry: {
          ...base,
          renderable: true,
          simplified: true,
          shotstackClipsCreated: clips.length,
          reason: "Mapped to fast flash/cut fade transition (no true glitch)",
          warning: "Shotstack simplified version",
        },
      };
    }
    case "10_red_grid_archive_background": {
      const main = resolveMediaUrl(p.mainImage);
      if (!main) {
        return {
          clips: [],
          entry: {
            ...base,
            renderable: false,
            simplified: false,
            shotstackClipsCreated: 0,
            reason: "Missing mainImage",
          },
        };
      }
      const title = String(p.title || "").trim();
      const subtitle = String(p.subtitle || "").trim();
      if (!title) {
        return {
          clips: [],
          entry: { ...base, renderable: false, simplified: false, shotstackClipsCreated: 0, reason: "Missing title" },
        };
      }
      clips.push(
        imageClip({
          src: main,
          start,
          length: Math.min(10, Math.max(5, length)),
          fit: "cover",
          effect: "zoomIn",
          transition: { in: "fade", out: "fade" },
        })
      );
      const sides = (Array.isArray(p.sideImages) ? p.sideImages : [])
        .map((u) => resolveMediaUrl(u))
        .filter(Boolean) as string[];
      // Side images as brief preceding flashes if available
      sides.slice(0, 2).forEach((src, i) => {
        clips.push(
          imageClip({
            src,
            start: start + i * 0.35,
            length: 0.7,
            opacity: 0.45,
            transition: { in: "fade", out: "fade" },
          })
        );
      });
      clips.push(
        titleClip({
          text: subtitle ? `${title}\n${subtitle}` : title,
          start,
          length: Math.min(4, Math.max(2.5, length * 0.5)),
          position: "bottom",
          size: "medium",
          background: "#3A0A0A",
        })
      );
      return {
        clips,
        entry: {
          ...base,
          renderable: true,
          simplified: true,
          shotstackClipsCreated: clips.length,
          reason: "Mapped to main image + title/subtitle (no red grid recreation)",
          warning: "Shotstack simplified version",
        },
      };
    }
    default:
      return {
        clips: [],
        entry: {
          ...base,
          renderable: false,
          simplified: false,
          shotstackClipsCreated: 0,
          reason: `Unsupported presetId for Shotstack: ${ev.presetId}`,
        },
      };
  }
}

export async function mapEffectsToShotstack(params: {
  jobId: string;
  events: EffectTimelineEvent[];
  scenes: TimelineScene[];
  fps?: number;
}): Promise<{
  effectClips: ShotstackClip[];
  map: EffectMapEntry[];
  qa: EffectRenderabilityQa;
}> {
  const fps = params.fps || FPS;
  const videoEndSec = params.scenes.reduce((m, s) => Math.max(m, s.endTime || 0), 0) || 120;
  const durationMin = Math.max(1 / 60, videoEndSec / 60);

  const effectClips: ShotstackClip[] = [];
  const map: EffectMapEntry[] = [];
  const criticalIssues: string[] = [];
  const warnings: string[] = [];

  for (const ev of params.events) {
    const result = mapOneEffect(ev, fps, videoEndSec);
    map.push(result.entry);
    if (result.entry.renderable) {
      effectClips.push(...result.clips);
      if (result.entry.warning) warnings.push(`${ev.id}: ${result.entry.warning}`);
      if (ev.blocksSubtitles) warnings.push(`${ev.id}: may overlap subtitles — keep captions clear of lower third`);
    } else {
      criticalIssues.push(`${ev.id}: ${result.entry.reason}`);
      warnings.push(`${ev.id}: Will not appear in final render`);
    }
  }

  const renderable = map.filter((m) => m.renderable);
  const skipped = map.filter((m) => !m.renderable);
  const simplified = map.filter((m) => m.simplified && m.renderable);
  const effectsPerMinuteRenderable = Number((renderable.length / durationMin).toFixed(2));
  // Soft cadence: for ~2 min aim for 4–6 renderable; for longer ~2/min
  const targetMin = Math.max(2, Math.floor(durationMin * 2));
  const cadenceMetFinalRender = renderable.length >= Math.min(targetMin, 4) || params.events.length === 0;

  const qa: EffectRenderabilityQa = {
    jobId: params.jobId,
    plannedEffectsCount: params.events.length,
    renderableEffectsCount: renderable.length,
    skippedEffectsCount: skipped.length,
    simplifiedEffectsCount: simplified.length,
    effectsPerMinuteRenderable,
    cadenceMetFinalRender,
    entries: map,
    criticalIssues,
    warnings,
    checkedAt: new Date().toISOString(),
  };

  await writeJson(jobDataFile("shotstack-effect-map", params.jobId), {
    jobId: params.jobId,
    entries: map,
    createdAt: new Date().toISOString(),
  });
  await writeJson(jobDataFile("effect-renderability-qa", params.jobId), qa);

  return { effectClips, map, qa };
}

/** Presets that fully replace the base scene visual while they play. */
const FULL_FRAME_REPLACE_PRESETS = new Set<string>([
  "04_glass_gallery_slideshow",
  "05_archive_ribbon_slideshow",
  "06_cinematic_stage_slideshow",
  "07_split_comparison_slideshow",
  "09_glitch_cut_transition",
  "10_red_grid_archive_background",
  "15_quote_only",
  "21_royal_archive_slideshow",
  "24_soft_glass_focus_slideshow",
  "25_clean_zoom_frame_slideshow",
  "26_minimal_blur_backdrop_slideshow",
  "27_editorial_soft_pan_slideshow",
  "28_crystal_stage_slideshow",
]);

export function buildBaseVisualClips(
  scenes: TimelineScene[],
  libraryById: Map<string, ApprovedVisual>
): { clips: ShotstackClip[]; count: number } {
  const clips: ShotstackClip[] = [];
  let cursor = 0;
  for (const scene of scenes) {
    const length = Math.max(1, Number(scene.duration) || 3.5);
    // Prefer beat/scene clock so effect startFrames (from scene.startTime) stay aligned.
    const start =
      typeof scene.startTime === "number" && Number.isFinite(scene.startTime)
        ? Math.max(0, scene.startTime)
        : cursor;
    const visual = libraryById.get(scene.approvedVisualId || scene.selectedVisualId);
    const src = toShotstackPublicUrl(visual?.filePathOrUrl) || toShotstackPublicUrl(visual?.thumbnail);
    if (!src) {
      cursor = Math.max(cursor, start + length);
      continue;
    }
    if (
      isVideoUrl(src) ||
      visual?.source === "pexels_clip" ||
      visual?.source === "pixabay_clip" ||
      visual?.source === "raw_footage" ||
      visual?.source === "user_youtube_raw"
    ) {
      clips.push({
        asset: { type: "video", src, volume: 0 },
        start,
        length,
        fit: "cover",
      });
    } else {
      clips.push({
        asset: { type: "image", src },
        start,
        length,
        fit: "cover",
        transition: { in: "fade", out: "fade" },
      });
    }
    cursor = Math.max(cursor, start + length);
  }
  return { clips, count: clips.length };
}

/**
 * Remove (or split) base visual clips under full-frame presentation effects
 * so effects replace the shot instead of stacking a second image on top.
 */
export function punchOutBaseClipsForEffects(
  baseClips: ShotstackClip[],
  ranges: Array<{ start: number; end: number }>
): ShotstackClip[] {
  if (!ranges.length) return baseClips;
  const out: ShotstackClip[] = [];
  for (const clip of baseClips) {
    let segments: Array<{ start: number; length: number }> = [
      { start: clip.start, length: clip.length },
    ];
    for (const range of ranges) {
      const next: Array<{ start: number; length: number }> = [];
      for (const seg of segments) {
        const segEnd = seg.start + seg.length;
        const overlapStart = Math.max(seg.start, range.start);
        const overlapEnd = Math.min(segEnd, range.end);
        if (overlapEnd <= overlapStart + 0.05) {
          next.push(seg);
          continue;
        }
        if (overlapStart > seg.start + 0.05) {
          next.push({ start: seg.start, length: overlapStart - seg.start });
        }
        if (segEnd > overlapEnd + 0.05) {
          next.push({ start: overlapEnd, length: segEnd - overlapEnd });
        }
      }
      segments = next;
    }
    for (const seg of segments) {
      if (seg.length < 0.2) continue;
      out.push({ ...clip, start: seg.start, length: seg.length });
    }
  }
  return out;
}

export async function buildParityShotstackEdit(params: {
  jobId: string;
  scenes: TimelineScene[];
  libraryById: Map<string, ApprovedVisual>;
  voiceoverSrc?: string;
  effectEvents: EffectTimelineEvent[];
  fps?: number;
}): Promise<{
  edit: ShotstackEdit;
  map: EffectMapEntry[];
  qa: EffectRenderabilityQa;
  audit: ShotstackRenderAudit;
}> {
  const fps = params.fps || FPS;
  const base = buildBaseVisualClips(params.scenes, params.libraryById);
  const mapped = await mapEffectsToShotstack({
    jobId: params.jobId,
    events: params.effectEvents,
    scenes: params.scenes,
    fps,
  });

  // Only include renderable effect clips
  const effectClips = mapped.effectClips;
  const textOverlayClipsCount = effectClips.filter((c) => c.asset?.type === "title").length;
  const slideshowImageSequenceClipsCount = effectClips.filter((c) => c.asset?.type === "image").length;
  const transitionClipsCount = mapped.map.filter(
    (m) => m.renderable && m.presetId === "09_glitch_cut_transition"
  ).length;

  // Full-frame presentation effects replace base visuals (no double-stack).
  const replaceRanges = mapped.map
    .filter((m) => m.renderable && FULL_FRAME_REPLACE_PRESETS.has(m.presetId))
    .map((m) => {
      const ev = params.effectEvents.find((e) => e.id === m.effectId);
      if (!ev) return null;
      const start = ev.startFrame / fps;
      const end = start + Math.max(0.8, ev.durationFrames / fps);
      return { start, end };
    })
    .filter((r): r is { start: number; end: number } => !!r);

  const baseClips = punchOutBaseClipsForEffects(base.clips, replaceRanges);

  // Shotstack rejects overlapping clips on the same track — pack separately.
  const tracks: Array<{ clips: ShotstackClip[] }> = [
    ...packClipsIntoTracks(effectClips),
    ...packClipsIntoTracks(baseClips),
  ];

  const edit: ShotstackEdit = {
    timeline: {
      background: "#000000",
      tracks,
    },
    output: {
      format: "mp4",
      resolution: "hd",
      aspectRatio: "16:9",
      fps: 25,
      quality: "medium",
    },
  };
  if (params.voiceoverSrc) {
    edit.timeline.soundtrack = {
      src: params.voiceoverSrc,
      effect: "fadeInFadeOut",
    };
  }

  const audit: ShotstackRenderAudit = {
    jobId: params.jobId,
    baseVisualClipsCount: baseClips.length,
    audioClipsCount: params.voiceoverSrc ? 1 : 0,
    textOverlayClipsCount,
    slideshowImageSequenceClipsCount,
    transitionClipsCount,
    skippedEffectCount: mapped.qa.skippedEffectsCount,
    renderableEffectCount: mapped.qa.renderableEffectsCount,
    simplifiedEffectCount: mapped.qa.simplifiedEffectsCount,
    matchedSceneReview: mapped.qa.skippedEffectsCount === 0 || mapped.qa.renderableEffectsCount > 0,
    createdAt: new Date().toISOString(),
  };

  await writeJson(jobDataFile("shotstack-edit", params.jobId), edit);
  await writeJson(jobDataFile("shotstack-edit-json", params.jobId), edit);
  await writeJson(jobDataFile("shotstack-render-audit", params.jobId), audit);
  await writeJson(jobDataFile("final-timeline", params.jobId), {
    jobId: params.jobId,
    scenes: params.scenes,
    locked: true,
    renderer: "shotstack",
    effectEventsRenderable: mapped.map.filter((m) => m.renderable).map((m) => m.effectId),
  });

  return { edit, map: mapped.map, qa: mapped.qa, audit };
}

export async function attachRenderabilityToScenes(
  jobId: string,
  scenes: Array<TimelineScene & { effects?: Array<Record<string, unknown>> }>,
  map: EffectMapEntry[]
): Promise<typeof scenes> {
  const byId = new Map(map.map((m) => [m.effectId, m]));
  const enriched = scenes.map((s) => ({
    ...s,
    effects: (s.effects || []).map((e) => {
      const id = String(e.id || "");
      const m = byId.get(id);
      return {
        ...e,
        renderProvider: "shotstack" as const,
        renderable: m?.renderable ?? false,
        simplified: m?.simplified ?? false,
        renderReason: m?.reason,
        renderWarning: m?.warning,
      };
    }),
  }));
  await writeJson(jobDataFile("visual-intelligence-final-assignment", jobId), {
    jobId,
    scenes: enriched,
  });
  return enriched;
}

export async function loadEffectEvents(jobId: string): Promise<EffectTimelineEvent[]> {
  const data = await readJson<{ events?: EffectTimelineEvent[] }>(jobDataFile("effect-timeline", jobId));
  return data?.events || [];
}
