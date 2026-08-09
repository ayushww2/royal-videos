/**
 * Minimal RunPod REST client for on-demand start/stop.
 * Prefer STOP (not terminate) so the network volume stays attached to a reusable pod.
 */
import path from "node:path";
import { config, optionalEnv, requireEnv } from "../config.js";
import { readJson, writeJson } from "../storage.js";

const REST = "https://rest.runpod.io/v1";

export type RunpodPodStatus =
  | "RUNNING"
  | "EXITED"
  | "STOPPED"
  | "STARTING"
  | "STOPPING"
  | "TERMINATED"
  | string;

export type RunpodPod = {
  id: string;
  name?: string;
  desiredStatus?: string;
  runtime?: { uptimeInSeconds?: number } | null;
};

type RunpodState = {
  podId: string;
  updatedAt: string;
  lastEnsureAt?: string;
};

function statePath(): string {
  return path.join(config.dataPath, "runpod-worker-state.json");
}

function apiKey(): string {
  return requireEnv("RUNPOD_API_KEY");
}

async function rest<T>(
  method: string,
  pathname: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${REST}${pathname}`, {
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
    throw new Error(`RunPod ${method} ${pathname} failed (${res.status}): ${detail}`);
  }
  return json as T;
}

export async function getRunpodPod(podId: string): Promise<RunpodPod | null> {
  try {
    return await rest<RunpodPod>("GET", `/pods/${podId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\(404\)/.test(msg)) return null;
    throw err;
  }
}

export function isPodRunning(pod: RunpodPod | null): boolean {
  if (!pod) return false;
  const status = String(pod.desiredStatus || "").toUpperCase();
  return status === "RUNNING" || status === "STARTING";
}

export function isPodStopped(pod: RunpodPod | null): boolean {
  if (!pod) return true;
  const status = String(pod.desiredStatus || "").toUpperCase();
  return status === "EXITED" || status === "STOPPED" || status === "TERMINATED" || !status;
}

export async function startRunpodPod(podId: string): Promise<void> {
  // REST start endpoint (preferred over terminate+recreate).
  await rest("POST", `/pods/${podId}/start`);
}

export async function stopRunpodPod(podId: string): Promise<void> {
  await rest("POST", `/pods/${podId}/stop`);
}

export async function createRunpodPodFromTemplate(): Promise<string> {
  const templateId = requireEnv("RUNPOD_TEMPLATE_ID");
  const networkVolumeId = optionalEnv("RUNPOD_VOLUME_ID");
  const name = optionalEnv("RUNPOD_POD_NAME") || "documentary-remotion-worker";
  const gpuTypeIds = (optionalEnv("RUNPOD_GPU_TYPE") || "NVIDIA GeForce RTX 4090")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const computeType = (optionalEnv("RUNPOD_COMPUTE_TYPE") || "GPU").toUpperCase();

  const body: Record<string, unknown> = {
    name,
    templateId,
    volumeMountPath: "/workspace",
    cloudType: optionalEnv("RUNPOD_CLOUD_TYPE") || "SECURE",
  };

  if (networkVolumeId) body.networkVolumeId = networkVolumeId;

  const startCmd = optionalEnv("RUNPOD_DOCKER_START_CMD");
  if (startCmd) {
    // REST expects string[]; allow a single shell command string.
    body.dockerStartCmd = ["bash", "-lc", startCmd];
  }

  if (computeType === "CPU") {
    body.computeType = "CPU";
    body.cpuFlavorIds = (optionalEnv("RUNPOD_CPU_FLAVOR") || "cpu3g")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    body.computeType = "GPU";
    body.gpuTypeIds = gpuTypeIds;
    body.gpuCount = Number(optionalEnv("RUNPOD_GPU_COUNT") || "1") || 1;
  }

  // REST API expects env as a flat object, not GraphQL [{key,value}].
  const env: Record<string, string> = {};
  const workerSecret = optionalEnv("RUNPOD_WORKER_SECRET");
  const appUrl = optionalEnv("PUBLIC_APP_URL");
  if (workerSecret) env.RUNPOD_WORKER_SECRET = workerSecret;
  if (appUrl) {
    env.APP_BASE_URL = appUrl;
    env.PUBLIC_APP_URL = appUrl;
  }
  env.REMOTION_CONCURRENCY =
    optionalEnv("RUNPOD_REMOTION_CONCURRENCY") || optionalEnv("REMOTION_CONCURRENCY") || "8";
  env.RUNPOD_IDLE_STOP_MINUTES = optionalEnv("RUNPOD_IDLE_STOP_MINUTES") || "10";
  if (optionalEnv("RUNPOD_API_KEY")) {
    env.RUNPOD_API_KEY = requireEnv("RUNPOD_API_KEY");
  }
  body.env = env;

  const created = await rest<RunpodPod>("POST", "/pods", body);
  if (!created?.id) throw new Error("RunPod create pod returned no id");
  return created.id;
}

export async function loadRunpodState(): Promise<RunpodState | null> {
  return readJson<RunpodState>(statePath());
}

export async function saveRunpodState(podId: string): Promise<void> {
  await writeJson(statePath(), {
    podId,
    updatedAt: new Date().toISOString(),
    lastEnsureAt: new Date().toISOString(),
  } satisfies RunpodState);
}

/**
 * Ensure a worker pod is RUNNING. Prefer resume of a stopped pod (keeps volume).
 * Returns the pod id that should be processing the queue.
 */
export async function ensureRunpodWorkerRunning(): Promise<{
  podId: string;
  action: "already_running" | "started" | "created";
}> {
  const configuredPodId = optionalEnv("RUNPOD_POD_ID");
  const state = await loadRunpodState();
  const candidateId = configuredPodId || state?.podId;

  if (candidateId) {
    const pod = await getRunpodPod(candidateId);
    if (pod && isPodRunning(pod)) {
      await saveRunpodState(candidateId);
      return { podId: candidateId, action: "already_running" };
    }
    if (pod && isPodStopped(pod)) {
      console.log(`[runpod] starting stopped pod ${candidateId}`);
      await startRunpodPod(candidateId);
      await saveRunpodState(candidateId);
      return { podId: candidateId, action: "started" };
    }
    // Pod missing/terminated — fall through to create if template configured.
    console.warn(`[runpod] pod ${candidateId} unavailable; will create from template if set`);
  }

  if (!optionalEnv("RUNPOD_TEMPLATE_ID")) {
    throw new Error(
      "No running RunPod worker and RUNPOD_TEMPLATE_ID is unset. Set RUNPOD_POD_ID to a stopped pod, or RUNPOD_TEMPLATE_ID to create one."
    );
  }

  console.log("[runpod] creating pod from template…");
  const podId = await createRunpodPodFromTemplate();
  await saveRunpodState(podId);
  return { podId, action: "created" };
}

export async function stopRunpodWorkerIfIdle(): Promise<{ stopped: boolean; podId?: string }> {
  const configuredPodId = optionalEnv("RUNPOD_POD_ID");
  const state = await loadRunpodState();
  const podId = configuredPodId || state?.podId || optionalEnv("RUNPOD_POD_ID");
  // Prefer explicit env on the pod itself.
  const selfId = process.env.RUNPOD_POD_ID?.trim() || podId;
  if (!selfId) return { stopped: false };

  const pod = await getRunpodPod(selfId);
  if (!pod || !isPodRunning(pod)) return { stopped: false, podId: selfId };

  console.log(`[runpod] stopping idle pod ${selfId}`);
  await stopRunpodPod(selfId);
  return { stopped: true, podId: selfId };
}
