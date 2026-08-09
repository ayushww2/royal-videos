/**
 * GPT Image generation via real OpenAI only (never ContactBox chat proxy).
 * Defaults: gpt-image-2, 1536x1024 (~16:9 landscape), quality low.
 */
import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { optionalEnv, config } from "./config.js";

export type GptImageResult = {
  model: string;
  size: string;
  quality: string;
  outputPath: string;
  revisedPrompt?: string;
};

function imageApiKey(): string {
  const key = optionalEnv("OPENAI_IMAGE_API_KEY");
  if (!key) {
    throw new Error(
      "Missing OPENAI_IMAGE_API_KEY. Set your real OpenAI key (not ContactBox) for GPT Image."
    );
  }
  return key;
}

function imageClient(): OpenAI {
  return new OpenAI({
    apiKey: imageApiKey(),
    baseURL: optionalEnv("OPENAI_IMAGE_BASE_URL") || "https://api.openai.com/v1",
    maxRetries: 2,
    timeout: 300_000,
  });
}

export function imageGenDefaults(): { model: string; size: string; quality: string } {
  return {
    model: optionalEnv("OPENAI_IMAGE_MODEL") || "gpt-image-2",
    size: optionalEnv("OPENAI_IMAGE_SIZE") || "1536x1024",
    quality: optionalEnv("OPENAI_IMAGE_QUALITY") || "low",
  };
}

/**
 * Generate one landscape still and save under storage/generated-images/.
 */
export async function generateGptImage(params: {
  prompt: string;
  filename?: string;
  size?: string;
  quality?: "low" | "medium" | "high" | "auto";
  model?: string;
}): Promise<GptImageResult> {
  const defaults = imageGenDefaults();
  const model = params.model || defaults.model;
  const size = params.size || defaults.size;
  const quality = params.quality || (defaults.quality as "low" | "medium" | "high" | "auto");

  const openai = imageClient();
  const result = await openai.images.generate({
    model,
    prompt: params.prompt,
    size: size as "1536x1024" | "1024x1024" | "1024x1536" | "auto",
    quality,
    // gpt-image models return b64 by default on many accounts
  } as Parameters<typeof openai.images.generate>[0]);

  const first = result.data?.[0];
  if (!first) throw new Error("GPT Image returned no data");

  const dir = path.join(config.storagePath, "generated-images");
  const filename =
    params.filename ||
    `gpt-image-${Date.now()}.png`;
  const outputPath = path.join(dir, filename);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (first.b64_json) {
    await fs.writeFile(outputPath, Buffer.from(first.b64_json, "base64"));
  } else if (first.url) {
    const res = await fetch(first.url);
    if (!res.ok) throw new Error(`Failed to download image URL (${res.status})`);
    await fs.writeFile(outputPath, Buffer.from(await res.arrayBuffer()));
  } else {
    throw new Error("GPT Image response missing b64_json and url");
  }

  return {
    model,
    size,
    quality,
    outputPath,
    revisedPrompt: first.revised_prompt,
  };
}
