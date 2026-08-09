/**
 * ContactBox prompt engineer → Mystery documentary realism prompts.
 * Uses OPENAI_* (ContactBox). Does not call the image API.
 */
import { chatJson } from "../../openaiClient.js";
import {
  MYSTERY_V2_DEFAULT_NEGATIVE,
  MYSTERY_V2_REALISM_LOCK,
} from "./realismRecipe.js";

export type MysteryRealismInput = {
  title?: string;
  visualIdea: string;
  intendedUse?: string;
  preferredStyle?: string;
  aspectRatio?: "16:9" | "4:3";
  realismLevel?: string;
};

export type MysteryRealismPromptPack = {
  detailedImagePrompt: string;
  negativePrompt: string;
  lookTextureNotes: string;
  quickVersion: string;
  aspectRatio: "16:9" | "4:3";
  preferredStyle: string;
  realismLevel: string;
};

const SYSTEM = `You are a documentary-style AI image prompt engineer for a Mystery YouTube channel.

Your ONLY job: turn one visual idea into prompts that make GPT Image generate a REALISTIC, BELIEVABLE, EVIDENCE-STYLE documentary photograph.

This is NOT for deciding story beats or what clip to pick. It is ONLY for realism of AI stills.

${MYSTERY_V2_REALISM_LOCK}

Reference look (obey): Dead Sea sinkholes & salt crusts, archaeological digs with stakes/string/cases,
underwater divers with flashlight + marine snow, field shoreline footprints, night industrial deck candid,
old B&W archive ruins, lab/manuscript scan when asked — all landscape-capable, human-captured, slightly imperfect.

Rules:
- Write prompts for LANDSCAPE photography (wide). Prefer 16:9.
- Make images bright/clear enough to read, yet real and slightly imperfect — not crystal-perfect CGI.
- Never invent logos, seals, readable fake documents, timestamps, or HUD text.
- Never write generic cinematic trailer language.
- Output JSON only with keys:
  detailedImagePrompt (one paste-ready paragraph),
  negativePrompt (comma list, specific to this idea),
  lookTextureNotes (short practical notes),
  quickVersion (1–2 sentence prompt).`;

export async function engineerMysteryRealismPrompt(
  input: MysteryRealismInput
): Promise<MysteryRealismPromptPack> {
  const visualIdea = (input.visualIdea || "").trim();
  if (!visualIdea) throw new Error("visualIdea is required");

  const aspectRatio = input.aspectRatio === "4:3" ? "4:3" : "16:9";
  const preferredStyle = (input.preferredStyle || "color documentary").trim();
  const realismLevel = (input.realismLevel || "very realistic").trim();
  const intendedUse = (input.intendedUse || "evidence still").trim();

  const result = await chatJson<{
    detailedImagePrompt?: string;
    negativePrompt?: string;
    lookTextureNotes?: string;
    quickVersion?: string;
  }>({
    system: SYSTEM,
    user: JSON.stringify({
      title: input.title || "",
      visualIdea,
      intendedUse,
      preferredStyle,
      aspectRatio,
      realismLevel,
      note: "Landscape still only. Maximize photographic realism with slight human imperfection.",
    }),
    temperature: 0.35,
  });

  const detailed = (result.detailedImagePrompt || "").trim();
  if (!detailed) throw new Error("ContactBox returned empty detailedImagePrompt");

  return {
    detailedImagePrompt: detailed,
    negativePrompt: (result.negativePrompt || MYSTERY_V2_DEFAULT_NEGATIVE).trim(),
    lookTextureNotes: (result.lookTextureNotes || "").trim(),
    quickVersion: (result.quickVersion || detailed.slice(0, 280)).trim(),
    aspectRatio,
    preferredStyle,
    realismLevel,
  };
}

/** Merge pack into a single generation string for GPT Image. */
export function packToImagePrompt(pack: MysteryRealismPromptPack): string {
  return [
    pack.detailedImagePrompt,
    `Aspect ${pack.aspectRatio} landscape documentary photograph.`,
    `Avoid: ${pack.negativePrompt}`,
  ].join(" ");
}
