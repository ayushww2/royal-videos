import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type FocusPoint = {
  x: number;
  y: number;
};

export type SlideItem = {
  src: string;
  caption?: string;
  kicker?: string;
  focus?: FocusPoint;
  focusX?: number;
  focusY?: number;
};

export type BaseSlideshowProps = {
  slides: SlideItem[];
  durationPerSlide?: number;
  transitionFrames?: number;
  showPresetLabel?: boolean;
  accentColor?: string;
};

export type ClassicLowerThirdProps = {
  primaryText: string;
  secondaryText?: string;
  tagText?: string;
  durationFrames?: number;
  showPresetLabel?: boolean;
};

export type RedGridArchiveProps = {
  mainImage: string;
  sideImages?: string[];
  title?: string;
  subtitle?: string;
  durationFrames?: number;
  showPresetLabel?: boolean;
};

export type QuoteOnlyProps = {
  quote: string;
  attribution?: string;
  context?: string;
  backgroundImage?: string;
  durationFrames?: number;
  accentColor?: string;
  showPresetLabel?: boolean;
};

export type RevealQuestionProps = {
  question: string;
  secondaryText?: string;
  subtext?: string;
  backgroundImage?: string;
  durationFrames?: number;
  accentColor?: string;
  showPresetLabel?: boolean;
};

export type EarlierPresetId =
  | "01_classic_blue_white_lower_third"
  | "02_secondary_blue_lower_third"
  | "04_glass_gallery_slideshow"
  | "05_archive_ribbon_slideshow"
  | "08_reveal_question"
  | "10_red_grid_archive_background"
  | "15_quote_only"
  | "21_royal_archive_slideshow";

export type EarlierTimelineEvent = {
  id: string;
  presetId: EarlierPresetId;
  startFrame: number;
  durationFrames: number;
  layer?: number;
  props: Record<string, unknown>;
  tags?: string[];
};

const clamp01 = (v: number) =>
  Math.max(0, Math.min(1, v));

const phase = (
  frame: number,
  from: number,
  to: number
) =>
  clamp01(
    interpolate(frame, [from, to], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

const focusOf = (
  slide: SlideItem
): FocusPoint => ({
  x: clamp01(
    slide.focus?.x ??
      slide.focusX ??
      0.5
  ),
  y: clamp01(
    slide.focus?.y ??
      slide.focusY ??
      0.5
  ),
});

const FillImage: React.FC<{
  src: string;
  focus?: FocusPoint;
  scale?: number;
  opacity?: number;
  filter?: string;
  transform?: string;
}> = ({
  src,
  focus = {x: 0.5, y: 0.5},
  scale = 1,
  opacity = 1,
  filter = "none",
  transform,
}) => (
  <Img
    src={src}
    style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition:
        `${focus.x * 100}% ${focus.y * 100}%`,
      transform:
        transform ??
        `scale(${scale})`,
      opacity,
      filter,
    }}
  />
);

const useSlideState = (
  slides: SlideItem[],
  durationPerSlide: number,
  transitionFrames: number
) => {
  const frame =
    useCurrentFrame();

  const safeSlides =
    slides.length
      ? slides
      : [{src: ""}];

  const stride =
    Math.max(
      1,
      durationPerSlide -
        transitionFrames
    );

  const index =
    Math.floor(frame / stride) %
    safeSlides.length;

  const nextIndex =
    (index + 1) %
    safeSlides.length;

  const localFrame =
    frame % stride;

  const slideProgress =
    clamp01(
      localFrame / stride
    );

  const transitionProgress =
    phase(
      localFrame,
      stride -
        transitionFrames,
      stride
    );

  return {
    frame,
    current:
      safeSlides[index],
    next:
      safeSlides[nextIndex],
    index,
    nextIndex,
    localFrame,
    slideProgress,
    transitionProgress,
  };
};

const Finish: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background:
        "radial-gradient(circle at center, transparent 0%, transparent 60%, rgba(0,0,0,0.58) 100%)",
    }}
  />
);

const PresetLabel: React.FC<{
  number: string;
  name: string;
  accent: string;
}> = ({
  number,
  name,
  accent,
}) => (
  <div
    style={{
      position: "absolute",
      left: 34,
      top: 24,
      zIndex: 100,
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "9px 16px",
      background:
        "rgba(0,0,0,0.68)",
      borderLeft:
        `5px solid ${accent}`,
      color: "white",
      fontFamily:
        "Inter, Arial, sans-serif",
      fontWeight: 900,
      fontSize: 18,
      letterSpacing: 1.8,
      textTransform: "uppercase",
    }}
  >
    <span>{number}</span>
    <span>{name}</span>
  </div>
);

export const ClassicBlueWhiteLowerThird: React.FC<
  ClassicLowerThirdProps
> = ({
  primaryText,
  secondaryText,
  tagText,
  durationFrames = 90,
  showPresetLabel = false,
}) => {
  const frame =
    useCurrentFrame();

  const enter =
    phase(frame, 0, 14);

  const exit =
    interpolate(
      frame,
      [
        Math.max(
          0,
          durationFrames - 12
        ),
        durationFrames,
      ],
      [1, 0],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      }
    );

  const visible =
    enter * exit;

  return (
    <AbsoluteFill
      style={{
        pointerEvents:
          "none",
      }}
    >
      <div
        style={{
          position:
            "absolute",
          left:
            110 -
            (1 - enter) *
              140,
          bottom: 72,
          width: 720,
          height: 165,
          opacity: visible,
        }}
      >
        <div
          style={{
            position:
              "absolute",
            left: 0,
            top: 36,
            width: 590,
            height: 106,
            background:
              "linear-gradient(90deg, #102D6B 0%, #244FA8 100%)",
            boxShadow:
              "0 14px 35px rgba(0,0,0,0.34)",
          }}
        />

        <div
          style={{
            position:
              "absolute",
            left: 30,
            top: 56,
            color: "white",
            fontFamily:
              "Georgia, serif",
            fontWeight: 700,
            fontSize: 34,
            lineHeight: 1,
            textTransform:
              "uppercase",
            textShadow:
              "2px 2px 0 rgba(0,0,0,0.58)",
          }}
        >
          {primaryText}
        </div>

        {secondaryText ? (
          <div
            style={{
              position:
                "absolute",
              left: 30,
              top: 108,
              color:
                "#F3F4F6",
              fontFamily:
                "Inter, Arial, sans-serif",
              fontWeight: 850,
              fontSize: 20,
              letterSpacing: 0.7,
              textTransform:
                "uppercase",
              textShadow:
                "1px 1px 0 rgba(0,0,0,0.58)",
            }}
          >
            {secondaryText}
          </div>
        ) : null}

        <div
          style={{
            position:
              "absolute",
            left: 575,
            top: 82,
            width: 68,
            height: 66,
            borderLeft:
              "6px solid white",
            borderBottom:
              "6px solid white",
            opacity: 0.92,
          }}
        />

        {tagText ? (
          <div
            style={{
              position:
                "absolute",
              left: 0,
              top: 6,
              padding:
                "8px 14px",
              background:
                "rgba(0,0,0,0.64)",
              color: "white",
              fontFamily:
                "Inter, Arial, sans-serif",
              fontWeight: 900,
              fontSize: 14,
              letterSpacing: 1.5,
              textTransform:
                "uppercase",
            }}
          >
            {tagText}
          </div>
        ) : null}
      </div>

      {showPresetLabel ? (
        <PresetLabel
          number="01"
          name="Classic Blue White Lower Third"
          accent="#4F82E8"
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const SecondaryBlueLowerThird: React.FC<
  ClassicLowerThirdProps
> = ({
  primaryText,
  secondaryText,
  tagText,
  durationFrames = 84,
  showPresetLabel = false,
}) => {
  const frame =
    useCurrentFrame();

  const enter =
    phase(frame, 0, 16);

  const exit =
    interpolate(
      frame,
      [
        Math.max(
          0,
          durationFrames - 12
        ),
        durationFrames,
      ],
      [1, 0],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      }
    );

  return (
    <AbsoluteFill
      style={{
        pointerEvents:
          "none",
      }}
    >
      <div
        style={{
          position:
            "absolute",
          left: 86,
          bottom: 72,
          width: 610,
          height: 132,
          transform:
            `translateX(${(1 - enter) * -130}px)`,
          opacity:
            enter * exit,
        }}
      >
        <div
          style={{
            position:
              "absolute",
            inset: 0,
            background:
              "rgba(4,14,30,0.82)",
            border:
              "1px solid rgba(255,255,255,0.12)",
            boxShadow:
              "0 18px 48px rgba(0,0,0,0.34)",
          }}
        />

        <div
          style={{
            position:
              "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 12,
            background:
              "linear-gradient(180deg, #4E9BF8, #1F5EBB)",
          }}
        />

        <div
          style={{
            position:
              "absolute",
            left: 34,
            top: 22,
            color: "white",
            fontFamily:
              "Inter, Arial, sans-serif",
            fontWeight: 900,
            fontSize: 29,
            textTransform:
              "uppercase",
            letterSpacing: 0.8,
          }}
        >
          {primaryText}
        </div>

        {secondaryText ? (
          <div
            style={{
              position:
                "absolute",
              left: 34,
              top: 68,
              color:
                "rgba(255,255,255,0.76)",
              fontFamily:
                "Inter, Arial, sans-serif",
              fontWeight: 760,
              fontSize: 18,
              textTransform:
                "uppercase",
              letterSpacing: 0.8,
            }}
          >
            {secondaryText}
          </div>
        ) : null}

        {tagText ? (
          <div
            style={{
              position:
                "absolute",
              right: 18,
              top: 20,
              padding:
                "6px 10px",
              color:
                "#A9D0FF",
              border:
                "1px solid rgba(78,155,248,0.5)",
              fontFamily:
                "Inter, Arial, sans-serif",
              fontWeight: 850,
              fontSize: 12,
              letterSpacing: 1.1,
              textTransform:
                "uppercase",
            }}
          >
            {tagText}
          </div>
        ) : null}
      </div>

      {showPresetLabel ? (
        <PresetLabel
          number="02"
          name="Secondary Blue Lower Third"
          accent="#4E9BF8"
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const GlassGallerySlideshow: React.FC<
  BaseSlideshowProps
> = ({
  slides,
  durationPerSlide = 105,
  transitionFrames = 20,
  showPresetLabel = false,
  accentColor = "#73D9EE",
}) => {
  const state =
    useSlideState(
      slides,
      durationPerSlide,
      transitionFrames
    );

  const currentFocus =
    focusOf(state.current);

  const nextFocus =
    focusOf(state.next);

  return (
    <AbsoluteFill
      style={{
        backgroundColor:
          "#071318",
        overflow: "hidden",
      }}
    >
      <FillImage
        src={
          state.current.src
        }
        focus={
          currentFocus
        }
        scale={1.15}
        filter=
          "blur(30px) brightness(0.28) saturate(0.74)"
      />

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 32%, rgba(255,255,255,0.10), transparent 42%)",
        }}
      />

      <div
        style={{
          position:
            "absolute",
          left: "9%",
          top: "9%",
          width: "82%",
          height: "76%",
          overflow: "hidden",
          borderRadius: 26,
          border:
            "1px solid rgba(255,255,255,0.32)",
          boxShadow:
            "0 28px 88px rgba(0,0,0,0.48)",
          background:
            "rgba(255,255,255,0.05)",
        }}
      >
        <FillImage
          src={
            state.current.src
          }
          focus={
            currentFocus
          }
          scale={
            1.02 +
            state.slideProgress *
              0.06
          }
          opacity={
            1 -
            state.transitionProgress
          }
          filter=
            "contrast(1.04) saturate(0.96)"
        />

        <div
          style={{
            position:
              "absolute",
            inset: 0,
          }}
        >
          <FillImage
            src={
              state.next.src
            }
            focus={
              nextFocus
            }
            transform=
              {`translateY(${(1 - state.transitionProgress) * 4}%) scale(${1.05 - state.transitionProgress * 0.02})`}
            opacity={
              state.transitionProgress
            }
          />
        </div>

        <div
          style={{
            position:
              "absolute",
            top: -170,
            left:
              -120 +
              (state.frame %
                130) *
                6,
            width: 160,
            height: "170%",
            transform:
              "rotate(18deg)",
            background:
              "linear-gradient(180deg, transparent, rgba(255,255,255,0.20), transparent)",
            mixBlendMode:
              "screen",
            opacity: 0.55,
          }}
        />
      </div>

      {state.current.caption ? (
        <div
          style={{
            position:
              "absolute",
            left: "50%",
            bottom: "8%",
            transform:
              "translateX(-50%)",
            color: "white",
            fontFamily:
              "Inter, Arial, sans-serif",
            fontWeight: 820,
            fontSize: 23,
            maxWidth: "74%",
            textAlign:
              "center",
            textShadow:
              "0 6px 20px rgba(0,0,0,0.56)",
          }}
        >
          {state.current.caption}
        </div>
      ) : null}

      {showPresetLabel ? (
        <PresetLabel
          number="04"
          name="Glass Gallery"
          accent={accentColor}
        />
      ) : null}

      <Finish />
    </AbsoluteFill>
  );
};

export const ArchiveRibbonSlideshow: React.FC<
  BaseSlideshowProps
> = ({
  slides,
  durationPerSlide = 105,
  transitionFrames = 20,
  showPresetLabel = false,
  accentColor = "#D4B16A",
}) => {
  const state =
    useSlideState(
      slides,
      durationPerSlide,
      transitionFrames
    );

  const cardX =
    -state.transitionProgress *
    360;

  const nextX =
    (1 -
      state.transitionProgress) *
    360;

  const renderCard = (
    slide: SlideItem,
    x: number,
    opacity: number,
    rotate: number,
    frameNumber: number
  ) => (
    <div
      style={{
        position:
          "absolute",
        left: "50%",
        top: "50%",
        width: "69%",
        height: "73%",
        transform:
          `translate(-50%, -50%) translateX(${x}px) rotate(${rotate}deg)`,
        backgroundColor:
          "#EAE0CB",
        padding: 18,
        boxSizing:
          "border-box",
        boxShadow:
          "0 34px 95px rgba(0,0,0,0.56)",
        opacity,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "82%",
          overflow: "hidden",
          backgroundColor:
            "#111",
        }}
      >
        <FillImage
          src={slide.src}
          focus={
            focusOf(slide)
          }
          scale={
            1.02 +
            state.slideProgress *
              0.05
          }
          filter=
            "sepia(0.18) contrast(1.025) saturate(0.82)"
        />
      </div>

      <div
        style={{
          height: "18%",
          display: "flex",
          alignItems:
            "center",
          justifyContent:
            "space-between",
          color: "#2A241D",
          fontFamily:
            "Courier New, monospace",
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
            {slide.kicker ??
              `ARCHIVE FRAME ${String(frameNumber).padStart(2, "0")}`}
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 16,
              opacity: 0.72,
            }}
          >
            {slide.caption ??
              "DOCUMENTARY RECORD"}
          </div>
        </div>

        <div
          style={{
            border:
              "2px solid rgba(90,60,32,0.55)",
            padding:
              "7px 10px",
            fontWeight: 900,
            transform:
              "rotate(-4deg)",
            opacity: 0.8,
          }}
        >
          REVIEWED
        </div>
      </div>
    </div>
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor:
          "#26231D",
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 42%, rgba(212,177,106,0.18), transparent 46%)",
        }}
      />

      <div
        style={{
          position:
            "absolute",
          left: 0,
          right: 0,
          top: "50%",
          height: 88,
          transform:
            "translateY(-50%)",
          backgroundColor:
            "rgba(212,177,106,0.10)",
          borderTop:
            "1px solid rgba(212,177,106,0.25)",
          borderBottom:
            "1px solid rgba(212,177,106,0.25)",
        }}
      />

      {renderCard(
        state.current,
        cardX,
        1,
        -1.1 +
          state.slideProgress *
            0.45,
        state.index + 1
      )}

      {renderCard(
        state.next,
        nextX,
        state.transitionProgress,
        1.1,
        state.nextIndex + 1
      )}

      {showPresetLabel ? (
        <PresetLabel
          number="05"
          name="Archive Ribbon"
          accent={accentColor}
        />
      ) : null}

      <Finish />
    </AbsoluteFill>
  );
};

export const RevealQuestion: React.FC<
  RevealQuestionProps
> = ({
  question,
  secondaryText,
  subtext,
  backgroundImage,
  durationFrames = 105,
  accentColor = "#F04C56",
  showPresetLabel = false,
}) => {
  const frame =
    useCurrentFrame();

  const {fps} =
    useVideoConfig();

  const intro =
    clamp01(
      spring({
        frame,
        fps,
        durationInFrames: 26,
        config: {
          damping: 12,
          stiffness: 145,
          mass: 0.8,
        },
      })
    );

  const outro =
    interpolate(
      frame,
      [
        Math.max(
          0,
          durationFrames - 14
        ),
        durationFrames,
      ],
      [1, 0],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      }
    );

  const supporting =
    subtext ??
    secondaryText;

  return (
    <AbsoluteFill
      style={{
        backgroundColor:
          "black",
        overflow: "hidden",
      }}
    >
      {backgroundImage ? (
        <Img
          src={
            backgroundImage
          }
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform:
              "scale(1.06)",
            filter:
              "brightness(0.28) contrast(1.05) saturate(0.82)",
          }}
        />
      ) : null}

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at center, rgba(16,20,28,0.12), rgba(0,0,0,0.76))",
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent:
            "center",
          alignItems:
            "center",
          opacity:
            intro * outro,
        }}
      >
        <div
          style={{
            width: "84%",
            textAlign:
              "center",
            transform:
              `scale(${1.28 - intro * 0.28})`,
          }}
        >
          <div
            style={{
              color: "white",
              fontFamily:
                "Arial Narrow, Oswald, Impact, Inter, sans-serif",
              fontWeight: 950,
              fontSize:
                question.length >
                38
                  ? 56
                  : 72,
              letterSpacing: 2.6,
              lineHeight: 1,
              textTransform:
                "uppercase",
              textShadow:
                "0 6px 24px rgba(0,0,0,0.78)",
            }}
          >
            {question}
          </div>

          <div
            style={{
              width:
                300 * intro,
              height: 6,
              backgroundColor:
                accentColor,
              margin:
                "28px auto 0",
              boxShadow:
                `0 0 20px ${accentColor}`,
            }}
          />

          {supporting ? (
            <div
              style={{
                marginTop: 24,
                color:
                  "rgba(255,255,255,0.84)",
                fontFamily:
                  "Inter, Arial, sans-serif",
                fontWeight: 750,
                fontSize: 24,
                letterSpacing: 1.8,
                textTransform:
                  "uppercase",
              }}
            >
              {supporting}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>

      {showPresetLabel ? (
        <PresetLabel
          number="08"
          name="Reveal Question"
          accent={accentColor}
        />
      ) : null}

      <Finish />
    </AbsoluteFill>
  );
};

export const RedGridArchiveBackground: React.FC<
  RedGridArchiveProps
> = ({
  mainImage,
  sideImages = [],
  title = "FIELD INVESTIGATION",
  subtitle = "Archive and evidence montage",
  durationFrames = 150,
  showPresetLabel = false,
}) => {
  const frame =
    useCurrentFrame();

  const progress =
    clamp01(
      frame /
        durationFrames
    );

  const offset =
    progress * 26;

  return (
    <AbsoluteFill
      style={{
        backgroundColor:
          "#4B0F12",
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at center, rgba(140,30,35,0.65), rgba(40,5,8,0.96) 75%)",
        }}
      />

      <AbsoluteFill
        style={{
          opacity: 0.42,
          backgroundImage:
            "linear-gradient(#B23A3A 2px, transparent 2px), linear-gradient(90deg, #B23A3A 2px, transparent 2px)",
          backgroundSize:
            "74px 74px",
          transform:
            `translate(${offset}px, ${offset * 0.4}px)`,
        }}
      />

      {sideImages
        .slice(0, 2)
        .map(
          (
            src,
            index
          ) => (
            <div
              key={
                `${src}-${index}`
              }
              style={{
                position:
                  "absolute",
                [index === 0
                  ? "left"
                  : "right"]: 80,
                top: 140,
                width: 280,
                height: 600,
                overflow:
                  "hidden",
                opacity: 0.30,
                filter:
                  "blur(1px) saturate(0.75)",
                transform:
                  `rotate(${index === 0 ? -2 : 2}deg)`,
                boxShadow:
                  "0 20px 60px rgba(0,0,0,0.5)",
              }}
            >
              <FillImage
                src={src}
              />
            </div>
          )
        )}

      <div
        style={{
          position:
            "absolute",
          left: "50%",
          top: "47%",
          width: 780,
          height: 520,
          transform:
            `translate(-50%, -50%) scale(${0.82 + progress * 0.025})`,
          overflow: "hidden",
          backgroundColor:
            "black",
          border:
            "8px solid rgba(255,255,255,0.88)",
          boxShadow:
            "0 28px 80px rgba(0,0,0,0.65)",
        }}
      >
        <FillImage
          src={mainImage}
        />
      </div>

      <div
        style={{
          position:
            "absolute",
          left: "50%",
          bottom: 55,
          transform:
            "translateX(-50%)",
          textAlign:
            "center",
          color: "white",
        }}
      >
        <div
          style={{
            fontFamily:
              "Arial Narrow, Oswald, Impact, sans-serif",
            fontWeight: 950,
            fontSize: 42,
            letterSpacing: 2,
            textTransform:
              "uppercase",
          }}
        >
          {title}
        </div>

        <div
          style={{
            marginTop: 7,
            fontFamily:
              "Inter, Arial, sans-serif",
            fontWeight: 650,
            fontSize: 18,
            color:
              "rgba(255,255,255,0.68)",
          }}
        >
          {subtitle}
        </div>
      </div>

      {showPresetLabel ? (
        <PresetLabel
          number="10"
          name="Red Grid Archive"
          accent="#B23A3A"
        />
      ) : null}

      <Finish />
    </AbsoluteFill>
  );
};

export const QuoteOnly: React.FC<
  QuoteOnlyProps
> = ({
  quote,
  attribution,
  context,
  backgroundImage,
  durationFrames = 120,
  accentColor = "#E7B958",
  showPresetLabel = false,
}) => {
  const frame =
    useCurrentFrame();

  const {fps} =
    useVideoConfig();

  const intro =
    clamp01(
      spring({
        frame,
        fps,
        durationInFrames: 25,
        config: {
          damping: 15,
          stiffness: 120,
          mass: 0.78,
        },
      })
    );

  const outro =
    interpolate(
      frame,
      [
        Math.max(
          0,
          durationFrames - 14
        ),
        durationFrames,
      ],
      [1, 0],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      }
    );

  return (
    <AbsoluteFill
      style={{
        backgroundColor:
          "#080808",
        overflow: "hidden",
      }}
    >
      {backgroundImage ? (
        <Img
          src={
            backgroundImage
          }
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform:
              `scale(${1.05 + frame * 0.00012})`,
            filter:
              "brightness(0.24) grayscale(0.15) saturate(0.72)",
          }}
        />
      ) : null}

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgba(35,35,35,0.18), rgba(0,0,0,0.84))",
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent:
            "center",
          alignItems:
            "center",
          opacity:
            intro * outro,
        }}
      >
        <div
          style={{
            width: "76%",
            textAlign:
              "center",
            transform:
              `translateY(${(1 - intro) * 30}px)`,
          }}
        >
          <div
            style={{
              color:
                accentColor,
              fontFamily:
                "Georgia, serif",
              fontSize: 112,
              lineHeight: 0.55,
            }}
          >
            “
          </div>

          <div
            style={{
              color: "white",
              fontFamily:
                "Georgia, Times New Roman, serif",
              fontWeight: 700,
              fontSize:
                quote.length >
                120
                  ? 42
                  : 54,
              lineHeight: 1.15,
              textShadow:
                "0 6px 24px rgba(0,0,0,0.78)",
            }}
          >
            {quote}
          </div>

          <div
            style={{
              width:
                180 *
                phase(
                  frame,
                  14,
                  42
                ),
              height: 5,
              margin:
                "28px auto 0",
              backgroundColor:
                accentColor,
              boxShadow:
                `0 0 18px ${accentColor}`,
            }}
          />

          {attribution ? (
            <div
              style={{
                marginTop: 23,
                color: "white",
                fontFamily:
                  "Inter, Arial, sans-serif",
                fontWeight: 900,
                fontSize: 23,
                letterSpacing: 2.4,
                textTransform:
                  "uppercase",
              }}
            >
              {attribution}
            </div>
          ) : null}

          {context ? (
            <div
              style={{
                marginTop: 8,
                color:
                  "rgba(255,255,255,0.62)",
                fontFamily:
                  "Inter, Arial, sans-serif",
                fontWeight: 650,
                fontSize: 18,
                letterSpacing: 1.4,
                textTransform:
                  "uppercase",
              }}
            >
              {context}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>

      {showPresetLabel ? (
        <PresetLabel
          number="15"
          name="Quote Only"
          accent={accentColor}
        />
      ) : null}

      <Finish />
    </AbsoluteFill>
  );
};

export const RoyalArchiveSlideshow: React.FC<
  BaseSlideshowProps
> = ({
  slides,
  durationPerSlide = 105,
  transitionFrames = 16,
  showPresetLabel = false,
  accentColor = "#D7B26A",
}) => {
  const state =
    useSlideState(
      slides,
      durationPerSlide,
      transitionFrames
    );

  const slide =
    state.current;

  return (
    <AbsoluteFill
      style={{
        backgroundColor:
          "#1A1215",
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(135deg, rgba(193,154,82,0.14), transparent 34%, transparent 66%, rgba(132,39,58,0.12))",
        }}
      />

      <div
        style={{
          position:
            "absolute",
          left: "17%",
          top: "10%",
          width: "66%",
          height: "76%",
          background:
            "#EFE6D7",
          border:
            "1px solid rgba(100,74,44,0.34)",
          boxShadow:
            "0 28px 90px rgba(0,0,0,0.55)",
          transform:
            `rotate(${Math.sin(state.frame / 35) * 0.8}deg)`,
        }}
      >
        <div
          style={{
            position:
              "absolute",
            left: 34,
            top: 34,
            right: 34,
            height: "69%",
            overflow: "hidden",
            border:
              "1px solid rgba(90,72,56,0.22)",
          }}
        >
          <FillImage
            src={slide.src}
            focus={
              focusOf(slide)
            }
            scale={
              1.03 +
              state.slideProgress *
                0.055
            }
            filter=
              "sepia(0.18) contrast(1.03) saturate(0.86)"
          />
        </div>

        <div
          style={{
            position:
              "absolute",
            left: 36,
            bottom: 88,
            color: "#45352A",
            fontFamily:
              "Georgia, serif",
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: 1.2,
          }}
        >
          {slide.kicker ??
            "ROYAL ARCHIVE"}
        </div>

        <div
          style={{
            position:
              "absolute",
            left: 36,
            right: 190,
            bottom: 44,
            color: "#2C231D",
            fontFamily:
              "Inter, Arial, sans-serif",
            fontWeight: 900,
            fontSize: 26,
          }}
        >
          {slide.caption ??
            "A moment preserved for the record."}
        </div>

        <div
          style={{
            position:
              "absolute",
            right: 38,
            bottom: 38,
            padding:
              "10px 16px",
            border:
              "3px solid rgba(98,73,55,0.68)",
            color: "#5A4033",
            fontFamily:
              "Inter, Arial, sans-serif",
            fontWeight: 900,
            fontSize: 16,
            letterSpacing: 1.4,
          }}
        >
          REVIEWED
        </div>

        <div
          style={{
            position:
              "absolute",
            right: 36,
            top: 30,
            color: "#8B796C",
            fontFamily:
              "Inter, Arial, sans-serif",
            fontWeight: 800,
            fontSize: 15,
            letterSpacing: 1.5,
          }}
        >
          FRAME {String(state.index + 1).padStart(2, "0")}
        </div>
      </div>

      {showPresetLabel ? (
        <PresetLabel
          number="21"
          name="Royal Archive"
          accent={accentColor}
        />
      ) : null}

      <Finish />
    </AbsoluteFill>
  );
};

export const earlierPresetRegistry: Record<
  EarlierPresetId,
  React.ComponentType<any>
> = {
  "01_classic_blue_white_lower_third":
    ClassicBlueWhiteLowerThird,

  "02_secondary_blue_lower_third":
    SecondaryBlueLowerThird,

  "04_glass_gallery_slideshow":
    GlassGallerySlideshow,

  "05_archive_ribbon_slideshow":
    ArchiveRibbonSlideshow,

  "08_reveal_question":
    RevealQuestion,

  "10_red_grid_archive_background":
    RedGridArchiveBackground,

  "15_quote_only":
    QuoteOnly,

  "21_royal_archive_slideshow":
    RoyalArchiveSlideshow,
};

export const EARLIER_PRESET_ORDER = [
  {
    order: 1,
    id: "01_classic_blue_white_lower_third",
    name: "Classic Blue White Lower Third",
  },
  {
    order: 2,
    id: "02_secondary_blue_lower_third",
    name: "Secondary Blue Lower Third",
  },
  {
    order: 3,
    id: "04_glass_gallery_slideshow",
    name: "Glass Gallery Slideshow",
  },
  {
    order: 4,
    id: "05_archive_ribbon_slideshow",
    name: "Archive Ribbon Slideshow",
  },
  {
    order: 5,
    id: "21_royal_archive_slideshow",
    name: "Royal Archive Slideshow",
  },
  {
    order: 6,
    id: "10_red_grid_archive_background",
    name: "Red Grid Archive Background",
  },
  {
    order: 7,
    id: "15_quote_only",
    name: "Quote Only",
  },
  {
    order: 8,
    id: "08_reveal_question",
    name: "Reveal Question",
  },
] as const;

export const EarlierPresetTimeline: React.FC<{
  events: EarlierTimelineEvent[];
}> = ({events}) => {
  const sorted =
    [...events].sort(
      (a, b) =>
        (a.layer ?? 10) -
          (b.layer ?? 10) ||
        a.startFrame -
          b.startFrame
    );

  return (
    <AbsoluteFill>
      {sorted.map(
        (event) => {
          const Component =
            earlierPresetRegistry[
              event.presetId
            ];

          return (
            <Sequence
              key={
                event.id
              }
              from={
                event.startFrame
              }
              durationInFrames={
                event.durationFrames
              }
              layout="none"
              name={`${event.presetId}:${event.id}`}
            >
              <Component
                {...event.props}
                durationFrames={
                  event.durationFrames
                }
              />
            </Sequence>
          );
        }
      )}
    </AbsoluteFill>
  );
};
