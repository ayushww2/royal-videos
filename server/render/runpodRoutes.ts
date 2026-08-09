import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { config, optionalEnv } from "../config.js";
import {
  claimNextRunpodJob,
  completeRunpodJob,
  completeRunpodJobFromUrl,
  countRenderQueue,
  failRunpodJob,
  reportRunpodProgress,
  type RunpodQueuedPayload,
} from "./runpodQueue.js";
import { stopRunpodWorkerIfIdle } from "./runpodClient.js";
import { jobDataFile, readJson } from "../storage.js";

function workerSecret(): string | undefined {
  return optionalEnv("RUNPOD_WORKER_SECRET");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function extractBearer(req: Request): string {
  const header = String(req.headers.authorization || "");
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return String(req.headers["x-runpod-worker-secret"] || "").trim();
}

export function requireRunpodWorkerAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = workerSecret();
  if (!expected) {
    res.status(503).json({ error: "RUNPOD_WORKER_SECRET is not configured on the server" });
    return;
  }
  const provided = extractBearer(req);
  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ error: "Invalid RunPod worker secret" });
    return;
  }
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const jobId = String(req.params.jobId || "tmp");
      const dest = path.join(config.storagePath, "renders", jobId, "incoming");
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      cb(null, file.originalname || "final.mp4");
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

/**
 * Worker-facing routes (auth via RUNPOD_WORKER_SECRET).
 * Register BEFORE the session requireAuth middleware.
 */
export function registerRunpodWorkerRoutes(app: Express): void {
  const auth = requireRunpodWorkerAuth;

  app.get("/api/render-queue", auth, async (_req, res) => {
    try {
      const snap = await countRenderQueue();
      res.json({ ok: true, ...snap });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/render-queue/claim", auth, async (_req, res) => {
    try {
      const job = await claimNextRunpodJob();
      if (!job) return res.json({ ok: true, job: null });
      res.json({ ok: true, job });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Serverless worker fetches full inputProps when /run payload is too large. */
  app.get("/api/render-queue/:jobId/props", auth, async (req, res) => {
    try {
      const payload = await readJson<RunpodQueuedPayload>(
        jobDataFile("remotion-input-props-full", req.params.jobId)
      );
      if (!payload?.inputProps) {
        return res.status(404).json({ error: "Props not found for job" });
      }
      res.json({
        ok: true,
        jobId: payload.jobId,
        compositionId: payload.compositionId,
        inputProps: payload.inputProps,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Worker uploaded to R2 and reports the public URL (no multipart). */
  app.post("/api/render-queue/:jobId/complete-url", auth, async (req, res) => {
    try {
      const outputUrl = String(req.body?.outputUrl || "").trim();
      if (!outputUrl) {
        return res.status(400).json({ error: "Missing outputUrl" });
      }
      const r2Key = req.body?.r2Key ? String(req.body.r2Key) : undefined;
      const durationInFrames = req.body?.durationInFrames
        ? Number(req.body.durationInFrames)
        : undefined;
      const result = await completeRunpodJobFromUrl({
        jobId: req.params.jobId,
        outputUrl,
        r2Key,
        durationInFrames: Number.isFinite(durationInFrames) ? durationInFrames : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/render-queue/:jobId/progress", auth, async (req, res) => {
    try {
      const progress = Number(req.body?.progress ?? req.body?.pct ?? 0);
      const normalized = progress > 1 ? progress / 100 : progress;
      await reportRunpodProgress(req.params.jobId, normalized);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post(
    "/api/render-queue/:jobId/complete",
    auth,
    upload.single("file"),
    async (req, res) => {
      try {
        const filePath = req.file?.path;
        if (!filePath) {
          return res.status(400).json({ error: "Missing multipart file field `file` (final.mp4)" });
        }
        const durationInFrames = req.body?.durationInFrames
          ? Number(req.body.durationInFrames)
          : undefined;
        const result = await completeRunpodJob({
          jobId: req.params.jobId,
          uploadedPath: filePath,
          durationInFrames: Number.isFinite(durationInFrames) ? durationInFrames : undefined,
        });
        res.json({ ok: true, ...result });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.post("/api/render-queue/:jobId/fail", auth, async (req, res) => {
    try {
      const error = String(req.body?.error || "RunPod render failed");
      await failRunpodJob(req.params.jobId, error);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Worker asks Railway to stop the idle pod (or stops itself if API key is on pod). */
  app.post("/api/render-queue/stop-idle", auth, async (_req, res) => {
    try {
      const snap = await countRenderQueue();
      if (snap.queued > 0 || snap.rendering > 0) {
        return res.json({
          ok: true,
          stopped: false,
          reason: "queue_not_empty",
          ...snap,
        });
      }
      const result = await stopRunpodWorkerIfIdle();
      res.json({ ok: true, ...result, ...snap });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
