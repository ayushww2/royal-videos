/**
 * Mystery v2 custom transition overlays (film burns / glitches) hosted on R2.
 */
import { optionalEnv } from "../../config.js";
import { MYSTERY_V2_FX_DENSITY } from "./fxRecipe.js";

export type MysteryOverlayId =
  | "camera-shutter"
  | "double-camera-film-burn"
  | "film-burn"
  | "film-burn-woosh"
  | "light-film-burn"
  | "light-glitch-effect"
  | "rgb-glitch-effect"
  | "soft-film-burn"
  | "transition-glitch"
  | "white-glitch";

export type MysteryOverlayDef = {
  id: MysteryOverlayId;
  file: string;
  /** Native mp4 duration before speed trim (~0.77s target in Remotion). */
  nativeSec: number;
  /** Shotstack clip length after mild speed-up feel. */
  lengthSec: number;
};

export const MYSTERY_V2_OVERLAYS: MysteryOverlayDef[] = [
  { id: "camera-shutter", file: "overlays/transitions/camera-shutter.mp4", nativeSec: 0.701, lengthSec: 0.77 },
  {
    id: "double-camera-film-burn",
    file: "overlays/transitions/double-camera-film-burn.mp4",
    nativeSec: 0.801,
    lengthSec: 0.77,
  },
  { id: "film-burn", file: "overlays/transitions/film-burn.mp4", nativeSec: 0.534, lengthSec: 0.77 },
  { id: "film-burn-woosh", file: "overlays/transitions/film-burn-woosh.mp4", nativeSec: 0.601, lengthSec: 0.77 },
  { id: "light-film-burn", file: "overlays/transitions/light-film-burn.mp4", nativeSec: 0.801, lengthSec: 0.77 },
  {
    id: "light-glitch-effect",
    file: "overlays/transitions/light-glitch-effect.mp4",
    nativeSec: 0.501,
    lengthSec: 0.77,
  },
  { id: "rgb-glitch-effect", file: "overlays/transitions/rgb-glitch-effect.mp4", nativeSec: 0.968, lengthSec: 0.77 },
  { id: "soft-film-burn", file: "overlays/transitions/soft-film-burn.mp4", nativeSec: 0.701, lengthSec: 0.77 },
  { id: "transition-glitch", file: "overlays/transitions/transition-glitch.mp4", nativeSec: 0.367, lengthSec: 0.77 },
  { id: "white-glitch", file: "overlays/transitions/white-glitch.mp4", nativeSec: 0.734, lengthSec: 0.77 },
];

export function mysteryOverlayPublicBase(): string {
  return (
    optionalEnv("R2_PUBLIC_URL") ||
    optionalEnv("PUBLIC_APP_URL") ||
    "https://pub-0ae6bea3eabc4a8db3932d8674ab8c01.r2.dev"
  ).replace(/\/$/, "");
}

export function mysteryOverlayUrl(overlay: MysteryOverlayDef | MysteryOverlayId): string {
  const def =
    typeof overlay === "string"
      ? MYSTERY_V2_OVERLAYS.find((o) => o.id === overlay)
      : overlay;
  if (!def) throw new Error(`Unknown Mystery overlay: ${overlay}`);
  return `${mysteryOverlayPublicBase()}/${def.file}`;
}

/** Shotstack video overlay clip (opacity approximates screen blend). */
export function buildMysteryOverlayClip(opts: {
  overlayId: MysteryOverlayId;
  start: number;
  opacity?: number;
}): Record<string, unknown> {
  const def = MYSTERY_V2_OVERLAYS.find((o) => o.id === opts.overlayId);
  if (!def) throw new Error(`Unknown Mystery overlay: ${opts.overlayId}`);
  return {
    asset: {
      type: "video",
      src: mysteryOverlayUrl(def),
      volume: 1,
    },
    start: opts.start,
    length: def.lengthSec,
    fit: "cover",
    opacity: opts.opacity ?? 0.85,
    position: "center",
  };
}

export function mysteryOverlayBudgetPerMinute(): number {
  return MYSTERY_V2_FX_DENSITY.overlaysPerMinute.target;
}
