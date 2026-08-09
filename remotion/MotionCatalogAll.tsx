import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const STILLS = [
  "overlays/transitions/preview-stills/cave.png",
  "overlays/transitions/preview-stills/a.png",
  "overlays/transitions/preview-stills/b.png",
  "overlays/transitions/preview-stills/c.png",
] as const;

export type MotionDemo = {
  id: string;
  name: string;
  kind: "camera" | "transition";
  /** Remotion / pipeline name you can ask for later. */
  code: string;
};

/** Remotion-native motion demos (Ken Burns + CSS cut transitions). */
export const MOTION_DEMOS: MotionDemo[] = [
  { id: "01", name: "Zoom In (Ken Burns)", kind: "camera", code: "cameraMotion: zoom_in" },
  { id: "02", name: "Zoom Out (Ken Burns)", kind: "camera", code: "cameraMotion: zoom_out" },
  { id: "03", name: "Static Hold", kind: "camera", code: "cameraMotion: none" },
  { id: "04", name: "Fade", kind: "transition", code: "transition: fade" },
  { id: "05", name: "Wipe Left", kind: "transition", code: "transition: wipeLeft" },
  { id: "06", name: "Wipe Right", kind: "transition", code: "transition: wipeRight" },
  { id: "07", name: "Swipe / Slide Left", kind: "transition", code: "transition: slideLeft" },
  { id: "08", name: "Swipe / Slide Right", kind: "transition", code: "transition: slideRight" },
  { id: "09", name: "Slide Up", kind: "transition", code: "transition: slideUp" },
  { id: "10", name: "Slide Down", kind: "transition", code: "transition: slideDown" },
  { id: "11", name: "Reveal (iris-ish)", kind: "transition", code: "transition: reveal" },
  { id: "12", name: "Zoom Transition", kind: "transition", code: "transition: zoom" },
];

const NameCard: React.FC<{ demo: MotionDemo; index: number; total: number }> = ({
  demo,
  index,
  total,
}) => (
  <>
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        padding: "22px 40px",
        background: "linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)",
        display: "flex",
        alignItems: "baseline",
        gap: 18,
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      <span style={{ fontFamily: "Inter, Arial, sans-serif", fontSize: 32, fontWeight: 800, color: "#ffd24a" }}>
        {index + 1}/{total}
      </span>
      <span style={{ fontFamily: "Inter, Arial, sans-serif", fontSize: 44, fontWeight: 800, color: "#fff" }}>
        {demo.name}
      </span>
    </div>
    <div
      style={{
        position: "absolute",
        bottom: 28,
        left: 40,
        padding: "12px 22px",
        background: "rgba(0,0,0,0.82)",
        borderLeft: "6px solid #7dd3fc",
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      <div style={{ fontFamily: "Consolas, monospace", fontSize: 28, color: "#8ff0a4" }}>{demo.code}</div>
      <div
        style={{
          fontFamily: "Inter, Arial, sans-serif",
          fontSize: 20,
          color: "#c9d4e4",
          marginTop: 4,
          letterSpacing: 2,
        }}
      >
        {demo.kind === "camera" ? "CAMERA MOTION" : "CUT TRANSITION"}
      </div>
    </div>
  </>
);

function KenBurns({
  src,
  mode,
}: {
  src: string;
  mode: "zoom_in" | "zoom_out" | "none";
}) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const intensity = 0.12;
  let scale = 1;
  if (mode === "zoom_in") {
    scale = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [1, 1 + intensity], {
      extrapolateRight: "clamp",
    });
  } else if (mode === "zoom_out") {
    scale = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [1 + intensity, 1], {
      extrapolateRight: "clamp",
    });
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
}

type TransitionKind =
  | "fade"
  | "wipeLeft"
  | "wipeRight"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "reveal"
  | "zoom";

function TransitionPair({
  fromSrc,
  toSrc,
  kind,
  transitionFrames,
}: {
  fromSrc: string;
  toSrc: string;
  kind: TransitionKind;
  transitionFrames: number;
}) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const mid = Math.floor((durationInFrames - transitionFrames) / 2);
  const t0 = mid;
  const t1 = mid + transitionFrames;
  const p =
    frame < t0
      ? 0
      : frame >= t1
        ? 1
        : interpolate(frame, [t0, t1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const fromStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    position: "absolute",
  };
  const toStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    position: "absolute",
  };

  if (kind === "fade") {
    fromStyle.opacity = 1 - p;
    toStyle.opacity = p;
  } else if (kind === "wipeLeft") {
    toStyle.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
  } else if (kind === "wipeRight") {
    toStyle.clipPath = `inset(0 0 0 ${(1 - p) * 100}%)`;
  } else if (kind === "slideLeft") {
    fromStyle.transform = `translateX(${-p * 100}%)`;
    toStyle.transform = `translateX(${(1 - p) * 100}%)`;
  } else if (kind === "slideRight") {
    fromStyle.transform = `translateX(${p * 100}%)`;
    toStyle.transform = `translateX(${(p - 1) * 100}%)`;
  } else if (kind === "slideUp") {
    fromStyle.transform = `translateY(${-p * 100}%)`;
    toStyle.transform = `translateY(${(1 - p) * 100}%)`;
  } else if (kind === "slideDown") {
    fromStyle.transform = `translateY(${p * 100}%)`;
    toStyle.transform = `translateY(${(p - 1) * 100}%)`;
  } else if (kind === "reveal") {
    const r = p * 80;
    toStyle.clipPath = `circle(${r}% at 50% 50%)`;
  } else if (kind === "zoom") {
    fromStyle.transform = `scale(${1 + p * 0.35})`;
    fromStyle.opacity = 1 - p;
    toStyle.transform = `scale(${1.2 - p * 0.2})`;
    toStyle.opacity = p;
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <Img src={staticFile(fromSrc)} style={fromStyle} />
      <Img src={staticFile(toSrc)} style={toStyle} />
    </AbsoluteFill>
  );
}

export type MotionCatalogAllProps = {
  holdSec?: number;
};

export const MotionCatalogAll: React.FC<MotionCatalogAllProps> = ({ holdSec = 3.2 }) => {
  const { fps } = useVideoConfig();
  const holdFrames = Math.max(1, Math.round(holdSec * fps));
  const transitionFrames = Math.round(0.7 * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "#05070b" }}>
      {MOTION_DEMOS.map((demo, i) => {
        const a = STILLS[i % STILLS.length];
        const b = STILLS[(i + 1) % STILLS.length];
        return (
          <Sequence key={demo.id} from={i * holdFrames} durationInFrames={holdFrames} layout="none">
            <AbsoluteFill>
              {demo.kind === "camera" ? (
                <KenBurns
                  src={a}
                  mode={
                    demo.code.includes("zoom_in")
                      ? "zoom_in"
                      : demo.code.includes("zoom_out")
                        ? "zoom_out"
                        : "none"
                  }
                />
              ) : (
                <TransitionPair
                  fromSrc={a}
                  toSrc={b}
                  kind={demo.code.replace("transition: ", "") as TransitionKind}
                  transitionFrames={transitionFrames}
                />
              )}
              <NameCard demo={demo} index={i} total={MOTION_DEMOS.length} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const MOTION_CATALOG_COUNT = MOTION_DEMOS.length;
