import { requireEnv, optionalEnv } from "../config.js";

export function getShotstackKey(): string {
  return requireEnv("SHOTSTACK_API_KEY");
}

export function getShotstackRenderUrl(): string {
  return (
    optionalEnv("SHOTSTACK_API_URL") ||
    "https://api.shotstack.io/edit/stage/render"
  );
}

export function getShotstackStatusUrl(renderId: string): string {
  const base = getShotstackRenderUrl().replace(/\/$/, "");
  return `${base}/${renderId}`;
}

export interface ShotstackClip {
  asset: Record<string, unknown>;
  start: number;
  length: number;
  fit?: string;
  transition?: { in?: string; out?: string };
  effect?: string;
  filter?: string;
  opacity?: number;
  position?: string;
  scale?: number;
  width?: number;
  height?: number;
  offset?: { x?: number; y?: number };
}

export interface ShotstackEdit {
  timeline: {
    soundtrack?: { src: string; effect?: string };
    background?: string;
    tracks: Array<{ clips: ShotstackClip[] }>;
  };
  output: {
    format: "mp4";
    resolution: "hd" | "sd" | "mobile";
    aspectRatio?: string;
    fps?: number;
    quality?: string;
  };
}

export async function submitShotstackRender(edit: ShotstackEdit): Promise<{ id: string }> {
  const res = await fetch(getShotstackRenderUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": getShotstackKey(),
    },
    body: JSON.stringify(edit),
  });
  const text = await res.text();
  let data: {
    success?: boolean;
    message?: string;
    response?: { id?: string; error?: string; message?: string };
    errors?: Array<{ detail?: string; title?: string }>;
  } = {};
  try {
    data = text ? (JSON.parse(text) as typeof data) : {};
  } catch {
    data = { message: text || `HTTP ${res.status}` };
  }
  if (!res.ok || !data.success || !data.response?.id) {
    const validation =
      (data.response as { errors?: Array<{ message?: string }> } | undefined)?.errors
        ?.map((e) => e.message)
        .filter(Boolean)
        .join("; ") || "";
    const detail =
      validation ||
      data.response?.error ||
      data.errors?.[0]?.detail ||
      data.message ||
      text ||
      `HTTP ${res.status}`;
    if (/0['’]? credits|at least 1 credit|plan limits/i.test(detail)) {
      throw new Error(
        `Shotstack has 0 sandbox credits. Add credits at https://dashboard.shotstack.io/subscription then retry render. (${detail})`
      );
    }
    throw new Error(`Shotstack submit failed: ${detail}`);
  }
  return { id: data.response.id };
}

export async function pollShotstackRender(
  renderId: string,
  opts?: { timeoutMs?: number; intervalMs?: number }
): Promise<{ status: string; url?: string; error?: string; raw: unknown }> {
  const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000;
  const intervalMs = opts?.intervalMs ?? 4000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(getShotstackStatusUrl(renderId), {
      headers: {
        Accept: "application/json",
        "x-api-key": getShotstackKey(),
      },
    });
    const data = (await res.json()) as {
      success?: boolean;
      message?: string;
      response?: { status?: string; url?: string; error?: string };
    };
    const status = data.response?.status || "unknown";
    if (status === "done") {
      return { status, url: data.response?.url, raw: data };
    }
    if (status === "failed") {
      return {
        status,
        error: data.response?.error || data.message || "Shotstack render failed",
        raw: data,
      };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Shotstack render timed out for id ${renderId}`);
}
