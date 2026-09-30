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

type MotionKind =
  | "push_in"
  | "pull_out"
  | "pan_left_to_right"
  | "pan_right_to_left"
  | "pan_top_to_bottom"
  | "pan_bottom_to_top"
  | "diagonal_tl_br"
  | "diagonal_tr_bl"
  | "focus_push"
  | "focus_pull"
  | "push_pan"
  | "pull_pan"
  | "micro_drift"
  | "layered_parallax"
  | "film_gate_drift"
  | "framed_card_push"
  | "split_panel_drift";

type MotionDefinition = {
  id: string;
  name: string;
  description: string;
  kind: MotionKind;
  focusX?: number;
  focusY?: number;
};

export const ROYAL_IMAGE_MOTIONS: MotionDefinition[] = [
  {
    id: "01",
    name: "Gentle Push In",
    description: "A slow, centered move closer for an important person or emotional beat.",
    kind: "push_in",
  },
  {
    id: "02",
    name: "Gentle Pull Out",
    description: "Starts close and gradually reveals more of the scene and its context.",
    kind: "pull_out",
  },
  {
    id: "03",
    name: "Pan Left To Right",
    description: "Travels smoothly across a wide group, room, building, or ceremony.",
    kind: "pan_left_to_right",
  },
  {
    id: "04",
    name: "Pan Right To Left",
    description: "The reverse horizontal move, used to avoid repetitive screen direction.",
    kind: "pan_right_to_left",
  },
  {
    id: "05",
    name: "Pan Top To Bottom",
    description: "Reveals downward through architecture, a full portrait, or a tall scene.",
    kind: "pan_top_to_bottom",
  },
  {
    id: "06",
    name: "Pan Bottom To Top",
    description: "Moves upward to reveal a person, monument, palace, or formal setting.",
    kind: "pan_bottom_to_top",
  },
  {
    id: "07",
    name: "Diagonal Top Left To Bottom Right",
    description: "A soft diagonal camera drift for wide, layered compositions.",
    kind: "diagonal_tl_br",
  },
  {
    id: "08",
    name: "Diagonal Top Right To Bottom Left",
    description: "The opposite diagonal direction for natural visual variation.",
    kind: "diagonal_tr_bl",
  },
  {
    id: "09",
    name: "Focus Point Push",
    description: "Pushes toward an off-center face or important object without losing it.",
    kind: "focus_push",
    focusX: 0.38,
    focusY: 0.44,
  },
  {
    id: "10",
    name: "Focus Point Pull Out",
    description: "Begins on a focal detail and opens outward to reveal the full photograph.",
    kind: "focus_pull",
    focusX: 0.62,
    focusY: 0.44,
  },
  {
    id: "11",
    name: "Push And Pan",
    description: "Classic Ken Burns movement: zoom and horizontal travel at the same time.",
    kind: "push_pan",
  },
  {
    id: "12",
    name: "Pull And Pan",
    description: "Widens while shifting toward the surrounding people or environment.",
    kind: "pull_pan",
    focusX: 0.5,
    focusY: 0,
  },
  {
    id: "13",
    name: "Micro Drift",
    description: "Barely visible movement for documents, headlines, and sensitive portraits.",
    kind: "micro_drift",
  },
  {
    id: "14",
    name: "Layered Parallax",
    description: "A stylized depth treatment with slower background and foreground movement.",
    kind: "layered_parallax",
  },
  {
    id: "15",
    name: "Film Gate Drift",
    description: "Tiny organic frame movement inspired by restrained archival film projection.",
    kind: "film_gate_drift",
  },
  {
    id: "16",
    name: "Framed Card Push",
    description: "A clean photograph card floats forward over a softened background.",
    kind: "framed_card_push",
  },
  {
    id: "17",
    name: "Split Panel Drift",
    description: "Two synchronized crops move in opposite directions for comparison beats.",
    kind: "split_panel_drift",
  },
];

export const ROYAL_IMAGE_MOTION_COUNT = ROYAL_IMAGE_MOTIONS.length;

export type RoyalImageMotionCatalogProps = {
  holdSec?: number;
  imagePaths?: string[];
};

const DEFAULT_IMAGES = [
  "demo/roadblock.png",
  "demo/statue.png",
  "demo/research.png",
];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeInOut = (value: number) => {
  const p = clamp01(value);
  return p * p * (3 - 2 * p);
};

const sourceFor = (path: string) =>
  /^https?:\/\//i.test(path) ? path : staticFile(path);

const imageStyle = (
  scale: number,
  x: number,
  y: number,
  rotate: number,
  transformOrigin: string
): React.CSSProperties => ({
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "50% 50%",
  transform: `translate3d(${x}%, ${y}%, 0) scale(${scale}) rotate(${rotate}deg)`,
  transformOrigin,
  willChange: "transform",
});

const MotionLabels: React.FC<{
  motion: MotionDefinition;
  index: number;
}> = ({ motion, index }) => (
  <>
    <div
      style={{
        position: "absolute",
        left: 54,
        top: 46,
        display: "flex",
        alignItems: "center",
        gap: 18,
        zIndex: 20,
      }}
    >
      <div
        style={{
          padding: "9px 14px",
          background: "#800080",
          color: "white",
          fontFamily: "Inter, Arial, sans-serif",
          fontWeight: 900,
          fontSize: 24,
          letterSpacing: 1.3,
          boxShadow: "0 8px 24px rgba(0,0,0,0.34)",
        }}
      >
        {String(index + 1).padStart(2, "0")} / {ROYAL_IMAGE_MOTION_COUNT}
      </div>
      <div
        style={{
          color: "white",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 800,
          fontSize: 42,
          letterSpacing: 0.3,
          textShadow: "0 3px 12px rgba(0,0,0,0.9)",
        }}
      >
        {motion.name}
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        left: 54,
        bottom: 46,
        maxWidth: 1150,
        padding: "15px 20px",
        borderLeft: "6px solid white",
        background: "rgba(3,8,18,0.78)",
        color: "white",
        fontFamily: "Inter, Arial, sans-serif",
        fontWeight: 650,
        fontSize: 24,
        lineHeight: 1.25,
        zIndex: 20,
        boxShadow: "0 8px 28px rgba(0,0,0,0.26)",
      }}
    >
      {motion.description}
    </div>
    <div
      style={{
        position: "absolute",
        right: 54,
        bottom: 50,
        color: "rgba(255,255,255,0.82)",
        fontFamily: "Inter, Arial, sans-serif",
        fontWeight: 800,
        fontSize: 17,
        letterSpacing: 2.4,
        textTransform: "uppercase",
        zIndex: 20,
      }}
    >
      Royal image motion · 3 second demo
    </div>
  </>
);

const StandardMotion: React.FC<{
  src: string;
  motion: MotionDefinition;
  progress: number;
  frame: number;
}> = ({ src, motion, progress, frame }) => {
  let scale = 1.06;
  let x = 0;
  let y = 0;
  let rotate = 0;
  let transformOrigin = "50% 50%";

  switch (motion.kind) {
    case "push_in":
      scale = 1.015 + progress * 0.065;
      break;
    case "pull_out":
      scale = 1.085 - progress * 0.065;
      break;
    case "pan_left_to_right":
      scale = 1.09;
      x = -3.2 + progress * 6.4;
      break;
    case "pan_right_to_left":
      scale = 1.09;
      x = 3.2 - progress * 6.4;
      break;
    case "pan_top_to_bottom":
      scale = 1.09;
      y = -3.2 + progress * 6.4;
      break;
    case "pan_bottom_to_top":
      scale = 1.09;
      y = 3.2 - progress * 6.4;
      break;
    case "diagonal_tl_br":
      scale = 1.1;
      x = -2.8 + progress * 5.6;
      y = -2.8 + progress * 5.6;
      break;
    case "diagonal_tr_bl":
      scale = 1.1;
      x = 2.8 - progress * 5.6;
      y = -2.8 + progress * 5.6;
      break;
    case "focus_push":
      scale = 1.015 + progress * 0.075;
      transformOrigin = `${(motion.focusX ?? 0.5) * 100}% ${(motion.focusY ?? 0.5) * 100}%`;
      x = progress * 1.2;
      break;
    case "focus_pull":
      scale = 1.095 - progress * 0.075;
      transformOrigin = `${(motion.focusX ?? 0.5) * 100}% ${(motion.focusY ?? 0.5) * 100}%`;
      x = 1.2 - progress * 1.2;
      break;
    case "push_pan":
      scale = 1.02 + progress * 0.075;
      x = 2.6 - progress * 5.2;
      y = 1.1 - progress * 1.4;
      break;
    case "pull_pan":
      scale = 1.075 - progress * 0.055;
      x = -2.5 + progress * 5;
      y = progress * 0.6;
      transformOrigin = `${(motion.focusX ?? 0.5) * 100}% ${(motion.focusY ?? 0.5) * 100}%`;
      break;
    case "micro_drift":
      scale = 1.035 + progress * 0.012;
      x = -0.8 + progress * 1.6;
      y = 0.45 - progress * 0.9;
      break;
    case "film_gate_drift":
      scale = 1.045;
      x = Math.sin(frame * 0.33) * 0.16 + (progress - 0.5) * 0.25;
      y = Math.cos(frame * 0.27) * 0.13;
      rotate = Math.sin(frame * 0.21) * 0.028;
      break;
    default:
      break;
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#05070b" }}>
      <Img
        src={src}
        style={{
          ...imageStyle(scale, x, y, rotate, transformOrigin),
          objectPosition: `${(motion.focusX ?? 0.5) * 100}% ${(motion.focusY ?? 0.5) * 100}%`,
        }}
      />
    </AbsoluteFill>
  );
};

const LayeredParallax: React.FC<{
  src: string;
  progress: number;
}> = ({ src, progress }) => (
  <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#05070b" }}>
    <Img
      src={src}
      style={{
        ...imageStyle(1.12 + progress * 0.018, -1 + progress * 2, 0, 0, "50% 50%"),
        filter: "blur(16px) brightness(0.52) saturate(0.8)",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: "8% 7%",
        overflow: "hidden",
        border: "2px solid rgba(255,255,255,0.78)",
        boxShadow: "0 28px 80px rgba(0,0,0,0.58)",
        transform: `translate3d(${2.2 - progress * 4.4}%, ${0.8 - progress * 1.6}%, 0) scale(${1.015 + progress * 0.025})`,
      }}
    >
      <Img
        src={src}
        style={imageStyle(1.045, 0, 0, 0, "50% 50%")}
      />
    </div>
  </AbsoluteFill>
);

const FramedCardPush: React.FC<{
  src: string;
  progress: number;
}> = ({ src, progress }) => (
  <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#060911" }}>
    <Img
      src={src}
      style={{
        ...imageStyle(1.1, 0, 0, 0, "50% 50%"),
        filter: "blur(22px) brightness(0.45) saturate(0.72)",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: "7% 8%",
        padding: 12,
        background: "rgba(255,255,255,0.94)",
        boxShadow: "0 34px 95px rgba(0,0,0,0.66)",
        transform: `translateY(${18 - progress * 18}px) scale(${0.94 + progress * 0.06})`,
      }}
    >
      <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
        <Img
          src={src}
          style={imageStyle(1.025 + progress * 0.02, 0, 0, 0, "50% 50%")}
        />
      </div>
    </div>
  </AbsoluteFill>
);

const SplitPanelDrift: React.FC<{
  src: string;
  progress: number;
}> = ({ src, progress }) => (
  <AbsoluteFill style={{ background: "#070B14" }}>
    <div
      style={{
        position: "absolute",
        left: "3%",
        top: "6%",
        width: "46%",
        height: "88%",
        overflow: "hidden",
        boxShadow: "0 24px 70px rgba(0,0,0,0.52)",
      }}
    >
      <Img
        src={src}
        style={{
          ...imageStyle(1.12, -3 + progress * 5, 0, 0, "35% 50%"),
          objectPosition: "32% 50%",
        }}
      />
    </div>
    <div
      style={{
        position: "absolute",
        right: "3%",
        top: "6%",
        width: "46%",
        height: "88%",
        overflow: "hidden",
        boxShadow: "0 24px 70px rgba(0,0,0,0.52)",
      }}
    >
      <Img
        src={src}
        style={{
          ...imageStyle(1.12, 3 - progress * 5, 0, 0, "68% 50%"),
          objectPosition: "68% 50%",
        }}
      />
    </div>
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "4%",
        width: 4,
        height: "92%",
        transform: "translateX(-50%)",
        background: "rgba(255,255,255,0.88)",
      }}
    />
  </AbsoluteFill>
);

const MotionScene: React.FC<{
  motion: MotionDefinition;
  imagePath: string;
  index: number;
}> = ({ motion, imagePath, index }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const linear = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const progress = easeInOut(linear);
  const src = sourceFor(imagePath);

  return (
    <AbsoluteFill style={{ backgroundColor: "#05070b", overflow: "hidden" }}>
      {motion.kind === "layered_parallax" ? (
        <LayeredParallax src={src} progress={progress} />
      ) : motion.kind === "framed_card_push" ? (
        <FramedCardPush src={src} progress={progress} />
      ) : motion.kind === "split_panel_drift" ? (
        <SplitPanelDrift src={src} progress={progress} />
      ) : (
        <StandardMotion
          src={src}
          motion={motion}
          progress={progress}
          frame={frame}
        />
      )}

      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "linear-gradient(180deg, rgba(2,6,14,0.58) 0%, transparent 28%, transparent 66%, rgba(2,6,14,0.48) 100%)",
        }}
      />
      <MotionLabels motion={motion} index={index} />
    </AbsoluteFill>
  );
};

export const RoyalImageMotionCatalog: React.FC<
  RoyalImageMotionCatalogProps
> = ({ holdSec = 3, imagePaths = DEFAULT_IMAGES }) => {
  const { fps } = useVideoConfig();
  const holdFrames = Math.max(1, Math.round(holdSec * fps));
  const safeImages = imagePaths.length ? imagePaths : DEFAULT_IMAGES;

  return (
    <AbsoluteFill style={{ backgroundColor: "#05070b" }}>
      {ROYAL_IMAGE_MOTIONS.map((motion, index) => (
        <Sequence
          key={motion.id}
          from={index * holdFrames}
          durationInFrames={holdFrames}
          layout="none"
        >
          <MotionScene
            motion={motion}
            imagePath={safeImages[index % safeImages.length]}
            index={index}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
