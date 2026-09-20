import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import {
  productionPresetRegistry,
  type ProductionPresetId,
} from "./productionRegistry";

const demo = {
  roadblock: staticFile("demo/roadblock.png"),
  statue: staticFile("demo/statue.png"),
  research: staticFile("demo/research.png"),
};

const demoSlides = [
  {
    src: demo.roadblock,
    kicker: "FIELD RECORD",
    caption: "The road was closed before sunrise.",
    focus: { x: 0.5, y: 0.52 },
  },
  {
    src: demo.statue,
    kicker: "DIVE FRAME 04",
    caption: "A structure emerged beneath the silt.",
    focus: { x: 0.52, y: 0.45 },
  },
  {
    src: demo.research,
    kicker: "EXPEDITION LOG",
    caption: "The team returned with new equipment.",
    focus: { x: 0.5, y: 0.5 },
  },
];

export type EffectCatalogStillProps = {
  presetId: ProductionPresetId;
};

const OVERLAY_PRESETS = new Set<string>([
  "01_classic_blue_white_lower_third",
  "02_secondary_blue_lower_third",
  "03_simple_text_overlay",
  "29_classic_purple_white_lower_third",
]);

function demoPropsFor(presetId: ProductionPresetId): Record<string, unknown> {
  switch (presetId) {
    case "01_classic_blue_white_lower_third":
      return {
        primaryText: "DR. ROBERT HAYES",
        secondaryText: "MARINE ARCHAEOLOGIST",
        durationFrames: 120,
        showPresetLabel: false,
      };
    case "02_secondary_blue_lower_third":
      return {
        primaryText: "THE HIDDEN CHAMBER",
        secondaryText: "FIELD INVESTIGATION",
        durationFrames: 120,
        showPresetLabel: false,
      };
    case "03_simple_text_overlay":
      return {
        text: "FIELD INVESTIGATION",
        secondaryText: "The restricted search area",
        durationFrames: 120,
        showPresetLabel: false,
      };
    case "29_classic_purple_white_lower_third":
      return {
        primaryText: "HIDDEN ROYAL SECRET",
        durationFrames: 120,
        position: "bottom_left",
        showPresetLabel: false,
      };
    case "15_quote_only":
      return {
        quote: "The truth was buried beneath the silt.",
        attribution: "— Field Journal, 1974",
        context: "EXPEDITION LOG",
        backgroundImage: demo.statue,
        durationFrames: 120,
        showPresetLabel: false,
      };
    case "08_reveal_question":
      return {
        question: "WHO CLOSED THE AREA?",
        subtext: "And what were they trying to hide?",
        backgroundImage: demo.roadblock,
        durationFrames: 120,
        showPresetLabel: false,
      };
    case "09_glitch_cut_transition":
      return {
        fromImageSrc: demo.roadblock,
        toImageSrc: demo.statue,
        durationFrames: 36,
        showPresetLabel: false,
      };
    case "07_split_comparison_slideshow":
      return {
        leftImageSrc: demo.statue,
        rightImageSrc: demo.research,
        leftLabel: "SUBMERGED DISCOVERY",
        rightLabel: "EXPEDITION RECORD",
        leftTarget: { x: 0.53, y: 0.42, width: 0.24, height: 0.28 },
        rightTarget: { x: 0.52, y: 0.38, width: 0.24, height: 0.24 },
        showPresetLabel: false,
      };
    case "10_red_grid_archive_background":
      return {
        mainImage: demo.statue,
        sideImages: [demo.roadblock, demo.research],
        title: "FIELD INVESTIGATION",
        subtitle: "Archive comparison sequence",
        durationFrames: 150,
        showPresetLabel: false,
      };
    case "04_glass_gallery_slideshow":
    case "05_archive_ribbon_slideshow":
    case "06_cinematic_stage_slideshow":
    case "21_royal_archive_slideshow":
    case "24_soft_glass_focus_slideshow":
    case "25_clean_zoom_frame_slideshow":
    case "26_minimal_blur_backdrop_slideshow":
    case "27_editorial_soft_pan_slideshow":
    case "28_crystal_stage_slideshow":
      return {
        slides: demoSlides,
        durationPerSlide: 105,
        defaultSlideFrames: 105,
        transitionFrames: 18,
        showPresetLabel: false,
      };
    default:
      return { showPresetLabel: false };
  }
}

/**
 * Single-preset still for contact-sheet reference PNGs.
 * Render mid-frame so intro animations have settled.
 */
export const EffectCatalogStill: React.FC<EffectCatalogStillProps> = ({
  presetId,
}) => {
  const Component = productionPresetRegistry[presetId];
  if (!Component) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#111",
          color: "#fff",
          justifyContent: "center",
          alignItems: "center",
          fontFamily: "Inter, Arial, sans-serif",
          fontSize: 32,
        }}
      >
        Unknown preset: {presetId}
      </AbsoluteFill>
    );
  }

  const props = demoPropsFor(presetId);
  const needsBg = OVERLAY_PRESETS.has(presetId);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0c10" }}>
      {needsBg ? (
        <Img
          src={demo.roadblock}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}
      <Component {...props} />
    </AbsoluteFill>
  );
};
