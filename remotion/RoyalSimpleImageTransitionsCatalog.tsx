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

type SimpleEffectKind =
  | "push_in"
  | "pull_out"
  | "clean_cut"
  | "cross_dissolve"
  | "fade_black"
  | "zoom_dissolve"
  | "wipe_left"
  | "wipe_right"
  | "slide_left"
  | "white_flash";

type SimpleEffect = {
  id: string;
  name: string;
  description: string;
  kind: SimpleEffectKind;
};

export const ROYAL_SIMPLE_IMAGE_EFFECTS: SimpleEffect[] = [
  {
    id: "01",
    name: "Slow Push In",
    description: "Clean full-screen image with a gentle move closer.",
    kind: "push_in",
  },
  {
    id: "02",
    name: "Slow Pull Out",
    description: "Clean full-screen image that slowly opens outward.",
    kind: "pull_out",
  },
  {
    id: "03",
    name: "Clean Cut",
    description: "The normal documentary cut: direct, invisible, and fast.",
    kind: "clean_cut",
  },
  {
    id: "04",
    name: "Cross Dissolve",
    description: "One full-screen image softly blends into the next.",
    kind: "cross_dissolve",
  },
  {
    id: "05",
    name: "Fade Through Black",
    description: "A short dark pause separates a larger change in topic or time.",
    kind: "fade_black",
  },
  {
    id: "06",
    name: "Soft Zoom Dissolve",
    description: "A restrained zoom and dissolve connect two related photographs.",
    kind: "zoom_dissolve",
  },
  {
    id: "07",
    name: "Wipe Left",
    description: "The next full-screen image is revealed cleanly from the left.",
    kind: "wipe_left",
  },
  {
    id: "08",
    name: "Wipe Right",
    description: "The next full-screen image is revealed cleanly from the right.",
    kind: "wipe_right",
  },
  {
    id: "09",
    name: "Slide Left",
    description: "Both complete images exchange positions in one smooth horizontal move.",
    kind: "slide_left",
  },
  {
    id: "10",
    name: "Soft White Flash",
    description: "A brief light flash hides the cut without adding a designed background.",
    kind: "white_flash",
  },
];

export const ROYAL_SIMPLE_IMAGE_EFFECT_COUNT =
  ROYAL_SIMPLE_IMAGE_EFFECTS.length;

export type RoyalSimpleImageTransitionsCatalogProps = {
  holdSec?: number;
  imagePaths?: string[];
};

const DEFAULT_IMAGES = [
  "demo/roadblock.png",
  "demo/statue.png",
  "demo/research.png",
];

const sourceFor = (path: string) =>
  /^https?:\/\//i.test(path) ? path : staticFile(path);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeInOut = (value: number) => {
  const p = clamp01(value);
  return p * p * (3 - 2 * p);
};

const FullscreenImage: React.FC<{
  src: string;
  style?: React.CSSProperties;
}> = ({ src, style }) => (
  <Img
    src={src}
    style={{
      position: "absolute",
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "50% 50%",
      ...style,
    }}
  />
);

const PreviewLabels: React.FC<{
  effect: SimpleEffect;
  index: number;
}> = ({ effect, index }) => (
  <>
    <div
      style={{
        position: "absolute",
        left: 48,
        top: 38,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div
        style={{
          padding: "8px 13px",
          background: "#800080",
          color: "white",
          fontFamily: "Inter, Arial, sans-serif",
          fontWeight: 900,
          fontSize: 23,
          letterSpacing: 1.2,
        }}
      >
        {String(index + 1).padStart(2, "0")} / {ROYAL_SIMPLE_IMAGE_EFFECT_COUNT}
      </div>
      <div
        style={{
          color: "white",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 800,
          fontSize: 40,
          textShadow: "0 3px 12px rgba(0,0,0,0.92)",
        }}
      >
        {effect.name}
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        left: 48,
        bottom: 38,
        zIndex: 20,
        maxWidth: 1080,
        padding: "13px 17px",
        background: "rgba(3,7,16,0.76)",
        borderLeft: "6px solid white",
        color: "white",
        fontFamily: "Inter, Arial, sans-serif",
        fontWeight: 650,
        fontSize: 22,
      }}
    >
      {effect.description}
    </div>
    <div
      style={{
        position: "absolute",
        right: 48,
        bottom: 42,
        zIndex: 20,
        color: "rgba(255,255,255,0.85)",
        fontFamily: "Inter, Arial, sans-serif",
        fontWeight: 850,
        fontSize: 16,
        letterSpacing: 2.1,
        textTransform: "uppercase",
      }}
    >
      Clean fullscreen · no decorative background
    </div>
  </>
);

const SimpleEffectScene: React.FC<{
  effect: SimpleEffect;
  fromPath: string;
  toPath: string;
  index: number;
}> = ({ effect, fromPath, toPath, index }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fullProgress = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const transitionStart = Math.round(durationInFrames * 0.38);
  const transitionEnd = Math.round(durationInFrames * 0.64);
  const transitionProgress = easeInOut(
    interpolate(
      frame,
      [transitionStart, transitionEnd],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
  );
  const fromSrc = sourceFor(fromPath);
  const toSrc = sourceFor(toPath);

  let visual: React.ReactNode;
  switch (effect.kind) {
    case "push_in":
      visual = (
        <FullscreenImage
          src={toSrc}
          style={{ transform: `scale(${1 + fullProgress * 0.055})` }}
        />
      );
      break;
    case "pull_out":
      visual = (
        <FullscreenImage
          src={toSrc}
          style={{ transform: `scale(${1.055 - fullProgress * 0.055})` }}
        />
      );
      break;
    case "clean_cut":
      visual = (
        <>
          <FullscreenImage
            src={fromSrc}
            style={{ opacity: transitionProgress < 0.5 ? 1 : 0 }}
          />
          <FullscreenImage
            src={toSrc}
            style={{ opacity: transitionProgress >= 0.5 ? 1 : 0 }}
          />
        </>
      );
      break;
    case "cross_dissolve":
      visual = (
        <>
          <FullscreenImage
            src={fromSrc}
            style={{ opacity: 1 - transitionProgress }}
          />
          <FullscreenImage
            src={toSrc}
            style={{ opacity: transitionProgress }}
          />
        </>
      );
      break;
    case "fade_black": {
      const fromOpacity =
        transitionProgress < 0.5 ? 1 - transitionProgress * 2 : 0;
      const toOpacity =
        transitionProgress > 0.5 ? (transitionProgress - 0.5) * 2 : 0;
      visual = (
        <>
          <AbsoluteFill style={{ backgroundColor: "#000" }} />
          <FullscreenImage src={fromSrc} style={{ opacity: fromOpacity }} />
          <FullscreenImage src={toSrc} style={{ opacity: toOpacity }} />
        </>
      );
      break;
    }
    case "zoom_dissolve":
      visual = (
        <>
          <FullscreenImage
            src={fromSrc}
            style={{
              opacity: 1 - transitionProgress,
              transform: `scale(${1 + transitionProgress * 0.055})`,
            }}
          />
          <FullscreenImage
            src={toSrc}
            style={{
              opacity: transitionProgress,
              transform: `scale(${1.045 - transitionProgress * 0.045})`,
            }}
          />
        </>
      );
      break;
    case "wipe_left":
      visual = (
        <>
          <FullscreenImage src={fromSrc} />
          <FullscreenImage
            src={toSrc}
            style={{
              clipPath: `inset(0 ${(1 - transitionProgress) * 100}% 0 0)`,
            }}
          />
        </>
      );
      break;
    case "wipe_right":
      visual = (
        <>
          <FullscreenImage src={fromSrc} />
          <FullscreenImage
            src={toSrc}
            style={{
              clipPath: `inset(0 0 0 ${(1 - transitionProgress) * 100}%)`,
            }}
          />
        </>
      );
      break;
    case "slide_left":
      visual = (
        <>
          <FullscreenImage
            src={fromSrc}
            style={{
              transform: `translateX(${-transitionProgress * 100}%)`,
            }}
          />
          <FullscreenImage
            src={toSrc}
            style={{
              transform: `translateX(${(1 - transitionProgress) * 100}%)`,
            }}
          />
        </>
      );
      break;
    case "white_flash": {
      const flashOpacity =
        transitionProgress < 0.5
          ? transitionProgress * 2
          : (1 - transitionProgress) * 2;
      visual = (
        <>
          <FullscreenImage
            src={fromSrc}
            style={{ opacity: transitionProgress < 0.5 ? 1 : 0 }}
          />
          <FullscreenImage
            src={toSrc}
            style={{ opacity: transitionProgress >= 0.5 ? 1 : 0 }}
          />
          <AbsoluteFill
            style={{
              backgroundColor: "white",
              opacity: flashOpacity,
            }}
          />
        </>
      );
      break;
    }
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      {visual}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "linear-gradient(180deg, rgba(2,5,12,0.48) 0%, transparent 23%, transparent 73%, rgba(2,5,12,0.36) 100%)",
        }}
      />
      <PreviewLabels effect={effect} index={index} />
    </AbsoluteFill>
  );
};

export const RoyalSimpleImageTransitionsCatalog: React.FC<
  RoyalSimpleImageTransitionsCatalogProps
> = ({ holdSec = 3, imagePaths = DEFAULT_IMAGES }) => {
  const { fps } = useVideoConfig();
  const holdFrames = Math.max(1, Math.round(holdSec * fps));
  const safeImages = imagePaths.length ? imagePaths : DEFAULT_IMAGES;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {ROYAL_SIMPLE_IMAGE_EFFECTS.map((effect, index) => (
        <Sequence
          key={effect.id}
          from={index * holdFrames}
          durationInFrames={holdFrames}
          layout="none"
        >
          <SimpleEffectScene
            effect={effect}
            fromPath={safeImages[index % safeImages.length]}
            toPath={safeImages[(index + 1) % safeImages.length]}
            index={index}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
