/**
 * Mystery v2 realism: ContactBox engineers prompt → OpenAI gpt-image-2 generates still.
 */
import path from "node:path";
import { writeJson, jobDataFile } from "../../storage.js";
import { generateGptImage } from "../../openaiImageClient.js";
import {
  engineerMysteryRealismPrompt,
  packToImagePrompt,
  type MysteryRealismInput,
  type MysteryRealismPromptPack,
} from "./realismPromptEngineer.js";
import {
  MYSTERY_V2_IMAGE_MODEL,
  MYSTERY_V2_IMAGE_QUALITY,
  MYSTERY_V2_IMAGE_SIZE,
} from "./realismRecipe.js";

export type MysteryRealismGenerateResult = {
  pack: MysteryRealismPromptPack;
  imagePrompt: string;
  image?: {
    model: string;
    size: string;
    quality: string;
    outputPath: string;
  };
};

export async function generateMysteryRealismStill(
  input: MysteryRealismInput & {
    generateImage?: boolean;
    filename?: string;
    jobId?: string;
  }
): Promise<MysteryRealismGenerateResult> {
  const pack = await engineerMysteryRealismPrompt(input);
  const imagePrompt = packToImagePrompt(pack);

  const out: MysteryRealismGenerateResult = { pack, imagePrompt };

  if (input.generateImage !== false) {
    const image = await generateGptImage({
      prompt: imagePrompt,
      filename:
        input.filename ||
        `mystery-v2-realism-${Date.now()}.png`,
      model: MYSTERY_V2_IMAGE_MODEL,
      size: MYSTERY_V2_IMAGE_SIZE,
      quality: MYSTERY_V2_IMAGE_QUALITY,
    });
    out.image = {
      model: image.model,
      size: image.size,
      quality: image.quality,
      outputPath: image.outputPath,
    };
  }

  if (input.jobId) {
    await writeJson(jobDataFile("mystery-v2-realism-last", input.jobId), {
      jobId: input.jobId,
      ...out,
      createdAt: new Date().toISOString(),
    });
  }

  return out;
}

export function mysteryRealismPublicPath(outputPath: string): string {
  return path.basename(outputPath);
}
