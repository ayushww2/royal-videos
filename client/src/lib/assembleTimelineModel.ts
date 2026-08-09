import type {
  TimelineEffectEvent,
  TimelineMusicEvent,
  TimelineSfxEvent,
} from "./api";
import { isVideoMediaUrl } from "./api";
import type { Scene } from "./types";

export type VisualClipKind = "image" | "raw" | "effect";

export type AssembledVisualClip = {
  id: string;
  sceneId: string;
  label: string;
  startTime: number;
  endTime: number;
  duration: number;
  previewUrl?: string;
  kind: VisualClipKind;
  revise: boolean;
  source: string;
  index: number;
};

export type AssembledSegment = {
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  duration: number;
  meta?: string;
  sceneId?: string;
};

export type AssembledMarker = {
  id: string;
  label: string;
  startTime: number;
  duration: number;
  sceneId?: string;
};

export type AssembledTimelineModel = {
  durationSec: number;
  visualClips: AssembledVisualClip[];
  captionSegments: AssembledSegment[];
  effectSegments: AssembledSegment[];
  musicSegments: AssembledSegment[];
  sfxMarkers: AssembledMarker[];
  narration: AssembledSegment | null;
};

function shortLabel(id: string): string {
  return id.replace(/^\d+_/, "").replace(/_/g, " ").slice(0, 28);
}

function visualKind(scene: Scene): VisualClipKind {
  if ((scene.effects?.length || 0) > 0) return "effect";
  if (
    scene.rawFootageUsed ||
    /raw|youtube/i.test(scene.source || "") ||
    isVideoMediaUrl(scene.previewUrl)
  ) {
    return "raw";
  }
  return "image";
}

function clipLabel(scene: Scene, index: number): string {
  return (
    scene.mainPerson ||
    scene.specificPlace ||
    scene.selectionIntent ||
    scene.beatType ||
    `Scene ${index + 1}`
  );
}

/** Split narration into dense word/phrase chips across each scene's duration. */
export function buildCaptionSegments(scenes: Scene[]): AssembledSegment[] {
  const sorted = [...scenes].sort((a, b) => a.startTime - b.startTime);
  const out: AssembledSegment[] = [];

  for (const scene of sorted) {
    const text = (scene.narrationText || "").trim();
    const words = text ? text.split(/\s+/).filter(Boolean) : [];
    const duration = Math.max(0.15, scene.duration || scene.endTime - scene.startTime || 1);

    if (!words.length) {
      out.push({
        id: `${scene.sceneId}-cap`,
        label: clipLabel(scene, out.length),
        startTime: scene.startTime,
        endTime: scene.endTime,
        duration,
        sceneId: scene.sceneId,
      });
      continue;
    }

    // Dense blue pills: single words when sparse; 2-word phrases when dense
    const groupSize = words.length > 28 ? 2 : 1;
    const chips: string[] = [];
    for (let i = 0; i < words.length; i += groupSize) {
      chips.push(words.slice(i, i + groupSize).join(" "));
    }

    const chipDur = duration / chips.length;
    chips.forEach((label, idx) => {
      const startTime = scene.startTime + idx * chipDur;
      const endTime = idx === chips.length - 1 ? scene.endTime : startTime + chipDur;
      out.push({
        id: `${scene.sceneId}-cap-${idx}`,
        label,
        startTime,
        endTime,
        duration: Math.max(0.08, endTime - startTime),
        sceneId: scene.sceneId,
      });
    });
  }

  return out;
}

export function assembleTimelineModel(input: {
  scenes: Scene[];
  musicEvents?: TimelineMusicEvent[];
  sfxEvents?: TimelineSfxEvent[];
  effectEvents?: TimelineEffectEvent[];
  voiceoverUrl?: string;
  voiceoverDurationSec?: number;
  durationSec?: number;
}): AssembledTimelineModel {
  const scenes = [...(input.scenes || [])].sort((a, b) => a.startTime - b.startTime);
  const visualClips: AssembledVisualClip[] = scenes.map((scene, index) => ({
    id: scene.sceneId,
    sceneId: scene.sceneId,
    label: clipLabel(scene, index),
    startTime: scene.startTime,
    endTime: scene.endTime,
    duration: scene.duration,
    previewUrl: scene.previewUrl,
    kind: visualKind(scene),
    revise: Boolean(scene.markForAiRevise),
    source: scene.source,
    index,
  }));

  const captionSegments = buildCaptionSegments(scenes);

  const effectSource =
    input.effectEvents?.length
      ? input.effectEvents
      : scenes.flatMap((scene) =>
          (scene.effects || []).map((fx) => ({
            id: fx.id,
            presetId: fx.presetId,
            startTime: (fx.startFrame || 0) / 30,
            durationSec: Math.max(0.2, (fx.durationFrames || 30) / 30),
            sceneId: scene.sceneId,
            reason: fx.reason,
          }))
        );

  const effectSegments: AssembledSegment[] = effectSource.map((ev) => ({
    id: ev.id,
    label: shortLabel(ev.presetId),
    startTime: ev.startTime,
    endTime: ev.startTime + ev.durationSec,
    duration: ev.durationSec,
    meta: ev.reason,
    sceneId: ev.sceneId,
  }));

  const musicSegments: AssembledSegment[] = (input.musicEvents || []).map((ev) => ({
    id: ev.id,
    label: shortLabel(ev.musicId),
    startTime: ev.startTime,
    endTime: ev.startTime + ev.durationSec,
    duration: ev.durationSec,
    meta: ev.role || ev.reason,
  }));

  const sfxMarkers: AssembledMarker[] = (input.sfxEvents || []).map((ev) => ({
    id: ev.id,
    label: shortLabel(ev.sfxId),
    startTime: ev.startTime,
    duration: Math.max(0.15, ev.durationSec || 0.4),
    sceneId: ev.sceneId,
  }));

  // Fallback: scene-attached SFX without global plan times
  if (!sfxMarkers.length) {
    for (const scene of scenes) {
      for (const sfx of scene.sfx || []) {
        sfxMarkers.push({
          id: sfx.id,
          label: shortLabel(sfx.sfxId),
          startTime: typeof sfx.startTime === "number" ? sfx.startTime : scene.startTime,
          duration: 0.4,
          sceneId: scene.sceneId,
        });
      }
    }
  }

  const sceneEnd = scenes.reduce((m, s) => Math.max(m, s.endTime || 0), 0);
  const durationSec = Math.max(
    input.durationSec || 0,
    sceneEnd,
    input.voiceoverDurationSec || 0,
    ...musicSegments.map((m) => m.endTime),
    ...effectSegments.map((e) => e.endTime),
    ...sfxMarkers.map((s) => s.startTime + s.duration),
    1
  );

  const narration: AssembledSegment | null =
    input.voiceoverUrl || (input.voiceoverDurationSec || 0) > 0
      ? {
          id: "voiceover",
          label: "Voiceover",
          startTime: 0,
          endTime: Math.max(input.voiceoverDurationSec || durationSec, durationSec * 0.98),
          duration: Math.max(input.voiceoverDurationSec || durationSec, durationSec * 0.98),
        }
      : null;

  return {
    durationSec,
    visualClips,
    captionSegments,
    effectSegments,
    musicSegments,
    sfxMarkers,
    narration,
  };
}

export function sceneAtPlayhead(scenes: Scene[], playhead: number): Scene | undefined {
  if (!scenes.length) return undefined;
  const hit = scenes.find((s) => playhead >= s.startTime && playhead < s.endTime);
  if (hit) return hit;
  const sorted = [...scenes].sort((a, b) => a.startTime - b.startTime);
  if (playhead <= sorted[0].startTime) return sorted[0];
  return sorted[sorted.length - 1];
}

export function effectsAtPlayhead(
  effects: AssembledSegment[],
  playhead: number
): AssembledSegment[] {
  return effects.filter((e) => playhead >= e.startTime && playhead < e.endTime);
}

export { isVideoMediaUrl };
