import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  config,
  checkRequiredApis,
  checkRenderApis,
  getRenderer,
  getRendererForJob,
  getElevenLabsKeyOptional,
} from "./config.js";
import {
  generateElevenLabsVoiceover,
  listElevenLabsOptions,
  DEFAULT_ELEVENLABS_VOICE_ID,
  DEFAULT_ELEVENLABS_MODEL_ID,
} from "./elevenlabsClient.js";
import { ensureDirs, jobDir, loadJob, listJobs, saveJob, readJson, writeJson, jobDataFile } from "./storage.js";
import { loadScenes } from "./visualIntelligence/pipeline.js";
import {
  enqueuePipelineJob,
  pipelineQueueSnapshot,
  resumePipelineQueue,
} from "./visualIntelligence/pipelineQueue.js";
import { renderJob } from "./render/renderJob.js";
import { assembleTimeline } from "./visualIntelligence/timelineAssembly.js";
import { runFinalQA } from "./visualIntelligence/finalQA.js";
import {
  registerLibraryRoutes,
  registerPublicLibraryRenderRoute,
} from "./library/routes.js";
import { registerPublicRenderStorageRoute } from "./render/storageMedia.js";
import { registerRunpodWorkerRoutes } from "./render/runpodRoutes.js";
import { registerRoyalV2Routes } from "./visualIntelligence/royalV2/routes.js";
import { registerEditorSearchRoutes } from "./visualIntelligence/royalV2/editorSearch.js";
import { registerEditorChatRoutes } from "./visualIntelligence/royalV2/editorChatRoutes.js";
import { registerMysteryV2Routes } from "./visualIntelligence/mysteryV2/routes.js";
import { registerKnowledgeEditorRoutes } from "./visualIntelligence/knowledgeEditorRoutes.js";
import {
  enqueueRoyalV2Job,
} from "./visualIntelligence/royalV2/queue.js";
import { loadVerifiedRoyalV2Timeline } from "./visualIntelligence/royalV2/lock.js";
import {
  registerRawIngestAppRoutes,
  registerRawIngestWorkerRoutes,
} from "./rawFootage/rawIngestRoutes.js";
import { nicheSupportsYoutubeRaw, queueRawIngest } from "./rawFootage/rawIngestQueue.js";
import { parseUserYoutubeRawUrls } from "./rawFootage/youtubeUrls.js";
import {
  clearSessionCookie,
  isAuthenticated,
  requireAuth,
  setSessionCookie,
  validateCredentials,
} from "./auth.js";
import type { ApprovedVisual, JobRecord, NicheStyle, TimelineScene } from "../shared/visualIntelligence.js";
import { JOB_STATUS_LABELS, WORDS_PER_MINUTE } from "../shared/visualIntelligence.js";
import type { EffectTimelineEvent } from "./visualIntelligence/effectPlanner.js";

await ensureDirs();

function toMediaUrl(filePathOrUrl?: string): string | undefined {
  if (!filePathOrUrl) return undefined;
  if (/^https?:\/\//i.test(filePathOrUrl)) return filePathOrUrl;
  if (filePathOrUrl.startsWith("/")) return filePathOrUrl;
  const normalized = path.resolve(filePathOrUrl);
  const storageRoot = path.resolve(config.storagePath);
  if (normalized.startsWith(storageRoot)) {
    const rel = normalized.slice(storageRoot.length).replace(/\\/g, "/").replace(/^\//, "");
    return `/media/${rel}`;
  }
  return undefined;
}

function enrichScene(scene: TimelineScene, libraryById: Map<string, ApprovedVisual>) {
  const visual = libraryById.get(scene.approvedVisualId || scene.selectedVisualId);
  return {
    ...scene,
    previewUrl: toMediaUrl(visual?.filePathOrUrl) || toMediaUrl(visual?.thumbnail),
    fromApprovedLibrary: Boolean(scene.approvedVisualId && !scene.fallbackUsed),
    libraryVisual: visual
      ? {
          approvedVisualId: visual.approvedVisualId,
          source: visual.source,
          queryPackId: visual.queryPackId,
          bestUseCase: visual.bestUseCase,
        }
      : null,
  };
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");
  if (!validateCredentials(username, password)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  setSessionCookie(res);
  res.json({ ok: true, username });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
  res.json({ ok: true, username: process.env.APP_USERNAME?.trim() || "ayush" });
});

registerPublicLibraryRenderRoute(app);
registerPublicRenderStorageRoute(app);
registerRawIngestWorkerRoutes(app);
registerRunpodWorkerRoutes(app);
app.use(requireAuth);
registerLibraryRoutes(app);
registerRoyalV2Routes(app);
registerMysteryV2Routes(app);
registerRawIngestAppRoutes(app);
registerEditorSearchRoutes(app);
registerEditorChatRoutes(app);
registerKnowledgeEditorRoutes(app);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const jobId = String(req.params.jobId || req.body.jobId || "tmp");
      const dest = path.join(jobDir(jobId), "uploads");
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
    },
  }),
});

app.get("/api/health", (_req, res) => {
  const apis = checkRequiredApis();
  const renderApis = checkRenderApis();
  const renderer = getRenderer();
  res.json({
    ok: apis.ok,
    missing: apis.ok ? [] : apis.missing,
    pexelsConfigured: Boolean(process.env.PEXELS_API_KEY?.trim()),
    pixabayConfigured: Boolean(process.env.PIXABAY_API_KEY?.trim()),
    shotstackConfigured: Boolean(process.env.SHOTSTACK_API_KEY?.trim()),
    elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
    elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID,
    elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_ELEVENLABS_MODEL_ID,
    shotstackMissing: renderer === "shotstack" && !renderApis.ok ? renderApis.missing : [],
    shotstackNote:
      renderer === "shotstack"
        ? "Stage/sandbox key must have credits. If render returns 0 credits, top up at https://dashboard.shotstack.io/subscription"
        : "Shotstack optional — final MP4 uses Remotion effect pack",
    model: config.openaiModel,
    renderer,
    remotionReady: renderer === "remotion" || renderer === "remotion-lambda",
    remotionLambda: renderer === "remotion-lambda",
    runpodServerlessReady: Boolean(process.env.RUNPOD_SERVERLESS_ENDPOINT_ID?.trim()),
    runpodMode: process.env.RUNPOD_SERVERLESS_ENDPOINT_ID?.trim()
      ? "serverless"
      : process.env.RUNPOD_POD_ID?.trim() || process.env.RUNPOD_TEMPLATE_ID?.trim()
        ? "pod"
        : "none",
    storagePath: config.storagePath,
    dataPath: config.dataPath,
    persistentVolume: config.storagePath.startsWith("/data") || config.dataPath.startsWith("/data"),
    pipelineQueue: pipelineQueueSnapshot(),
    whisperConcurrency: Math.max(
      1,
      Math.min(3, Number(process.env.WHISPER_CONCURRENCY || "1") || 1),
    ),
  });
});

app.get("/api/elevenlabs/options", (_req, res) => {
  res.json(listElevenLabsOptions());
});

app.get("/api/jobs", async (_req, res) => {
  res.json({ jobs: await listJobs() });
});

app.get("/api/jobs/:jobId", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({
    job,
    statusLabel: JOB_STATUS_LABELS[job.status],
  });
});

/** Update optional custom edit instructions (and mirror into job data JSON). */
app.patch("/api/jobs/:jobId", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const body = (req.body || {}) as {
    customEditInstructions?: string | null;
    title?: string;
  };
  if (typeof body.title === "string" && body.title.trim()) {
    job.title = body.title.trim();
  }
  if (body.customEditInstructions !== undefined) {
    const text = String(body.customEditInstructions || "").trim();
    job.customEditInstructions = text || undefined;
    await writeJson(jobDataFile("custom-edit-instructions", job.jobId), {
      jobId: job.jobId,
      customEditInstructions: job.customEditInstructions || "",
      updatedAt: new Date().toISOString(),
    });
  }
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  res.json({ ok: true, job });
});

/** Live render / RunPod status for job detail polling. */
app.get("/api/jobs/:jobId/render-status", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  // Mystery v2 always reports RunPod even if global RENDERER=shotstack.
  const renderer = getRendererForJob(job.niche);
  const renderApis = checkRenderApis();
  const playableUrl =
    job.render?.outputUrl ||
    job.render?.shotstackUrl ||
    (job.render?.outputKey ? `/media/${job.render.outputKey}` : undefined);
  const serverlessReady = Boolean(process.env.RUNPOD_SERVERLESS_ENDPOINT_ID?.trim());
  const runpodKeysOk =
    Boolean(process.env.RUNPOD_API_KEY?.trim()) &&
    Boolean(process.env.RUNPOD_WORKER_SECRET?.trim()) &&
    (serverlessReady || Boolean(process.env.RUNPOD_POD_ID?.trim() || process.env.RUNPOD_TEMPLATE_ID?.trim()));
  res.json({
    jobId: job.jobId,
    status: job.status,
    progressPercent: job.render?.progressPercent ?? job.progressPercent ?? 0,
    render: job.render || { status: "idle" },
    playableUrl,
    localPath: job.render?.outputPath,
    r2Key: job.render?.r2Key,
    rendererConfigured: renderer,
    runpodReady: renderer === "runpod" && runpodKeysOk,
    runpodServerlessReady: renderer === "runpod" && runpodKeysOk && serverlessReady,
    runpodMode: serverlessReady ? "serverless" : "pod",
    setupError:
      renderer === "runpod"
        ? runpodKeysOk
          ? null
          : "Missing RunPod config: RUNPOD_API_KEY / RUNPOD_WORKER_SECRET / endpoint or pod"
        : renderApis.ok
          ? null
          : `Missing render config: ${renderApis.missing.join(", ")}`,
  });
});

app.post("/api/jobs", upload.fields([
  { name: "voiceover", maxCount: 1 },
  { name: "rawFootage", maxCount: 10 },
  { name: "scriptFile", maxCount: 1 },
]), async (req, res) => {
  const apis = checkRequiredApis();
  if (!apis.ok) {
    return res.status(400).json({
      error: `Missing required API keys: ${apis.missing.join(", ")}. Set them in Railway Variables or local .env`,
      missing: apis.missing,
    });
  }

  const jobId = randomUUID();
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  let script = String(req.body.script || "");
  const scriptFile = files?.scriptFile?.[0];
  if (scriptFile) {
    script = fs.readFileSync(scriptFile.path, "utf8");
  }
  if (!script.trim()) {
    return res.status(400).json({ error: "Script text or .txt upload is required" });
  }

  const niche = (req.body.niche || "Celebrity v1") as NicheStyle;
  const title = String(req.body.title || "Untitled Documentary").trim();
  const customEditInstructions = String(req.body.customEditInstructions || "").trim() || undefined;

  // Move uploads into job folder (multer may have used tmp if jobId wasn't known)
  const destUploads = path.join(jobDir(jobId), "uploads");
  fs.mkdirSync(destUploads, { recursive: true });

  const relocate = (file?: Express.Multer.File) => {
    if (!file) return undefined;
    const target = path.join(destUploads, path.basename(file.path));
    if (file.path !== target) {
      fs.renameSync(file.path, target);
    }
    return target;
  };

  const voiceoverMode = String(req.body.voiceoverMode || "upload").trim().toLowerCase();
  let voiceoverPath = relocate(files?.voiceover?.[0]);
  let voiceoverSource: JobRecord["voiceoverSource"] = voiceoverPath ? "upload" : undefined;
  let elevenLabsVoiceId: string | undefined;
  let elevenLabsModelId: string | undefined;

  if (voiceoverMode === "elevenlabs" && !voiceoverPath) {
    if (!getElevenLabsKeyOptional()) {
      return res.status(400).json({
        error: "ELEVENLABS_API_KEY is not set. Add it to .env or Railway Variables.",
      });
    }
    elevenLabsVoiceId = String(req.body.elevenLabsVoiceId || DEFAULT_ELEVENLABS_VOICE_ID).trim();
    elevenLabsModelId = String(req.body.elevenLabsModelId || DEFAULT_ELEVENLABS_MODEL_ID).trim();
    const outPath = path.join(destUploads, "voiceover.elevenlabs.mp3");
    try {
      const gen = await generateElevenLabsVoiceover({
        text: script,
        outPath,
        voiceId: elevenLabsVoiceId,
        modelId: elevenLabsModelId,
      });
      voiceoverPath = outPath;
      voiceoverSource = "elevenlabs";
      elevenLabsVoiceId = gen.voiceId;
      elevenLabsModelId = gen.modelId;
      console.log(
        `[job] ${jobId} elevenlabs VO voice=${gen.voiceId} model=${gen.modelId} chunks=${gen.chunks} bytes=${gen.bytes}`
      );
    } catch (err) {
      return res.status(502).json({
        error: `ElevenLabs voiceover failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const rawFootagePaths = (files?.rawFootage || []).map((f) => relocate(f)!).filter(Boolean);

  const parsedYt = parseUserYoutubeRawUrls(req.body.userYoutubeRawUrls);
  if (parsedYt.error) {
    return res.status(400).json({ error: parsedYt.error });
  }
  let userYoutubeRawUrls = parsedYt.urls;
  if (userYoutubeRawUrls.length && !nicheSupportsYoutubeRaw(niche)) {
    return res.status(400).json({
      error:
        "YouTube raw links are only supported for Celebrity v1, Mystery v1, Mystery v2, Space v1, and War v1",
    });
  }
  if (niche === "Royal v2") {
    userYoutubeRawUrls = [];
  }

  let voiceoverDurationSec: number | undefined;
  if (voiceoverPath) {
    try {
      const { probeMediaDurationSec } = await import("./visualIntelligence/jobDuration.js");
      const dur = await probeMediaDurationSec(voiceoverPath);
      if (dur > 1) voiceoverDurationSec = dur;
      console.log(`[job] ${jobId} voiceover duration=${dur.toFixed(2)}s`);
    } catch (err) {
      console.warn(`[job] ${jobId} voiceover probe failed`, err);
    }
  }

  const now = new Date().toISOString();
  const job: JobRecord = {
    jobId,
    title,
    niche,
    script,
    customEditInstructions,
    voiceoverPath,
    voiceoverDurationSec,
    voiceoverSource,
    elevenLabsVoiceId,
    elevenLabsModelId,
    rawFootagePaths,
    uploadedAssetPaths: [],
    userYoutubeRawUrls: userYoutubeRawUrls.length ? userYoutubeRawUrls : undefined,
    rawIngestStatus: userYoutubeRawUrls.length ? "queued" : "idle",
    status: userYoutubeRawUrls.length ? "raw_ingest_queued" : "uploaded",
    createdAt: now,
    updatedAt: now,
    sceneApprovals: {},
    render: { status: "idle" },
  };
  await saveJob(job);
  if (customEditInstructions) {
    await writeJson(jobDataFile("custom-edit-instructions", jobId), {
      jobId,
      customEditInstructions,
      updatedAt: now,
    });
  }

  // Optional cloud YouTube raw ingest runs before VI (Celebrity / Mystery / Space).
  if (userYoutubeRawUrls.length) {
    const words = script.trim().split(/\s+/).filter(Boolean).length;
    const targetDurationSec =
      voiceoverDurationSec || Math.max(60, Math.round((words / WORDS_PER_MINUTE) * 60));
    try {
      await queueRawIngest({
        jobId,
        urls: userYoutubeRawUrls,
        niche,
        title,
        targetDurationSec,
      });
    } catch (err) {
      console.error("Raw ingest queue failed", jobId, err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to queue YouTube raw ingest",
      });
    }
  } else if (job.niche === "Royal v2") {
    // Royal v2: batch bookkeeping + shared pipeline concurrency gate.
    void enqueueRoyalV2Job(jobId).catch((err) => {
      console.error("Royal v2 queue failed", jobId, err);
    });
  } else {
    // All niches share PIPELINE_WORKER_CONCURRENCY (default 4).
    void enqueuePipelineJob(jobId).catch((err) => {
      console.error("Pipeline queue failed", jobId, err);
    });
  }

  res.status(201).json({ job });
});

/**
 * Inject precomputed Whisper alignment + optional compressed VO (under 25MB).
 * Used when Railway ffmpeg/Whisper would stall on large ElevenLabs files.
 */
app.post(
  "/api/jobs/:jobId/inject-voice-alignment",
  upload.single("voiceover"),
  async (req, res) => {
    const job = await loadJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const body = (req.body || {}) as {
      alignmentJson?: string;
      voiceoverUrl?: string;
      replaceOriginal?: string | boolean;
    };

    let alignment: unknown = null;
    if (body.alignmentJson) {
      try {
        alignment = JSON.parse(body.alignmentJson);
      } catch {
        return res.status(400).json({ error: "alignmentJson is not valid JSON" });
      }
    } else if (req.is("application/json") && (req.body as { words?: unknown })?.words) {
      alignment = req.body;
    }

    const uploadsDir = path.join(jobDir(job.jobId), "uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });

    let replacedVoiceover = false;
    const replaceOriginal =
      body.replaceOriginal === true ||
      body.replaceOriginal === "1" ||
      body.replaceOriginal === "true" ||
      req.query.replace === "1";

    try {
      if (req.file?.path) {
        const dest = path.join(uploadsDir, "voiceover.whisper64k.mp3");
        fs.copyFileSync(req.file.path, dest);
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* ignore */
        }
        if (replaceOriginal && job.voiceoverPath) {
          fs.copyFileSync(dest, job.voiceoverPath);
          replacedVoiceover = true;
        } else if (!job.voiceoverPath) {
          job.voiceoverPath = dest;
          replacedVoiceover = true;
        }
      } else if (body.voiceoverUrl && /^https?:\/\//i.test(body.voiceoverUrl)) {
        const dest = path.join(uploadsDir, "voiceover.whisper64k.mp3");
        const resp = await fetch(body.voiceoverUrl);
        if (!resp.ok) {
          return res.status(400).json({
            error: `Failed to download voiceoverUrl (${resp.status})`,
          });
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length > 25 * 1024 * 1024) {
          return res.status(400).json({ error: "Downloaded VO exceeds 25MB" });
        }
        fs.writeFileSync(dest, buf);
        if (replaceOriginal && job.voiceoverPath) {
          fs.copyFileSync(dest, job.voiceoverPath);
          replacedVoiceover = true;
        }
      }
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (alignment && typeof alignment === "object") {
      const report = {
        ...(alignment as Record<string, unknown>),
        jobId: job.jobId,
        status: "ready",
        source: "openai_whisper",
        voiceoverPath: job.voiceoverPath,
        voiceoverDurationSec:
          (alignment as { voiceoverDurationSec?: number }).voiceoverDurationSec ||
          job.voiceoverDurationSec,
        createdAt: new Date().toISOString(),
      };
      await writeJson(jobDataFile("voice-alignment", job.jobId), report);
    }

    job.updatedAt = new Date().toISOString();
    await saveJob(job);
    const saved = await readJson<{ words?: unknown[]; status?: string }>(
      jobDataFile("voice-alignment", job.jobId)
    );
    res.json({
      ok: true,
      replacedVoiceover,
      alignmentStatus: saved?.status || null,
      wordCount: Array.isArray(saved?.words) ? saved!.words!.length : 0,
      voiceoverPath: job.voiceoverPath,
    });
  }
);

app.post("/api/jobs/:jobId/retry", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const body = (req.body || {}) as { force?: boolean; skipRawIngest?: boolean };
  const force =
    req.query.force === "1" ||
    req.query.force === "true" ||
    Boolean(body.force);
  const skipRawIngest =
    req.query.skipRawIngest === "1" ||
    req.query.skipRawIngest === "true" ||
    Boolean(body.skipRawIngest);
  const processing = [
    "raw_ingest_queued",
    "raw_ingesting",
    "analyzing_full_script",
    "creating_visual_beats",
    "creating_query_packs",
    "collecting_visual_candidates",
    "judging_candidates",
    "building_approved_visual_library",
    "assembling_timeline",
    "queued",
    "script_analysis",
    "beat_breakdown",
    "library_candidate_collection",
    "visual_assignment",
    "repetition_audit",
    "weak_scene_repair",
    "effect_planning",
    "rendering",
  ].includes(job.status);
  if (processing && !force) {
    return res.status(400).json({ error: "Job is already processing" });
  }
  // Requeue YouTube raw only when we have no usable clips yet.
  // Force alone must NOT wipe a ready ingest (zombie restart after deploy).
  // Force DOES clear a prior failed/skipped ingest so Celebrity can recover raw %.
  const hasUsableYtClips = (job.userYoutubeRawIngest?.clips?.length || 0) > 0;
  const requeueYt =
    !skipRawIngest &&
    Boolean(job.userYoutubeRawUrls?.length) &&
    nicheSupportsYoutubeRaw(job.niche) &&
    !hasUsableYtClips &&
    (force || job.rawIngestStatus !== "failed");
  job.status = requeueYt ? "raw_ingest_queued" : "uploaded";
  job.error = undefined;
  job.render = { status: "idle" };
  if (skipRawIngest && job.userYoutubeRawUrls?.length) {
    job.rawIngestStatus = "failed";
    job.rawIngestError = job.rawIngestError || "skipped raw ingest — continue images-only";
    if (!job.userYoutubeRawIngest) {
      job.userYoutubeRawIngest = {
        clips: [],
        analysisSummary: "Raw ingest skipped",
        usableDurationSec: 0,
        meanQuality: 0,
        topicCoverage: 0,
        usableScore: 0,
        rawTargetPercent: 20,
        effectiveRawTargetPercent: 0,
        rawReducedReason: "skipped",
        completedAt: new Date().toISOString(),
      };
    }
  }
  if (requeueYt) {
    job.rawIngestStatus = "queued";
    job.rawIngestError = undefined;
    // Drop stale empty/failed ingest payload so mix targets recompute after re-ingest.
    if (force && !hasUsableYtClips) {
      job.userYoutubeRawIngest = undefined;
    }
  }
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  // War v1 / Mystery v2 force-restart: drop stale packs/candidates.
  // Mystery v2 also clears beats so ~4–5s hold merge rebuilds from Whisper.
  if (force && (job.niche === "War v1" || job.niche === "Mystery v2")) {
    const staleKeys =
      job.niche === "Mystery v2"
        ? [
            "editor-visual-beats",
            "visual-intelligence-beats",
            "mystery-v1-beats",
            "search-query-packs",
            "visual-intelligence-query-packs",
            "mystery-v2-visual-plan",
            "mystery-v2-ai-stills",
            "mystery-v2-intro-plan",
            "visual-intelligence-candidates",
            "visual-intelligence-candidate-pool",
            "mystery-v1-candidate-pool",
            "visual-intelligence-filtered-candidates",
            "visual-intelligence-judgments",
            "visual-intelligence-approved-library",
            "editor-approved-visual-library",
            "visual-intelligence-final-assignment",
            "editor-final-scene-assignment",
            "visual-intelligence-final-qa",
            "editor-final-qa",
            "effect-timeline",
            "effect-planner",
            "royal-v2-glitch-plan",
            "remotion-input-props",
          ]
        : [
            "editor-visual-beats",
            "visual-intelligence-beats",
            "mystery-v1-beats",
            "search-query-packs",
            "war-v1-library-assign",
            "visual-intelligence-candidates",
            "visual-intelligence-filtered-candidates",
            "visual-intelligence-judgments",
            "visual-intelligence-approved-library",
            "visual-intelligence-final-assignment",
            "visual-intelligence-final-qa",
            "editor-final-qa",
            "effect-timeline",
            "effect-planner",
          ];
    for (const key of staleKeys) {
      try {
        fs.unlinkSync(jobDataFile(key, job.jobId));
      } catch {
        /* missing ok */
      }
    }
  }

  if (requeueYt) {
    const words = job.script.trim().split(/\s+/).filter(Boolean).length;
    const targetDurationSec =
      job.voiceoverDurationSec || Math.max(60, Math.round((words / WORDS_PER_MINUTE) * 60));
    void queueRawIngest({
      jobId: job.jobId,
      urls: job.userYoutubeRawUrls || [],
      niche: job.niche,
      title: job.title,
      targetDurationSec,
    }).catch((err) => {
      console.error("Raw ingest re-queue failed", job.jobId, err);
    });
  } else if (job.niche === "Royal v2") {
    try {
      await enqueueRoyalV2Job(job.jobId);
    } catch (err) {
      console.error("Royal v2 retry queue failed", job.jobId, err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    try {
      // Clear stale scene approvals so long Mystery jobs don't carry pending maps.
      if (force && job.niche === "Mystery v2") {
        job.sceneApprovals = {};
        job.stats = undefined;
        job.updatedAt = new Date().toISOString();
        await saveJob(job);
      }
      await enqueuePipelineJob(job.jobId, { force: Boolean(force) });
      const queued = await loadJob(job.jobId);
      console.log(
        `[retry] enqueued ${job.jobId} status=${queued?.status} niche=${job.niche} force=${Boolean(force)}`
      );
      return res.json({
        ok: true,
        job: queued || job,
        message: force ? "Pipeline force-restarted" : "Pipeline restarted",
      });
    } catch (err) {
      console.error("Pipeline retry queue failed", job.jobId, err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  res.json({ ok: true, job, message: force ? "Pipeline force-restarted" : "Pipeline restarted" });
});

app.get("/api/jobs/:jobId/scenes", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const scenes = await loadScenes(job.jobId);
  const library = await readJson<{ approved: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", job.jobId)
  );
  const libraryById = new Map((library?.approved || []).map((v) => [v.approvedVisualId, v]));
  res.json({
    job,
    scenes: scenes.map((s) => enrichScene(s, libraryById)),
    approvals: job.sceneApprovals || {},
    librarySize: libraryById.size,
  });
});

app.post("/api/jobs/:jobId/scenes/:sceneId/approve", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  job.sceneApprovals = job.sceneApprovals || {};
  job.sceneApprovals[req.params.sceneId] = "approved";
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  res.json({ ok: true, approvals: job.sceneApprovals });
});

app.post("/api/jobs/:jobId/scenes/:sceneId/reject", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.niche === "Royal v2" && job.timelineLock?.locked) {
    return res.status(409).json({ error: "Timeline is locked; unlock Royal v2 before changing approval" });
  }
  job.sceneApprovals = job.sceneApprovals || {};
  job.sceneApprovals[req.params.sceneId] = "rejected";
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  res.json({ ok: true, approvals: job.sceneApprovals });
});

app.post("/api/jobs/:jobId/scenes/:sceneId/find-better", async (req, res) => {
  // Only place where re-search is allowed: explicit user action.
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.niche === "Royal v2" && job.timelineLock?.locked) {
    return res.status(409).json({ error: "Timeline is locked; unlock Royal v2 before replacing visuals" });
  }
  const scenes = await loadScenes(job.jobId);
  const scene = scenes.find((s) => s.sceneId === req.params.sceneId);
  if (!scene) return res.status(404).json({ error: "Scene not found" });

  const { assessContentSafety } = await import("./visualIntelligence/contentSafety.js");
  const library = await readJson<{ approved: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", job.jobId)
  );
  const approved = library?.approved || [];
  const alternatives = approved
    .filter((v) => v.approvedVisualId !== scene.approvedVisualId)
    .filter((v) => !(v.warnings || []).some((w) => /soft_failed/i.test(w)))
    .filter((v) => v.reuseLimit === undefined || v.reuseLimit > 0)
    .filter((v) => v.allowedBeatIds.includes(scene.beatId) || v.allowedBeatIds.length === 0)
    .filter(
      (v) =>
        !assessContentSafety({
          title: v.bestUseCase,
          url: v.filePathOrUrl,
          description: (v.matchedPeople || []).join(" "),
        }).unsafe
    )
    .map((v) => {
      const hay = `${v.bestUseCase || ""} ${(v.matchedPeople || []).join(" ")} ${(v.matchedPlaces || []).join(" ")} ${(v.matchedScriptSubjects || []).join(" ")}`.toLowerCase();
      const needle = `${scene.viewerShouldSee || ""} ${scene.narrationText || ""}`.toLowerCase();
      const words = needle.split(/\s+/).filter((w) => w.length > 3).slice(0, 8);
      const hits = words.filter((w) => hay.includes(w)).length;
      const editor = v.visualEditorScore ?? v.confidenceScores?.visualEditorScore ?? v.confidenceScores?.entityMatch ?? 50;
      return { v, score: editor + hits * 6 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (!alternatives.length) {
    return res.json({
      ok: false,
      message: "No better approved visual in library. Re-run collection is limited in MVP; try rejecting and using another approved item if available.",
      alternatives: [],
    });
  }

  const next = alternatives[0].v;
  scene.selectedVisualId = next.approvedVisualId;
  scene.approvedVisualId = next.approvedVisualId;
  scene.source = next.source;
  scene.reasonSelected = "User requested find better visual from approved library (best scored alt)";
  scene.fallbackUsed = false;
  scene.needsBetterVisual = false;
  scene.confidence = Math.min(0.95, Math.max(0.55, (next.visualEditorScore ?? next.confidenceScores.entityMatch ?? 70) / 100));
  scene.confidenceScores = next.confidenceScores;
  scene.queryPackId = next.queryPackId;
  scene.warnings = next.warnings;

  const idx = scenes.findIndex((s) => s.sceneId === scene.sceneId);
  scenes[idx] = scene;
  const { writeJson } = await import("./storage.js");
  await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), {
    jobId: job.jobId,
    scenes,
  });
  await runFinalQA(job.jobId, scenes);

  res.json({ ok: true, scene, alternatives });
});

app.get("/api/jobs/:jobId/render-info", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const scenes = await loadScenes(job.jobId);
  const qa = await readJson<{ canRender?: boolean; criticalIssues?: string[]; warnings?: string[] }>(
    jobDataFile("visual-intelligence-final-qa", job.jobId)
  );
  const library = await readJson<{ approved: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", job.jobId)
  );
  const approvedCount = Object.values(job.sceneApprovals || {}).filter((v) => v === "approved").length;
  const rejectedCount = Object.values(job.sceneApprovals || {}).filter((v) => v === "rejected").length;
  const warningCount = scenes.reduce((n, s) => n + s.warnings.length, 0);
  const durationEstimate = scenes.reduce((n, s) => n + (s.duration || 0), 0);
  const readyStatuses = new Set([
    "ready_for_scene_review",
    "scene_review_ready",
    "approved",
    "completed",
    "rendering",
  ]);
  const sceneReviewReady = readyStatuses.has(job.status) || scenes.length > 0;
  const libraryBuilt = (library?.approved || []).length > 0 || scenes.some((s) => !!s.approvedVisualId);
  const allHaveVisuals = scenes.length > 0 && scenes.every((s) => !!s.selectedVisualId && !!s.approvedVisualId);
  const criticalWrongEntity = (qa?.criticalIssues || []).some((x) =>
    x.toLowerCase().includes("wrong")
  );
  const missingApproved = scenes.some((s) => !s.approvedVisualId);
  const checklist = {
    allScenesHaveVisuals: allHaveVisuals,
    noCriticalWrongEntity: !criticalWrongEntity,
    noMissingApprovedVisual: !missingApproved,
    sceneReviewReady,
    sceneReviewApproved: scenes.length > 0 && approvedCount === scenes.length,
    finalTimelineSaved:
      job.niche === "Royal v2" ? Boolean(job.timelineLock?.locked) : scenes.length > 0,
    libraryBuilt,
    qaCanRender: qa?.canRender !== false,
  };
  const blockedReasons: string[] = [];
  if (!sceneReviewReady) blockedReasons.push("Scene Review required before render");
  if (!libraryBuilt && scenes.length === 0) blockedReasons.push("Visual library not built yet");
  if (approvedCount === 0) blockedReasons.push("no approved scenes");
  if (job.niche === "Royal v2" && approvedCount !== scenes.length) {
    blockedReasons.push("All Royal v2 scenes must be approved");
  }
  if (job.niche === "Royal v2" && !job.timelineLock?.locked) {
    blockedReasons.push("Royal v2 final timeline is not locked");
  }
  if (qa && qa.canRender === false) {
    blockedReasons.push("Render blocked by critical warning");
  }
  const needsAttention = scenes.filter(
    (s) =>
      (job.sceneApprovals || {})[s.sceneId] !== "approved" ||
      s.needsBetterVisual ||
      s.softApproval === "fail" ||
      s.softApproval === "unsure" ||
      s.confidence < 0.7 ||
      s.warnings.includes("possible wrong entity") ||
      s.warnings.includes("possible wrong context")
  ).length;

  res.json({
    job,
    approvedScenesCount: approvedCount,
    rejectedScenesCount: rejectedCount,
    totalScenes: scenes.length,
    warningsCount: warningCount,
    durationEstimate,
    needsAttention,
    checklist,
    blockedReasons,
    canRender:
      checklist.sceneReviewReady &&
      checklist.allScenesHaveVisuals &&
      checklist.qaCanRender &&
      checklist.sceneReviewApproved &&
      checklist.finalTimelineSaved &&
      !missingApproved,
    qa,
    render: job.render,
  });
});

app.get("/api/jobs/:jobId/library", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const library = await readJson<{ approved: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", job.jobId)
  );
  const scenes = await loadScenes(job.jobId);
  const approved = (library?.approved || []).map((v) => {
    const usedBy = scenes.filter((s) => s.approvedVisualId === v.approvedVisualId).map((s) => s.sceneId);
    return {
      ...v,
      previewUrl: toMediaUrl(v.filePathOrUrl) || toMediaUrl(v.thumbnail || ""),
      usedByScenes: usedBy,
      reuseCount: usedBy.length,
    };
  });
  res.json({ job, approved });
});

app.get("/api/jobs/:jobId/reports", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const reports = [
    { key: "remotion-input-props", label: "Remotion input props" },
    { key: "effect-planner", label: "Effect planner report" },
    { key: "effect-timeline", label: "Effect timeline events" },
    { key: "effect-final-qa", label: "Effect final QA" },
    { key: "effect-renderability-qa", label: "Effect renderability QA" },
    { key: "shotstack-effect-map", label: "Shotstack effect map" },
    { key: "shotstack-edit-json", label: "Shotstack edit JSON" },
    { key: "shotstack-render-audit", label: "Shotstack render audit" },
    { key: "title-lock", label: "Title lock" },
    { key: "full-script-visual-map", label: "Full script visual map" },
    { key: "editor-visual-beats", label: "Editor visual beats" },
    { key: "search-query-packs", label: "Search query packs" },
    { key: "editor-approved-visual-library", label: "Editor approved library" },
    { key: "editor-final-scene-assignment", label: "Editor final scene assignment" },
    { key: "editor-final-qa", label: "Editor final QA" },
    { key: "editor-gpt-judgment", label: "Editor GPT judgment" },
    { key: "visual-intelligence-global-context", label: "Global context report" },
    { key: "visual-intelligence-beats", label: "Beats report" },
    { key: "visual-intelligence-query-packs", label: "Query packs report" },
    { key: "visual-intelligence-candidate-pool", label: "Candidate pool report" },
    { key: "visual-intelligence-approved-library", label: "Approved visual library report" },
    { key: "visual-intelligence-final-assignment", label: "Final assignment report" },
    { key: "visual-intelligence-final-qa", label: "Final QA report" },
    { key: "render-audit", label: "Render audit report" },
    { key: "shotstack-edit", label: "Shotstack edit payload" },
    { key: "mystery-v1-beats", label: "Mystery v1 beats" },
    { key: "mystery-v1-candidate-pool", label: "Mystery v1 candidate pool" },
    { key: "mystery-v1-filtered-candidates", label: "Mystery v1 filtered candidates" },
    { key: "mystery-v1-gpt55-judgment", label: "Mystery v1 GPT judgment" },
    { key: "mystery-v1-approved-visual-library", label: "Mystery v1 approved library" },
    { key: "mystery-v1-final-visual-assignment", label: "Mystery v1 final assignment" },
    { key: "mystery-v1-raw-footage-index", label: "Mystery v1 raw footage index" },
    { key: "mystery-v1-raw-footage-usage", label: "Mystery v1 raw footage usage" },
    { key: "mystery-v1-final-qa", label: "Mystery v1 final QA" },
    { key: "mystery-v2-visual-plan", label: "Mystery v2 visual plan" },
    { key: "mystery-v2-ai-stills", label: "Mystery v2 AI stills" },
    { key: "mystery-v2-intro-plan", label: "Mystery v2 cinematic intro" },
    { key: "royal-v2-visual-plan", label: "Royal v2 visual plan" },
    { key: "royal-v2-candidate-library", label: "Royal v2 candidate library" },
    { key: "royal-v2-final-assignment", label: "Royal v2 final assignment" },
    { key: "royal-v2-repetition-audit", label: "Royal v2 repetition audit" },
    { key: "royal-v2-raw-usage", label: "Royal v2 raw usage" },
    { key: "royal-v2-manager-summary", label: "Royal v2 manager summary" },
    { key: "royal-v2-assistant-actions", label: "Royal v2 assistant actions" },
    { key: "royal-v2-external-fallback", label: "Royal v2 external fallback" },
    { key: "royal-v2-soft-approval", label: "Royal v2 soft scene approval" },
    { key: "royal-v2-auto-approval", label: "Royal v2 auto approval" },
    { key: "royal-v2-sfx-plan", label: "Royal v2 SFX plan" },
  ];
  const available = [];
  for (const r of reports) {
    const file = jobDataFile(r.key, job.jobId);
    const exists = fs.existsSync(file);
    available.push({
      ...r,
      available: exists,
      url: exists ? `/api/jobs/${job.jobId}/reports/${r.key}` : null,
    });
  }
  res.json({ jobId: job.jobId, reports: available });
});

app.get("/api/jobs/:jobId/reports/:reportKey", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const allowed = new Set([
    "remotion-input-props",
    "effect-planner",
    "effect-timeline",
    "effect-final-qa",
    "effect-renderability-qa",
    "shotstack-effect-map",
    "shotstack-edit-json",
    "shotstack-render-audit",
    "title-lock",
    "full-script-visual-map",
    "editor-visual-beats",
    "search-query-packs",
    "editor-approved-visual-library",
    "editor-final-scene-assignment",
    "editor-final-qa",
    "editor-gpt-judgment",
    "visual-intelligence-global-context",
    "visual-intelligence-beats",
    "visual-intelligence-query-packs",
    "visual-intelligence-candidate-pool",
    "visual-intelligence-filtered-candidates",
    "visual-intelligence-gpt55-judgment",
    "visual-intelligence-approved-library",
    "visual-intelligence-final-assignment",
    "visual-intelligence-final-qa",
    "final-timeline",
    "render-audit",
    "shotstack-edit",
    "important-entity-detection",
    "mystery-v1-beats",
    "mystery-v1-candidate-pool",
    "mystery-v1-filtered-candidates",
    "mystery-v1-gpt55-judgment",
    "mystery-v1-approved-visual-library",
    "mystery-v1-final-visual-assignment",
    "mystery-v1-raw-footage-index",
    "mystery-v1-raw-footage-usage",
    "mystery-v1-final-qa",
    "mystery-v2-visual-plan",
    "mystery-v2-ai-stills",
    "mystery-v2-intro-plan",
    "royal-v2-visual-plan",
    "royal-v2-candidate-library",
    "royal-v2-final-assignment",
    "royal-v2-repetition-audit",
    "royal-v2-raw-usage",
    "royal-v2-manager-summary",
    "royal-v2-assistant-actions",
    "royal-v2-external-fallback",
    "royal-v2-soft-approval",
    "royal-v2-auto-approval",
    "royal-v2-sfx-plan",
    "royal-v2-glitch-plan",
  ]);
  if (!allowed.has(req.params.reportKey)) {
    return res.status(400).json({ error: "Unknown report" });
  }
  const data = await readJson(jobDataFile(req.params.reportKey, job.jobId));
  if (!data) return res.status(404).json({ error: "Report not found" });
  res.json(data);
});

app.delete("/api/jobs/:jobId", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status === "rendering" || job.status === "analyzing_full_script") {
    return res.status(400).json({ error: "Cannot delete while job is actively processing" });
  }
  const dir = jobDir(job.jobId);
  fs.rmSync(dir, { recursive: true, force: true });
  // Keep data reports for inspection unless force=1
  if (req.query.purgeReports === "1") {
    const prefix = path.join(config.dataPath);
    for (const file of fs.readdirSync(prefix)) {
      if (file.includes(`-job-${job.jobId}.json`) || file === `job-${job.jobId}.json`) {
        fs.unlinkSync(path.join(prefix, file));
      }
    }
  }
  res.json({ ok: true });
});

app.post("/api/jobs/:jobId/scenes/:sceneId/mark-needs-better", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.niche === "Royal v2" && job.timelineLock?.locked) {
    return res.status(409).json({ error: "Timeline is locked; unlock Royal v2 before editing" });
  }
  job.sceneApprovals = job.sceneApprovals || {};
  job.sceneApprovals[req.params.sceneId] = "rejected";
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  res.json({ ok: true, approvals: job.sceneApprovals, message: "Marked as needs better visual" });
});

app.post("/api/jobs/:jobId/scenes/:sceneId/set-visual", async (req, res) => {
  try {
    const { setSceneVisualFromUrl } = await import("./visualIntelligence/emergencyVisualFix.js");
    const result = await setSceneVisualFromUrl({
      jobId: req.params.jobId,
      sceneId: req.params.sceneId,
      url: String(req.body?.url || ""),
      title: req.body?.title ? String(req.body.title) : undefined,
      thumbnail: req.body?.thumbnail ? String(req.body.thumbnail) : undefined,
      personName: req.body?.personName ? String(req.body.personName) : undefined,
      softFailIds: Array.isArray(req.body?.softFailIds)
        ? req.body.softFailIds.map(String)
        : undefined,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : /required|Refusing|locked/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

app.post("/api/jobs/:jobId/approved-visuals/soft-fail", async (req, res) => {
  try {
    const { softFailApprovedVisuals } = await import("./visualIntelligence/emergencyVisualFix.js");
    const ids = Array.isArray(req.body?.approvedVisualIds)
      ? req.body.approvedVisualIds.map(String)
      : [];
    if (!ids.length) return res.status(400).json({ error: "approvedVisualIds[] required" });
    const result = await softFailApprovedVisuals(
      req.params.jobId,
      ids,
      String(req.body?.reason || "content_safety soft-fail")
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs/:jobId/scenes/:sceneId/use-source", async (req, res) => {
  // Swap from approved library only — no re-search / no pipeline changes.
  const prefer = String(req.body?.prefer || "");
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.niche === "Royal v2" && job.timelineLock?.locked) {
    return res.status(409).json({ error: "Timeline is locked; unlock Royal v2 before replacing visuals" });
  }
  const scenes = await loadScenes(job.jobId);
  const scene = scenes.find((s) => s.sceneId === req.params.sceneId);
  if (!scene) return res.status(404).json({ error: "Scene not found" });
  const { assessContentSafety } = await import("./visualIntelligence/contentSafety.js");
  const library = await readJson<{ approved: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", job.jobId)
  );
  const approved = library?.approved || [];
  const pool = approved.filter((v) => {
    if (v.approvedVisualId === scene.approvedVisualId) return false;
    if ((v.warnings || []).some((w) => /soft_failed/i.test(w))) return false;
    if (v.reuseLimit === 0) return false;
    const u = String(v.filePathOrUrl || "");
    if (!u) return false;
    if (/^http:\/\//i.test(u)) return false;
    if (/lookaside\.|fbsbx\.com|instagram\.com\/seo\/|tiktok\.com|tiktokcdn\.|pinimg\.com|pinterest\./i.test(u)) return false;
    if (
      assessContentSafety({
        title: v.bestUseCase,
        url: v.filePathOrUrl,
        description: (v.matchedPeople || []).join(" "),
      }).unsafe
    ) {
      return false;
    }
    return /^https:\/\//i.test(u) || u.startsWith("/");
  });
  let next =
    prefer === "raw"
      ? pool.find((v) => v.source === "raw_footage")
      : prefer === "image"
        ? pool.find((v) =>
            ["google_image", "brave_image", "pexels_image", "pixabay_image", "uploaded_asset"].includes(v.source)
          )
        : undefined;
  if (!next) next = pool[0];
  if (!next) {
    return res.json({ ok: false, message: "No alternate visual in approved library" });
  }
  scene.selectedVisualId = next.approvedVisualId;
  scene.approvedVisualId = next.approvedVisualId;
  scene.source = next.source;
  scene.reasonSelected = `User selected ${prefer || "alternate"} visual from approved library`;
  scene.fallbackUsed = false;
  scene.confidence = next.confidenceScores.entityMatch / 100;
  scene.confidenceScores = next.confidenceScores;
  scene.queryPackId = next.queryPackId;
  scene.warnings = next.warnings;
  const idx = scenes.findIndex((s) => s.sceneId === scene.sceneId);
  scenes[idx] = scene;
  const { writeJson } = await import("./storage.js");
  await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), {
    jobId: job.jobId,
    scenes,
  });
  await runFinalQA(job.jobId, scenes);
  res.json({ ok: true, scene });
});

app.post("/api/jobs/:jobId/approve-all", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const scenes = await loadScenes(job.jobId);
  job.sceneApprovals = job.sceneApprovals || {};
  for (const s of scenes) {
    job.sceneApprovals[s.sceneId] = "approved";
  }
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  res.json({ ok: true, approved: scenes.length, approvals: job.sceneApprovals });
});

app.post("/api/jobs/:jobId/clear-render-blocks", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const scenes = await loadScenes(job.jobId);
  job.sceneApprovals = job.sceneApprovals || {};
  for (const s of scenes) {
    job.sceneApprovals[s.sceneId] = "approved";
  }
  job.error = undefined;
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  const qaPath = jobDataFile("visual-intelligence-final-qa", job.jobId);
  const qa = (await readJson<Record<string, unknown>>(qaPath)) || {
    jobId: job.jobId,
    criticalIssues: [],
    warnings: [],
  };
  const previousCritical = Array.isArray(qa.criticalIssues) ? qa.criticalIssues : [];
  qa.canRender = true;
  qa.criticalIssues = [];
  qa.warnings = [
    ...(Array.isArray(qa.warnings) ? (qa.warnings as string[]) : []),
    ...previousCritical.map((x) => `cleared critical (user override): ${String(x)}`),
  ];
  qa.overrideAt = new Date().toISOString();
  qa.overrideReason = "User cleared render blocks";
  await writeJson(qaPath, qa);

  // Also clear editor QA twin if present
  const editorQaPath = jobDataFile("editor-final-qa", job.jobId);
  const editorQa = await readJson<Record<string, unknown>>(editorQaPath);
  if (editorQa) {
    editorQa.canRender = true;
    editorQa.criticalIssues = [];
    editorQa.overrideAt = new Date().toISOString();
    await writeJson(editorQaPath, editorQa);
  }

  res.json({
    ok: true,
    approved: scenes.length,
    clearedCritical: previousCritical,
    canRender: true,
  });
});

app.post("/api/jobs/:jobId/replace-effect-timeline", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const body = (req.body || {}) as {
    events?: EffectTimelineEvent[];
    fps?: number;
    note?: string;
  };
  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) return res.status(400).json({ error: "events required" });
  const fps = body.fps || 30;
  const report = {
    jobId: job.jobId,
    fps,
    totalScenes: 0,
    totalEffectEvents: events.length,
    effectsPerMinute: events.length / Math.max(0.1, (job.voiceoverDurationSec || 200) / 60),
    presetIdsUsed: [...new Set(events.map((e) => e.presetId))],
    lowerThirdsCount: events.filter((e) => String(e.presetId).includes("lower_third")).length,
    slideshowPresentationCount: events.filter((e) => String(e.presetId).includes("slideshow") || e.presetId === "10_red_grid_archive_background").length,
    revealGlitchCount: events.filter((e) => e.presetId === "08_reveal_question" || e.presetId === "15_quote_only").length,
    spacingWarnings: [] as string[],
    subtitleOverlapWarnings: [] as string[],
    validationErrors: [] as string[],
    events,
    createdAt: new Date().toISOString(),
    note: body.note || "manual replace-effect-timeline",
  };
  await writeJson(jobDataFile("effect-timeline", job.jobId), { jobId: job.jobId, fps, events });
  await writeJson(jobDataFile("effect-planner", job.jobId), report);

  // Embed effects onto scenes by time overlap for Scene Review display.
  const assignment = await readJson<{ scenes?: TimelineScene[] }>(
    jobDataFile("visual-intelligence-final-assignment", job.jobId)
  );
  if (assignment?.scenes?.length) {
    const enriched = assignment.scenes.map((s) => {
      const startF = Math.round((s.startTime || 0) * fps);
      const endF = Math.round((s.endTime || s.startTime + s.duration) * fps);
      const sceneEffects = events.filter((e) => {
        const eEnd = e.startFrame + e.durationFrames;
        return e.startFrame < endF && eEnd > startF;
      });
      return { ...s, effects: sceneEffects };
    });
    await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), {
      ...assignment,
      scenes: enriched,
    });
  }

  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  res.json({
    ok: true,
    jobId: job.jobId,
    eventCount: events.length,
    presets: report.presetIdsUsed,
  });
});

app.post("/api/jobs/:jobId/attach-shotstack-result", async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const body = (req.body || {}) as { url?: string; shotstackId?: string; note?: string };
  const url = String(body.url || "").trim();
  if (!/^https:\/\//i.test(url)) {
    return res.status(400).json({ error: "url must be https" });
  }
  const shotstackId = String(body.shotstackId || "").trim() || undefined;
  job.status = "completed";
  job.error = undefined;
  job.render = {
    status: "done",
    shotstackId,
    shotstackUrl: url,
    outputUrl: url,
    progressPercent: 100,
    renderer: "shotstack",
  };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  await writeJson(jobDataFile("render-audit", job.jobId), {
    jobId: job.jobId,
    renderer: "shotstack",
    shotstackId,
    shotstackUrl: url,
    note: body.note || "attached completed Shotstack output",
    renderedAt: new Date().toISOString(),
  });
  res.json({ ok: true, jobId: job.jobId, status: job.status, render: job.render });
});

app.post("/api/jobs/:jobId/render", async (req, res) => {
  const apis = checkRequiredApis();
  if (!apis.ok) {
    return res.status(400).json({ error: `Missing API keys: ${apis.missing.join(", ")}` });
  }
  const renderApis = checkRenderApis();
  if (!renderApis.ok) {
    return res.status(400).json({
      error: `Missing render config: ${renderApis.missing.join(", ")}`,
    });
  }
  const jobCheck = await loadJob(req.params.jobId);
  if (!jobCheck) return res.status(404).json({ error: "Job not found" });
  if (jobCheck.niche === "Royal v2" && !jobCheck.timelineLock?.locked) {
    return res.status(400).json({ error: "Royal v2 timeline must be approved and locked before render" });
  }
  let scenesCheck: TimelineScene[];
  try {
    scenesCheck =
      jobCheck.niche === "Royal v2"
        ? await loadVerifiedRoyalV2Timeline(req.params.jobId)
        : await loadScenes(req.params.jobId);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
  const force =
    req.query.force === "1" ||
    req.query.force === "true" ||
    Boolean((req.body as { force?: boolean } | undefined)?.force);
  let approvedCount = Object.values(jobCheck.sceneApprovals || {}).filter((v) => v === "approved").length;
  if (!scenesCheck.length) {
    return res.status(400).json({ error: "Scene Review required before render" });
  }
  if (force && approvedCount < scenesCheck.length) {
    jobCheck.sceneApprovals = jobCheck.sceneApprovals || {};
    for (const s of scenesCheck) jobCheck.sceneApprovals[s.sceneId] = "approved";
    jobCheck.updatedAt = new Date().toISOString();
    await saveJob(jobCheck);
    approvedCount = scenesCheck.length;
  }
  if (approvedCount === 0) {
    return res.status(400).json({ error: "no approved scenes" });
  }
  const qa = await readJson<{ canRender?: boolean; criticalIssues?: string[] }>(
    jobDataFile("visual-intelligence-final-qa", req.params.jobId)
  );
  if (qa && qa.canRender === false && !force) {
    return res.status(400).json({
      error: `Render blocked by critical warning: ${(qa.criticalIssues || []).join("; ")}`,
    });
  }

  // Remotion can take many minutes — start in background so the HTTP request does not time out.
  // RunPod: queue + wake on-demand pod (billed only while Running).
  const renderer = getRenderer();
  if (renderer === "runpod") {
    try {
      const result = await renderJob(req.params.jobId, { force });
      return res.json({ ok: true, started: true, queued: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const job = await loadJob(req.params.jobId);
      if (job) {
        job.render = { status: "failed", renderer: "runpod", error: message };
        job.status = "failed";
        job.error = message;
        job.updatedAt = new Date().toISOString();
        await saveJob(job);
      }
      return res.status(400).json({ error: message });
    }
  }
  if (renderer === "remotion" || renderer === "remotion-lambda") {
    const jobId = req.params.jobId;
    void renderJob(jobId, { force })
      .then((result) => {
        console.log(`[${renderer}] render complete ${jobId}`, result.outputKey);
      })
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${renderer}] render failed ${jobId}`, message);
        const job = await loadJob(jobId);
        if (job) {
          job.render = { status: "failed", error: message };
          job.status = "failed";
          job.error = message;
          job.updatedAt = new Date().toISOString();
          await saveJob(job);
        }
      });
    return res.json({ ok: true, started: true, renderer });
  }

  try {
    const result = await renderJob(req.params.jobId, { force });
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const job = await loadJob(req.params.jobId);
    if (job) {
      job.render = { status: "failed", error: message };
      job.status = "failed";
      job.error = message;
      job.updatedAt = new Date().toISOString();
      await saveJob(job);
    }
    res.status(400).json({ error: message });
  }
});

app.use("/media", express.static(config.storagePath));

// Serve client build in production
const clientDist = path.join(process.cwd(), "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // Never let the SPA swallow API/media — unmatched API gets JSON 404.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
    }
    if (req.path.startsWith("/media")) {
      return res.status(404).json({ error: "Media not found" });
    }
    if (req.method === "GET" || req.method === "HEAD") {
      return res.sendFile(path.join(clientDist, "index.html"));
    }
    return next();
  });
}

app.listen(config.port, () => {
  console.log(`Documentary Video Factory listening on :${config.port}`);
  const apis = checkRequiredApis();
  if (!apis.ok) {
    console.warn(`WARNING: missing API keys: ${apis.missing.join(", ")}`);
  }
});

void resumePipelineQueue().catch((error) => {
  console.error("[pipeline-queue] resume failed", error);
});

// silence unused import in case tree shaking
void assembleTimeline;
