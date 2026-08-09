import React from "react";
import { AbsoluteFill, Sequence } from "remotion";

import {
  selectedPresetRegistry,
  normalizeSelectedEventProps,
  validateSelectedEvent,
  type SelectedPresetId as LegacySelectedPresetId,
  type SelectedTimelineEvent as LegacySelectedTimelineEvent,
} from "./selected/SelectedVisualPack";
import {
  earlierPresetRegistry,
  type EarlierPresetId,
} from "./earlier/EarlierEffectsPack";
import {
  cleanPresetRegistry,
  type CleanPresetId,
} from "./finalClean/FinalCleanPresets";

/**
 * Production Remotion presets for DocumentaryEdit.
 * Earlier pack upgrades shared IDs; selected pack keeps split/glitch/cinematic;
 * final-clean pack adds soft glass / zoom / purple lower third.
 */
export type ProductionPresetId =
  | LegacySelectedPresetId
  | EarlierPresetId
  | CleanPresetId;

export type ProductionTimelineEvent = {
  id: string;
  presetId: ProductionPresetId;
  startFrame: number;
  durationFrames: number;
  layer?: number;
  tags?: string[];
  props: Record<string, unknown>;
};

export const productionPresetRegistry: Record<
  string,
  React.ComponentType<any>
> = {
  ...selectedPresetRegistry,
  // Earlier pack wins for upgraded shared designs + new quote/royal archive.
  ...earlierPresetRegistry,
  ...cleanPresetRegistry,
  // Mystery finalize: text-fitting classic blue LT (selected pack outline style).
  "01_classic_blue_white_lower_third":
    selectedPresetRegistry["01_classic_blue_white_lower_third"],
};

export const PRODUCTION_PRESET_ORDER = [
  { order: 1, id: "01_classic_blue_white_lower_third", name: "Classic Blue/White Lower Third" },
  { order: 2, id: "02_secondary_blue_lower_third", name: "Secondary Blue Lower Third" },
  { order: 3, id: "29_classic_purple_white_lower_third", name: "Classic Purple/White Lower Third" },
  { order: 4, id: "03_simple_text_overlay", name: "Simple Text Overlay" },
  { order: 5, id: "04_glass_gallery_slideshow", name: "Glass Gallery Slideshow" },
  { order: 6, id: "24_soft_glass_focus_slideshow", name: "Soft Glass Focus Slideshow" },
  { order: 7, id: "25_clean_zoom_frame_slideshow", name: "Clean Zoom Frame Slideshow" },
  { order: 8, id: "26_minimal_blur_backdrop_slideshow", name: "Minimal Blur Backdrop Slideshow" },
  { order: 9, id: "05_archive_ribbon_slideshow", name: "Archive Ribbon Slideshow" },
  { order: 10, id: "21_royal_archive_slideshow", name: "Royal Archive Slideshow" },
  { order: 11, id: "06_cinematic_stage_slideshow", name: "Cinematic Stage Slideshow" },
  { order: 12, id: "28_crystal_stage_slideshow", name: "Crystal Stage Slideshow" },
  { order: 13, id: "07_split_comparison_slideshow", name: "Split Comparison Slideshow" },
  { order: 14, id: "10_red_grid_archive_background", name: "Red Grid Archive Background" },
  { order: 15, id: "15_quote_only", name: "Quote Only" },
  { order: 16, id: "08_reveal_question", name: "Reveal Question" },
  { order: 17, id: "09_glitch_cut_transition", name: "Glitch Cut Transition" },
  { order: 18, id: "27_editorial_soft_pan_slideshow", name: "Editorial Soft Pan Slideshow" },
] as const;

function normalizeProductionProps(
  presetId: ProductionPresetId,
  props: Record<string, unknown>
): Record<string, unknown> {
  if (presetId in selectedPresetRegistry) {
    return normalizeSelectedEventProps(
      presetId as LegacySelectedPresetId,
      props
    );
  }
  const next: Record<string, unknown> = { ...props, showPresetLabel: false };
  if (Array.isArray(next.slides)) {
    next.slides = (next.slides as Array<Record<string, unknown>>).map((slide) => {
      const focusX =
        typeof (slide.focus as { x?: number } | undefined)?.x === "number"
          ? (slide.focus as { x: number }).x
          : typeof slide.focusX === "number"
            ? slide.focusX
            : 0.5;
      const focusY =
        typeof (slide.focus as { y?: number } | undefined)?.y === "number"
          ? (slide.focus as { y: number }).y
          : typeof slide.focusY === "number"
            ? slide.focusY
            : 0.5;
      return {
        ...slide,
        focus: { x: focusX, y: focusY },
        focusX,
        focusY,
        showPresetLabel: false,
      };
    });
  }
  if (presetId === "08_reveal_question") {
    if (!next.question && next.primaryText) next.question = next.primaryText;
    if (!next.primaryText && next.question) next.primaryText = next.question;
    if (!next.backgroundImage && next.imageSrc) next.backgroundImage = next.imageSrc;
    if (!next.imageSrc && next.backgroundImage) next.imageSrc = next.backgroundImage;
  }
  if (presetId === "15_quote_only" && !next.quote && next.text) {
    next.quote = next.text;
  }
  if (presetId === "29_classic_purple_white_lower_third") {
    if (!next.locationTag && next.tagText) next.locationTag = next.tagText;
    if (!next.tagText && next.locationTag) next.tagText = next.locationTag;
  }
  return next;
}

export function validateProductionEvent(event: ProductionTimelineEvent): string[] {
  if (event.presetId in selectedPresetRegistry) {
    return validateSelectedEvent(event as LegacySelectedTimelineEvent);
  }
  const errors: string[] = [];
  if (!event.id) errors.push("Missing event.id");
  if (!productionPresetRegistry[event.presetId]) {
    errors.push(`Unsupported presetId: ${event.presetId}`);
    return errors;
  }
  if (!Number.isFinite(event.startFrame) || event.startFrame < 0) {
    errors.push("startFrame must be a non-negative number");
  }
  if (!Number.isFinite(event.durationFrames) || event.durationFrames <= 0) {
    errors.push("durationFrames must be greater than zero");
  }
  const p = event.props || {};
  switch (event.presetId) {
    case "15_quote_only":
      if (!String(p.quote || p.text || "").trim()) errors.push("Missing quote");
      break;
    case "21_royal_archive_slideshow":
    case "24_soft_glass_focus_slideshow":
    case "25_clean_zoom_frame_slideshow":
    case "26_minimal_blur_backdrop_slideshow":
    case "27_editorial_soft_pan_slideshow":
    case "28_crystal_stage_slideshow": {
      const slides = p.slides as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(slides) || slides.length < 1) errors.push("Missing slides");
      else {
        slides.forEach((s, i) => {
          if (!String(s.src || "").trim()) errors.push(`slides[${i}] missing image src`);
        });
      }
      break;
    }
    case "29_classic_purple_white_lower_third":
      if (!String(p.primaryText || "").trim()) errors.push("Missing primaryText");
      break;
    default:
      break;
  }
  return errors;
}

export const ProductionTimelineRenderer: React.FC<{
  events: ProductionTimelineEvent[];
}> = ({ events }) => {
  const sorted = [...events].sort(
    (a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.startFrame - b.startFrame
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      {sorted.map((event) => {
        const Component = productionPresetRegistry[event.presetId];
        if (!Component) return null;
        const props = normalizeProductionProps(event.presetId, event.props || {});
        return (
          <Sequence
            key={event.id}
            from={event.startFrame}
            durationInFrames={Math.max(1, event.durationFrames)}
            layout="none"
          >
            <Component {...props} durationFrames={event.durationFrames} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
