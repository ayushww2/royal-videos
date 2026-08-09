/**
 * Load + merge Shotstack Mystery Documentary Pack v2 Final templates.
 */
import fs from "node:fs";
import path from "node:path";
import {
  normalizeMysteryEffect,
  normalizeMysteryTransition,
} from "./fxRecipe.js";

export const MYSTERY_PACK_ROOT = path.join(
  process.cwd(),
  "server/visualIntelligence/mysteryV2/shotstackPack"
);
export const MYSTERY_PACK_TEMPLATES_DIR = path.join(MYSTERY_PACK_ROOT, "templates");

export type MysteryPackPresetId =
  | "01_lower_third_blue_clean"
  | "02_question_ask_mystery"
  | "03_reveal_mystery"
  | "04_glass_slideshow_amber_zoom"
  | "05_glass_slideshow_crimson_carousel"
  | "06_glass_slideshow_midnight_wipe"
  | "07_glass_slideshow_violet_reveal"
  | "08_side_by_side_black_white_border"
  | "09_red_grid_white_lines_75_percent";

export type MysteryPackMergeField = { find: string; replace: string };

export type MysteryPackTemplate = {
  timeline: {
    background?: string;
    tracks: Array<{ clips: Array<Record<string, unknown>> }>;
  };
  output: Record<string, unknown>;
  merge: MysteryPackMergeField[];
};

export type MysteryPackPresetMeta = {
  id: MysteryPackPresetId;
  file: string;
  title: string;
  kind:
    | "lower_third"
    | "question"
    | "reveal"
    | "glass_slideshow"
    | "side_by_side"
    | "red_grid";
  durationSec: number;
  mergeKeys: string[];
  glass?: {
    imageCount: 3;
    holdSec: 3;
    frameWidth: 1550;
    frameHeight: 870;
  };
};

export const MYSTERY_PACK_PRESETS: MysteryPackPresetMeta[] = [
  {
    id: "01_lower_third_blue_clean",
    file: "01_lower_third_blue_clean.json",
    title: "Clean blue lower third",
    kind: "lower_third",
    durationSec: 5,
    mergeKeys: ["PRIMARY_TEXT", "BACKGROUND_IMAGE"],
  },
  {
    id: "02_question_ask_mystery",
    file: "02_question_ask_mystery.json",
    title: "Mystery question ask",
    kind: "question",
    durationSec: 5,
    mergeKeys: ["QUESTION", "SUBQUESTION", "BACKGROUND_IMAGE"],
  },
  {
    id: "03_reveal_mystery",
    file: "03_reveal_mystery.json",
    title: "Mystery reveal",
    kind: "reveal",
    durationSec: 4.5,
    mergeKeys: ["REVEAL_TEXT", "BACKGROUND_IMAGE"],
  },
  {
    id: "04_glass_slideshow_amber_zoom",
    file: "04_glass_slideshow_amber_zoom.json",
    title: "Amber glass slideshow — zoom",
    kind: "glass_slideshow",
    durationSec: 9,
    mergeKeys: ["IMAGE_1", "IMAGE_2", "IMAGE_3"],
    glass: { imageCount: 3, holdSec: 3, frameWidth: 1550, frameHeight: 870 },
  },
  {
    id: "05_glass_slideshow_crimson_carousel",
    file: "05_glass_slideshow_crimson_carousel.json",
    title: "Crimson glass slideshow — carousel",
    kind: "glass_slideshow",
    durationSec: 9,
    mergeKeys: ["IMAGE_1", "IMAGE_2", "IMAGE_3"],
    glass: { imageCount: 3, holdSec: 3, frameWidth: 1550, frameHeight: 870 },
  },
  {
    id: "06_glass_slideshow_midnight_wipe",
    file: "06_glass_slideshow_midnight_wipe.json",
    title: "Midnight glass slideshow — wipe",
    kind: "glass_slideshow",
    durationSec: 9,
    mergeKeys: ["IMAGE_1", "IMAGE_2", "IMAGE_3"],
    glass: { imageCount: 3, holdSec: 3, frameWidth: 1550, frameHeight: 870 },
  },
  {
    id: "07_glass_slideshow_violet_reveal",
    file: "07_glass_slideshow_violet_reveal.json",
    title: "Violet glass slideshow — reveal",
    kind: "glass_slideshow",
    durationSec: 9,
    mergeKeys: ["IMAGE_1", "IMAGE_2", "IMAGE_3"],
    glass: { imageCount: 3, holdSec: 3, frameWidth: 1550, frameHeight: 870 },
  },
  {
    id: "08_side_by_side_black_white_border",
    file: "08_side_by_side_black_white_border.json",
    title: "Side-by-side — two images",
    kind: "side_by_side",
    durationSec: 5,
    mergeKeys: ["LEFT_IMAGE", "RIGHT_IMAGE"],
  },
  {
    id: "09_red_grid_white_lines_75_percent",
    file: "09_red_grid_white_lines_75_percent.json",
    title: "Red grid — one 75% image",
    kind: "red_grid",
    durationSec: 5,
    mergeKeys: ["IMAGE_URL"],
  },
];

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function listMysteryPackTemplateFiles(): string[] {
  return fs
    .readdirSync(MYSTERY_PACK_TEMPLATES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

export function loadMysteryPackTemplate(presetId: MysteryPackPresetId | string): MysteryPackTemplate {
  const meta = MYSTERY_PACK_PRESETS.find((p) => p.id === presetId || p.file === presetId);
  const file = meta?.file || (String(presetId).endsWith(".json") ? String(presetId) : `${presetId}.json`);
  const full = path.join(MYSTERY_PACK_TEMPLATES_DIR, file);
  if (!fs.existsSync(full)) throw new Error(`Mystery pack template missing: ${file}`);
  return JSON.parse(fs.readFileSync(full, "utf8")) as MysteryPackTemplate;
}

export function loadAllMysteryPackTemplates(): Array<{
  meta: MysteryPackPresetMeta;
  template: MysteryPackTemplate;
}> {
  const files = new Set(listMysteryPackTemplateFiles());
  return MYSTERY_PACK_PRESETS.map((meta) => {
    if (!files.has(meta.file)) throw new Error(`Expected template missing: ${meta.file}`);
    return { meta, template: loadMysteryPackTemplate(meta.id) };
  });
}

/** Replace {{FIND}} placeholders AND top-level merge array values. */
export function applyMysteryPackMerge(
  template: MysteryPackTemplate,
  replacements: Record<string, string>
): MysteryPackTemplate {
  const out = deepClone(template);
  const merged: MysteryPackMergeField[] = (out.merge || []).map((m) => ({
    find: m.find,
    replace: replacements[m.find] ?? m.replace,
  }));
  out.merge = merged;

  // Also inline-replace {{KEY}} in timeline so rendered edit is self-contained
  // (Shotstack merge API is for templates; stage /edit accepts fully resolved edits).
  let json = JSON.stringify(out.timeline);
  for (const m of merged) {
    const token = `{{${m.find}}}`;
    json = json.split(token).join(m.replace);
  }
  out.timeline = JSON.parse(json) as MysteryPackTemplate["timeline"];
  return out;
}

function walkClips(
  tracks: MysteryPackTemplate["timeline"]["tracks"],
  visit: (clip: Record<string, unknown>) => void
): void {
  for (const track of tracks) {
    for (const clip of track.clips || []) visit(clip);
  }
}

/**
 * Normalize for Shotstack stage sandbox:
 * - default-speed effects/transitions
 * - output resolution hd
 * - side-by-side: split overlapping image clips onto separate tracks
 */
export function normalizeMysteryPackEdit(template: MysteryPackTemplate): MysteryPackTemplate {
  const out = deepClone(template);

  // Fix side-by-side overlapping clips (validation FAIL in pack report).
  const imageTracks = out.timeline.tracks.filter((t) =>
    (t.clips || []).some((c) => (c.asset as { type?: string } | undefined)?.type === "image")
  );
  if (imageTracks.length === 1 && (imageTracks[0].clips || []).length === 2) {
    const [a, b] = imageTracks[0].clips;
    const startA = Number(a.start) || 0;
    const startB = Number(b.start) || 0;
    const lenA = Number(a.length) || 0;
    const lenB = Number(b.length) || 0;
    const overlap = startA < startB + lenB && startB < startA + lenA;
    if (overlap) {
      const htmlTracks = out.timeline.tracks.filter((t) => t !== imageTracks[0]);
      out.timeline.tracks = [...htmlTracks, { clips: [a] }, { clips: [b] }];
    }
  }

  walkClips(out.timeline.tracks, (clip) => {
    // Keep pack html5 + GSAP as authored (stage accepted this for LT/question/reveal).
    // Do not move width/height onto html5 assets — stage rejects those properties there.
    if (typeof clip.effect === "string") {
      clip.effect = normalizeMysteryEffect(clip.effect);
    }
    const tr = clip.transition as { in?: string; out?: string } | undefined;
    if (tr) {
      if (tr.in) tr.in = normalizeMysteryTransition(tr.in);
      if (tr.out) tr.out = normalizeMysteryTransition(tr.out);
    }
  });

  // Prefer medium quality for sandbox HTML-heavy presets (faster, less hang risk).
  out.output = {
    ...out.output,
    format: "mp4",
    resolution: "hd",
    aspectRatio: "16:9",
    fps: out.output.fps || 25,
    quality: "medium",
  };

  return out;
}

export function buildMysteryPackEdit(
  presetId: MysteryPackPresetId,
  replacements: Record<string, string>
): MysteryPackTemplate {
  const raw = loadMysteryPackTemplate(presetId);
  const merged = applyMysteryPackMerge(raw, replacements);
  return normalizeMysteryPackEdit(merged);
}

export function mysteryPackEditForShotstack(edit: MysteryPackTemplate): {
  timeline: MysteryPackTemplate["timeline"];
  output: Record<string, unknown>;
} {
  // Strip merge array — stage render wants resolved timeline only.
  return { timeline: edit.timeline, output: edit.output };
}
