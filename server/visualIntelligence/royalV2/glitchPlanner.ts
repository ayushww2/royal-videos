/**
 * Royal v2 sparse glitch overlay planner.
 * Places ~0.75s screen-blend glitch clips (with ducked audio) on rare
 * chapter / crisis / reveal scene changes — not every cut.
 */
import { optionalEnv } from "../../config.js";
import type { TimelineScene } from "../../../shared/visualIntelligence.js";
import type { EffectTimelineEvent } from "../effectPlanner.js";

export type RoyalGlitchId =
  | "glitch_scan_a"
  | "glitch_scan_b"
  | "glitch_line_burst"
  | "glitch_static"
  | "glitch_block_slice";

export type RoyalGlitchEvent = {
  id: string;
  glitchId: RoyalGlitchId;
  /** Path under Remotion public dir, e.g. overlays/glitch/glitch_line_burst.mp4 */
  publicPath: string;
  startTime: number;
  durationSec: number;
  /** Overlay video volume (source already ~-28 LUFS). */
  volume: number;
  /** CSS mix-blend-mode for the overlay video. */
  blendMode: "screen" | "lighten" | "plus-lighter";
  reason: string;
  sceneId?: string;
};

const APPROVED: RoyalGlitchId[] = [
  "glitch_line_burst",
  "glitch_block_slice",
  "glitch_scan_a",
  "glitch_scan_b",
  "glitch_static",
];

/** Prefer subtler clips; static only for crisis/reveal. */
const SOFT_ROTATION: RoyalGlitchId[] = [
  "glitch_line_burst",
  "glitch_block_slice",
  "glitch_scan_a",
  "glitch_scan_b",
];

const DEFAULT_VOLUME: Record<RoyalGlitchId, number> = {
  glitch_scan_a: 0.2,
  glitch_scan_b: 0.2,
  glitch_line_burst: 0.18,
  glitch_static: 0.16,
  glitch_block_slice: 0.18,
};

const CLIP_DURATION = 0.75;
/** Extra duck under VO on top of loudnorm'd files. */
const MASTER_DUCK = 0.8;
/** Min seconds between any two glitch overlays (~1 per minute). */
const MIN_SPACING_SEC = 55;
/** Cap total glitches per video (~1/min; 5-min cuts get ~5). */
const MAX_PER_VIDEO = 12;

function glitchEnabled(): boolean {
  const raw = optionalEnv("ROYAL_GLITCH");
  if (raw == null || raw === "") return false;
  const v = raw.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function publicPathFor(id: RoyalGlitchId): string {
  return `overlays/glitch/${id}.mp4`;
}

function volumeFor(id: RoyalGlitchId): number {
  return Math.max(0.05, Math.min(0.35, DEFAULT_VOLUME[id] * MASTER_DUCK));
}

function beatLooksCrisis(text: string): boolean {
  return /\b(crisis|scandal|collapse|backlash|chaos|rupture|broke|breaking|explosive|shock|shocked|turmoil|meltdown)\b/i.test(
    text
  );
}

function beatLooksReveal(text: string): boolean {
  return /\b(reveal|revealed|the truth|secret|secrets|exposed|uncovered|never told|hidden|leak|leaked|bombshell)\b/i.test(
    text
  );
}

function beatLooksChapter(text: string, index: number): boolean {
  if (index === 0) return false;
  // Denser chapter hooks so ~1/min pacing can fill on shorter cuts.
  if (index % 18 === 0) return true;
  return /\b(but|however|years later|meanwhile|finally|so when|chapter|part two|turning point|inheritance|estate|judgment|apology)\b/i.test(
    text
  );
}

function effectWantsGlitch(presets: string[]): boolean {
  return presets.some((p) => /09_glitch|08_reveal|10_red_grid/i.test(p));
}

/**
 * Plan sparse Royal glitch overlays (~0.75s + sound) on earned scene changes only.
 * Opt-in via ROYAL_GLITCH=true. Default off (pack is YouTube-leaning; rare impact only).
 */
export async function planRoyalV2GlitchOverlays(params: {
  scenes: TimelineScene[];
  effectEvents?: EffectTimelineEvent[];
}): Promise<{ events: RoyalGlitchEvent[]; report: Record<string, unknown> }> {
  if (!glitchEnabled()) {
    return {
      events: [],
      report: { enabled: false, reason: "ROYAL_GLITCH disabled (default off — set true to enable)" },
    };
  }

  const scenes = [...params.scenes].sort((a, b) => a.startTime - b.startTime);
  const effectsByScene = new Map<string, string[]>();
  for (const ev of params.effectEvents || []) {
    const sid = String((ev as { sceneId?: string }).sceneId || "");
    if (!sid) continue;
    const list = effectsByScene.get(sid) || [];
    list.push(ev.presetId);
    effectsByScene.set(sid, list);
  }

  const candidates: Array<{
    scene: TimelineScene;
    reason: string;
    preferStatic: boolean;
  }> = [];

  for (let i = 1; i < scenes.length; i++) {
    const scene = scenes[i];
    const text = `${scene.narrationText || ""} ${scene.viewerShouldSee || ""} ${scene.selectionIntent || ""}`;
    const presets = effectsByScene.get(scene.sceneId) || [];
    const crisis = beatLooksCrisis(text);
    const reveal = beatLooksReveal(text);
    const chapter = beatLooksChapter(text, i);
    const fx = effectWantsGlitch(presets);
    if (!crisis && !reveal && !chapter && !fx) continue;
    candidates.push({
      scene,
      reason: crisis
        ? "crisis"
        : reveal
          ? "reveal"
          : fx
            ? "effect_glitch_or_reveal"
            : "chapter",
      preferStatic: crisis || reveal,
    });
  }

  const events: RoyalGlitchEvent[] = [];
  let lastAt = -999;
  let softIdx = 0;
  let staticUsed = 0;

  for (const cand of candidates) {
    if (events.length >= MAX_PER_VIDEO) break;
    if (cand.scene.startTime - lastAt < MIN_SPACING_SEC) continue;

    let glitchId: RoyalGlitchId;
    if (cand.preferStatic && staticUsed < 1) {
      glitchId = "glitch_static";
      staticUsed += 1;
    } else {
      glitchId = SOFT_ROTATION[softIdx % SOFT_ROTATION.length];
      softIdx += 1;
    }

    events.push({
      id: `glitch-${cand.scene.sceneId}`,
      glitchId,
      publicPath: publicPathFor(glitchId),
      startTime: cand.scene.startTime,
      durationSec: CLIP_DURATION,
      volume: volumeFor(glitchId),
      blendMode: "screen",
      reason: cand.reason,
      sceneId: cand.scene.sceneId,
    });
    lastAt = cand.scene.startTime;
  }

  const byId: Record<string, number> = {};
  for (const e of events) byId[e.glitchId] = (byId[e.glitchId] || 0) + 1;

  return {
    events,
    report: {
      enabled: true,
      totalEvents: events.length,
      candidateCount: candidates.length,
      byGlitchId: byId,
      clipDurationSec: CLIP_DURATION,
      minSpacingSec: MIN_SPACING_SEC,
      maxPerVideo: MAX_PER_VIDEO,
      masterDuck: MASTER_DUCK,
      loudnessPrepLufs: -28,
      blendMode: "screen",
      approvedPool: APPROVED,
      rejectedPool: [
        "glitch_next_card",
        "glitch_rf_card",
        "glitch_noref_card",
        "glitch_error_signal",
      ],
      policy: "sparse chapter/crisis/reveal only; opt-in ROYAL_GLITCH",
    },
  };
}
