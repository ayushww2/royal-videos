/**
 * RunPod (or any cloud) YouTube raw ingest worker.
 *
 * Env:
 *   APP_BASE_URL / PUBLIC_APP_URL — Railway/app API base
 *   RUNPOD_WORKER_SECRET or RAW_INGEST_WORKER_SECRET
 *   YT_COOKIES_PATH — Netscape cookies.txt on the pod volume
 *   YTDLP_PROXY — optional residential proxy
 *   R2_* / OPENAI_* — upload + vision
 *
 * Usage:
 *   npm run runpod:ingest-worker
 */
import { randomUUID } from "node:crypto";
import { ingestUserYoutubeRaw } from "../server/rawFootage/youtubeIngest.js";

const APP_BASE =
  (process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(
    /\/$/,
    ""
  );
const SECRET =
  process.env.RUNPOD_WORKER_SECRET?.trim() || process.env.RAW_INGEST_WORKER_SECRET?.trim() || "";
const WORKER_ID = process.env.RAW_INGEST_WORKER_ID?.trim() || `ingest-${randomUUID().slice(0, 8)}`;
const POLL_MS = Number(process.env.RAW_INGEST_POLL_MS || 5000);
const IDLE_STOP_MS = Number(process.env.RAW_INGEST_IDLE_STOP_MS || 10 * 60 * 1000);

if (!SECRET) {
  console.error("Missing RUNPOD_WORKER_SECRET / RAW_INGEST_WORKER_SECRET");
  process.exit(1);
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${APP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

async function maybeIdleStop(idleSince: number): Promise<void> {
  if (Date.now() - idleSince < IDLE_STOP_MS) return;
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  const podId = process.env.RUNPOD_INGEST_POD_ID?.trim() || process.env.RUNPOD_POD_ID?.trim();
  if (!apiKey || !podId) {
    console.log("[ingest-worker] idle timeout reached (no pod stop configured)");
    return;
  }
  console.log(`[ingest-worker] idle ${IDLE_STOP_MS}ms — stopping pod ${podId}`);
  try {
    await fetch(`https://rest.runpod.io/v1/pods/${podId}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    console.warn("[ingest-worker] stop pod failed", err);
  }
}

async function main() {
  console.log(`[ingest-worker] starting ${WORKER_ID} → ${APP_BASE}`);
  let idleSince = Date.now();

  for (;;) {
    try {
      const claimRes = await api("/api/raw-ingest/claim", {
        method: "POST",
        body: JSON.stringify({ workerId: WORKER_ID }),
      });
      if (!claimRes.ok) {
        console.warn(`[ingest-worker] claim HTTP ${claimRes.status}`);
        await new Promise((r) => setTimeout(r, POLL_MS));
        await maybeIdleStop(idleSince);
        continue;
      }
      const claimJson = (await claimRes.json()) as {
        job: null | {
          jobId: string;
          urls: string[];
          niche: string;
          title: string;
          targetDurationSec?: number;
        };
      };

      if (!claimJson.job) {
        await maybeIdleStop(idleSince);
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }

      idleSince = Date.now();
      const job = claimJson.job;
      console.log(`[ingest-worker] claimed ${job.jobId} urls=${job.urls.length}`);

      try {
        const result = await ingestUserYoutubeRaw({
          jobId: job.jobId,
          niche: job.niche as never,
          title: job.title,
          urls: job.urls,
          targetDurationSec: job.targetDurationSec,
          onProgress: async (p) => {
            await api(`/api/raw-ingest/${job.jobId}/progress`, {
              method: "POST",
              body: JSON.stringify(p),
            }).catch(() => undefined);
          },
        });

        const completeRes = await api(`/api/raw-ingest/${job.jobId}/complete`, {
          method: "POST",
          body: JSON.stringify({ result }),
        });
        if (!completeRes.ok) {
          throw new Error(`complete HTTP ${completeRes.status}: ${await completeRes.text()}`);
        }
        console.log(`[ingest-worker] completed ${job.jobId}: ${result.analysisSummary}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ingest-worker] failed ${job.jobId}`, message);
        await api(`/api/raw-ingest/${job.jobId}/fail`, {
          method: "POST",
          body: JSON.stringify({ error: message }),
        }).catch(() => undefined);
      }
      idleSince = Date.now();
    } catch (err) {
      console.warn("[ingest-worker] loop error", err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
