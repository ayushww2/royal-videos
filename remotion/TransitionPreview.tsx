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

export type TransitionPreviewProps = {
  /** Path under remotion/public, e.g. overlays/transitions/film-burn-woosh.mp4 */
  transitionPath?: string;
  /** Hold length per still (seconds) */
  holdSec?: number;
  /** Forced transition length (seconds) — plays with original audio */
  transitionSec?: number;
  /** screen works well for film burns / light leaks */
  blendMode?: React.CSSProperties["mixBlendMode"];
  /** Volume of transition's embedded SFX */
  transitionVolume?: number;
  /** Peak darken during transition (0–1). */
  transitionDarken?: number;
  stillPaths?: string[];
};

const DEFAULT_STILLS = [
  "overlays/transitions/preview-stills/cave.png",
  "overlays/transitions/preview-stills/a.png",
  "overlays/transitions/preview-stills/b.png",
];

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
 * Quick preview: 2–3 stills with one overlay transition + original SFX.
 * Darkens underlay while the transition plays.
 */
export const TransitionPreview: React.FC<TransitionPreviewProps> = ({
  transitionPath = "overlays/transitions/film-burn-woosh.mp4",
  holdSec = 1.8,
  transitionSec = 1,
  blendMode = "screen",
  transitionVolume = 0.85,
  transitionDarken = 0.38,
  stillPaths = DEFAULT_STILLS,
}) => {
  const { fps } = useVideoConfig();
  const stills = (stillPaths?.length ? stillPaths : DEFAULT_STILLS).slice(0, 3);
  const holdFrames = Math.max(1, Math.round(holdSec * fps));
  const transitionFrames = Math.max(1, Math.round(transitionSec * fps));
  const cutFrames = stills.slice(0, -1).map((_, i) => (i + 1) * holdFrames);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {stills.map((p, i) => (
        <Sequence key={p} from={i * holdFrames} durationInFrames={holdFrames}>
          <AbsoluteFill>
            <Img
              src={staticFile(p)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </AbsoluteFill>
        </Sequence>
      ))}

      {cutFrames.map((cutAt, i) => {
        const from = Math.max(0, cutAt - Math.floor(transitionFrames / 2));
        return (
          <Sequence
            key={`tx-${i}`}
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
                src={staticFile(transitionPath)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                volume={transitionVolume}
                muted={false}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
