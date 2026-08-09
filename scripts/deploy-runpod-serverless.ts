/**
 * Create/update RunPod Serverless template + endpoint for Remotion.
 *
 * Env (.env or process):
 *   RUNPOD_API_KEY (required)
 *   RUNPOD_SERVERLESS_IMAGE (default ghcr.io/ayushww2/new-video-ai-remotion-serverless:latest)
 *   PUBLIC_APP_URL / APP_BASE_URL
 *   RUNPOD_WORKER_SECRET
 *   R2_* (passed into template env for worker uploads)
 *   RUNPOD_SERVERLESS_ENDPOINT_ID (if set, PATCH endpoint instead of create)
 *   RUNPOD_SERVERLESS_TEMPLATE_ID (optional reuse)
 */
import { execSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config();

/** Merge Railway production vars into process.env when local R2/secrets are missing. */
function mergeRailwayEnv(): void {
  try {
    const buf = execSync("railway variables --json", { encoding: "buffer" });
    let text = buf.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const json = JSON.parse(text) as Record<string, string>;
    for (const [k, v] of Object.entries(json)) {
      if (!v) continue;
      if (!process.env[k]?.trim()) process.env[k] = v;
    }
    console.log("[deploy] merged missing keys from railway variables");
  } catch {
    console.warn("[deploy] could not merge railway variables (continuing with .env)");
  }
}

mergeRailwayEnv();

const REST = "https://rest.runpod.io/v1";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

async function rest<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(`${REST}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv("RUNPOD_API_KEY")}`,
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
    throw new Error(
      `RunPod ${method} ${pathname} → ${res.status}: ${text.slice(0, 800)}`
    );
  }
  return json as T;
}

function templateEnv(): Record<string, string> {
  const env: Record<string, string> = {
    RENDERER: "remotion",
    REMOTION_LAMBDA: "0",
    RUNPOD_RENDER: "0",
    REMOTION_CONCURRENCY:
      optionalEnv("RUNPOD_REMOTION_CONCURRENCY") ||
      optionalEnv("REMOTION_CONCURRENCY") ||
      "8",
    STORAGE_PATH: "/app/storage",
    NODE_ENV: "production",
  };
  const app = optionalEnv("PUBLIC_APP_URL") || optionalEnv("APP_BASE_URL");
  if (app) {
    env.PUBLIC_APP_URL = app;
    env.APP_BASE_URL = app;
  }
  for (const k of [
    "RUNPOD_WORKER_SECRET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_PUBLIC_URL",
  ]) {
    const v = optionalEnv(k);
    if (v) env[k] = v;
  }
  return env;
}

async function ensureTemplate(): Promise<string> {
  const existing = optionalEnv("RUNPOD_SERVERLESS_TEMPLATE_ID");
  const image =
    optionalEnv("RUNPOD_SERVERLESS_IMAGE") ||
    "ghcr.io/ayushww2/new-video-ai-remotion-serverless:latest";
  const name =
    optionalEnv("RUNPOD_SERVERLESS_TEMPLATE_NAME") ||
    "documentary-remotion-serverless";

  const body = {
    name,
    imageName: image,
    isServerless: true,
    isPublic: false,
    containerDiskInGb: Number(optionalEnv("RUNPOD_SERVERLESS_DISK_GB") || "40") || 40,
    volumeInGb: 0,
    dockerStartCmd: ["python3", "-u", "serverless/handler.py"],
    env: templateEnv(),
  };

  if (existing) {
    try {
      await rest("PATCH", `/templates/${existing}`, body);
      console.log(`[deploy] updated template ${existing}`);
      return existing;
    } catch (err) {
      console.warn(
        `[deploy] patch template failed, will create:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Unique name if create (RunPod requires unique template names)
  const createBody = {
    ...body,
    name: `${name}-${Date.now().toString(36).slice(-6)}`,
  };
  const created = await rest<{ id: string }>("POST", "/templates", createBody);
  if (!created?.id) throw new Error("Template create returned no id");
  console.log(`[deploy] created template ${created.id} image=${image}`);
  return created.id;
}

async function ensureEndpoint(templateId: string): Promise<string> {
  const existing = optionalEnv("RUNPOD_SERVERLESS_ENDPOINT_ID");
  const endpointBody = {
    name: optionalEnv("RUNPOD_SERVERLESS_ENDPOINT_NAME") || "documentary-remotion-3090",
    templateId,
    gpuTypeIds: ["NVIDIA GeForce RTX 3090"],
    gpuCount: 1,
    workersMin: 0,
    workersMax: 3,
    idleTimeout: 30,
    executionTimeoutMs: 7_200_000,
    flashboot: true,
    scalerType: "REQUEST_COUNT",
    scalerValue: 1,
    computeType: "GPU",
  };

  if (existing) {
    try {
      await rest("PATCH", `/endpoints/${existing}`, {
        ...endpointBody,
        templateId,
      });
      console.log(`[deploy] updated endpoint ${existing}`);
      return existing;
    } catch (err) {
      console.warn(
        `[deploy] patch endpoint failed, will create:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const created = await rest<{ id: string }>("POST", "/endpoints", endpointBody);
  if (!created?.id) throw new Error("Endpoint create returned no id");
  console.log(`[deploy] created endpoint ${created.id}`);
  return created.id;
}

async function main(): Promise<void> {
  requireEnv("RUNPOD_API_KEY");
  const templateId = await ensureTemplate();
  const endpointId = await ensureEndpoint(templateId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        templateId,
        endpointId,
        workersMax: 3,
        workersMin: 0,
        gpu: "NVIDIA GeForce RTX 3090",
        setEnv: `RUNPOD_SERVERLESS_ENDPOINT_ID=${endpointId}`,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
