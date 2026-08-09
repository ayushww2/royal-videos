/**
 * Mystery v2 effect density (manager lock):
 * - 3 classic blue lower thirds / minute
 * - 2 glass slideshows / minute
 * - 1 question ask / minute
 * - 1 reveal / 2 minutes
 * - plus glitch/film-burn cut energy + Ken Burns handled in Remotion scenes
 */
import { jobDataFile, writeJson } from "../../storage.js";
import type { EffectTimelineEvent } from "../effectPlanner.js";
import type { TimelineScene, TitleLock, VisualBeat } from "../../../shared/visualIntelligence.js";

const FPS = 30;
const LT = "01_classic_blue_white_lower_third";
const GLASS = "04_glass_gallery_slideshow";
const QUESTION = "08_reveal_question";
const REVEAL = "08_reveal_question";
const GLITCH_CUT = "09_glitch_cut_transition";

const TRANSITION_OVERLAYS = [
  "overlays/transitions/film-burn.mp4",
  "overlays/transitions/soft-film-burn.mp4",
  "overlays/transitions/light-film-burn.mp4",
  "overlays/transitions/film-burn-woosh.mp4",
  "overlays/transitions/camera-shutter.mp4",
  "overlays/transitions/transition-glitch.mp4",
  "overlays/transitions/light-glitch-effect.mp4",
  "overlays/transitions/rgb-glitch-effect.mp4",
  "overlays/transitions/white-glitch.mp4",
];

function countPerMin(n: number, durationSec: number): number {
  return Math.max(1, Math.round((durationSec / 60) * n));
}

function placeEven(
  count: number,
  durationSec: number,
  clipSec: number,
  blocked: Array<{ s: number; e: number }>,
  pad = 3
): number[] {
  const out: number[] = [];
  const usable = Math.max(clipSec + pad * 2, durationSec - pad * 2);
  for (let i = 0; i < count; i++) {
    let start = pad + ((i + 0.5) / count) * usable - clipSec / 2;
    start = Math.max(pad, Math.min(durationSec - clipSec - 0.5, start));
    for (let a = 0; a < 20; a++) {
      const end = start + clipSec;
      const hit = blocked.some((b) => start < b.e + 0.6 && end > b.s - 0.6);
      const self = out.some((p) => Math.abs(p - start) < clipSec + 0.8);
      if (!hit && !self) break;
      start = Math.min(durationSec - clipSec - 0.5, start + clipSec + 1.2);
      if (start + clipSec >= durationSec - 1) start = pad + a * 2.2;
    }
    out.push(Number(start.toFixed(2)));
  }
  return out;
}

function sceneAt(scenes: TimelineScene[], t: number): TimelineScene {
  return (
    scenes.find((s) => t >= s.startTime && t < s.endTime) ||
    scenes[scenes.length - 1] ||
    scenes[0]
  );
}

function upperWords(text: string, n: number): string {
  const stop = new Set(
    "the a an and or of to in on for is are was were be that this with as at by from into would could".split(
      " "
    )
  );
  const words = text
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
  return words.slice(0, n).join(" ").toUpperCase().slice(0, 32) || "MYSTERY";
}

function slidesFrom(
  scenes: TimelineScene[],
  libraryUrls: Map<string, string>,
  t: number,
  n: number
): Array<{ src: string; kicker?: string; caption?: string }> {
  const startIdx = Math.max(0, scenes.findIndex((s) => s.startTime >= t));
  const out: Array<{ src: string; kicker?: string; caption?: string }> = [];
  for (let i = 0; i < n; i++) {
    const sc = scenes[(startIdx + i) % scenes.length];
    const src =
      libraryUrls.get(sc.approvedVisualId || sc.selectedVisualId || "") ||
      sc.previewUrl ||
      "";
    if (!src) continue;
    out.push({
      src,
      kicker: "FIELD RECORD",
      caption: (sc.narrationText || "").slice(0, 72),
    });
  }
  return out;
}

export type MysteryGlitchEvent = {
  id: string;
  glitchId: string;
  publicPath: string;
  startTime: number;
  durationSec: number;
  volume: number;
  blendMode?: "screen" | "lighten" | "plus-lighter";
  reason?: string;
  sceneId?: string;
  darken?: number;
};

export function planMysteryV2EffectDensity(params: {
  jobId: string;
  title: string;
  scenes: TimelineScene[];
  beats?: VisualBeat[];
  titleLock?: TitleLock | null;
  libraryUrls: Map<string, string>;
}): {
  events: EffectTimelineEvent[];
  glitchEvents: MysteryGlitchEvent[];
  counts: Record<string, number>;
} {
  const scenes = params.scenes;
  const durationSec = Math.max(
    ...scenes.map((s) => s.endTime || 0),
    scenes.reduce((n, s) => n + (s.duration || 0), 0)
  );
  const events: EffectTimelineEvent[] = [];
  const blocked: Array<{ s: number; e: number }> = [];
  let id = 0;
  const add = (e: Omit<EffectTimelineEvent, "id" | "layer"> & { layer?: number }) => {
    const ev: EffectTimelineEvent = {
      id: `m2-fx-${++id}`,
      layer: e.layer ?? 10,
      ...e,
    } as EffectTimelineEvent;
    events.push(ev);
    blocked.push({
      s: e.startFrame / FPS,
      e: (e.startFrame + e.durationFrames) / FPS,
    });
  };

  const secondary = upperWords(
    params.titleLock?.centralObjectOrPlace || params.title || "MYSTERY",
    4
  );

  // 2 glass slideshows / minute
  {
    const n = countPerMin(2, durationSec);
    const showSec = 4.2;
    for (const start of placeEven(n, durationSec, showSec, blocked, 4)) {
      const sc = sceneAt(scenes, start);
      const slides = slidesFrom(scenes, params.libraryUrls, start, 3);
      if (slides.length < 1) continue;
      add({
        presetId: GLASS,
        startFrame: Math.round(start * FPS),
        durationFrames: Math.round(showSec * FPS),
        sceneId: sc.sceneId,
        reason: "Mystery v2 density: 2 glass/min",
        tags: ["mystery_v2_density", "glass"],
        props: { slides, showPresetLabel: false },
      });
    }
  }

  // 1 question ask / minute
  {
    const n = countPerMin(1, durationSec);
    const showSec = 3.8;
    for (const start of placeEven(n, durationSec, showSec, blocked, 5)) {
      const sc = sceneAt(scenes, start);
      const q = (sc.narrationText || "").match(/[^.?!]*\?/)?.[0]?.trim();
      add({
        presetId: QUESTION,
        startFrame: Math.round(start * FPS),
        durationFrames: Math.round(showSec * FPS),
        sceneId: sc.sceneId,
        reason: "Mystery v2 density: 1 question/min",
        tags: ["mystery_v2_density", "question"],
        blocksSubtitles: true,
        props: {
          question: (q || upperWords(sc.narrationText || "WHAT HAPPENED NEXT", 6) + "?").slice(
            0,
            90
          ),
          answer: "",
          showPresetLabel: false,
          mode: "question",
        },
      });
    }
  }

  // 1 reveal every 2 minutes
  {
    const n = Math.max(1, Math.round(durationSec / 120));
    const showSec = 4.0;
    for (const start of placeEven(n, durationSec, showSec, blocked, 8)) {
      const sc = sceneAt(scenes, start);
      add({
        presetId: REVEAL,
        startFrame: Math.round(start * FPS),
        durationFrames: Math.round(showSec * FPS),
        sceneId: sc.sceneId,
        reason: "Mystery v2 density: 1 reveal / 2 min",
        tags: ["mystery_v2_density", "reveal"],
        blocksSubtitles: true,
        props: {
          question: upperWords(sc.narrationText || "THE TRUTH", 5),
          answer: (sc.narrationText || "").slice(0, 90),
          showPresetLabel: false,
          mode: "reveal",
        },
      });
    }
  }

  // Sparse glitch-cut transitions (~1/min) for wipe/energy
  {
    const n = countPerMin(1, durationSec);
    const showSec = 0.9;
    for (const start of placeEven(n, durationSec, showSec, blocked, 6)) {
      const sc = sceneAt(scenes, start);
      const next = sceneAt(scenes, Math.min(durationSec - 0.1, start + 1.2));
      const from =
        params.libraryUrls.get(sc.approvedVisualId || sc.selectedVisualId || "") ||
        sc.previewUrl;
      const to =
        params.libraryUrls.get(next.approvedVisualId || next.selectedVisualId || "") ||
        next.previewUrl;
      if (!from || !to) continue;
      add({
        presetId: GLITCH_CUT,
        startFrame: Math.round(start * FPS),
        durationFrames: Math.round(showSec * FPS),
        sceneId: sc.sceneId,
        reason: "Mystery v2 transition energy",
        tags: ["mystery_v2_density", "transition", "wipe"],
        props: {
          fromImageSrc: from,
          toImageSrc: to,
          showPresetLabel: false,
        },
      });
    }
  }

  // 3 classic blue lower thirds / minute (overlay — lighter collision)
  {
    const ltBlocked = blocked.map((b) => ({ ...b }));
    const n = countPerMin(3, durationSec);
    const showSec = 3.4;
    for (const start of placeEven(n, durationSec, showSec, ltBlocked, 2)) {
      const sc = sceneAt(scenes, start);
      add({
        presetId: LT,
        startFrame: Math.round(start * FPS),
        durationFrames: Math.round(showSec * FPS),
        sceneId: sc.sceneId,
        reason: "Mystery v2 density: 3 classic blue LT/min",
        tags: ["mystery_v2_density", "lower_third"],
        blocksSubtitles: true,
        layer: 20,
        props: {
          primaryText: upperWords(sc.narrationText || params.title, 3),
          secondaryText: secondary,
          position: "bottom_left",
          showPresetLabel: false,
        },
      });
    }
  }

  events.sort((a, b) => a.startFrame - b.startFrame || a.layer - b.layer);

  // Film-burn / glitch overlays (~2.5/min) for fade/wipe feel between stills
  const glitchEvents: MysteryGlitchEvent[] = [];
  const gN = countPerMin(2.5, durationSec);
  const gStarts = placeEven(gN, durationSec, 0.7, [], 3);
  gStarts.forEach((start, i) => {
    const sc = sceneAt(scenes, start);
    glitchEvents.push({
      id: `m2-glitch-${i + 1}`,
      glitchId: `overlay-${i % TRANSITION_OVERLAYS.length}`,
      publicPath: TRANSITION_OVERLAYS[i % TRANSITION_OVERLAYS.length],
      startTime: start,
      durationSec: 0.65,
      volume: 0.12,
      blendMode: "screen",
      darken: 0.35,
      reason: "Mystery v2 cut energy (fade/wipe/burn)",
      sceneId: sc.sceneId,
    });
  });

  const counts: Record<string, number> = {};
  for (const e of events) counts[e.presetId] = (counts[e.presetId] || 0) + 1;
  counts.glitchOverlays = glitchEvents.length;

  return { events, glitchEvents, counts };
}

export async function persistMysteryV2Effects(params: {
  jobId: string;
  title: string;
  scenes: TimelineScene[];
  beats?: VisualBeat[];
  titleLock?: TitleLock | null;
  libraryUrls: Map<string, string>;
}): Promise<{
  events: EffectTimelineEvent[];
  glitchEvents: MysteryGlitchEvent[];
  counts: Record<string, number>;
}> {
  const planned = planMysteryV2EffectDensity(params);
  await writeJson(jobDataFile("effect-timeline", params.jobId), {
    jobId: params.jobId,
    fps: FPS,
    events: planned.events,
    mode: "mystery_v2_density",
    counts: planned.counts,
  });
  await writeJson(jobDataFile("effect-planner", params.jobId), {
    jobId: params.jobId,
    events: planned.events,
    mode: "mystery_v2_density",
    counts: planned.counts,
    note: "3 LT/min classic blue · 2 glass/min · 1 question/min · 1 reveal/2min · transition overlays",
  });
  await writeJson(jobDataFile("royal-v2-glitch-plan", params.jobId), {
    jobId: params.jobId,
    events: planned.glitchEvents,
    mode: "mystery_v2_transitions",
  });
  return planned;
}
