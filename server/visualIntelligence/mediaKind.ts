const VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v)(?:[?#]|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(?:[?#]|$)/i;

const CLIP_SOURCES = new Set([
  "raw_footage",
  "trusted_clip",
  "user_youtube_raw",
  "pexels_clip",
  "pixabay_clip",
]);

const IMAGE_SOURCES = new Set([
  "google_image",
  "brave_image",
  "pexels_image",
  "pixabay_image",
  "cached_approved",
  "uploaded_asset",
  "fallback",
  "fallback_image",
]);

const CLIP_MEDIA = new Set(["raw_footage", "trusted_clip", "trusted_clips", "video"]);

export function mediaKind(input: {
  source?: string;
  mediaType?: string;
  url?: string;
}): "clip" | "image" | "unknown" {
  const url = input.url || "";
  if (VIDEO_EXT.test(url)) return "clip";
  if (IMAGE_EXT.test(url)) return "image";
  if (input.mediaType === "image") return "image";
  if (input.mediaType && CLIP_MEDIA.has(input.mediaType)) return "clip";
  if (input.source && IMAGE_SOURCES.has(input.source)) return "image";
  if (input.source && CLIP_SOURCES.has(input.source)) return "clip";
  return "unknown";
}

export function rawFootageFlagForVisual(input: {
  source?: string;
  mediaType?: string;
  url?: string;
}): boolean {
  return mediaKind(input) === "clip";
}
