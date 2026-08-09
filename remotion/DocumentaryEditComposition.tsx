import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import {
  ProductionTimelineRenderer,
  type ProductionTimelineEvent,
} from "./productionRegistry";
import {
  CinematicIntro,
  INTRO_DURATION_SEC,
  type IntroShot,
} from "./CinematicIntro";

export type DocumentarySceneClip = {
  sceneId: string;
  startTime: number;
  endTime: number;
  duration: number;
  imageUrl?: string;
  videoUrl?: string;
  videoStartSeconds?: number;
  /** Ken Burns: zoom_in | zoom_out | none */
  cameraMotion?: "zoom_in" | "zoom_out" | "none";
  /** Scale delta over the hold (default ~0.06). */
  cameraIntensity?: number;
};

export type DocumentarySfxEvent = {
  id: string;
  sfxId: string;
  publicPath: string;
  startTime: number;
  durationSec: number;
  volume: number;
  reason?: string;
  sceneId?: string;
};

export type DocumentaryMusicEvent = {
  id: string;
  musicId: string;
  publicPath: string;
  startTime: number;
  durationSec: number;
  volume: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  reason?: string;
  role?: string;
};

export type DocumentaryGlitchEvent = {
  id: string;
  glitchId: string;
  /** Bundled path under remotion/public, OR an absolute https URL (R2). */
  publicPath: string;
  startTime: number;
  durationSec: number;
  volume: number;
  blendMode?: "screen" | "lighten" | "plus-lighter";
  reason?: string;
  sceneId?: string;
  /** Peak black veil under the overlay during the cut (0–1). */
  darken?: number;
  /** >1 plays the overlay faster. */
  playbackRate?: number;
};

export type DocumentaryCinematicIntro = {
  enabled?: boolean;
  durationSec?: number;
  musicVolume?: number;
  shots?: IntroShot[];
};

export type DocumentaryEditProps = {
  scenes: DocumentarySceneClip[];
  effectEvents: ProductionTimelineEvent[];
  sfxEvents?: DocumentarySfxEvent[];
  musicEvents?: DocumentaryMusicEvent[];
  glitchEvents?: DocumentaryGlitchEvent[];
  fps?: number;
  voiceoverUrl?: string;
  /** Prepended before VO body (Mystery v2 every video). */
  cinematicIntro?: DocumentaryCinematicIntro;
};

export { INTRO_DURATION_SEC };

/** Brief black veil under a transition overlay so the cut reads as a real edit. */
const TransitionDarkenVeil: React.FC<{
  durationInFrames: number;
  amount: number;
}> = ({ durationInFrames, amount }) => {
  const frame = useCurrentFrame();
  const peak = Math.max(0, Math.min(1, amount));
  const opacity = interpolate(
    frame,
    [0, durationInFrames * 0.5, durationInFrames],
    [0, peak, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return (
    <AbsoluteFill
      style={{ backgroundColor: "black", opacity, pointerEvents: "none" }}
    />
  );
};

function musicVolumeAtFrame(params: {
  frame: number;
  durationInFrames: number;
  baseVolume: number;
  fadeInFrames: number;
  fadeOutFrames: number;
}): number {
  const { frame, durationInFrames, baseVolume, fadeInFrames, fadeOutFrames } = params;
  let scale = 1;
  if (fadeInFrames > 0 && frame < fadeInFrames) {
    scale = Math.min(scale, frame / fadeInFrames);
  }
  if (fadeOutFrames > 0 && frame > durationInFrames - fadeOutFrames) {
    scale = Math.min(scale, Math.max(0, (durationInFrames - frame) / fadeOutFrames));
  }
  return Math.max(0, Math.min(0.2, baseVolume * scale));
}

const SceneMedia: React.FC<{
  scene: DocumentarySceneClip;
  durationInFrames: number;
  fps: number;
}> = ({ scene, durationInFrames, fps }) => {
  const frame = useCurrentFrame();
  const media = scene.videoUrl || scene.imageUrl;
  if (!media) return null;
  const isVideo =
    Boolean(scene.videoUrl) || /\.(mp4|webm|mov|mkv|m4v)(?:[?&#]|$)/i.test(media);
  const motion = scene.cameraMotion || (isVideo ? "none" : "zoom_in");
  const intensity = Math.max(0.02, Math.min(0.12, scene.cameraIntensity ?? 0.06));
  let scale = 1;
  if (motion === "zoom_in") {
    scale = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [1, 1 + intensity], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  } else if (motion === "zoom_out") {
    scale = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [1 + intensity, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: `scale(${scale})`,
  };
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {isVideo ? (
        <OffthreadVideo
          src={scene.videoUrl || media}
          startFrom={Math.max(0, Math.round((scene.videoStartSeconds || 0) * fps))}
          style={style}
          muted
        />
      ) : (
        <Img src={scene.imageUrl || media} style={style} />
      )}
    </AbsoluteFill>
  );
};

/**
 * Base documentary images/video + full production Remotion effect overlays.
 * Includes selected pack, earlier effects pack, and final-clean soft glass pack.
 * Royal scene-change SFX + sparse background music + optional glitch overlays under VO.
 * Celebrity stills get subtle Ken Burns zoom in/out from cameraMotion.
 */
export const DocumentaryEditComposition: React.FC<DocumentaryEditProps> = ({
  scenes,
  effectEvents,
  sfxEvents = [],
  musicEvents = [],
  glitchEvents = [],
  fps = 30,
  voiceoverUrl,
  cinematicIntro,
}) => {
  const introOn = Boolean(cinematicIntro?.enabled && (cinematicIntro.shots?.length || 0) > 0);
  const introSec = cinematicIntro?.durationSec || INTRO_DURATION_SEC;
  const introFrames = introOn ? Math.round(introSec * fps) : 0;

  const body = (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {voiceoverUrl ? <Audio src={voiceoverUrl} /> : null}
      {scenes.map((scene) => {
        const from = Math.max(0, Math.round(scene.startTime * fps));
        const durationInFrames = Math.max(
          1,
          Math.round((scene.duration || scene.endTime - scene.startTime) * fps)
        );
        const media = scene.videoUrl || scene.imageUrl;
        if (!media) return null;
        return (
          <Sequence key={scene.sceneId} from={from} durationInFrames={durationInFrames}>
            <SceneMedia scene={scene} durationInFrames={durationInFrames} fps={fps} />
          </Sequence>
        );
      })}
      <ProductionTimelineRenderer
        events={(effectEvents || []).filter((e) => e.props?._skipRemotion !== true)}
      />
      {(glitchEvents || []).map((glitch) => {
        const from = Math.max(0, Math.round(glitch.startTime * fps));
        const durationInFrames = Math.max(
          1,
          Math.round((glitch.durationSec || 0.75) * fps)
        );
        // R2-hosted overlays come through as absolute URLs; bundled ones as public paths.
        const src = /^https?:\/\//i.test(glitch.publicPath)
          ? glitch.publicPath
          : staticFile(glitch.publicPath.replace(/^\/+/, ""));
        const blend = glitch.blendMode || "screen";
        return (
          <Sequence key={glitch.id} from={from} durationInFrames={durationInFrames}>
            {glitch.darken ? (
              <TransitionDarkenVeil
                durationInFrames={durationInFrames}
                amount={glitch.darken}
              />
            ) : null}
            <AbsoluteFill style={{ mixBlendMode: blend, pointerEvents: "none" }}>
              <OffthreadVideo
                src={src}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                volume={Math.max(0.05, Math.min(0.4, glitch.volume ?? 0.18))}
                playbackRate={
                  glitch.playbackRate && glitch.playbackRate > 0
                    ? glitch.playbackRate
                    : undefined
                }
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
      {(musicEvents || []).map((music) => {
        const from = Math.max(0, Math.round(music.startTime * fps));
        const durationInFrames = Math.max(1, Math.round((music.durationSec || 60) * fps));
        const fadeInFrames = Math.max(1, Math.round((music.fadeInSec ?? 2.5) * fps));
        const fadeOutFrames = Math.max(1, Math.round((music.fadeOutSec ?? 3.5) * fps));
        const baseVolume = Math.max(0.05, Math.min(0.2, music.volume ?? 0.1));
        const src = staticFile(music.publicPath.replace(/^\/+/, ""));
        return (
          <Sequence key={music.id} from={from} durationInFrames={durationInFrames}>
            <Audio
              src={src}
              volume={(f) =>
                musicVolumeAtFrame({
                  frame: f,
                  durationInFrames,
                  baseVolume,
                  fadeInFrames,
                  fadeOutFrames,
                })
              }
            />
          </Sequence>
        );
      })}
      {(sfxEvents || []).map((sfx) => {
        const from = Math.max(0, Math.round(sfx.startTime * fps));
        const durationInFrames = Math.max(1, Math.round((sfx.durationSec || 0.5) * fps));
        const src = staticFile(sfx.publicPath.replace(/^\/+/, ""));
        return (
          <Sequence key={sfx.id} from={from} durationInFrames={durationInFrames}>
            <Audio src={src} volume={Math.max(0.05, Math.min(0.5, sfx.volume ?? 0.22))} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );

  if (!introOn) return body;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Sequence from={0} durationInFrames={introFrames}>
        <CinematicIntro
          musicVolume={cinematicIntro?.musicVolume ?? 0.85}
          shots={cinematicIntro?.shots}
        />
      </Sequence>
      <Sequence from={introFrames}>{body}</Sequence>
    </AbsoluteFill>
  );
};
