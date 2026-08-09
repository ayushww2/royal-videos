import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/** Native file durations (seconds) — used to stretch each clip to transitionSec. */
export const ALL_TRANSITIONS = [
  { path: "overlays/transitions/camera-shutter.mp4", nativeSec: 0.701, label: "1 camera shutter" },
  { path: "overlays/transitions/double-camera-film-burn.mp4", nativeSec: 0.801, label: "2 double camera film burn" },
  { path: "overlays/transitions/film-burn.mp4", nativeSec: 0.534, label: "3 film burn" },
  { path: "overlays/transitions/film-burn-woosh.mp4", nativeSec: 0.601, label: "4 film burn woosh" },
  { path: "overlays/transitions/light-film-burn.mp4", nativeSec: 0.801, label: "5 light film burn" },
  { path: "overlays/transitions/light-glitch-effect.mp4", nativeSec: 0.501, label: "6 light glitch" },
  { path: "overlays/transitions/rgb-glitch-effect.mp4", nativeSec: 0.968, label: "7 rgb glitch" },
  { path: "overlays/transitions/soft-film-burn.mp4", nativeSec: 0.701, label: "8 soft film burn" },
  { path: "overlays/transitions/transition-glitch.mp4", nativeSec: 0.367, label: "9 transition glitch" },
  { path: "overlays/transitions/white-glitch.mp4", nativeSec: 0.734, label: "10 white glitch" },
] as const;

const STILLS = [
  "overlays/transitions/preview-stills/cave.png",
  "overlays/transitions/preview-stills/a.png",
  "overlays/transitions/preview-stills/b.png",
  "overlays/transitions/preview-stills/c.png",
] as const;

export type TransitionPreviewAllProps = {
  holdSec?: number;
  /** Base transition length before speedFactor (seconds). */
  transitionSec?: number;
  /** >1 = faster. 1.3 → duration = transitionSec / 1.3 */
  speedFactor?: number;
  blendMode?: React.CSSProperties["mixBlendMode"];
  transitionVolume?: number;
  /** Peak darken during transition (0–1). 0.38 = 38% black veil. */
  transitionDarken?: number;
};

function TransitionDarkenVeil({
  durationInFrames,
  amount,
}: {
  durationInFrames: number;
  amount: number;
}) {
  const frame = useCurrentFrame();
  const fade = Math.max(1, Math.round(durationInFrames * 0.2));
  const opacity = interpolate(
    frame,
    [0, fade, Math.max(fade + 1, durationInFrames - fade), Math.max(1, durationInFrames - 1)],
    [0, amount, amount, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000",
        opacity,
        pointerEvents: "none",
      }}
    />
  );
}

/**
 * Cycles all 10 transition overlays: still → 1s transition+SFX (time-stretched) → next still.
 * Underlays darken slightly while the transition plays so burns/glitches read cleanly.
 */
export const TransitionPreviewAll: React.FC<TransitionPreviewAllProps> = ({
  holdSec = 1.4,
  transitionSec = 1,
  speedFactor = 1.3,
  blendMode = "screen",
  transitionVolume = 0.9,
  transitionDarken = 0.38,
}) => {
  const { fps } = useVideoConfig();
  const holdFrames = Math.max(1, Math.round(holdSec * fps));
  const effectiveSec = transitionSec / Math.max(0.1, speedFactor);
  const transitionFrames = Math.max(1, Math.round(effectiveSec * fps));
  const stillCount = ALL_TRANSITIONS.length + 1;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {Array.from({ length: stillCount }, (_, i) => {
        const still = STILLS[i % STILLS.length];
        const label =
          i < ALL_TRANSITIONS.length
            ? `Next: ${ALL_TRANSITIONS[i].label}`
            : "End";
        return (
          <Sequence
            key={`still-${i}`}
            from={i * holdFrames}
            durationInFrames={holdFrames}
          >
            <AbsoluteFill>
              <Img
                src={staticFile(still)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 48,
                  bottom: 48,
                  padding: "10px 18px",
                  background: "rgba(0,0,0,0.65)",
                  color: "#fff",
                  fontFamily: "Georgia, serif",
                  fontSize: 36,
                  letterSpacing: 0.5,
                }}
              >
                {label}
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {ALL_TRANSITIONS.map((tx, i) => {
        const cutAt = (i + 1) * holdFrames;
        const from = Math.max(0, cutAt - Math.floor(transitionFrames / 2));
        // Play full native clip inside the shortened window (faster = higher rate).
        const playbackRate = tx.nativeSec / effectiveSec;
        return (
          <Sequence
            key={tx.path}
            from={from}
            durationInFrames={transitionFrames}
          >
            <TransitionDarkenVeil
              durationInFrames={transitionFrames}
              amount={transitionDarken}
            />
            <AbsoluteFill
              style={{ mixBlendMode: blendMode, pointerEvents: "none" }}
            >
              <OffthreadVideo
                src={staticFile(tx.path)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                volume={transitionVolume}
                muted={false}
                playbackRate={playbackRate}
              />
            </AbsoluteFill>
            <div
              style={{
                position: "absolute",
                top: 40,
                left: 48,
                padding: "8px 16px",
                background: "rgba(0,0,0,0.7)",
                color: "#ffe08a",
                fontFamily: "Georgia, serif",
                fontSize: 32,
                zIndex: 5,
              }}
            >
              {tx.label} · {effectiveSec.toFixed(2)}s · {speedFactor}x
            </div>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
