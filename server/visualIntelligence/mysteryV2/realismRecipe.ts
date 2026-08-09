/**
 * Locked Mystery v2 AI-image realism recipe.
 * ContactBox uses this to write prompts; OpenAI Image 2 renders them.
 * Not a beat/selection planner — realism settings only.
 */

export const MYSTERY_V2_IMAGE_MODEL = "gpt-image-2";
export const MYSTERY_V2_IMAGE_SIZE = "1536x1024"; // landscape ~16:9
export const MYSTERY_V2_IMAGE_QUALITY = "low" as const;

/** Short locked aesthetic the prompt engineer must obey. */
export const MYSTERY_V2_REALISM_LOCK = `
MYSTERY V2 REALISM LOCK (mandatory):
- Landscape / wide documentary still only (16:9 framing intent).
- Must look like a real human-captured photograph or archive/lab/field still — NOT AI art.
- Bright and clear enough to read the subject, but slightly imperfect: natural grain, soft optics,
  mild haze, uneven exposure, functional framing (not poster composition).
- Prefer: field investigation, archaeological dig, sinkhole/shoreline geology, underwater exploration,
  manuscript/lab scan, declassified archive, CCTV/drone frame when style requests it.
- Lighting: natural daylight, overcast documentary light, or single functional flashlight underwater —
  never glossy cinematic grade, never teal-and-orange trailer look.
- Texture: porous rock, salt crust, silt, marine snow/backscatter, film grain, compression softness.
- Reveal clues stay subtle and physical (water seepage, footprint, dark void, beam on rock) —
  never fake official stamps, logos, readable forged documents, or HUD overlays.
- Forbidden: perfect symmetry, crystal CGI, beauty retouch, fantasy glow, meme text, watermarks,
  stock-model posing, oversaturated fantasy colors.
`.trim();

export const MYSTERY_V2_DEFAULT_NEGATIVE = [
  "glossy AI art",
  "cinematic movie poster",
  "overdramatic lighting",
  "teal and orange grade",
  "perfect symmetry",
  "clean CGI",
  "3D render look",
  "fantasy effects",
  "neon glow",
  "readable fake text",
  "logos",
  "watermarks",
  "fake timestamps",
  "fake official seals",
  "HUD overlay",
  "stock model posing",
  "beauty retouch",
  "oversaturated colors",
  "plastic skin",
  "distorted hands",
  "distorted faces",
  "illegible gibberish typography",
].join(", ");
