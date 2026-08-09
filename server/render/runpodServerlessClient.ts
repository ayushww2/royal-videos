/**
 * RunPod Serverless API client (queue /run + /status poll).
 * Prefer this path when RUNPOD_SERVERLESS_ENDPOINT_ID is set.
 */
import { optionalEnv, requireEnv } from "../config.js";

const API = "https://api.runpod.ai/v2";

export type ServerlessStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | string;

export type ServerlessJobStatus = {
  id: string;
  status: ServerlessStatus;
  output?: unknown;
  error?: string;
  progress?: string | number;
};

function endpointId(): string {
  return requireEnv("RUNPOD_SERVERLESS_ENDPOINT_ID");
}

export function serverlessEndpointConfigured(): boolean {
  return Boolean(optionalEnv("RUNPOD_SERVERLESS_ENDPOINT_ID"));
}

function apiKey(): string {
  return requireEnv("RUNPOD_API_KEY");
}

async function apiJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/${endpointId()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const detail =
      typeof json === "object" && json && "error" in json
        ? JSON.stringify((json as { error: unknown }).error)
        : text.slice(0, 500);
    throw new Error(`RunPod serverless ${method} ${path} failed (${res.status}): ${detail}`);
  }
  return json as T;
}

export async function submitServerlessRender(input: Record<string, unknown>): Promise<{ id: string }> {
  // Async /run — Railway polls status (renders can exceed runsync limits).
  // Keep body minimal; some accounts reject policy blocks with 500.
  const data = await apiJson<{ id: string }>("POST", "/run", { input });
  if (!data?.id) throw new Error("RunPod /run returned no id");
  return { id: data.id };
}

export async function getServerlessJobStatus(runId: string): Promise<ServerlessJobStatus> {
  return apiJson<ServerlessJobStatus>("GET", `/status/${runId}`);
}

/** Parse progressPercent from RunPod progress field (string or number). */
export function parseServerlessProgress(progress: unknown): number | undefined {
  if (typeof progress === "number" && Number.isFinite(progress)) {
    return progress > 1 ? Math.min(100, Math.round(progress)) : Math.min(100, Math.round(progress * 100));
  }
  if (typeof progress === "string") {
    const m = progress.match(/(\d{1,3})\s*%/);
    if (m) return Math.min(100, Number(m[1]));
    const n = Number(progress);
    if (Number.isFinite(n)) {
      return n > 1 ? Math.min(100, Math.round(n)) : Math.min(100, Math.round(n * 100));
    }
  }
  return undefined;
}
