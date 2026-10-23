/**
 * Photoreal royal press stills via ElevenLabs GPT Image 2.5 Sunburst.
 * These are synthetic stills that look like news-wire photographs. They are
 * not archive files from the Royal Media Library.
 */
import path from "node:path";
import { generateElevenLabsImage, elevenLabsImageSettings, type ElevenLabsImageResult } from "../../elevenlabsImageClient.js";
import { canonicalRoyalPerson, canonicalRoyalPlace } from "./taxonomy.js";

export type RoyalFootageStillInput = {
  person?: string;
  place?: string;
  action?: string;
  /** Full prompt override. Person, place, and action are still recorded when provided. */
  prompt?: string;
  filename?: string;
};

export type RoyalFootageStillResult = {
  person?: string;
  place?: string;
  action?: string;
  prompt: string;
  synthetic: true;
  source: "elevenlabs-image";
  image: ElevenLabsImageResult;
};

export function buildRoyalFootagePrompt(input: RoyalFootageStillInput): {
  person?: string;
  place?: string;
  action?: string;
  prompt: string;
} {
  const person = input.person?.trim()
    ? canonicalRoyalPerson(input.person) || input.person.trim()
    : undefined;
  const place = input.place?.trim()
    ? canonicalRoyalPlace(input.place) || input.place.trim()
    : undefined;
  const action = input.action?.trim() || undefined;

  if (input.prompt?.trim()) {
    return { person, place, action, prompt: input.prompt.trim() };
  }

  const subject = person || "King Charles";
  const location = place || "Buckingham Palace";
  const doing =
    action ||
    "stepping from a black state car at the palace gates while press photographers wait behind a barrier";

  const prompt = [
    "Photoreal 16:9 landscape press photograph, indistinguishable from a real news-wire still.",
    `${subject} ${doing} at ${location}.`,
    "Real human proportions, natural skin texture, available daylight, slight 35mm grain, shallow depth of field.",
    "Candid documentary photography. No illustration, no CGI, no plastic skin, no text, no watermark, no logo, no caption.",
  ].join(" ");

  return { person: subject, place: location, action: doing, prompt };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function generateRoyalFootageStill(
  input: RoyalFootageStillInput
): Promise<RoyalFootageStillResult> {
  const built = buildRoyalFootagePrompt(input);
  const filename =
    input.filename ||
    `royal-footage-${slug(built.person || "royal")}-${Date.now()}.png`;
  const image = await generateElevenLabsImage({
    prompt: built.prompt,
    filename,
    settings: elevenLabsImageSettings(),
  });
  return {
    ...built,
    synthetic: true,
    source: "elevenlabs-image",
    image,
  };
}

export function royalFootageRecipe() {
  return {
    ...elevenLabsImageSettings(),
    provider: "elevenlabs",
    endpoint: "POST /v1/flows/image",
    delivery: "poll",
    synthetic: true,
    note: "AI press-style stills for Royal v2. Not Royal Media Library archive files.",
  };
}

export function royalFootageReportPath(outputPath: string): string {
  const dir = path.dirname(outputPath);
  const base = path.basename(outputPath, path.extname(outputPath));
  return path.join(dir, `${base}.json`);
}
