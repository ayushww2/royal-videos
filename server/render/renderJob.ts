import fs from "node:fs/promises";
import path from "node:path";
import { config, optionalEnv, getRendererForJob, type FinalRenderer } from "../config.js";
import { jobDataFile, writeJson, readJson, loadJob, saveJob } from "../storage.js";
import { runFinalQA } from "../visualIntelligence/finalQA.js";
import type { TimelineScene, ApprovedVisual } from "../../shared/visualIntelligence.js";
import type { EffectTimelineEvent } from "../visualIntelligence/effectPlanner.js";
import { buildRemotionInputProps, renderRemotionMp4 } from "./remotionRender.js";
import { toShotstackPublicUrl } from "./shotstackEffectMapper.js";
import { loadVerifiedRoyalV2Timeline } from "../visualIntelligence/royalV2/lock.js";
import { queueRunpodRender } from "./runpodQueue.js";

export async function renderJob(
  jobId: string,
  opts?: { force?: boolean }
): Promise<{
  outputPath?: string;
  outputKey?: string;
  shotstackId?: string;
  shotstackUrl?: string;
  renderer: FinalRenderer | "runpod-serverless";
  queued?: boolean;
  podId?: string;
  runId?: string;
  mode?: "serverless" | "pod";
}> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");

  // Mystery v2 always RunPod (never Shotstack), regardless of global RENDERER.
  const renderer = getRendererForJob(job.niche);
  if (renderer === "runpod") {
    const queued = await queueRunpodRender(jobId, opts);
    return {
      renderer: queued.renderer,
      queued: true,
      podId: queued.podId,
      runId: queued.runId,
      mode: queued.mode,
    };
  }

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
    console.warn(`[render] force=true — overriding QA: ${qa.criticalIssues.join("; ")}`);
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

  job.status = "rendering";
  job.render = { status: "rendering", renderer };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

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
  }>(jobDataFile("visual-intelligence-final-assignment", jobId));
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
  }>;

  const workDir = path.join(config.storagePath, "renders", jobId);
  await fs.mkdir(workDir, { recursive: true });
  const outputKey = `renders/${jobId}/final.mp4`;
  const outputPath = path.join(config.storagePath, outputKey);

  if (renderer === "remotion" || renderer === "remotion-lambda") {
    const inputProps = buildRemotionInputProps({
      scenes,
      libraryById: byId,
      effectEvents,
      sfxEvents,
      musicEvents,
      glitchEvents,
      voiceoverPath: job.voiceoverPath,
      fps: 30,
      imagesOnly: process.env.REMOTION_IMAGES_ONLY !== "0",
    });

    const logTag = renderer === "remotion-lambda" ? "remotion-lambda" : "remotion";

    await writeJson(jobDataFile("remotion-input-props", jobId), {
      jobId,
      compositionId: "DocumentaryEdit",
      renderer,
      effectCount: inputProps.effectEvents.length,
      sceneCount: inputProps.scenes.length,
      sfxCount: (inputProps.sfxEvents || []).length,
      musicCount: (inputProps.musicEvents || []).length,
      glitchCount: (inputProps.glitchEvents || []).length,
      hasVoiceover: Boolean(inputProps.voiceoverUrl),
      presetsUsed: [...new Set(inputProps.effectEvents.map((e) => e.presetId))],
      createdAt: new Date().toISOString(),
    });

    let lastPct = -1;
    const result = await renderRemotionMp4({
      jobId,
      outputPath,
      inputProps,
      onProgress: (progress) => {
        const pct = Math.round(progress * 100);
        if (pct >= lastPct + 5 || pct === 100) {
          lastPct = pct;
          console.log(`[${logTag}] ${jobId} ${pct}%`);
        }
      },
    });

    const publicBase = optionalEnv("PUBLIC_APP_URL")?.replace(/\/$/, "");
    const localUrl = publicBase ? `${publicBase}/media/${outputKey}` : undefined;

    await writeJson(jobDataFile("render-audit", jobId), {
      jobId,
      renderer,
      outputKey,
      outputPath: result.outputPath,
      durationInFrames: result.durationInFrames,
      lambdaRenderId: result.renderId,
      lambdaOutputUrl: result.outputUrl,
      sceneCount: scenes.length,
      effectCount: effectEvents.length,
      presetsUsed: [...new Set(effectEvents.map((e) => e.presetId))],
      noResearchDuringRender: true,
      renderedAt: new Date().toISOString(),
    });

    job.status = "completed";
    job.render = {
      status: "completed",
      outputKey,
      outputPath,
      shotstackUrl: localUrl || result.outputUrl,
    };
    job.updatedAt = new Date().toISOString();
    await saveJob(job);

    return {
      outputPath,
      outputKey,
      shotstackUrl: localUrl || result.outputUrl,
      renderer,
    };
  }

  // Legacy Shotstack path (RENDERER=shotstack)
  const { submitShotstackRender, pollShotstackRender } = await import("./shotstackClient.js");
  const { buildParityShotstackEdit } = await import("./shotstackEffectMapper.js");
  const voiceoverSrc =
    toShotstackPublicUrl(job.voiceoverPath) ||
    (await import("./storageMedia.js")).storageRenderUrl(job.voiceoverPath);
  const { edit, qa: effectQa, audit } = await buildParityShotstackEdit({
    jobId,
    scenes,
    libraryById: byId,
    voiceoverSrc,
    effectEvents,
    fps: 30,
  });
  await writeJson(jobDataFile("shotstack-edit", jobId), edit);
  const { id: shotstackId } = await submitShotstackRender(edit);
  job.render = { status: "rendering", shotstackId };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  const result = await pollShotstackRender(shotstackId);
  if (result.status !== "done" || !result.url) {
    throw new Error(result.error || "Shotstack render failed");
  }
  try {
    const mp4 = await fetch(result.url);
    if (mp4.ok) {
      const buf = Buffer.from(await mp4.arrayBuffer());
      await fs.writeFile(outputPath, buf);
    }
  } catch {
    // Cloud URL is still valid even if local download fails.
  }
  await writeJson(jobDataFile("render-audit", jobId), {
    jobId,
    renderer: "shotstack",
    shotstackId,
    shotstackUrl: result.url,
    outputKey,
    outputPath,
    sceneCount: scenes.length,
    matchedSceneReview: audit.matchedSceneReview,
    noResearchDuringRender: true,
    effectRenderability: effectQa,
    shotstackAudit: audit,
    renderedAt: new Date().toISOString(),
    shotstackPoll: result.raw,
  });
  job.status = "completed";
  job.render = {
    status: "completed",
    outputKey,
    outputPath,
    shotstackId,
    shotstackUrl: result.url,
  };
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  return {
    outputPath,
    outputKey,
    shotstackId,
    shotstackUrl: result.url,
    renderer: "shotstack",
  };
}
