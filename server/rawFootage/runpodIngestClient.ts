/**
 * Minimal RunPod wake helper for the YouTube raw ingest worker.
 * Mirrors the intended render-worker pattern: orchestrator wakes a stopped pod; worker claims jobs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config, optionalEnv } from "../config.js";
import { writeJson, readJson } from "../storage.js";

type RunpodIngestState = {
  lastWakeAt?: string;
  lastPodId?: string;
  lastError?: string;
};

const STATE_FILE = () => path.join(config.dataPath, "runpod-ingest-worker-state.json");

async function loadState(): Promise<RunpodIngestState> {
  return (await readJson<RunpodIngestState>(STATE_FILE())) || {};
}

async function saveState(state: RunpodIngestState): Promise<void> {
  await writeJson(STATE_FILE(), state);
}

/**
 * Best-effort: start a stopped ingest pod via RunPod REST API.
 * No-op when RUNPOD_API_KEY / pod id are unset (worker can still be started manually).
 */
export async function ensureRunpodIngestWorkerRunning(): Promise<{ ok: boolean; detail: string }> {
  const apiKey = optionalEnv("RUNPOD_API_KEY");
  const podId = optionalEnv("RUNPOD_INGEST_POD_ID") || optionalEnv("RUNPOD_POD_ID");
  if (!apiKey || !podId) {
    return {
      ok: false,
      detail: "RUNPOD_API_KEY / RUNPOD_INGEST_POD_ID not set — start ingest worker manually",
    };
  }

  const state = await loadState();
  const last = state.lastWakeAt ? Date.parse(state.lastWakeAt) : 0;
  if (last && Date.now() - last < 30_000) {
    return { ok: true, detail: "recently woken" };
  }

  try {
    const res = await fetch(`https://rest.runpod.io/v1/pods/${podId}/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      // Some accounts use /resume
      const res2 = await fetch(`https://api.runpod.io/graphql`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `mutation { resumePod(podId: "${podId}") { id desiredStatus } }`,
        }),
      });
      if (!res2.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`RunPod start failed ${res.status}: ${text.slice(0, 300)}`);
      }
    }
    await saveState({ lastWakeAt: new Date().toISOString(), lastPodId: podId });
    return { ok: true, detail: `woke pod ${podId}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await saveState({ ...state, lastError: message, lastPodId: podId });
    return { ok: false, detail: message };
  }
}

export async function noteIngestWorkerHeartbeat(workerId: string): Promise<void> {
  const dir = path.join(config.dataPath, "raw-ingest-heartbeats");
  await fs.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, `${workerId}.json`), {
    workerId,
    at: new Date().toISOString(),
  });
}
