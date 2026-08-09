import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in .env locally or in Railway Variables.`
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  storagePath: path.resolve(process.env.STORAGE_PATH || path.join(ROOT_DIR, "storage")),
  dataPath: path.resolve(process.env.DATA_PATH || path.join(ROOT_DIR, "data")),
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.5",
  openaiBaseUrl: process.env.OPENAI_BASE_URL?.trim() || "https://api.contactboxtools.me/v1",
  nodeEnv: process.env.NODE_ENV || "development",
};

export function getOpenAiKey(): string {
  return requireEnv("OPENAI_API_KEY");
}

export function getSearchApiKey(): string {
  return requireEnv("SEARCHAPI_API_KEY");
}

export function getPexelsKey(): string | undefined {
  return optionalEnv("PEXELS_API_KEY");
}

export function getPixabayKey(): string | undefined {
  return optionalEnv("PIXABAY_API_KEY");
}

export function getShotstackKeyOptional(): string | undefined {
  return optionalEnv("SHOTSTACK_API_KEY");
}

export function getElevenLabsKey(): string {
  return requireEnv("ELEVENLABS_API_KEY");
}

export function getElevenLabsKeyOptional(): string | undefined {
  return optionalEnv("ELEVENLABS_API_KEY");
}

/** Default voice: Bill (Social Media). Override with ELEVENLABS_VOICE_ID. */
export function getElevenLabsVoiceId(): string {
  return optionalEnv("ELEVENLABS_VOICE_ID") || "pqHfZKP75CvOlQylNhV4";
}

/** Default model: Turbo v2.5. Override with ELEVENLABS_MODEL_ID. */
export function getElevenLabsModelId(): string {
  return optionalEnv("ELEVENLABS_MODEL_ID") || "eleven_turbo_v2_5";
}

export function checkRequiredApis(): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.OPENAI_API_KEY?.trim()) missing.push("OPENAI_API_KEY");
  if (!process.env.SEARCHAPI_API_KEY?.trim()) missing.push("SEARCHAPI_API_KEY");
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}

function envTruthy(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Celebrity v1 reference-edit recipe (Tp5kwT3785Y pacing/raw%/effects).
 * Defaults ON — permanent Celebrity behavior after user approval.
 * Set CELEBRITY_V1_REFERENCE_EDIT=false to disable.
 */
export function celebrityV1ReferenceEditEnabled(): boolean {
  const raw = (process.env.CELEBRITY_V1_REFERENCE_EDIT || "").trim().toLowerCase();
  if (!raw) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return true;
}

export type FinalRenderer = "remotion" | "remotion-lambda" | "runpod" | "shotstack";

/** True when final Remotion renders should run on AWS Remotion Lambda. */
export function useRemotionLambda(): boolean {
  const renderer = (process.env.RENDERER || "remotion").trim().toLowerCase();
  return renderer === "remotion-lambda" || envTruthy("REMOTION_LAMBDA");
}

/** True when final Remotion renders should run on an on-demand RunPod worker. */
export function useRunpodRenderer(): boolean {
  const renderer = (process.env.RENDERER || "remotion").trim().toLowerCase();
  return renderer === "runpod" || envTruthy("RUNPOD_RENDER");
}

export function getRenderer(): FinalRenderer {
  const v = (process.env.RENDERER || "remotion").trim().toLowerCase();
  if (v === "shotstack") return "shotstack";
  if (v === "remotion-lambda" || envTruthy("REMOTION_LAMBDA")) return "remotion-lambda";
  if (v === "runpod" || envTruthy("RUNPOD_RENDER")) return "runpod";
  return "remotion";
}

/**
 * Niche-aware final renderer. Mystery v2 is RunPod-only (Remotion on serverless/pod) —
 * never Shotstack, even if global RENDERER=shotstack.
 */
export function getRendererForJob(niche?: string): FinalRenderer {
  if (String(niche || "").trim() === "Mystery v2") return "runpod";
  return getRenderer();
}

export function getRemotionAwsRegion(): string {
  return (
    optionalEnv("REMOTION_AWS_REGION") ||
    optionalEnv("AWS_REGION") ||
    "us-east-1"
  );
}

export function checkRenderApis(): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const renderer = getRenderer();
  // Remotion is the default final renderer (real 10-effect pack). Shotstack optional.
  if (renderer === "shotstack" && !process.env.SHOTSTACK_API_KEY?.trim()) {
    missing.push("SHOTSTACK_API_KEY");
  }
  if (renderer === "remotion-lambda") {
    if (!process.env.REMOTION_FUNCTION_NAME?.trim()) missing.push("REMOTION_FUNCTION_NAME");
    if (!process.env.REMOTION_SERVE_URL?.trim()) missing.push("REMOTION_SERVE_URL");
    if (!process.env.AWS_ACCESS_KEY_ID?.trim()) missing.push("AWS_ACCESS_KEY_ID");
    if (!process.env.AWS_SECRET_ACCESS_KEY?.trim()) missing.push("AWS_SECRET_ACCESS_KEY");
  }
  if (renderer === "runpod") {
    if (!process.env.RUNPOD_WORKER_SECRET?.trim()) missing.push("RUNPOD_WORKER_SECRET");
    if (!process.env.RUNPOD_API_KEY?.trim()) missing.push("RUNPOD_API_KEY");
    const hasServerless = Boolean(process.env.RUNPOD_SERVERLESS_ENDPOINT_ID?.trim());
    const hasPod =
      Boolean(process.env.RUNPOD_POD_ID?.trim()) || Boolean(process.env.RUNPOD_TEMPLATE_ID?.trim());
    if (!hasServerless && !hasPod) {
      missing.push("RUNPOD_SERVERLESS_ENDPOINT_ID (or RUNPOD_POD_ID / RUNPOD_TEMPLATE_ID)");
    }
  }
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}
