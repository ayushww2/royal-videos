import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import {
  productionPresetRegistry,
  type ProductionPresetId,
} from "./productionRegistry";
import {BlurFillImageEffect} from "./BlurFillImageEffect";

/**
 * Effects whose job is to DISPLAY / frame images (slideshows, grids, overlays on photos).
 * Text-only glitch cut is excluded.
 */
export const IMAGE_DISPLAY_EFFECTS: Array<{
  id: ProductionPresetId | "blur_fill_image";
  name: string;
  kind: "slideshow" | "comparison" | "grid" | "overlay_on_image" | "special";
}> = [
  {id: "04_glass_gallery_slideshow", name: "Glass Gallery Slideshow", kind: "slideshow"},
  {id: "24_soft_glass_focus_slideshow", name: "Soft Glass Focus Slideshow", kind: "slideshow"},
  {id: "25_clean_zoom_frame_slideshow", name: "Clean Zoom Frame Slideshow", kind: "slideshow"},
  {id: "26_minimal_blur_backdrop_slideshow", name: "Minimal Blur Backdrop Slideshow", kind: "slideshow"},
  {id: "05_archive_ribbon_slideshow", name: "Archive Ribbon Slideshow", kind: "slideshow"},
  {id: "21_royal_archive_slideshow", name: "Royal Archive Slideshow", kind: "slideshow"},
  {id: "06_cinematic_stage_slideshow", name: "Cinematic Stage Slideshow", kind: "slideshow"},
  {id: "28_crystal_stage_slideshow", name: "Crystal Stage Slideshow", kind: "slideshow"},
  {id: "27_editorial_soft_pan_slideshow", name: "Editorial Soft Pan Slideshow", kind: "slideshow"},
  {id: "07_split_comparison_slideshow", name: "Split Comparison Slideshow", kind: "comparison"},
  {id: "10_red_grid_archive_background", name: "Red Grid Archive Background", kind: "grid"},
  {id: "01_classic_blue_white_lower_third", name: "Classic Blue/White Lower Third", kind: "overlay_on_image"},
  {id: "02_secondary_blue_lower_third", name: "Secondary Blue Lower Third", kind: "overlay_on_image"},
  {id: "29_classic_purple_white_lower_third", name: "Classic Purple/White Lower Third", kind: "overlay_on_image"},
  {id: "03_simple_text_overlay", name: "Simple Text Overlay", kind: "overlay_on_image"},
  {id: "15_quote_only", name: "Quote Only (on image)", kind: "overlay_on_image"},
  {id: "08_reveal_question", name: "Reveal Question (on image)", kind: "overlay_on_image"},
  {id: "blur_fill_image", name: "Blur Fill Image", kind: "special"},
];

export const IMAGE_DISPLAY_EFFECT_COUNT = IMAGE_DISPLAY_EFFECTS.length;

/** Unique stills — one primary image per effect preview. */
const PREVIEW_IMAGES = [
  "william-promise/media/line-01-image.jpg",
  "william-promise/media/line-03-image.jpg",
  "william-promise/media/line-04-image.jpg",
  "william-promise/media/line-05-image.jpg",
  "william-promise/media/line-07-image.jpg",
  "william-promise/media/line-09-image.jpg",
  "william-promise/media/line-10-image.jpg",
  "william-promise/media/line-11-image.jpg",
  "william-promise/media/line-12-image.jpg",
  "william-promise/media/line-15-image.jpg",
  "william-promise/media/line-16-image.jpg",
  "william-promise/media/line-17-image.jpg",
  "william-promise/media/line-18-image.jpg",
  "william-promise/media/line-20-image.jpg",
  "william-promise/media/line-23-image.jpg",
  "intro/shot1.jpg",
  "intro/shot3.jpg",
  "intro/shot5.jpg",
  "demo/statue.png",
  "demo/roadblock.png",
  "demo/research.png",
] as const;

function img(i: number): string {
  return staticFile(PREVIEW_IMAGES[i % PREVIEW_IMAGES.length]);
}

function slidePack(primary: string, a: string, b: string) {
  return [
    {src: primary, kicker: "ARCHIVE", caption: "Primary visual hold", focus: {x: 0.5, y: 0.45}},
    {src: a, kicker: "FRAME 02", caption: "Supporting still", focus: {x: 0.52, y: 0.48}},
    {src: b, kicker: "FRAME 03", caption: "Context still", focus: {x: 0.48, y: 0.5}},
  ];
}

function propsFor(
  id: string,
  holdFrames: number,
  imageIndex: number
): Record<string, unknown> {
  const primary = img(imageIndex);
  const secondary = img(imageIndex + 3);
  const tertiary = img(imageIndex + 6);
  const slides = slidePack(primary, secondary, tertiary);
  const per = Math.max(20, Math.round(holdFrames / 3));

  switch (id) {
    case "01_classic_blue_white_lower_third":
      return {
        primaryText: "PRINCE WILLIAM",
        secondaryText: "HEIR TO THE THRONE",
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "02_secondary_blue_lower_third":
      return {
        primaryText: "THE PRIVATE BOUNDARY",
        secondaryText: "ROYAL HOUSEHOLD",
        tagText: "CONFIDENTIAL",
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "29_classic_purple_white_lower_third":
      return {
        primaryText: "QUEEN CAMILLA",
        secondaryText: "FUTURE AFTER SUCCESSION",
        locationTag: "LONDON",
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "03_simple_text_overlay":
      return {
        text: "PALACE DECISION",
        secondaryText: "What survives the reign",
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "15_quote_only":
      return {
        quote: "One king can reward loyalty — he cannot command the next reign.",
        attribution: "— Royal documentary",
        context: "SUCCESSION",
        backgroundImage: primary,
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "08_reveal_question":
      return {
        question: "WHO CONTROLS THE HOUSEHOLD?",
        subtext: "After Charles is gone",
        backgroundImage: primary,
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "07_split_comparison_slideshow":
      return {
        leftImageSrc: primary,
        rightImageSrc: secondary,
        leftLabel: "THEN",
        rightLabel: "NOW",
        leftTarget: {x: 0.5, y: 0.4, width: 0.3, height: 0.35},
        rightTarget: {x: 0.5, y: 0.4, width: 0.3, height: 0.35},
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "10_red_grid_archive_background":
      return {
        mainImage: primary,
        sideImages: [secondary, tertiary],
        title: "ROYAL ARCHIVE",
        subtitle: "Image display grid",
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    default:
      return {
        slides,
        durationPerSlide: per,
        defaultSlideFrames: per,
        transitionFrames: 14,
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
  }
}

const OVERLAY_NEEDS_BG = new Set([
  "01_classic_blue_white_lower_third",
  "02_secondary_blue_lower_third",
  "03_simple_text_overlay",
  "29_classic_purple_white_lower_third",
]);

const NameBanner: React.FC<{
  order: number;
  total: number;
  name: string;
  id: string;
  kind: string;
}> = ({order, total, name, id, kind}) => (
  <>
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        padding: "20px 36px",
        background: "linear-gradient(180deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0) 100%)",
        zIndex: 999,
        pointerEvents: "none",
        display: "flex",
        gap: 16,
        alignItems: "baseline",
      }}
    >
      <span style={{color: "#ffd24a", fontWeight: 800, fontSize: 32, fontFamily: "Inter, Arial, sans-serif"}}>
        {order}/{total}
      </span>
      <span style={{color: "#fff", fontWeight: 800, fontSize: 40, fontFamily: "Inter, Arial, sans-serif"}}>
        {name}
      </span>
    </div>
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: 32,
        padding: "12px 20px",
        background: "rgba(0,0,0,0.85)",
        borderLeft: "6px solid #8ff0a4",
        zIndex: 999,
        pointerEvents: "none",
      }}
    >
      <div style={{fontFamily: "Consolas, monospace", fontSize: 26, color: "#8ff0a4"}}>{id}</div>
      <div style={{fontFamily: "Inter, Arial, sans-serif", fontSize: 18, color: "#c9d4e4", marginTop: 4, letterSpacing: 2}}>
        {kind.toUpperCase()} · IMAGE DISPLAY
      </div>
    </div>
  </>
);

export type ImageOverlayEffectsShowcaseProps = {
  /** Hold each effect (seconds). Default 3.5 */
  holdSec?: number;
};

export const IMAGE_OVERLAY_HOLD_DEFAULT = 3.5;

export const ImageOverlayEffectsShowcase: React.FC<ImageOverlayEffectsShowcaseProps> = ({
  holdSec = IMAGE_OVERLAY_HOLD_DEFAULT,
}) => {
  const {fps} = useVideoConfig();
  const holdFrames = Math.max(1, Math.round(holdSec * fps));
  const total = IMAGE_DISPLAY_EFFECTS.length;

  return (
    <AbsoluteFill style={{backgroundColor: "#05070b"}}>
      {IMAGE_DISPLAY_EFFECTS.map((entry, i) => {
        const from = i * holdFrames;
        const primary = img(i);

        if (entry.id === "blur_fill_image") {
          return (
            <Sequence key={entry.id} from={from} durationInFrames={holdFrames} layout="none">
              <AbsoluteFill>
                <BlurFillImageEffect imageSrc={primary} />
                <NameBanner
                  order={i + 1}
                  total={total}
                  name={entry.name}
                  id={entry.id}
                  kind={entry.kind}
                />
              </AbsoluteFill>
            </Sequence>
          );
        }

        const Component = productionPresetRegistry[entry.id];
        const props = propsFor(entry.id, holdFrames, i);
        const needsBg = OVERLAY_NEEDS_BG.has(entry.id);

        return (
          <Sequence key={entry.id} from={from} durationInFrames={holdFrames} layout="none">
            <AbsoluteFill style={{backgroundColor: "#05070b"}}>
              {needsBg ? (
                <Img src={primary} style={{width: "100%", height: "100%", objectFit: "cover"}} />
              ) : null}
              {Component ? <Component {...(props as any)} /> : null}
              <NameBanner
                order={i + 1}
                total={total}
                name={entry.name}
                id={entry.id}
                kind={entry.kind}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const IMAGE_OVERLAY_SHOWCASE_FRAMES = Math.round(
  IMAGE_OVERLAY_HOLD_DEFAULT * IMAGE_DISPLAY_EFFECT_COUNT * 30
);
