import OpenAI from "openai";
import { getOpenAiKey, config } from "./config.js";

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: getOpenAiKey(),
      baseURL: config.openaiBaseUrl,
      maxRetries: 5,
      timeout: 120_000,
    });
  }
  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableError(err: unknown): boolean {
  const anyErr = err as { status?: number; code?: string; message?: string };
  const status = anyErr?.status;
  if (status === 408 || status === 409 || status === 429) return true;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  const msg = String(anyErr?.message || err || "").toLowerCase();
  return (
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed") ||
    msg.includes("socket")
  );
}

async function withRetries<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableError(err);
      if (!retryable || i === attempts - 1) break;
      const delay = Math.min(20_000, 800 * 2 ** i) + Math.floor(Math.random() * 400);
      console.warn(
        `[openai] ${label} failed (attempt ${i + 1}/${attempts}): ${
          err instanceof Error ? err.message : String(err)
        }; retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`OpenAI ${label} failed after retries: ${message}`);
}

export async function chatJson<T>(params: {
  system: string;
  user: string;
  temperature?: number;
  model?: string;
}): Promise<T> {
  return withRetries("chatJson", async () => {
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: params.model || config.openaiModel,
      temperature: params.temperature ?? 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI returned empty response");
    }
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new Error("OpenAI returned invalid JSON");
    }
  });
}

export async function chatText(params: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  return withRetries("chatText", async () => {
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: config.openaiModel,
      temperature: params.temperature ?? 0.2,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty response");
    return content;
  });
}

export type ChatImagePart = {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
};

export type ChatTextPart = { type: "text"; text: string };

/** Vision-capable chat JSON helper (OpenAI image_url content parts). */
export async function chatJsonVision<T>(params: {
  system: string;
  user: Array<ChatTextPart | ChatImagePart>;
  temperature?: number;
  model?: string;
}): Promise<T> {
  return withRetries("chatJsonVision", async () => {
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: params.model || config.openaiModel,
      temperature: params.temperature ?? 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty vision response");
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new Error("OpenAI vision returned invalid JSON");
    }
  });
}
