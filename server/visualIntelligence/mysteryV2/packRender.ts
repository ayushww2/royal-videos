/**
 * Render Mystery Documentary Pack presets via Shotstack stage.
 */
import path from "node:path";
import { writeJson } from "../../storage.js";
import { config, optionalEnv } from "../../config.js";
import { pollShotstackRender, submitShotstackRender, type ShotstackEdit } from "../../render/shotstackClient.js";
import {
  buildMysteryPackEdit,
  mysteryPackEditForShotstack,
  MYSTERY_PACK_PRESETS,
  type MysteryPackPresetId,
} from "./packLoader.js";
import { mysteryOverlayPublicBase } from "./overlayCatalog.js";

export function mysteryPackDefaultStills(): {
  background: string;
  image1: string;
  image2: string;
  image3: string;
  left: string;
  right: string;
  single: string;
} {
  const base = mysteryOverlayPublicBase();
  return {
    background: `${base}/overlays/transitions/preview-stills/cave.png`,
    image1: `${base}/overlays/transitions/preview-stills/a.png`,
    image2: `${base}/overlays/transitions/preview-stills/b.png`,
    image3: `${base}/overlays/transitions/preview-stills/c.png`,
    left: `${base}/overlays/transitions/preview-stills/a.png`,
    right: `${base}/overlays/transitions/preview-stills/b.png`,
    single: `${base}/overlays/transitions/preview-stills/cave.png`,
  };
}

export function defaultMergeForPreset(presetId: MysteryPackPresetId): Record<string, string> {
  const stills = mysteryPackDefaultStills();
  switch (presetId) {
    case "01_lower_third_blue_clean":
      return {
        PRIMARY_TEXT: "FIELD INVESTIGATION",
        BACKGROUND_IMAGE: stills.background,
      };
    case "02_question_ask_mystery":
      return {
        QUESTION: "WHO CLOSED THE AREA?",
        SUBQUESTION: "AND WHAT WERE THEY TRYING TO HIDE?",
        BACKGROUND_IMAGE: stills.background,
      };
    case "03_reveal_mystery":
      return {
        REVEAL_TEXT: "THE ORIGINAL RECORDING",
        BACKGROUND_IMAGE: stills.single,
      };
    case "04_glass_slideshow_amber_zoom":
    case "05_glass_slideshow_crimson_carousel":
    case "06_glass_slideshow_midnight_wipe":
    case "07_glass_slideshow_violet_reveal":
      return {
        IMAGE_1: stills.image1,
        IMAGE_2: stills.image2,
        IMAGE_3: stills.image3,
      };
    case "08_side_by_side_black_white_border":
      return {
        LEFT_IMAGE: stills.left,
        RIGHT_IMAGE: stills.right,
      };
    case "09_red_grid_white_lines_75_percent":
      return { IMAGE_URL: stills.single };
    default:
      return {};
  }
}

export async function renderMysteryPackPreset(opts: {
  presetId: MysteryPackPresetId;
  merge?: Record<string, string>;
  saveDir?: string;
  poll?: boolean;
}): Promise<{
  presetId: MysteryPackPresetId;
  renderId: string;
  url?: string;
  status: string;
  editPath: string;
  error?: string;
}> {
  const merge = { ...defaultMergeForPreset(opts.presetId), ...(opts.merge || {}) };
  // Guard: every image URL must be public HTTPS
  for (const [k, v] of Object.entries(merge)) {
    if (/IMAGE|BACKGROUND|LEFT|RIGHT/i.test(k) && !/^https:\/\//i.test(v)) {
      throw new Error(`Merge field ${k} must be a public HTTPS URL, got: ${v}`);
    }
  }

  const packEdit = buildMysteryPackEdit(opts.presetId, merge);
  const shotstackBody = mysteryPackEditForShotstack(packEdit);
  const edit = shotstackBody as unknown as ShotstackEdit;

  const saveDir =
    opts.saveDir ||
    path.join(config.storagePath, "previews", "mystery-v2-pack");

  const { id } = await submitShotstackRender(edit);
  await writeJson(path.join(saveDir, `${opts.presetId}.edit.json`), {
    presetId: opts.presetId,
    merge,
    edit: shotstackBody,
    renderId: id,
    renderedAt: new Date().toISOString(),
    stageUrl: optionalEnv("SHOTSTACK_API_URL") || "https://api.shotstack.io/edit/stage/render",
  });

  if (opts.poll === false) {
    return {
      presetId: opts.presetId,
      renderId: id,
      status: "queued",
      editPath: path.join(saveDir, `${opts.presetId}.edit.json`),
    };
  }

  try {
    const result = await pollShotstackRender(id, { timeoutMs: 8 * 60 * 1000, intervalMs: 4000 });
    return {
      presetId: opts.presetId,
      renderId: id,
      url: result.url,
      status: result.status,
      error: result.error,
      editPath: path.join(saveDir, `${opts.presetId}.edit.json`),
    };
  } catch (err) {
    return {
      presetId: opts.presetId,
      renderId: id,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      editPath: path.join(saveDir, `${opts.presetId}.edit.json`),
    };
  }
}

export async function renderAllMysteryPackPresets(opts?: {
  saveDir?: string;
}): Promise<Array<Awaited<ReturnType<typeof renderMysteryPackPreset>>>> {
  const results = [];
  for (const meta of MYSTERY_PACK_PRESETS) {
    const r = await renderMysteryPackPreset({
      presetId: meta.id,
      saveDir: opts?.saveDir,
      poll: true,
    });
    results.push(r);
    if (r.status !== "done") {
      // Continue remaining presets but keep failure visible
      console.error(`[mystery-pack] ${meta.id} failed: ${r.error || r.status}`);
    } else {
      console.log(`[mystery-pack] ${meta.id} ok → ${r.url}`);
    }
  }
  return results;
}
