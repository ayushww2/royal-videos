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

type SafeEffectKind =
  | "card_push_in"
  | "card_pull_out"
  | "blurred_backdrop"
  | "royal_matte"
  | "floating_photo"
  | "archive_mount"
  | "layered_depth"
  | "photo_stack"
  | "split_compare"
  | "light_sweep";

type SafeEffectDefinition = {
  id: string;
  name: string;
  description: string;
  kind: SafeEffectKind;
};

export const ROYAL_SAFE_IMAGE_EFFECTS: SafeEffectDefinition[] = [
  {
    id: "01",
    name: "Full Image Push In",
    description: "The complete photograph moves closer inside a protected safe margin.",
    kind: "card_push_in",
  },
  {
    id: "02",
    name: "Full Image Pull Out",
    description: "The complete photograph gently recedes without losing any original edge.",
    kind: "card_pull_out",
  },
  {
    id: "03",
    name: "Blurred Background",
    description: "A soft duplicate fills the canvas while the sharp full image stays visible.",
    kind: "blurred_backdrop",
  },
  {
    id: "04",
    name: "Royal Matte Frame",
    description: "A dark editorial matte and fine border present the complete photograph.",
    kind: "royal_matte",
  },
  {
    id: "05",
    name: "Floating Photograph",
    description: "The full photograph rises slightly with restrained scale and shadow.",
    kind: "floating_photo",
  },
  {
    id: "06",
    name: "Archive Paper Mount",
    description: "A complete historical image rests on a warm archival presentation card.",
    kind: "archive_mount",
  },
  {
    id: "07",
    name: "Layered Card Depth",
    description: "Background and full foreground card move separately to create gentle depth.",
    kind: "layered_depth",
  },
  {
    id: "08",
    name: "Photo Stack Reveal",
    description: "The complete image moves forward over two subtly offset backing cards.",
    kind: "photo_stack",
  },
  {
    id: "09",
    name: "Full Image Comparison",
    description: "Two complete photographs share the screen without either one being cropped.",
    kind: "split_compare",
  },
  {
    id: "10",
    name: "Soft Light Sweep",
    description: "A restrained light pass adds motion while the complete image stays still.",
    kind: "light_sweep",
  },
];

export const ROYAL_SAFE_IMAGE_EFFECT_COUNT = ROYAL_SAFE_IMAGE_EFFECTS.length;

export type RoyalSafeImageEffectsCatalogProps = {
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

const easeInOut = (value: number) => {
  const p = Math.max(0, Math.min(1, value));
  return p * p * (3 - 2 * p);
};

const BlurredBackdrop: React.FC<{
  src: string;
  scale?: number;
  x?: number;
}> = ({ src, scale = 1.08, x = 0 }) => (
  <>
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `translateX(${x}%) scale(${scale})`,
        filter: "blur(26px) brightness(0.43) saturate(0.82)",
      }}
    />
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at center, transparent 20%, rgba(2,5,12,0.42) 100%)",
      }}
    />
  </>
);

const FullImage: React.FC<{
  src: string;
  style?: React.CSSProperties;
}> = ({ src, style }) => (
  <Img
    src={src}
    style={{
      width: "100%",
      height: "100%",
      objectFit: "contain",
      ...style,
    }}
  />
);

const Label: React.FC<{
  effect: SafeEffectDefinition;
  index: number;
}> = ({ effect, index }) => (
  <>
    <div
      style={{
        position: "absolute",
        left: 48,
        top: 38,
        display: "flex",
        alignItems: "center",
        gap: 16,
        zIndex: 30,
      }}
    >
      <div
        style={{
          padding: "9px 14px",
          background: "#800080",
          color: "white",
          fontFamily: "Inter, Arial, sans-serif",
          fontWeight: 900,
          fontSize: 23,
          letterSpacing: 1.2,
          boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
        }}
      >
        {String(index + 1).padStart(2, "0")} / {ROYAL_SAFE_IMAGE_EFFECT_COUNT}
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
        maxWidth: 1100,
        padding: "14px 18px",
        borderLeft: "6px solid white",
        background: "rgba(3,7,16,0.82)",
        color: "white",
        fontFamily: "Inter, Arial, sans-serif",
        fontWeight: 650,
        fontSize: 22,
        lineHeight: 1.25,
        zIndex: 30,
      }}
    >
      {effect.description}
    </div>
    <div
      style={{
        position: "absolute",
        right: 48,
        bottom: 42,
        color: "rgba(255,255,255,0.84)",
        fontFamily: "Inter, Arial, sans-serif",
        fontWeight: 850,
        fontSize: 16,
        letterSpacing: 2.2,
        textTransform: "uppercase",
        zIndex: 30,
      }}
    >
      Full image retained · crop-safe
    </div>
  </>
);

const SafeCard: React.FC<{
  src: string;
  transform?: string;
  background?: string;
  border?: string;
  padding?: number;
  shadow?: string;
  inset?: string;
}> = ({
  src,
  transform = "none",
  background = "rgba(6,10,20,0.94)",
  border = "2px solid rgba(255,255,255,0.82)",
  padding = 10,
  shadow = "0 30px 88px rgba(0,0,0,0.62)",
  inset = "10% 8%",
}) => (
  <div
    style={{
      position: "absolute",
      inset,
      padding,
      background,
      border,
      boxSizing: "border-box",
      boxShadow: shadow,
      transform,
      overflow: "hidden",
    }}
  >
    <FullImage src={src} />
  </div>
);

const SafeEffectScene: React.FC<{
  effect: SafeEffectDefinition;
  imagePath: string;
  secondaryImagePath: string;
  index: number;
}> = ({ effect, imagePath, secondaryImagePath, index }) => {
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
  const secondarySrc = sourceFor(secondaryImagePath);

  let content: React.ReactNode;
  switch (effect.kind) {
    case "card_push_in":
      content = (
        <>
          <BlurredBackdrop src={src} scale={1.08 + progress * 0.012} />
          <SafeCard
            src={src}
            transform={`scale(${0.91 + progress * 0.075})`}
          />
        </>
      );
      break;
    case "card_pull_out":
      content = (
        <>
          <BlurredBackdrop src={src} scale={1.095 - progress * 0.012} />
          <SafeCard
            src={src}
            transform={`scale(${0.985 - progress * 0.075})`}
          />
        </>
      );
      break;
    case "blurred_backdrop":
      content = (
        <>
          <BlurredBackdrop
            src={src}
            scale={1.08 + progress * 0.025}
            x={-0.6 + progress * 1.2}
          />
          <SafeCard
            src={src}
            inset="9% 10%"
            transform={`scale(${0.965 + progress * 0.022})`}
            border="1px solid rgba(255,255,255,0.7)"
          />
        </>
      );
      break;
    case "royal_matte":
      content = (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 50% 44%, #18233A 0%, #080D18 68%, #03050A 100%)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "8.5% 7.5%",
              padding: 18,
              background: "#0A1020",
              border: "3px solid rgba(255,255,255,0.9)",
              boxShadow:
                "0 0 0 8px rgba(128,0,128,0.72), 0 30px 85px rgba(0,0,0,0.62)",
              transform: `scale(${0.965 + progress * 0.022})`,
            }}
          >
            <FullImage src={src} />
          </div>
        </AbsoluteFill>
      );
      break;
    case "floating_photo":
      content = (
        <>
          <BlurredBackdrop src={src} />
          <SafeCard
            src={src}
            inset="9% 10%"
            transform={`translateY(${18 - progress * 30}px) scale(${0.955 + progress * 0.032})`}
            border="1px solid rgba(255,255,255,0.82)"
            shadow="0 38px 105px rgba(0,0,0,0.72)"
          />
        </>
      );
      break;
    case "archive_mount":
      content = (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 50% 45%, #695F4C 0%, #2D2921 62%, #15130F 100%)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "7% 9%",
              padding: "22px 22px 54px",
              background: "#E8DEC8",
              boxShadow: "0 34px 90px rgba(0,0,0,0.66)",
              transform: `rotate(${-0.35 + progress * 0.35}deg) scale(${0.955 + progress * 0.028})`,
              boxSizing: "border-box",
            }}
          >
            <FullImage src={src} />
            <div
              style={{
                position: "absolute",
                left: 28,
                bottom: 16,
                color: "#352E23",
                fontFamily: "Georgia, serif",
                fontWeight: 800,
                fontSize: 17,
                letterSpacing: 2.2,
              }}
            >
              ROYAL ARCHIVE
            </div>
          </div>
        </AbsoluteFill>
      );
      break;
    case "layered_depth":
      content = (
        <>
          <BlurredBackdrop
            src={src}
            scale={1.12 + progress * 0.035}
            x={-1.8 + progress * 3.6}
          />
          <div
            style={{
              position: "absolute",
              inset: "14% 10% 5% 18%",
              background: "rgba(128,0,128,0.46)",
              border: "2px solid rgba(255,255,255,0.58)",
              boxShadow: "0 22px 65px rgba(0,0,0,0.48)",
              transform: `translate(${18 - progress * 12}px, ${12 - progress * 7}px) rotate(1.1deg)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: "10% 17% 11% 8%",
              background: "rgba(255,255,255,0.2)",
              border: "2px solid rgba(255,255,255,0.42)",
              transform: `translate(${-14 + progress * 9}px, ${8 - progress * 5}px) rotate(-0.7deg)`,
            }}
          />
          <SafeCard
            src={src}
            inset="9% 14%"
            transform={`translate(${-16 + progress * 28}px, ${8 - progress * 16}px) scale(${0.92 + progress * 0.065})`}
          />
        </>
      );
      break;
    case "photo_stack":
      content = (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at center, #253048 0%, #080D17 72%)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "12% 10% 7% 13%",
              background: "#D8D8D8",
              transform: "rotate(2.2deg)",
              boxShadow: "0 22px 60px rgba(0,0,0,0.42)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: "9% 12% 10% 8%",
              background: "#F2F0EA",
              transform: "rotate(-1.5deg)",
              boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
            }}
          />
          <SafeCard
            src={src}
            inset="8% 10%"
            background="#F9F8F3"
            border="none"
            padding={14}
            transform={`translateY(${15 - progress * 15}px) scale(${0.94 + progress * 0.055})`}
          />
        </AbsoluteFill>
      );
      break;
    case "split_compare":
      content = (
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(135deg, #101827 0%, #060912 100%)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "3.5%",
              top: "10%",
              width: "45%",
              height: "80%",
              padding: 8,
              boxSizing: "border-box",
              background: "rgba(255,255,255,0.94)",
              boxShadow: "0 28px 78px rgba(0,0,0,0.58)",
              transform: `translateX(${-12 + progress * 12}px)`,
            }}
          >
            <FullImage src={src} />
          </div>
          <div
            style={{
              position: "absolute",
              right: "3.5%",
              top: "10%",
              width: "45%",
              height: "80%",
              padding: 8,
              boxSizing: "border-box",
              background: "rgba(255,255,255,0.94)",
              boxShadow: "0 28px 78px rgba(0,0,0,0.58)",
              transform: `translateX(${12 - progress * 12}px)`,
            }}
          >
            <FullImage src={secondarySrc} />
          </div>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "8%",
              width: 3,
              height: "84%",
              background: "#800080",
              transform: "translateX(-50%)",
            }}
          />
        </AbsoluteFill>
      );
      break;
    case "light_sweep":
      content = (
        <>
          <BlurredBackdrop src={src} />
          <div
            style={{
              position: "absolute",
              inset: "9% 9%",
              padding: 10,
              background: "#090E19",
              border: "1px solid rgba(255,255,255,0.76)",
              boxShadow: "0 30px 88px rgba(0,0,0,0.62)",
              overflow: "hidden",
            }}
          >
            <FullImage src={src} />
            <div
              style={{
                position: "absolute",
                top: "-20%",
                bottom: "-20%",
                left: `${-45 + progress * 170}%`,
                width: "22%",
                transform: "skewX(-18deg)",
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
                filter: "blur(7px)",
              }}
            />
          </div>
        </>
      );
      break;
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#05070B" }}>
      {content}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "linear-gradient(180deg, rgba(2,5,12,0.52) 0%, transparent 25%, transparent 70%, rgba(2,5,12,0.38) 100%)",
        }}
      />
      <Label effect={effect} index={index} />
    </AbsoluteFill>
  );
};

export const RoyalSafeImageEffectsCatalog: React.FC<
  RoyalSafeImageEffectsCatalogProps
> = ({ holdSec = 3, imagePaths = DEFAULT_IMAGES }) => {
  const { fps } = useVideoConfig();
  const holdFrames = Math.max(1, Math.round(holdSec * fps));
  const safeImages = imagePaths.length ? imagePaths : DEFAULT_IMAGES;

  return (
    <AbsoluteFill style={{ backgroundColor: "#05070B" }}>
      {ROYAL_SAFE_IMAGE_EFFECTS.map((effect, index) => (
        <Sequence
          key={effect.id}
          from={index * holdFrames}
          durationInFrames={holdFrames}
          layout="none"
        >
          <SafeEffectScene
            effect={effect}
            imagePath={safeImages[index % safeImages.length]}
            secondaryImagePath={safeImages[(index + 1) % safeImages.length]}
            index={index}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
