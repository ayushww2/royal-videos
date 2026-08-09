import fs from "node:fs/promises";
import path from "node:path";
import { config, optionalEnv } from "../config.js";
import { jobDataFile, listJobs, loadJob, readJson, saveJob, writeJson } from "../storage.js";
import { mediaLibraryPublicBase, r2Configured, r2PutObject } from "../library/r2.js";
import { runFinalQA } from "../visualIntelligence/finalQA.js";
import { loadVerifiedRoyalV2Timeline } from "../visualIntelligence/royalV2/lock.js";
import type { ApprovedVisual, TimelineScene } from "../../shared/visualIntelligence.js";
import type { EffectTimelineEvent } from "../visualIntelligence/effectPlanner.js";
import { buildRemotionInputProps, type RemotionInputProps } from "./remotionRender.js";
import {
  forceImagesOnlyScenes,
  imagesOnlyEnabled,
  mirrorRemotionPropsToR2,
  preflightImagesOnlyProps,
  scrubUntrustedMediaUrls,
  preflightVoiceoverDuration,
} from "./imagesOnlyHarden.js";
import { ensureRunpodWorkerRunning } from "./runpodClient.js";
import {
  getServerlessJobStatus,
  parseServerlessProgress,
  serverlessEndpointConfigured,
  submitServerlessRender,
} from "./runpodServerlessClient.js";

const COMPOSITION_ID = "DocumentaryEdit";
const SERVERLESS_POLL_MS = 5000;
const INLINE_PROPS_MAX_BYTES = 6 * 1024 * 1024;

export type RunpodQueuedPayload = {
  jobId: string;
  compositionId: string;
  inputProps: RemotionInputProps;
  createdAt: string;
  force?: boolean;
};

function fullPropsPath(jobId: string): string {
  return jobDataFile("remotion-input-props-full", jobId);
}

export async function countRenderQueue(): Promise<{
  queued: number;
  rendering: number;
  queuedJobIds: string[];
  renderingJobIds: string[];
}> {
  const jobs = await listJobs();
  const queued = jobs.filter((j) => j.status === "render_queued");
  const rendering = jobs.filter(
    (j) =>
      j.status === "rendering" &&
      (j.render?.renderer === "runpod" || j.render?.renderer === "runpod-serverless")
  );
  return {
    queued: queued.length,
    rendering: rendering.length,
    queuedJobIds: queued.map((j) => j.jobId),
    renderingJobIds: rendering.map((j) => j.jobId),
  };
}

/**
 * Prepare inputProps, mark job render_queued, then:
 * 1) Prefer RunPod Serverless when RUNPOD_SERVERLESS_ENDPOINT_ID is set
 * 2) Else fall back to on-demand Pod start (existing path)
 * Does not render on Railway.
 */
export async function queueRunpodRender(
  jobId: string,
  opts?: { force?: boolean }
): Promise<{
  jobId: string;
  renderer: "runpod" | "runpod-serverless";
  podId?: string;
  runId?: string;
  mode: "serverless" | "pod";
  action: "already_running" | "started" | "created" | "submitted";
}> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");

  const assignment =
    job.niche === "Royal v2"
      ? null
      : await readJson<{ scenes: TimelineScene[] }>(
          jobDataFile("visual-intelligence-final-assignment", jobId)
        );
  const scenes =
    job.niche === "Royal v2"
      ? await loadVerifiedRoyalV2Timeline(jobId)
      : assignment?.scenes || [];
  if (!scenes.length) throw new Error("No Scene Review assignment found");

  const qa = await runFinalQA(jobId, scenes);
  if (!qa.canRender && !opts?.force) {
    throw new Error(`Cannot render: ${qa.criticalIssues.join("; ")}`);
  }
  if (!qa.canRender && opts?.force) {
    console.warn(`[runpod] force=true — overriding QA: ${qa.criticalIssues.join("; ")}`);
    await writeJson(jobDataFile("visual-intelligence-final-qa", jobId), {
      ...qa,
      canRender: true,
      criticalIssues: [],
      warnings: [
        ...(qa.warnings || []),
        ...qa.criticalIssues.map((x) => `cleared critical (force render): ${x}`),
      ],
      overrideAt: new Date().toISOString(),
      overrideReason: "force render",
    });
  }

  const library = await readJson<{ approved: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", jobId)
  );
  const byId = new Map((library?.approved || []).map((v) => [v.approvedVisualId, v]));
  const effectTimeline = await readJson<{ events?: EffectTimelineEvent[] }>(
    jobDataFile("effect-timeline", jobId)
  );
  const effectEvents = effectTimeline?.events || [];
  const sfxPlan = await readJson<{ events?: Array<Record<string, unknown>> }>(
    jobDataFile("royal-v2-sfx-plan", jobId)
  );
  const musicPlan = await readJson<{ events?: Array<Record<string, unknown>> }>(
    jobDataFile("royal-v2-music-plan", jobId)
  );
  const glitchPlan = await readJson<{ events?: Array<Record<string, unknown>> }>(
    jobDataFile("royal-v2-glitch-plan", jobId)
  );
  const assignmentAudio = await readJson<{
    sfxEvents?: Array<Record<string, unknown>>;
    musicEvents?: Array<Record<string, unknown>>;
    glitchEvents?: Array<Record<string, unknown>>;
    cinematicIntro?: {
      enabled?: boolean;
      durationSec?: number;
      musicVolume?: number;
      shots?: Array<{
        src: string;
        line1: string;
        line2?: string;
        motion: "in" | "out";
        overlay?: string;
      }>;
    };
  }>(jobDataFile("visual-intelligence-final-assignment", jobId));
  const introPlan = await readJson<{
    enabled?: boolean;
    durationSec?: number;
    musicVolume?: number;
    shots?: Array<{
      src: string;
      line1: string;
      line2?: string;
      motion: "in" | "out";
      overlay?: string;
    }>;
  }>(jobDataFile("mystery-v2-intro-plan", jobId));
  const sfxEvents = (sfxPlan?.events || assignmentAudio?.sfxEvents || []) as Array<{
    id: string;
    sfxId: string;
    publicPath: string;
    startTime: number;
    durationSec: number;
    volume: number;
    reason?: string;
    sceneId?: string;
  }>;
  const musicEvents = (musicPlan?.events || assignmentAudio?.musicEvents || []) as Array<{
    id: string;
    musicId: string;
    publicPath: string;
    startTime: number;
    durationSec: number;
    volume: number;
    fadeInSec?: number;
    fadeOutSec?: number;
    reason?: string;
    role?: string;
  }>;
  const glitchEvents = (glitchPlan?.events || assignmentAudio?.glitchEvents || []) as Array<{
    id: string;
    glitchId: string;
    publicPath: string;
    startTime: number;
    durationSec: number;
    volume: number;
    blendMode?: "screen" | "lighten" | "plus-lighter";
    reason?: string;
    sceneId?: string;
    darken?: number;
  }>;
  const cinematicIntro = assignmentAudio?.cinematicIntro || introPlan || undefined;

  let inputProps = buildRemotionInputProps({
    scenes,
    libraryById: byId,
    effectEvents,
    sfxEvents,
    musicEvents,
    glitchEvents,
    voiceoverPath: job.voiceoverPath,
    fps: 30,
    imagesOnly: imagesOnlyEnabled(),
    cinematicIntro,
  });

  if (imagesOnlyEnabled()) {
    inputProps = forceImagesOnlyScenes(inputProps);
    console.log(
      `[runpod] images-only harden job=${jobId} scenes=${inputProps.scenes.length}`
    );
    const hardened = await mirrorRemotionPropsToR2(jobId, inputProps);
    inputProps = hardened.props;
    console.log(
      `[runpod] R2 mirror mirrored=${hardened.mirrored} trusted=${hardened.skippedTrusted} failed=${hardened.failedUrls.length}`
    );
    if (hardened.failedUrls.length) {
      await writeJson(jobDataFile("remotion-images-only-mirror-failures", jobId), {
        failedUrls: hardened.failedUrls.slice(0, 50),
        at: new Date().toISOString(),
      });
    }
    // Never leave dead third-party hosts in props — Remotion crashes on them.
    const scrubbed = scrubUntrustedMediaUrls(inputProps);
    inputProps = scrubbed.props;
    if (scrubbed.replaced) {
      console.warn(`[runpod] scrubbed ${scrubbed.replaced} untrusted media URL(s) → R2 stills`);
    }
    const issues = [
      ...preflightImagesOnlyProps(inputProps),
      ...preflightVoiceoverDuration({
        props: inputProps,
        voiceoverDurationSec: job.voiceoverDurationSec,
        toleranceSec: 3,
      }),
    ];
    await writeJson(jobDataFile("remotion-images-only-preflight", jobId), {
      issues,
      mirrored: hardened.mirrored,
      scrubbed: scrubbed.replaced,
      sceneCount: inputProps.scenes.length,
      at: new Date().toISOString(),
    });
    const critical = issues.filter((i) => i.level === "critical");
    if (critical.length && !opts?.force) {
      throw new Error(
        `Images-only preflight failed: ${critical.map((c) => c.message).join("; ")}`
      );
    }
    if (critical.length && opts?.force) {
      console.warn(
        `[runpod] force=true — overriding images-only preflight: ${critical
          .map((c) => c.message)
          .join("; ")}`
      );
    }
  }

  const payload: RunpodQueuedPayload = {
    jobId,
    compositionId: COMPOSITION_ID,
    inputProps,
    createdAt: new Date().toISOString(),
    force: opts?.force,
  };
  await writeJson(fullPropsPath(jobId), payload);
  await writeJson(jobDataFile("remotion-input-props", jobId), {
    jobId,
    compositionId: COMPOSITION_ID,
    renderer: "runpod",
    imagesOnly: imagesOnlyEnabled(),
    effectCount: inputProps.effectEvents.length,
    sceneCount: inputProps.scenes.length,
    sfxCount: (inputProps.sfxEvents || []).length,
    musicCount: (inputProps.musicEvents || []).length,
    glitchCount: (inputProps.glitchEvents || []).length,
    hasVoiceover: Boolean(inputProps.voiceoverUrl),
    presetsUsed: [...new Set(inputProps.effectEvents.map((e) => e.presetId))],
    createdAt: new Date().toISOString(),
  });

  // Prefer Serverless for ASAP scale-out; Pod remains the fallback.
  if (serverlessEndpointConfigured()) {
    job.status = "render_queued";
    job.error = undefined;
    job.render = {
      status: "queued",
      renderer: "runpod-serverless",
      message: "Submitting to RunPod Serverless…",
      progressPercent: 0,
    };
    job.updatedAt = new Date().toISOString();
    await saveJob(job);

    const appBase = (optionalEnv("PUBLIC_APP_URL") || optionalEnv("APP_BASE_URL") || "").replace(
      /\/$/,
      ""
    );
    const propsApproxBytes = Buffer.byteLength(JSON.stringify(inputProps), "utf8");
    // Keep /run payload small — fetch props from app when large.
    const inlineProps = propsApproxBytes < INLINE_PROPS_MAX_BYTES ? inputProps : undefined;
    const submitted = await submitServerlessRender({
      jobId,
      compositionId: COMPOSITION_ID,
      ...(inlineProps ? { inputProps: inlineProps } : {}),
      appBaseUrl: appBase || undefined,
      // Secret also set on the worker template; include for fetch-props path.
      workerSecret: optionalEnv("RUNPOD_WORKER_SECRET"),
    });

    job.status = "rendering";
    job.render = {
      status: "rendering",
      renderer: "runpod-serverless",
      runpodRunId: submitted.id,
      message: "RunPod Serverless queued",
      progressPercent: 1,
    };
    job.updatedAt = new Date().toISOString();
    await saveJob(job);

    console.log(
      `[runpod-serverless] submitted job=${jobId} runId=${submitted.id} scenes=${inputProps.scenes.length} inlineProps=${Boolean(inlineProps)}`
    );

    void pollServerlessUntilDone(jobId, submitted.id);

    return {
      jobId,
      renderer: "runpod-serverless",
      runId: submitted.id,
      mode: "serverless",
      action: "submitted",
    };
  }

  const ensure = await ensureRunpodWorkerRunning();

  job.status = "render_queued";
  job.error = undefined;
  job.render = {
    status: "queued",
    renderer: "runpod",
    runpodPodId: ensure.podId,
  };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  console.log(
    `[runpod] queued job=${jobId} pod=${ensure.podId} action=${ensure.action} scenes=${inputProps.scenes.length}`
  );

  return {
    jobId,
    renderer: "runpod",
    podId: ensure.podId,
    mode: "pod",
    action: ensure.action,
  };
}

async function pollServerlessUntilDone(jobId: string, runId: string): Promise<void> {
  const started = Date.now();
  const maxMs = 3 * 60 * 60 * 1000; // 3h safety
  while (Date.now() - started < maxMs) {
    try {
      const st = await getServerlessJobStatus(runId);
      const job = await loadJob(jobId);
      if (!job) return;

      // Worker may have already completed via complete-url / complete.
      if (job.status === "completed" || job.render?.status === "completed") return;
      if (job.status === "failed" && job.render?.runpodRunId === runId) return;

      const pct = parseServerlessProgress(st.progress);
      if (st.status === "IN_QUEUE" || st.status === "IN_PROGRESS") {
        job.status = "rendering";
        job.progressPercent = pct ?? job.progressPercent ?? 1;
        job.render = {
          ...(job.render || {}),
          status: "rendering",
          renderer: "runpod-serverless",
          runpodRunId: runId,
          progressPercent: pct ?? job.render?.progressPercent ?? 1,
          message:
            typeof st.progress === "string"
              ? st.progress
              : st.status === "IN_QUEUE"
                ? "Waiting for Serverless worker…"
                : `Rendering${pct != null ? ` ${pct}%` : ""}`,
        };
        job.updatedAt = new Date().toISOString();
        await saveJob(job);
      } else if (st.status === "COMPLETED") {
        const out =
          st.output && typeof st.output === "object"
            ? (st.output as Record<string, unknown>)
            : {};
        if (out.error) {
          await failRunpodJob(jobId, String(out.error));
          return;
        }
        // If worker already notified via complete-url, we're done.
        const fresh = await loadJob(jobId);
        if (fresh?.status === "completed") return;
        const outputUrl = typeof out.outputUrl === "string" ? out.outputUrl : undefined;
        const r2Key = typeof out.r2Key === "string" ? out.r2Key : undefined;
        if (outputUrl || r2Key) {
          await completeRunpodJobFromUrl({
            jobId,
            outputUrl: outputUrl || "",
            r2Key,
            durationInFrames:
              typeof out.durationInFrames === "number" ? out.durationInFrames : undefined,
          });
          return;
        }
        // Still waiting for multipart complete callback.
        job.render = {
          ...(job.render || {}),
          status: "rendering",
          renderer: "runpod-serverless",
          runpodRunId: runId,
          message: "Serverless finished — finalizing upload…",
        };
        job.updatedAt = new Date().toISOString();
        await saveJob(job);
        await new Promise((r) => setTimeout(r, SERVERLESS_POLL_MS));
        const again = await loadJob(jobId);
        if (again?.status === "completed") return;
        if (again?.status === "failed") return;
        // Give callback a few more ticks then accept output if present
        continue;
      } else if (
        st.status === "FAILED" ||
        st.status === "CANCELLED" ||
        st.status === "TIMED_OUT"
      ) {
        await failRunpodJob(
          jobId,
          st.error || `RunPod Serverless ${st.status}`
        );
        return;
      }
    } catch (err) {
      console.warn(
        `[runpod-serverless] poll error job=${jobId}:`,
        err instanceof Error ? err.message : err
      );
    }
    await new Promise((r) => setTimeout(r, SERVERLESS_POLL_MS));
  }
  await failRunpodJob(jobId, "RunPod Serverless poll timed out after 3h");
}

async function playableUrlForR2Key(r2Key: string, preferredUrl?: string): Promise<string> {
  const r2Public = optionalEnv("R2_PUBLIC_URL")?.replace(/\/$/, "");
  if (r2Public) {
    return `${r2Public}/${r2Key.split("/").map(encodeURIComponent).join("/")}`;
  }
  if (
    preferredUrl &&
    /^https?:\/\//i.test(preferredUrl) &&
    preferredUrl.includes("r2.dev")
  ) {
    return preferredUrl;
  }
  // Signed app proxy (works when bucket is private / R2_PUBLIC_URL unset).
  const { signLibraryRenderKey } = await import("../library/routes.js");
  const app = (optionalEnv("PUBLIC_APP_URL") || "").replace(/\/$/, "");
  const route = `/api/media-library/render-asset?key=${encodeURIComponent(r2Key)}&token=${signLibraryRenderKey(r2Key)}`;
  return app ? `${app}${route}` : route;
}

/** Mark job complete when worker uploaded to R2 (or provided a public URL). */
export async function completeRunpodJobFromUrl(params: {
  jobId: string;
  outputUrl: string;
  r2Key?: string;
  durationInFrames?: number;
}): Promise<{ outputUrl: string; r2Key?: string }> {
  const job = await loadJob(params.jobId);
  if (!job) throw new Error("Job not found");

  const outputKey = `renders/${params.jobId}/final.mp4`;
  const r2Key = params.r2Key || outputKey;
  const outputUrl = r2Key
    ? await playableUrlForR2Key(r2Key, params.outputUrl)
    : params.outputUrl;

  await writeJson(jobDataFile("render-audit", params.jobId), {
    jobId: params.jobId,
    renderer: job.render?.renderer || "runpod-serverless",
    outputKey,
    outputUrl,
    r2Key,
    durationInFrames: params.durationInFrames,
    renderedAt: new Date().toISOString(),
    via: "complete-url",
  });

  job.status = "completed";
  job.error = undefined;
  job.progressPercent = 100;
  job.render = {
    status: "completed",
    renderer: job.render?.renderer || "runpod-serverless",
    outputKey,
    outputUrl,
    r2Key,
    shotstackUrl: outputUrl,
    runpodPodId: job.render?.runpodPodId,
    runpodRunId: job.render?.runpodRunId,
    progressPercent: 100,
    message: r2Key ? "Uploaded to R2" : "Completed",
  };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  return { outputUrl, r2Key };
}

export async function claimNextRunpodJob(): Promise<RunpodQueuedPayload | null> {
  const jobs = await listJobs();
  const candidates = jobs
    .filter((j) => j.status === "render_queued")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  for (const candidate of candidates) {
    const job = await loadJob(candidate.jobId);
    if (!job || job.status !== "render_queued") continue;

    const payload = await readJson<RunpodQueuedPayload>(fullPropsPath(job.jobId));
    if (!payload?.inputProps) {
      job.status = "failed";
      job.render = {
        status: "failed",
        renderer: "runpod",
        error: "Missing remotion input props for RunPod claim",
      };
      job.error = job.render.error;
      job.updatedAt = new Date().toISOString();
      await saveJob(job);
      continue;
    }

    job.status = "rendering";
    job.render = {
      ...(job.render || {}),
      status: "rendering",
      renderer: "runpod",
    };
    job.updatedAt = new Date().toISOString();
    await saveJob(job);

    return payload;
  }

  return null;
}

export async function completeRunpodJob(params: {
  jobId: string;
  uploadedPath: string;
  durationInFrames?: number;
}): Promise<{
  outputKey: string;
  outputPath: string;
  shotstackUrl?: string;
  outputUrl?: string;
  r2Key?: string;
}> {
  const job = await loadJob(params.jobId);
  if (!job) throw new Error("Job not found");

  const outputKey = `renders/${params.jobId}/final.mp4`;
  const outputPath = path.join(config.storagePath, outputKey);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (path.resolve(params.uploadedPath) !== path.resolve(outputPath)) {
    await fs.copyFile(params.uploadedPath, outputPath);
    try {
      await fs.unlink(params.uploadedPath);
    } catch {
      // ignore cleanup failure
    }
  }

  const publicBase = optionalEnv("PUBLIC_APP_URL")?.replace(/\/$/, "");
  const localUrl = publicBase ? `${publicBase}/media/${outputKey}` : `/media/${outputKey}`;

  let r2Key: string | undefined;
  let outputUrl = localUrl;
  let r2Error: string | undefined;
  if (r2Configured()) {
    try {
      const body = await fs.readFile(outputPath);
      r2Key = `renders/${params.jobId}/final.mp4`;
      await r2PutObject({
        key: r2Key,
        body,
        contentType: "video/mp4",
        metadata: { jobId: params.jobId, renderer: "runpod" },
      });
      const r2Public = mediaLibraryPublicBase()?.replace(/\/$/, "");
      if (r2Public) {
        outputUrl = `${r2Public}/${r2Key.split("/").map(encodeURIComponent).join("/")}`;
      }
    } catch (err) {
      r2Error = err instanceof Error ? err.message : String(err);
      console.warn(`[runpod] R2 upload failed for ${params.jobId}: ${r2Error}`);
    }
  }

  await writeJson(jobDataFile("render-audit", params.jobId), {
    jobId: params.jobId,
    renderer: "runpod",
    outputKey,
    outputPath,
    outputUrl,
    r2Key,
    r2Error,
    durationInFrames: params.durationInFrames,
    renderedAt: new Date().toISOString(),
  });

  job.status = "completed";
  job.error = undefined;
  job.progressPercent = 100;
  job.render = {
    status: "completed",
    renderer: "runpod",
    outputKey,
    outputPath,
    outputUrl,
    r2Key,
    shotstackUrl: outputUrl,
    runpodPodId: job.render?.runpodPodId,
    runpodRunId: job.render?.runpodRunId,
    progressPercent: 100,
    message: r2Key ? "Uploaded to R2" : r2Configured() ? `Local only (R2 failed: ${r2Error})` : "Local only (R2 not configured)",
  };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  return { outputKey, outputPath, shotstackUrl: outputUrl, outputUrl, r2Key };
}

export async function failRunpodJob(jobId: string, error: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) return;
  job.status = "failed";
  job.error = error;
  job.render = {
    ...(job.render || {}),
    status: "failed",
    renderer: "runpod",
    error,
  };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
}

export async function reportRunpodProgress(jobId: string, progress: number): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) return;
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  job.progressPercent = pct;
  job.render = {
    ...(job.render || { status: "rendering", renderer: "runpod" }),
    status: "rendering",
    renderer: "runpod",
    progressPercent: pct,
    message: `Rendering ${pct}%`,
  };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
}
