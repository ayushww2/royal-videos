import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";

export type FocusPoint = { x: number; y: number };

export type SlideItem = {
  src: string;
  caption?: string;
  kicker?: string;
  focus?: FocusPoint;
  focusX?: number;
  focusY?: number;
};

export type SlideshowProps = {
  slides: SlideItem[];
  durationPerSlide?: number;
  transitionFrames?: number;
  showPresetLabel?: boolean;
  accentColor?: string;
};

export type LowerThirdProps = {
  primaryText: string;
  secondaryText: string;
  locationTag?: string;
  showPresetLabel?: boolean;
};

export type CleanPresetId =
  | "24_soft_glass_focus_slideshow"
  | "25_clean_zoom_frame_slideshow"
  | "26_minimal_blur_backdrop_slideshow"
  | "27_editorial_soft_pan_slideshow"
  | "28_crystal_stage_slideshow"
  | "29_classic_purple_white_lower_third";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const normalizeFocus = (slide: SlideItem): FocusPoint => ({
  x: clamp01(slide.focus?.x ?? slide.focusX ?? 0.5),
  y: clamp01(slide.focus?.y ?? slide.focusY ?? 0.5),
});

const FillImage: React.FC<{
  src: string;
  focus?: FocusPoint;
  scale?: number;
  opacity?: number;
  filter?: string;
  transform?: string;
}> = ({ src, focus = { x: 0.5, y: 0.5 }, scale = 1, opacity = 1, filter = "none", transform }) => (
  <Img
    src={src}
    style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: `${focus.x * 100}% ${focus.y * 100}%`,
      transform: transform ?? `scale(${scale})`,
      opacity,
      filter,
    }}
  />
);

const PresetLabel: React.FC<{
  number: string;
  name: string;
  accent: string;
}> = ({ number, name, accent }) => (
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
      background: "rgba(0,0,0,0.60)",
      borderLeft: `5px solid ${accent}`,
      color: "white",
      fontFamily: "Inter, Arial, sans-serif",
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

const vignette: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  background:
    "radial-gradient(circle at center, transparent 0%, transparent 62%, rgba(0,0,0,0.42) 100%)",
};

const getSlideState = (
  slides: SlideItem[],
  durationPerSlide: number,
  transitionFrames: number,
  frame: number
) => {
  const safeSlides = slides.length ? slides : [{ src: "" }];
  // Single-slide hold: no slide swap, no progressive zoom — avoids double-transition with base Ken Burns.
  if (safeSlides.length <= 1) {
    return {
      index: 0,
      nextIndex: 0,
      localFrame: frame,
      current: safeSlides[0],
      next: safeSlides[0],
      slideProgress: 0,
      transitionProgress: 0,
      holdStill: true as const,
    };
  }
  const tf = Math.max(1, Math.floor(transitionFrames) || 1);
  const stride = Math.max(tf + 1, durationPerSlide - tf);
  const index = Math.floor(frame / stride) % safeSlides.length;
  const nextIndex = (index + 1) % safeSlides.length;
  const localFrame = frame % stride;
  const slideProgress = clamp01(localFrame / stride);
  const transitionStart = stride - tf;
  const transitionProgress =
    tf <= 0 || transitionStart >= stride
      ? 0
      : clamp01(
          interpolate(localFrame, [transitionStart, stride], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        );

  return {
    index,
    nextIndex,
    localFrame,
    current: safeSlides[index],
    next: safeSlides[nextIndex],
    slideProgress,
    transitionProgress,
    holdStill: false as const,
  };
};

export const SoftGlassFocusSlideshow: React.FC<SlideshowProps> = ({
  slides,
  durationPerSlide = 105,
  transitionFrames = 18,
  showPresetLabel = false,
  accentColor = "#C7CFFB",
}) => {
  const frame = useCurrentFrame();
  const s = getSlideState(slides, durationPerSlide, transitionFrames, frame);
  const currentFocus = normalizeFocus(s.current);
  const nextFocus = normalizeFocus(s.next);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0C1220", overflow: "hidden" }}>
      <FillImage
        src={s.current.src}
        focus={currentFocus}
        scale={1.14}
        filter="blur(24px) brightness(0.34) saturate(0.84)"
      />

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 32%, rgba(255,255,255,0.10), transparent 42%), linear-gradient(180deg, rgba(255,255,255,0.05), transparent 26%, transparent 74%, rgba(0,0,0,0.06))",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: "9%",
          top: "9%",
          width: "82%",
          height: "76%",
          borderRadius: 28,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.24)",
          background: "rgba(255,255,255,0.07)",
          boxShadow: "0 24px 70px rgba(0,0,0,0.36)",
          backdropFilter: "blur(16px)",
        }}
      >
        <FillImage
          src={s.current.src}
          focus={currentFocus}
          scale={1.02 + s.slideProgress * 0.06}
          opacity={1 - s.transitionProgress}
          filter="contrast(1.03) saturate(0.97)"
        />
        <div style={{ position: "absolute", inset: 0 }}>
          <FillImage
            src={s.next.src}
            focus={nextFocus}
            transform={`translateY(${(1 - s.transitionProgress) * 4}%) scale(${1.05 - s.transitionProgress * 0.02})`}
            opacity={s.transitionProgress}
            filter="contrast(1.03) saturate(0.97)"
          />
        </div>

        <div
          style={{
            position: "absolute",
            top: -160,
            left: -120 + (frame % 120) * 6,
            width: 160,
            height: "160%",
            transform: "rotate(18deg)",
            background:
              "linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.22) 48%, transparent 100%)",
            mixBlendMode: "screen",
            opacity: 0.55,
          }}
        />
      </div>

      {s.current.caption ? (
        <div
          style={{
            position: "absolute",
            left: "11%",
            bottom: "8.5%",
            color: "white",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 850,
            fontSize: 24,
            maxWidth: "76%",
            textShadow: "0 6px 20px rgba(0,0,0,0.55)",
          }}
        >
          {s.current.caption}
        </div>
      ) : null}

      {showPresetLabel ? (
        <PresetLabel number="24" name="Soft Glass Focus" accent={accentColor} />
      ) : null}
      <div style={vignette} />
    </AbsoluteFill>
  );
};

export const CleanZoomFrameSlideshow: React.FC<SlideshowProps> = ({
  slides,
  durationPerSlide = 105,
  transitionFrames = 18,
  showPresetLabel = false,
  accentColor = "#D4DBFF",
}) => {
  const frame = useCurrentFrame();
  const s = getSlideState(slides, durationPerSlide, transitionFrames, frame);

  return (
    <AbsoluteFill style={{ backgroundColor: "#101319", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(circle at 50% 36%, rgba(255,255,255,0.08), transparent 45%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "8%",
          top: "10%",
          width: "84%",
          height: "74%",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.18)",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.34)",
        }}
      >
        <FillImage
          src={s.current.src}
          focus={normalizeFocus(s.current)}
          scale={1.0 + s.slideProgress * 0.08}
          opacity={1 - s.transitionProgress}
          filter="contrast(1.03) saturate(0.98)"
        />
        <div style={{ position: "absolute", inset: 0 }}>
          <FillImage
            src={s.next.src}
            focus={normalizeFocus(s.next)}
            scale={1.08 - s.transitionProgress * 0.04}
            opacity={s.transitionProgress}
            filter="contrast(1.03) saturate(0.98)"
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: "8%",
          top: "10%",
          width: "84%",
          height: "74%",
          border: "3px solid rgba(255,255,255,0.14)",
          pointerEvents: "none",
        }}
      />

      {s.current.kicker ? (
        <div
          style={{
            position: "absolute",
            left: "8%",
            top: "86.4%",
            color: "rgba(255,255,255,0.84)",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 900,
            fontSize: 14,
            letterSpacing: 1.8,
            textTransform: "uppercase",
          }}
        >
          {s.current.kicker}
        </div>
      ) : null}

      {s.current.caption ? (
        <div
          style={{
            position: "absolute",
            left: "8%",
            top: "89.3%",
            color: "white",
            fontFamily: "Georgia, serif",
            fontWeight: 700,
            fontSize: 28,
            maxWidth: "84%",
          }}
        >
          {s.current.caption}
        </div>
      ) : null}

      {showPresetLabel ? (
        <PresetLabel number="25" name="Clean Zoom Frame" accent={accentColor} />
      ) : null}
      <div style={vignette} />
    </AbsoluteFill>
  );
};

export const MinimalBlurBackdropSlideshow: React.FC<SlideshowProps> = ({
  slides,
  durationPerSlide = 105,
  transitionFrames = 18,
  showPresetLabel = false,
  accentColor = "#D7DCFF",
}) => {
  const frame = useCurrentFrame();
  const s = getSlideState(slides, durationPerSlide, transitionFrames, frame);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0F1116", overflow: "hidden" }}>
      <FillImage
        src={s.current.src}
        focus={normalizeFocus(s.current)}
        scale={1.12}
        filter="blur(22px) brightness(0.30) saturate(0.74)"
      />

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 22%, transparent 78%, rgba(0,0,0,0.05))",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: "14%",
          top: "11%",
          width: "72%",
          height: "72%",
          overflow: "hidden",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.18)",
          boxShadow: "0 18px 46px rgba(0,0,0,0.32)",
        }}
      >
        <FillImage
          src={s.current.src}
          focus={normalizeFocus(s.current)}
          scale={1.01 + s.slideProgress * 0.045}
          opacity={1 - s.transitionProgress}
        />
        <div style={{ position: "absolute", inset: 0 }}>
          <FillImage
            src={s.next.src}
            focus={normalizeFocus(s.next)}
            transform={`translateX(${(1 - s.transitionProgress) * 3}%) scale(1.03)`}
            opacity={s.transitionProgress}
          />
        </div>
      </div>

      {s.current.caption ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "9.2%",
            transform: "translateX(-50%)",
            maxWidth: "72%",
            color: "white",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 800,
            fontSize: 24,
            textAlign: "center",
            textShadow: "0 6px 20px rgba(0,0,0,0.55)",
          }}
        >
          {s.current.caption}
        </div>
      ) : null}

      {showPresetLabel ? (
        <PresetLabel number="26" name="Minimal Blur Backdrop" accent={accentColor} />
      ) : null}
      <div style={vignette} />
    </AbsoluteFill>
  );
};

export const EditorialSoftPanSlideshow: React.FC<SlideshowProps> = ({
  slides,
  durationPerSlide = 105,
  transitionFrames = 18,
  showPresetLabel = false,
  accentColor = "#D8DFFF",
}) => {
  const frame = useCurrentFrame();
  const s = getSlideState(slides, durationPerSlide, transitionFrames, frame);
  const panOffset = interpolate(s.slideProgress, [0, 1], [-2.5, 2.5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#121417", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: "7%",
          top: "8%",
          width: "86%",
          height: "80%",
          overflow: "hidden",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <FillImage
          src={s.current.src}
          focus={normalizeFocus(s.current)}
          transform={`translateX(${panOffset}%) scale(1.05)`}
          opacity={1 - s.transitionProgress}
          filter="contrast(1.03) saturate(0.98)"
        />
        <div style={{ position: "absolute", inset: 0 }}>
          <FillImage
            src={s.next.src}
            focus={normalizeFocus(s.next)}
            transform={`translateX(${6 - s.transitionProgress * 6}%) scale(1.05)`}
            opacity={s.transitionProgress}
            filter="contrast(1.03) saturate(0.98)"
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: "7%",
          right: "7%",
          top: "8%",
          height: 4,
          background: "rgba(255,255,255,0.82)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "7%",
          top: "8%",
          bottom: "12%",
          width: 4,
          background: "rgba(255,255,255,0.82)",
        }}
      />

      {s.current.kicker ? (
        <div
          style={{
            position: "absolute",
            left: "7%",
            bottom: "8.4%",
            color: "rgba(255,255,255,0.62)",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 900,
            fontSize: 13,
            letterSpacing: 1.8,
            textTransform: "uppercase",
          }}
        >
          {s.current.kicker}
        </div>
      ) : null}

      {s.current.caption ? (
        <div
          style={{
            position: "absolute",
            left: "7%",
            bottom: "4.2%",
            color: "white",
            fontFamily: "Georgia, serif",
            fontWeight: 700,
            fontSize: 28,
            maxWidth: "82%",
          }}
        >
          {s.current.caption}
        </div>
      ) : null}

      {showPresetLabel ? (
        <PresetLabel number="27" name="Editorial Soft Pan" accent={accentColor} />
      ) : null}
      <div style={vignette} />
    </AbsoluteFill>
  );
};

export const CrystalStageSlideshow: React.FC<SlideshowProps> = ({
  slides,
  durationPerSlide = 105,
  transitionFrames = 18,
  showPresetLabel = false,
  accentColor = "#E3E6FF",
}) => {
  const frame = useCurrentFrame();
  const s = getSlideState(slides, durationPerSlide, transitionFrames, frame);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0D1422", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 34%, rgba(138,175,255,0.18), transparent 44%), linear-gradient(180deg, rgba(255,255,255,0.03), transparent 26%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: "12%",
          top: "12%",
          width: "76%",
          height: "68%",
          overflow: "hidden",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.18)",
          boxShadow: "0 26px 70px rgba(0,0,0,0.35)",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <FillImage
          src={s.current.src}
          focus={normalizeFocus(s.current)}
          scale={1.03 + s.slideProgress * 0.05}
          opacity={1 - s.transitionProgress}
          filter="contrast(1.04) saturate(0.99)"
        />
        <div style={{ position: "absolute", inset: 0 }}>
          <FillImage
            src={s.next.src}
            focus={normalizeFocus(s.next)}
            scale={1.06 - s.transitionProgress * 0.03}
            opacity={s.transitionProgress}
            filter="contrast(1.04) saturate(0.99)"
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: "12%",
          top: "12%",
          width: "76%",
          height: "68%",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.30)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "16%",
          bottom: "10%",
          width: "68%",
          height: 2,
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
        }}
      />

      {s.current.caption ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "7.6%",
            transform: "translateX(-50%)",
            color: "white",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 850,
            fontSize: 24,
            maxWidth: "70%",
            textAlign: "center",
            textShadow: "0 6px 20px rgba(0,0,0,0.52)",
          }}
        >
          {s.current.caption}
        </div>
      ) : null}

      {showPresetLabel ? (
        <PresetLabel number="28" name="Crystal Stage" accent={accentColor} />
      ) : null}
      <div style={vignette} />
    </AbsoluteFill>
  );
};

export const ClassicPurpleWhiteLowerThird: React.FC<LowerThirdProps> = ({
  primaryText,
  secondaryText,
  locationTag,
  showPresetLabel = false,
}) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 100 - (1 - enter) * 120,
          bottom: 64,
          width: 660,
          height: 150,
          opacity: enter,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 22,
            width: 560,
            height: 98,
            background: "linear-gradient(90deg, #5B2CB8 0%, #7441D7 100%)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.30)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 24,
            top: 42,
            color: "#FFFFFF",
            fontFamily: "Georgia, serif",
            fontWeight: 700,
            fontSize: 32,
            lineHeight: 1.05,
            textShadow: "2px 2px 0 rgba(0,0,0,0.55)",
            letterSpacing: 0.5,
            maxWidth: 500,
            textTransform: "uppercase",
          }}
        >
          {primaryText}
        </div>
        <div
          style={{
            position: "absolute",
            left: 24,
            top: 94,
            color: "#F1F1F1",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 800,
            fontSize: 20,
            lineHeight: 1,
            letterSpacing: 0.5,
            textTransform: "uppercase",
            textShadow: "1px 1px 0 rgba(0,0,0,0.55)",
          }}
        >
          {secondaryText}
        </div>

        <div
          style={{
            position: "absolute",
            left: 548,
            top: 72,
            width: 64,
            height: 54,
            borderLeft: "6px solid rgba(255,255,255,0.95)",
            borderBottom: "6px solid rgba(255,255,255,0.95)",
            opacity: 0.95,
          }}
        />

        {locationTag ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              padding: "7px 14px",
              background: "rgba(0,0,0,0.62)",
              color: "white",
              fontFamily: "Inter, Arial, sans-serif",
              fontWeight: 900,
              fontSize: 14,
              letterSpacing: 1.6,
              textTransform: "uppercase",
            }}
          >
            {locationTag}
          </div>
        ) : null}
      </div>

      {showPresetLabel ? (
        <PresetLabel number="29" name="Classic Purple Lower Third" accent="#8F6BF3" />
      ) : null}
    </AbsoluteFill>
  );
};

export const cleanPresetRegistry: Record<CleanPresetId, React.ComponentType<any>> = {
  "24_soft_glass_focus_slideshow": SoftGlassFocusSlideshow,
  "25_clean_zoom_frame_slideshow": CleanZoomFrameSlideshow,
  "26_minimal_blur_backdrop_slideshow": MinimalBlurBackdropSlideshow,
  "27_editorial_soft_pan_slideshow": EditorialSoftPanSlideshow,
  "28_crystal_stage_slideshow": CrystalStageSlideshow,
  "29_classic_purple_white_lower_third": ClassicPurpleWhiteLowerThird,
};

export const CLEAN_PRESET_ORDER = [
  { order: 1, id: "24_soft_glass_focus_slideshow", name: "Soft Glass Focus Slideshow" },
  { order: 2, id: "25_clean_zoom_frame_slideshow", name: "Clean Zoom Frame Slideshow" },
  { order: 3, id: "26_minimal_blur_backdrop_slideshow", name: "Minimal Blur Backdrop Slideshow" },
  { order: 4, id: "27_editorial_soft_pan_slideshow", name: "Editorial Soft Pan Slideshow" },
  { order: 5, id: "28_crystal_stage_slideshow", name: "Crystal Stage Slideshow" },
  { order: 6, id: "29_classic_purple_white_lower_third", name: "Classic Purple White Lower Third" },
] as const;

export type CleanTimelineEvent = {
  id: string;
  presetId: CleanPresetId;
  startFrame: number;
  durationFrames: number;
  layer?: number;
  props: Record<string, unknown>;
};

export const CleanPresetTimeline: React.FC<{
  events: CleanTimelineEvent[];
}> = ({ events }) => {
  const sorted = [...events].sort(
    (a, b) =>
      (a.layer ?? 10) - (b.layer ?? 10) || a.startFrame - b.startFrame
  );

  return (
    <AbsoluteFill>
      {sorted.map((event) => {
        const Component = cleanPresetRegistry[event.presetId];
        return (
          <Sequence
            key={event.id}
            from={event.startFrame}
            durationInFrames={event.durationFrames}
            layout="none"
            name={`${event.presetId}:${event.id}`}
          >
            <Component {...event.props} durationFrames={event.durationFrames} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
