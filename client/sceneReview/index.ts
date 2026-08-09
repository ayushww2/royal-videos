// Scene Review client helpers (kept separate per architecture)
export type SceneApprovalState = "approved" | "rejected" | "pending";

export function sourceLabel(source: string): string {
  switch (source) {
    case "raw_footage":
      return "raw footage";
    case "user_youtube_raw":
      return "YouTube raw";
    case "uploaded_asset":
      return "uploaded asset";
    case "brave_image":
      return "Brave image";
    case "google_image":
      return "Google image";
    case "pexels_clip":
      return "Pexels clip";
    case "pexels_image":
      return "Pexels image";
    case "pixabay_clip":
      return "Pixabay clip";
    case "pixabay_image":
      return "Pixabay image";
    case "fallback_card":
      return "fallback card";
    default:
      return source;
  }
}

export function sourceShort(source: string): string {
  switch (source) {
    case "raw_footage":
    case "user_youtube_raw":
      return "Raw";
    case "brave_image":
      return "Brave";
    case "google_image":
      return "Google";
    case "pexels_clip":
    case "pexels_image":
      return "Pexels";
    case "pixabay_clip":
    case "pixabay_image":
      return "Pixabay";
    case "uploaded_asset":
      return "Uploaded";
    case "fallback_card":
      return "Fallback";
    default:
      return source;
  }
}
