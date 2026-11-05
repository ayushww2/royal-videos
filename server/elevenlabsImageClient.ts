/**
 * ElevenLabs Image API (flows). Polling only — no webhook endpoint in this app.
 * Royal footage stills default to gpt-image-2.5-sunburst, 16:9, 1K, quality low.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config, getElevenLabsKey, optionalEnv } from "./config.js";

const API_BASE = "https://api.elevenlabs.io/v1";

export const ELEVENLABS_IMAGE_DEFAULTS = {
  modelId: "gpt-image-2.5-sunburst",
  aspectRatio: "16:9",
  resolution: "1K",
  quality: "low",
} as const;

export type ElevenLabsImageQuality = "low" | "medium" | "high" | "xhigh" | "max";
export type ElevenLabsImageResolution = "1K" | "2K" | "4K";

export type ElevenLabsImageSettings = {
  modelId: string;
  aspectRatio: string;
  resolution: string;
  quality: string;
};

type GenerationStatus = "pending" | "generating" | "completed" | "failed";

type GenerationRecord = {
  id: string;
  status: GenerationStatus;
  content_url?: string;
  content_mime_type?: string;
  failure_reason?: string;
  error_message?: string;
};

export type ElevenLabsImageResult = ElevenLabsImageSettings & {
  generationId: string;
  outputPath: string;
  previewUrl: string;
  contentMimeType: string;
};

export function elevenLabsImageSettings(): ElevenLabsImageSettings {
  return {
    modelId: optionalEnv("ELEVENLABS_IMAGE_MODEL") || ELEVENLABS_IMAGE_DEFAULTS.modelId,
    aspectRatio:
      optionalEnv("ELEVENLABS_IMAGE_ASPECT_RATIO") || ELEVENLABS_IMAGE_DEFAULTS.aspectRatio,
    resolution: optionalEnv("ELEVENLABS_IMAGE_RESOLUTION") || ELEVENLABS_IMAGE_DEFAULTS.resolution,
    quality: optionalEnv("ELEVENLABS_IMAGE_QUALITY") || ELEVENLABS_IMAGE_DEFAULTS.quality,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text.slice(0, 500);
}

function throwForStatus(status: number, body: string): never {
  if (status === 402 || body.includes("paid_plan_required")) {
    throw new Error(
      "ElevenLabs Image API requires a Pro plan or above (paid_plan_required). " +
        "The key authenticated, but this workspace cannot generate images."
    );
  }
  if (status === 401) {
    throw new Error("ElevenLabs rejected the API key (401).");
  }
  throw new Error(`ElevenLabs image request failed (${status}): ${body}`);
}

async function createGeneration(prompt: string, settings: ElevenLabsImageSettings): Promise<string> {
  const res = await fetch(`${API_BASE}/flows/image`, {
    method: "POST",
    headers: {
      "xi-api-key": getElevenLabsKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model_id: settings.modelId,
      prompt,
      aspect_ratio: settings.aspectRatio,
      resolution: settings.resolution,
      quality: settings.quality,
    }),
  });
  if (!res.ok) throwForStatus(res.status, await readError(res));
  const body = (await res.json()) as { id?: string; status?: string };
  if (!body.id) throw new Error("ElevenLabs image create returned no generation id");
  return body.id;
}

async function getGeneration(id: string): Promise<GenerationRecord> {
  const res = await fetch(`${API_BASE}/flows/image/${encodeURIComponent(id)}`, {
    headers: {
      "xi-api-key": getElevenLabsKey(),
      Accept: "application/json",
    },
  });
  if (!res.ok) throwForStatus(res.status, await readError(res));
  return (await res.json()) as GenerationRecord;
}

async function pollGeneration(id: string): Promise<GenerationRecord> {
  const ceilingMs = Number(optionalEnv("ELEVENLABS_IMAGE_TIMEOUT_MS") || 180_000);
  const started = Date.now();
  let intervalMs = 2_000;
  while (Date.now() - started < ceilingMs) {
    const result = await getGeneration(id);
    if (result.status === "completed" || result.status === "failed") return result;
    await sleep(intervalMs);
    if (Date.now() - started > 20_000) intervalMs = Math.min(intervalMs * 2, 60_000);
  }
  throw new Error(`ElevenLabs image generation timed out after ${ceilingMs}ms (${id})`);
}

/**
 * Submit one still, poll until it finishes, and save the signed URL bytes.
 * Signed URLs expire in about an hour, so the file on disk is the copy to keep.
 */
export async function generateElevenLabsImage(params: {
  prompt: string;
  filename?: string;
  settings?: Partial<ElevenLabsImageSettings>;
}): Promise<ElevenLabsImageResult> {
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error("Image prompt is empty");
  const settings: ElevenLabsImageSettings = {
    ...elevenLabsImageSettings(),
    ...params.settings,
  };

  const generationId = await createGeneration(prompt, settings);
  const result = await pollGeneration(generationId);
  if (result.status === "failed") {
    throw new Error(
      `ElevenLabs image failed (${result.failure_reason || "unknown"}): ${
        result.error_message || "no error message"
      }`
    );
  }
  if (!result.content_url) throw new Error(`ElevenLabs image ${generationId} completed without a content_url`);

  const download = await fetch(result.content_url);
  if (!download.ok) {
    throw new Error(`Failed to download generated image (${download.status})`);
  }
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.length < 32) throw new Error("Downloaded image was empty");

  const dir = path.join(config.storagePath, "generated-images");
  const filename = params.filename || `elevenlabs-image-${generationId}.png`;
  const outputPath = path.join(dir, filename);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(outputPath, bytes);

  const rel = path.relative(config.storagePath, outputPath).split(path.sep).join("/");
  return {
    ...settings,
    generationId,
    outputPath,
    previewUrl: `/media/${rel}`,
    contentMimeType: result.content_mime_type || download.headers.get("content-type") || "image/png",
  };
}
