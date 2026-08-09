import React from "react";
import { AbsoluteFill, Img, Sequence, staticFile, useVideoConfig } from "remotion";
import {
  productionPresetRegistry,
  PRODUCTION_PRESET_ORDER,
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

/** Presets that are transparent overlays and need a photo underneath to read. */
const OVERLAY_PRESETS = new Set<string>([
  "01_classic_blue_white_lower_third",
  "02_secondary_blue_lower_third",
  "03_simple_text_overlay",
  "29_classic_purple_white_lower_third",
]);

const LOWER_THIRDS = new Set<string>([
  "01_classic_blue_white_lower_third",
  "02_secondary_blue_lower_third",
  "29_classic_purple_white_lower_third",
  "03_simple_text_overlay",
]);

function categoryOf(presetId: string): string {
  if (LOWER_THIRDS.has(presetId)) return "LOWER THIRD / TEXT";
  if (/slideshow/.test(presetId)) return "SLIDESHOW";
  if (presetId === "08_reveal_question") return "QUESTION REVEAL";
  if (presetId === "15_quote_only") return "QUOTE";
  if (presetId === "09_glitch_cut_transition") return "TRANSITION";
  if (presetId === "10_red_grid_archive_background") return "BACKGROUND GRID";
  return "EFFECT";
}

function demoPropsFor(presetId: string, holdFrames: number): Record<string, unknown> {
  switch (presetId) {
    case "01_classic_blue_white_lower_third":
      return {
        primaryText: "DR. ROBERT HAYES",
        secondaryText: "MARINE ARCHAEOLOGIST",
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "02_secondary_blue_lower_third":
      return {
        primaryText: "THE HIDDEN CHAMBER",
        secondaryText: "FIELD INVESTIGATION",
        tagText: "EVIDENCE",
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "03_simple_text_overlay":
      return {
        text: "FIELD INVESTIGATION",
        secondaryText: "The restricted search area",
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "29_classic_purple_white_lower_third":
      return {
        primaryText: "QUEEN ELIZABETH II",
        secondaryText: "CORONATION ARCHIVE",
        locationTag: "LONDON",
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "15_quote_only":
      return {
        quote: "The truth was buried beneath the silt.",
        attribution: "— Field Journal, 1974",
        context: "EXPEDITION LOG",
        backgroundImage: demo.statue,
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "08_reveal_question":
      return {
        question: "WHO CLOSED THE AREA?",
        subtext: "And what were they trying to hide?",
        backgroundImage: demo.roadblock,
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "09_glitch_cut_transition":
      return {
        fromImageSrc: demo.roadblock,
        toImageSrc: demo.statue,
        durationFrames: holdFrames,
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
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    case "10_red_grid_archive_background":
      return {
        mainImage: demo.statue,
        sideImages: [demo.roadblock, demo.research],
        title: "FIELD INVESTIGATION",
        subtitle: "Archive comparison sequence",
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
    default:
      return {
        slides: demoSlides,
        durationPerSlide: Math.round(holdFrames / 3),
        defaultSlideFrames: Math.round(holdFrames / 3),
        transitionFrames: 18,
        durationFrames: holdFrames,
        showPresetLabel: false,
      };
  }
}

/** Burned-in name card so every clip is self-identifying on playback. */
const NameCard: React.FC<{
  order: number;
  total: number;
  presetId: string;
  name: string;
}> = ({ order, total, presetId, name }) => (
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
        gap: 20,
        zIndex: 999,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          fontFamily: "Inter, Arial, sans-serif",
          fontSize: 34,
          fontWeight: 800,
          color: "#ffd24a",
          letterSpacing: 1,
        }}
      >
        {order}/{total}
      </span>
      <span
        style={{
          fontFamily: "Inter, Arial, sans-serif",
          fontSize: 46,
          fontWeight: 800,
          color: "#fff",
          letterSpacing: 0.5,
          textShadow: "0 2px 10px rgba(0,0,0,0.9)",
        }}
      >
        {name}
      </span>
    </div>
    <div
      style={{
        position: "absolute",
        bottom: 28,
        left: 40,
        padding: "12px 22px",
        background: "rgba(0,0,0,0.82)",
        borderLeft: "6px solid #ffd24a",
        zIndex: 999,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: "Consolas, monospace",
          fontSize: 30,
          color: "#8ff0a4",
          letterSpacing: 0.5,
        }}
      >
        {presetId}
      </div>
      <div
        style={{
          fontFamily: "Inter, Arial, sans-serif",
          fontSize: 22,
          color: "#c9d4e4",
          marginTop: 4,
          letterSpacing: 2,
        }}
      >
        {categoryOf(presetId)}
      </div>
    </div>
  </>
);

export type EffectCatalogAllProps = {
  /** Seconds each preset is held on screen. */
  holdSec?: number;
};

/**
 * Plays every production preset back-to-back with its name and presetId burned
 * on screen, so the catalog can be reviewed in one pass and referred to by name.
 */
export const EffectCatalogAll: React.FC<EffectCatalogAllProps> = ({ holdSec = 4 }) => {
  const { fps } = useVideoConfig();
  const holdFrames = Math.max(1, Math.round(holdSec * fps));
  const total = PRODUCTION_PRESET_ORDER.length;

  return (
    <AbsoluteFill style={{ backgroundColor: "#05070b" }}>
      {PRODUCTION_PRESET_ORDER.map((entry, i) => {
        const Component = productionPresetRegistry[entry.id];
        const props = demoPropsFor(entry.id, holdFrames);
        const needsBg = OVERLAY_PRESETS.has(entry.id);
        return (
          <Sequence
            key={entry.id}
            from={i * holdFrames}
            durationInFrames={holdFrames}
            layout="none"
          >
            <AbsoluteFill style={{ backgroundColor: "#05070b" }}>
              {needsBg ? (
                <Img
                  src={demo.roadblock}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}
              {Component ? (
                <Component {...(props as any)} />
              ) : (
                <AbsoluteFill
                  style={{
                    justifyContent: "center",
                    alignItems: "center",
                    color: "#ff6b6b",
                    fontFamily: "Inter, Arial, sans-serif",
                    fontSize: 40,
                  }}
                >
                  Missing preset: {entry.id}
                </AbsoluteFill>
              )}
              <NameCard
                order={entry.order}
                total={total}
                presetId={entry.id}
                name={entry.name}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const EFFECT_CATALOG_COUNT = PRODUCTION_PRESET_ORDER.length;
