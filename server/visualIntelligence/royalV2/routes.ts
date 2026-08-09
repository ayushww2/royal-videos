import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { loadJob, readJson, saveJob, jobDataFile } from "../../storage.js";
import type {
  JobRecord,
  RoyalBulkBatch,
  RoyalManagerSummary,
} from "../../../shared/visualIntelligence.js";
import { handleRoyalV2Assistant } from "./assistant.js";
import { lockRoyalV2Timeline, unlockRoyalV2Timeline } from "./lock.js";
import { royalAssetPreviewUrl, searchRoyalLibrary } from "./library.js";
import {
  enqueueRoyalV2Job,
  listRoyalV2Batches,
  loadRoyalV2Batch,
  royalV2QueueSnapshot,
  saveRoyalV2Batch,
} from "./queue.js";

async function enrichedBatch(batch: RoyalBulkBatch) {
  const jobs = (
    await Promise.all(
      batch.jobIds.map(async (jobId) => {
        const job = await loadJob(jobId);
        if (!job) return null;
        const summary = await readJson<RoyalManagerSummary>(
          jobDataFile("royal-v2-manager-summary", jobId)
        );
        return { ...job, managerSummary: summary };
      })
    )
  ).filter(Boolean);
  return { ...batch, jobs };
}

export function registerRoyalV2Routes(app: Express): void {
  app.get("/api/royal-v2/batches", async (_req, res) => {
    try {
      const batches = await listRoyalV2Batches();
      res.json({
        batches: await Promise.all(batches.map(enrichedBatch)),
        queue: royalV2QueueSnapshot(),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/royal-v2/batches/:batchId", async (req, res) => {
    const batch = await loadRoyalV2Batch(req.params.batchId);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    res.json({ batch: await enrichedBatch(batch), queue: royalV2QueueSnapshot() });
  });

  app.post("/api/royal-v2/batches", async (req, res) => {
    try {
      const requestedIds = Array.isArray(req.body?.jobIds) ? req.body.jobIds.map(String) : [];
      const specs = Array.isArray(req.body?.jobs) ? req.body.jobs : [];
      if (!requestedIds.length && !specs.length) {
        return res.status(400).json({ error: "Provide Royal v2 jobIds or jobs[]" });
      }
      if (requestedIds.length + specs.length > 50) {
        return res.status(400).json({ error: "Royal v2 batches support up to 50 jobs" });
      }

      const batchId = randomUUID();
      const jobIds: string[] = [];
      for (const id of requestedIds) {
        const job = await loadJob(id);
        if (!job || job.niche !== "Royal v2") {
          return res.status(400).json({ error: `Not a Royal v2 job: ${id}` });
        }
        job.batchId = batchId;
        await saveJob(job);
        jobIds.push(id);
      }
      for (const input of specs) {
        const script = String(input?.script || "").trim();
        if (!script) return res.status(400).json({ error: "Every inline batch job requires script" });
        const now = new Date().toISOString();
        const customEditInstructions =
          String(input?.customEditInstructions || "").trim() || undefined;
        const job: JobRecord = {
          jobId: randomUUID(),
          batchId,
          title: String(input?.title || "Untitled Royal Documentary").trim(),
          niche: "Royal v2",
          script,
          customEditInstructions,
          rawFootagePaths: [],
          uploadedAssetPaths: [],
          status: "queued",
          progressPercent: 0,
          createdAt: now,
          updatedAt: now,
          sceneApprovals: {},
          render: { status: "idle" },
        };
        await saveJob(job);
        jobIds.push(job.jobId);
      }

      const now = new Date().toISOString();
      const batch: RoyalBulkBatch = {
        batchId,
        name: String(req.body?.name || `Royal batch ${now.slice(0, 10)}`),
        jobIds,
        status: "queued",
        concurrency: royalV2QueueSnapshot().concurrency,
        createdAt: now,
        updatedAt: now,
      };
      await saveRoyalV2Batch(batch);
      for (const jobId of jobIds) await enqueueRoyalV2Job(jobId);
      res.status(201).json({ batch: await enrichedBatch(batch), queue: royalV2QueueSnapshot() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/royal-v2/jobs/:jobId/enqueue", async (req, res) => {
    try {
      await enqueueRoyalV2Job(req.params.jobId);
      res.json({ ok: true, queue: royalV2QueueSnapshot() });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/royal-v2/jobs/:jobId/manager-summary", async (req, res) => {
    const summary = await readJson<RoyalManagerSummary>(
      jobDataFile("royal-v2-manager-summary", req.params.jobId)
    );
    if (!summary) return res.status(404).json({ error: "Manager summary not available" });
    res.json({ summary });
  });

  app.post("/api/royal-v2/jobs/:jobId/assistant", async (req, res) => {
    try {
      res.json(await handleRoyalV2Assistant(req.params.jobId, req.body || {}));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/royal-v2/jobs/:jobId/lock", async (req, res) => {
    try {
      const result = await lockRoyalV2Timeline(
        req.params.jobId,
        String(req.body?.lockedBy || "manager")
      );
      res.json({ ok: true, lock: result });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/royal-v2/jobs/:jobId/unlock", async (req, res) => {
    if (req.body?.confirmed !== true) {
      return res.status(400).json({ error: "Unlock requires confirmed=true" });
    }
    try {
      await unlockRoyalV2Timeline(req.params.jobId, String(req.body?.unlockedBy || "manager"));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/royal-v2/library/search", async (req, res) => {
    try {
      const query = String(req.query.q || "");
      const mediaType =
        req.query.mediaType === "image" || req.query.mediaType === "raw_footage"
          ? req.query.mediaType
          : undefined;
      const assets = await searchRoyalLibrary(query, { mediaType, limit: Number(req.query.limit || 30) });
      res.json({
        assets: assets.map((asset) => ({
          ...asset,
          previewUrl: royalAssetPreviewUrl(asset),
        })),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

