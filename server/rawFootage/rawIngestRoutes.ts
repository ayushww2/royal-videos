import type { Express, Request, Response, NextFunction } from "express";
import {
  claimRawIngest,
  completeRawIngest,
  failRawIngest,
  getRawIngestQueueItem,
  progressRawIngest,
  rawIngestWorkerSecret,
} from "./rawIngestQueue.js";
import { noteIngestWorkerHeartbeat } from "./runpodIngestClient.js";
import { startPipelineAfterIngest } from "./startPipelineAfterIngest.js";
import type { UserYoutubeRawIngestResult } from "../../shared/visualIntelligence.js";

function requireWorkerAuth(req: Request, res: Response, next: NextFunction) {
  const secret = rawIngestWorkerSecret();
  if (!secret) {
    return res.status(503).json({ error: "Raw ingest worker secret not configured" });
  }
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/** Register BEFORE session requireAuth — worker uses Bearer secret. */
export function registerRawIngestWorkerRoutes(app: Express): void {
  app.get("/api/raw-ingest/health", requireWorkerAuth, async (req, res) => {
    const workerId = String(req.query.workerId || "ingest-worker");
    await noteIngestWorkerHeartbeat(workerId);
    res.json({ ok: true });
  });

  app.post("/api/raw-ingest/claim", requireWorkerAuth, async (req, res) => {
    const workerId = String(req.body?.workerId || "ingest-worker");
    await noteIngestWorkerHeartbeat(workerId);
    const item = await claimRawIngest(workerId);
    if (!item) return res.json({ job: null });
    res.json({ job: item });
  });

  app.post("/api/raw-ingest/:jobId/progress", requireWorkerAuth, async (req, res) => {
    const jobId = req.params.jobId;
    const progress = {
      stage: String(req.body?.stage || "progress"),
      message: String(req.body?.message || ""),
      percent: typeof req.body?.percent === "number" ? req.body.percent : undefined,
    };
    await progressRawIngest(jobId, progress);
    res.json({ ok: true });
  });

  app.post("/api/raw-ingest/:jobId/complete", requireWorkerAuth, async (req, res) => {
    const jobId = req.params.jobId;
    const result = req.body?.result as UserYoutubeRawIngestResult | undefined;
    if (!result || !Array.isArray(result.clips)) {
      return res.status(400).json({ error: "result with clips[] required" });
    }
    const job = await completeRawIngest(jobId, result);
    if (!job) return res.status(404).json({ error: "Job not found" });
    startPipelineAfterIngest(jobId);
    res.json({ ok: true, job });
  });

  app.post("/api/raw-ingest/:jobId/fail", requireWorkerAuth, async (req, res) => {
    const jobId = req.params.jobId;
    const error = String(req.body?.error || "raw ingest failed");
    const job = await failRawIngest(jobId, error);
    if (!job) return res.status(404).json({ error: "Job not found" });
    // Soft-fail: continue documentary with images only.
    startPipelineAfterIngest(jobId);
    res.json({ ok: true, job });
  });
}

/** Register AFTER session requireAuth — dashboard status. */
export function registerRawIngestAppRoutes(app: Express): void {
  app.get("/api/raw-ingest/:jobId", async (req, res) => {
    const item = await getRawIngestQueueItem(req.params.jobId);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json({ item });
  });
}
