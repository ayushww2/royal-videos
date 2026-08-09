import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type CleanSlideshowPreset =
  | "editorial_full_bleed"
  | "glass_gallery"
  | "archive_ribbon"
  | "dual_panel_story";

export type CleanSlide = {
  src: string;
  caption?: string;
  kicker?: string;
  focusX?: number;
  focusY?: number;
  /** Alternate focus shape — normalized with focusX/focusY */
  focus?: {x: number; y: number};
};

export type CleanDocumentarySlideshowProps = {
  preset: CleanSlideshowPreset;
  slides: CleanSlide[];

  durationPerSlide?: number;
  transitionFrames?: number;

  /** Controls zoom, drift, and transition strength. */
  intensity?: number;

  /** Optional override for preset background color. */
  backgroundColor?: string;

  showPresetLabel?: boolean;
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

const phase = (frame: number, from: number, to: number) => {
  if (!(to > from)) return frame >= to ? 1 : 0;
  return clamp(
    interpolate(frame, [from, to], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );
};

const easeInOut = (t: number) => {
  const p = clamp(t);
  return p < 0.5
    ? 4 * p * p * p
    : 1 - Math.pow(-2 * p + 2, 3) / 2;
};

const slideFocus = (slide: CleanSlide) => ({
  x: slide.focus?.x ?? slide.focusX ?? 0.5,
  y: slide.focus?.y ?? slide.focusY ?? 0.5,
});

const themeForPreset = (preset: CleanSlideshowPreset) => {
  switch (preset) {
    case "glass_gallery":
      return {
        background: "#071318",
        accent: "#73D9EE",
        label: "GLASS GALLERY",
      };
    case "archive_ribbon":
      return {
        background: "#26231D",
        accent: "#D4B16A",
        label: "ARCHIVE RIBBON",
      };
    case "dual_panel_story":
      return {
        background: "#09111E",
        accent: "#7FAEF8",
        label: "DUAL PANEL STORY",
      };
    default:
      return {
        background: "#050607",
        accent: "#FFFFFF",
        label: "EDITORIAL FULL-BLEED",
      };
  }
};

const useSlideState = (
  slides: CleanSlide[],
  durationPerSlide: number,
  transitionFrames: number
) => {
  const frame = useCurrentFrame();
  const safeSlides = slides.length ? slides : [{src: ""}];

  // Single-slide hold: no internal zoom/swap (avoids double motion with base Ken Burns).
  if (safeSlides.length <= 1) {
    return {
      current: safeSlides[0],
      next: safeSlides[0],
      index: 0,
      localFrame: frame,
      slideProgress: 0,
      transitionProgress: 0,
    };
  }

  const stride = Math.max(1, durationPerSlide - transitionFrames);
  const index = Math.floor(frame / stride) % safeSlides.length;
  const localFrame = frame % stride;

  const nextIndex = (index + 1) % safeSlides.length;
  const tf = Math.max(0, transitionFrames);
  const transitionStart = stride - tf;

  const transitionProgress =
    safeSlides.length <= 1 || tf <= 0
      ? 0
      : phase(localFrame, transitionStart, stride);

  const slideProgress = clamp(localFrame / stride);

  return {
    current: safeSlides[index],
    next: safeSlides[nextIndex],
    index,
    localFrame,
    slideProgress,
    transitionProgress,
  };
};

const SubtleFinish: React.FC = () => {
  return (
    <>
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          opacity: 0.035,
          mixBlendMode: "screen",
          backgroundImage: `
            radial-gradient(circle at 18% 24%, white 0 1px, transparent 1.3px),
            radial-gradient(circle at 68% 73%, white 0 1px, transparent 1.3px),
            radial-gradient(circle at 44% 52%, white 0 1px, transparent 1.3px)
          `,
          backgroundSize: "15px 15px, 19px 19px, 23px 23px",
        }}
      />

      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "radial-gradient(circle at center, transparent 0%, transparent 61%, rgba(0,0,0,0.48) 100%)",
        }}
      />
    </>
  );
};

const PresetLabel: React.FC<{
  text: string;
  accent: string;
}> = ({text, accent}) => {
  return (
    <div
      style={{
        position: "absolute",
        left: 38,
        top: 28,
        padding: "8px 12px",
        backgroundColor: "rgba(0,0,0,0.55)",
        borderLeft: `4px solid ${accent}`,
        color: "white",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: 16,
        fontWeight: 800,
        letterSpacing: 2,
        zIndex: 20,
      }}
    >
      {text}
    </div>
  );
};

const EditorialFullBleed: React.FC<
  Omit<CleanDocumentarySlideshowProps, "preset">
> = ({
  slides,
  durationPerSlide = 100,
  transitionFrames = 18,
  intensity = 0.72,
  showPresetLabel = false,
}) => {
  const {
    current,
    next,
    slideProgress,
    transitionProgress,
  } = useSlideState(
    slides,
    durationPerSlide,
    transitionFrames
  );

  const zoom =
    1.015 + easeInOut(slideProgress) * 0.075 * intensity;

  const nextZoom =
    1.08 - transitionProgress * 0.045;

  return (
    <AbsoluteFill style={{backgroundColor: "#050607"}}>
      <AbsoluteFill style={{overflow: "hidden"}}>
        <Img
          src={current.src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${slideFocus(current).x * 100}% ${slideFocus(current).y * 100}%`,
            transform: `scale(${zoom})`,
            filter: "contrast(1.045) saturate(0.9)",
            opacity: 1 - transitionProgress,
          }}
        />

        <Img
          src={next.src}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${slideFocus(next).x * 100}% ${slideFocus(next).y * 100}%`,
            transform: `scale(${nextZoom})`,
            filter: "contrast(1.045) saturate(0.9)",
            opacity: transitionProgress,
          }}
        />
      </AbsoluteFill>

      {/* Clean editorial letterbox */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: 26,
          backgroundColor: "rgba(0,0,0,0.9)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: "100%",
          height: 32,
          backgroundColor: "rgba(0,0,0,0.9)",
        }}
      />

      {(current.caption || current.kicker) && (
        <div
          style={{
            position: "absolute",
            left: 58,
            bottom: 62,
            maxWidth: "65%",
            opacity: 1 - transitionProgress,
          }}
        >
          {current.kicker ? (
            <div
              style={{
                color: "rgba(255,255,255,0.72)",
                fontFamily: "Inter, Arial, sans-serif",
                fontWeight: 800,
                fontSize: 17,
                letterSpacing: 3,
                marginBottom: 7,
              }}
            >
              {current.kicker.toUpperCase()}
            </div>
          ) : null}

          {current.caption ? (
            <div
              style={{
                display: "inline-block",
                color: "white",
                fontFamily: "Georgia, Times New Roman, serif",
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1.12,
                textShadow: "0 4px 18px rgba(0,0,0,0.75)",
              }}
            >
              {current.caption}
            </div>
          ) : null}

          <div
            style={{
              width: 150,
              height: 3,
              backgroundColor: "white",
              marginTop: 13,
            }}
          />
        </div>
      )}

      {showPresetLabel ? (
        <PresetLabel
          text="EDITORIAL FULL-BLEED"
          accent="#FFFFFF"
        />
      ) : null}

      <SubtleFinish />
    </AbsoluteFill>
  );
};

const GlassGallery: React.FC<
  Omit<CleanDocumentarySlideshowProps, "preset">
> = ({
  slides,
  durationPerSlide = 100,
  transitionFrames = 20,
  intensity = 0.75,
  backgroundColor,
  showPresetLabel = false,
}) => {
  const frame = useCurrentFrame();

  const {
    current,
    next,
    slideProgress,
    transitionProgress,
  } = useSlideState(
    slides,
    durationPerSlide,
    transitionFrames
  );

  const rise =
    (1 - easeInOut(slideProgress)) * 10 * intensity;

  const transitionY =
    transitionProgress * -30 * intensity;

  const theme = themeForPreset("glass_gallery");

  return (
    <AbsoluteFill
      style={{
        backgroundColor:
          backgroundColor ?? theme.background,
        overflow: "hidden",
      }}
    >
      {/* Blurred image-powered background */}
      <Img
        src={current.src}
        style={{
          position: "absolute",
          inset: "-8%",
          width: "116%",
          height: "116%",
          objectFit: "cover",
          filter: "blur(42px) brightness(0.35) saturate(0.72)",
          transform: `scale(1.12) translate(${Math.sin(frame * 0.012) * 8}px, ${Math.cos(frame * 0.01) * 7}px)`,
          opacity: 1 - transitionProgress,
        }}
      />

      <Img
        src={next.src}
        style={{
          position: "absolute",
          inset: "-8%",
          width: "116%",
          height: "116%",
          objectFit: "cover",
          filter: "blur(42px) brightness(0.35) saturate(0.72)",
          transform: "scale(1.12)",
          opacity: transitionProgress,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "78%",
          height: "76%",
          transform: `translate(-50%, -50%) translateY(${rise + transitionY}px)`,
          borderRadius: 22,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.52)",
          backgroundColor: "rgba(255,255,255,0.06)",
          boxShadow:
            "0 30px 95px rgba(0,0,0,0.58), inset 0 0 0 1px rgba(255,255,255,0.10)",
        }}
      >
        <Img
          src={current.src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${slideFocus(current).x * 100}% ${slideFocus(current).y * 100}%`,
            transform: `scale(${1.02 + slideProgress * 0.055 * intensity})`,
            filter: "contrast(1.035) saturate(0.94)",
            opacity: 1 - transitionProgress,
          }}
        />

        <Img
          src={next.src}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${slideFocus(next).x * 100}% ${slideFocus(next).y * 100}%`,
            transform: `scale(${1.08 - transitionProgress * 0.04})`,
            opacity: transitionProgress,
          }}
        />

        {/* Clean moving glass sheen */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${-30 + ((frame * 1.1) % 170)}%`,
            width: "18%",
            transform: "skewX(-18deg)",
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)",
            pointerEvents: "none",
          }}
        />
      </div>

      {current.caption ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 26,
            transform: "translateX(-50%)",
            padding: "10px 17px",
            backgroundColor: "rgba(4,11,15,0.68)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 999,
            color: "white",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 750,
            fontSize: 18,
            letterSpacing: 0.5,
            opacity: 1 - transitionProgress,
          }}
        >
          {current.caption}
        </div>
      ) : null}

      {showPresetLabel ? (
        <PresetLabel
          text={theme.label}
          accent={theme.accent}
        />
      ) : null}

      <SubtleFinish />
    </AbsoluteFill>
  );
};

const ArchiveRibbon: React.FC<
  Omit<CleanDocumentarySlideshowProps, "preset">
> = ({
  slides,
  durationPerSlide = 100,
  transitionFrames = 20,
  intensity = 0.72,
  backgroundColor,
  showPresetLabel = false,
}) => {
  const {
    current,
    next,
    index,
    slideProgress,
    transitionProgress,
  } = useSlideState(
    slides,
    durationPerSlide,
    transitionFrames
  );

  const theme = themeForPreset("archive_ribbon");

  const cardX =
    -transitionProgress * 360 * intensity;

  const nextX =
    (1 - transitionProgress) * 360 * intensity;

  return (
    <AbsoluteFill
      style={{
        backgroundColor:
          backgroundColor ?? theme.background,
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 42%, rgba(212,177,106,0.17) 0%, transparent 46%), linear-gradient(120deg, rgba(255,255,255,0.025), transparent 50%)",
        }}
      />

      {/* Thin archive ribbon */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          height: 88,
          transform: "translateY(-50%)",
          backgroundColor: "rgba(212,177,106,0.10)",
          borderTop: "1px solid rgba(212,177,106,0.25)",
          borderBottom: "1px solid rgba(212,177,106,0.25)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "69%",
          height: "73%",
          transform: `translate(-50%, -50%) translateX(${cardX}px) rotate(${-1.2 + slideProgress * 0.5}deg)`,
          backgroundColor: "#EAE0CB",
          padding: 18,
          boxSizing: "border-box",
          boxShadow: "0 32px 90px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "83%",
            overflow: "hidden",
            backgroundColor: "#111",
          }}
        >
          <Img
            src={current.src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: `${slideFocus(current).x * 100}% ${slideFocus(current).y * 100}%`,
              transform: `scale(${1.02 + slideProgress * 0.05})`,
              filter: "sepia(0.18) contrast(1.025) saturate(0.82)",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            height: "17%",
            color: "#2A241D",
            fontFamily: "Courier New, monospace",
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 900,
                fontSize: 19,
                letterSpacing: 1.5,
              }}
            >
              {current.kicker ?? `ARCHIVE FRAME ${String(index + 1).padStart(2, "0")}`}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 16,
                opacity: 0.72,
              }}
            >
              {current.caption ?? "DOCUMENTARY RECORD"}
            </div>
          </div>

          <div
            style={{
              border: "2px solid rgba(90,60,32,0.55)",
              padding: "7px 10px",
              fontWeight: 900,
              transform: "rotate(-4deg)",
              opacity: 0.8,
            }}
          >
            REVIEWED
          </div>
        </div>
      </div>

      {/* Incoming archive card */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "69%",
          height: "73%",
          transform: `translate(-50%, -50%) translateX(${nextX}px) rotate(1.2deg)`,
          backgroundColor: "#EAE0CB",
          padding: 18,
          boxSizing: "border-box",
          boxShadow: "0 32px 90px rgba(0,0,0,0.55)",
          opacity: transitionProgress,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "83%",
            overflow: "hidden",
            backgroundColor: "#111",
          }}
        >
          <Img
            src={next.src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: `${slideFocus(next).x * 100}% ${slideFocus(next).y * 100}%`,
              filter: "sepia(0.18) contrast(1.025) saturate(0.82)",
            }}
          />
        </div>
      </div>

      {showPresetLabel ? (
        <PresetLabel
          text={theme.label}
          accent={theme.accent}
        />
      ) : null}

      <SubtleFinish />
    </AbsoluteFill>
  );
};

const DualPanelStory: React.FC<
  Omit<CleanDocumentarySlideshowProps, "preset">
> = ({
  slides,
  durationPerSlide = 100,
  transitionFrames = 18,
  intensity = 0.7,
  backgroundColor,
  showPresetLabel = false,
}) => {
  const frame = useCurrentFrame();

  const {
    current,
    next,
    slideProgress,
    transitionProgress,
  } = useSlideState(
    slides,
    durationPerSlide,
    transitionFrames
  );

  const theme = themeForPreset("dual_panel_story");

  const dividerGrow = easeInOut(
    phase(slideProgress, 0.04, 0.28)
  );

  const mainShift =
    -transitionProgress * 80 * intensity;

  return (
    <AbsoluteFill
      style={{
        backgroundColor:
          backgroundColor ?? theme.background,
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 20% 35%, rgba(67,122,214,0.20) 0%, transparent 42%), radial-gradient(circle at 82% 68%, rgba(27,76,150,0.16) 0%, transparent 46%)",
          transform: `translate(${Math.sin(frame * 0.015) * 7}px, ${Math.cos(frame * 0.012) * 5}px)`,
        }}
      />

      {/* Main panel */}
      <div
        style={{
          position: "absolute",
          left: "5.5%",
          top: "12%",
          width: "65%",
          height: "76%",
          overflow: "hidden",
          borderRadius: 16,
          boxShadow: "0 26px 82px rgba(0,0,0,0.52)",
          transform: `translateX(${mainShift}px)`,
        }}
      >
        <Img
          src={current.src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${slideFocus(current).x * 100}% ${slideFocus(current).y * 100}%`,
            transform: `scale(${1.02 + slideProgress * 0.055})`,
            filter: "contrast(1.04) saturate(0.93)",
            opacity: 1 - transitionProgress,
          }}
        />

        <Img
          src={next.src}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${slideFocus(next).x * 100}% ${slideFocus(next).y * 100}%`,
            transform: `translateX(${(1 - transitionProgress) * 42}px) scale(1.05)`,
            opacity: transitionProgress,
          }}
        />
      </div>

      {/* Detail panel uses a tighter crop from same slide */}
      <div
        style={{
          position: "absolute",
          right: "5.5%",
          top: "21%",
          width: "22%",
          height: "58%",
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.30)",
          boxShadow: "0 20px 62px rgba(0,0,0,0.48)",
          transform: `translateY(${(1 - dividerGrow) * 45}px)`,
          opacity: dividerGrow,
        }}
      >
        <Img
          src={current.src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${slideFocus(current).x * 100}% ${slideFocus(current).y * 100}%`,
            transform: `scale(${1.34 + slideProgress * 0.07})`,
            filter: "contrast(1.08) saturate(0.86)",
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: 12,
            padding: "8px 10px",
            backgroundColor: "rgba(4,10,20,0.70)",
            borderLeft: `4px solid ${theme.accent}`,
            color: "white",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 800,
            fontSize: 14,
            letterSpacing: 1.2,
          }}
        >
          {current.kicker ?? "DETAIL VIEW"}
        </div>
      </div>

      {/* Divider */}
      <div
        style={{
          position: "absolute",
          left: "73.1%",
          top: "18%",
          width: 3,
          height: `${64 * dividerGrow}%`,
          backgroundColor: theme.accent,
          boxShadow: `0 0 16px ${theme.accent}`,
        }}
      />

      {current.caption ? (
        <div
          style={{
            position: "absolute",
            left: "6.5%",
            bottom: "4.3%",
            color: "white",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 760,
            fontSize: 22,
            letterSpacing: 0.4,
            opacity: 1 - transitionProgress,
          }}
        >
          {current.caption}
        </div>
      ) : null}

      {showPresetLabel ? (
        <PresetLabel
          text={theme.label}
          accent={theme.accent}
        />
      ) : null}

      <SubtleFinish />
    </AbsoluteFill>
  );
};

export const CleanDocumentarySlideshow: React.FC<
  CleanDocumentarySlideshowProps
> = (props) => {
  switch (props.preset) {
    case "glass_gallery":
      return <GlassGallery {...props} />;
    case "archive_ribbon":
      return <ArchiveRibbon {...props} />;
    case "dual_panel_story":
      return <DualPanelStory {...props} />;
    default:
      return <EditorialFullBleed {...props} />;
  }
};

/**
 * Example:
 *
 * const slides = [
 *   {
 *     src: staticFile("images/roadblock.png"),
 *     kicker: "FIELD RECORD",
 *     caption: "The road was closed before sunrise.",
 *     focusX: 0.5,
 *     focusY: 0.52,
 *   },
 *   {
 *     src: staticFile("images/statue.png"),
 *     kicker: "DIVE FRAME 04",
 *     caption: "A structure appeared beneath the silt.",
 *     focusX: 0.52,
 *     focusY: 0.44,
 *   },
 *   {
 *     src: staticFile("images/research.png"),
 *     kicker: "EXPEDITION LOG",
 *     caption: "The research team returned with new equipment.",
 *     focusX: 0.48,
 *     focusY: 0.5,
 *   },
 * ];
 *
 * <CleanDocumentarySlideshow
 *   preset="glass_gallery"
 *   slides={slides}
 *   durationPerSlide={105}
 *   transitionFrames={20}
 *   intensity={0.75}
 * />
 */
