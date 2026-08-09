import fs from "node:fs/promises";
import path from "node:path";
import { config, optionalEnv } from "../config.js";
import { loadJob, saveJob, writeJson, readJson } from "../storage.js";
import { ensureRunpodIngestWorkerRunning } from "./runpodIngestClient.js";
import type {
  JobRecord,
  NicheStyle,
  UserYoutubeRawIngestResult,
} from "../../shared/visualIntelligence.js";
import { YOUTUBE_RAW_SUPPORTED_NICHES } from "../../shared/visualIntelligence.js";

export type RawIngestQueueItem = {
  jobId: string;
  urls: string[];
  niche: NicheStyle;
  title: string;
  targetDurationSec?: number;
  status: "queued" | "claimed" | "completed" | "failed";
  queuedAt: string;
  claimedAt?: string;
  completedAt?: string;
  workerId?: string;
  progress?: { stage: string; message: string; percent?: number };
  error?: string;
  resultSummary?: string;
};

const QUEUE_FILE = () => path.join(config.dataPath, "raw-ingest-queue.json");

type QueueState = { items: RawIngestQueueItem[] };

async function loadQueue(): Promise<QueueState> {
  return (await readJson<QueueState>(QUEUE_FILE())) || { items: [] };
}

async function saveQueue(state: QueueState): Promise<void> {
  await writeJson(QUEUE_FILE(), state);
}

export function nicheSupportsYoutubeRaw(niche: NicheStyle): boolean {
  return YOUTUBE_RAW_SUPPORTED_NICHES.includes(niche);
}

export async function queueRawIngest(params: {
  jobId: string;
  urls: string[];
  niche: NicheStyle;
  title: string;
  targetDurationSec?: number;
}): Promise<RawIngestQueueItem> {
  const state = await loadQueue();
  const existing = state.items.find((i) => i.jobId === params.jobId && i.status === "queued");
  if (existing) {
    // Still wake the worker — retries used to early-return and leave jobs orphaned when the pod was stopped.
    void ensureRunpodIngestWorkerRunning().catch((err) => {
      console.warn("[raw-ingest] wake worker failed", err);
    });
    return existing;
  }

  const item: RawIngestQueueItem = {
    jobId: params.jobId,
    urls: params.urls,
    niche: params.niche,
    title: params.title,
    targetDurationSec: params.targetDurationSec,
    status: "queued",
    queuedAt: new Date().toISOString(),
  };
  state.items = state.items.filter((i) => i.jobId !== params.jobId);
  state.items.push(item);
  await saveQueue(state);

  const job = await loadJob(params.jobId);
  if (job) {
    job.status = "raw_ingest_queued";
    job.rawIngestStatus = "queued";
    job.rawIngestError = undefined;
    job.updatedAt = new Date().toISOString();
    await saveJob(job);
  }

  // Best-effort wake; queue remains claimable even if wake fails.
  void ensureRunpodIngestWorkerRunning().catch((err) => {
    console.warn("[raw-ingest] wake worker failed", err);
  });

  return item;
}

export async function claimRawIngest(workerId: string): Promise<RawIngestQueueItem | null> {
  const state = await loadQueue();
  const item = state.items.find((i) => i.status === "queued");
  if (!item) return null;
  item.status = "claimed";
  item.claimedAt = new Date().toISOString();
  item.workerId = workerId;
  await saveQueue(state);

  const job = await loadJob(item.jobId);
  if (job) {
    job.status = "raw_ingesting";
    job.rawIngestStatus = "ingesting";
    job.updatedAt = new Date().toISOString();
    await saveJob(job);
  }
  return item;
}

export async function progressRawIngest(
  jobId: string,
  progress: { stage: string; message: string; percent?: number }
): Promise<void> {
  const state = await loadQueue();
  const item = state.items.find((i) => i.jobId === jobId);
  if (item) {
    item.progress = progress;
    await saveQueue(state);
  }
}

export async function completeRawIngest(
  jobId: string,
  result: UserYoutubeRawIngestResult
): Promise<JobRecord | null> {
  const state = await loadQueue();
  const item = state.items.find((i) => i.jobId === jobId);
  if (item) {
    item.status = "completed";
    item.completedAt = new Date().toISOString();
    item.resultSummary = result.analysisSummary;
    item.progress = { stage: "done", message: result.analysisSummary, percent: 100 };
    await saveQueue(state);
  }

  const job = await loadJob(jobId);
  if (!job) return null;
  job.userYoutubeRawIngest = result;
  job.rawIngestStatus = "ready";
  job.rawIngestError = undefined;
  job.status = "raw_ready";
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  await fs.mkdir(path.join(config.storagePath, "jobs", jobId), { recursive: true });
  return job;
}

export async function failRawIngest(jobId: string, error: string): Promise<JobRecord | null> {
  const state = await loadQueue();
  const item = state.items.find((i) => i.jobId === jobId);
  if (item) {
    item.status = "failed";
    item.completedAt = new Date().toISOString();
    item.error = error;
    await saveQueue(state);
  }

  const job = await loadJob(jobId);
  if (!job) return null;
  job.rawIngestStatus = "failed";
  job.rawIngestError = error;
  job.status = "raw_ingest_failed";
  job.userYoutubeRawIngest = {
    clips: [],
    analysisSummary: `Ingest failed: ${error}`,
    usableDurationSec: 0,
    meanQuality: 0,
    topicCoverage: 0,
    usableScore: 0,
    rawTargetPercent: 20,
    effectiveRawTargetPercent: 0,
    rawReducedReason: "ingest failed",
    completedAt: new Date().toISOString(),
  };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  return job;
}

export async function getRawIngestQueueItem(jobId: string): Promise<RawIngestQueueItem | null> {
  const state = await loadQueue();
  return state.items.find((i) => i.jobId === jobId) || null;
}

export function rawIngestWorkerSecret(): string | undefined {
  return optionalEnv("RUNPOD_WORKER_SECRET") || optionalEnv("RAW_INGEST_WORKER_SECRET");
}
