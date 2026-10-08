/**
 * Speed a saved voiceover into a target words-per-minute band and scale
 * scene timestamps by the same ratio. Visual picks, narration, and notes stay.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { jobDataFile, loadJob, readJson, saveJob, writeJson } from "../storage.js";
import { probeMediaDurationSec } from "./jobDuration.js";
import { royalTimelineHash } from "./royalV2/lock.js";
import type { TimelineScene } from "../../shared/visualIntelligence.js";
import type { TimedWord, VoiceAlignmentReport } from "./voiceAlignment.js";

const DEFAULT_TARGET_WPM = 142.5;
const MIN_WPM = 140;
const MAX_WPM = 145;

const ASSIGNMENT_FILES = [
  "visual-intelligence-final-assignment",
  "royal-v2-final-assignment",
  "final-timeline",
] as const;

const EVENT_FILES = [
  "effect-timeline",
  "royal-v2-sfx-plan",
  "royal-v2-music-plan",
  "royal-v2-glitch-plan",
] as const;

type AssignmentFile = {
  scenes?: TimelineScene[];
  voiceoverDurationSec?: number;
  locked?: boolean;
  hash?: string;
  [key: string]: unknown;
};

export type RetimeVoiceResult = {
  ok: true;
  jobId: string;
  title: string;
  words: number;
  speed: number;
  sceneCount: number;
  visualsUnchanged: true;
  before: { durationSec: number; wpm: number };
  after: { durationSec: number; wpm: number };
  audioReplaced: boolean;
  scenesScaled: boolean;
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function wpmFor(words: number, durationSec: number): number {
  return words / (durationSec / 60);
}

function visualFingerprint(scenes: TimelineScene[]): string {
  return scenes
    .map((scene) =>
      [
        scene.sceneId,
        scene.selectedVisualId || "",
        scene.approvedVisualId || "",
        scene.narrationText || "",
        (scene.alternativeAssetIds || []).join(","),
        scene.editorNotes || "",
        scene.source || "",
      ].join("\u0001")
    )
    .join("\n");
}

function scaleScene(scene: TimelineScene, scale: number): TimelineScene {
  const startTime = round3(Number(scene.startTime) * scale);
  const endTime = round3(Number(scene.endTime) * scale);
  const next: TimelineScene = {
    ...scene,
    startTime,
    endTime,
    duration: round3(Math.max(0, endTime - startTime)),
  };
  if (typeof scene.lastUsedTimestamp === "number") {
    next.lastUsedTimestamp = round3(scene.lastUsedTimestamp * scale);
  }
  if (scene.effects?.length) {
    next.effects = scene.effects.map((fx) => {
      const copy: Record<string, unknown> = { ...fx };
      if (typeof copy.startFrame === "number") {
        copy.startFrame = Math.max(0, Math.round(copy.startFrame * scale));
      }
      if (typeof copy.durationFrames === "number") {
        copy.durationFrames = Math.max(1, Math.round(copy.durationFrames * scale));
      }
      if (typeof copy.startTime === "number") copy.startTime = round3(copy.startTime * scale);
      if (typeof copy.durationSec === "number") copy.durationSec = round3(copy.durationSec * scale);
      return copy;
    });
  }
  return next;
}

function scaleEventList(events: Array<Record<string, unknown>>, scale: number) {
  return events.map((event) => {
    const next = { ...event };
    for (const key of ["startTime", "endTime", "durationSec", "duration"] as const) {
      if (typeof next[key] === "number") next[key] = round3((next[key] as number) * scale);
    }
    if (typeof next.startFrame === "number") {
      next.startFrame = Math.max(0, Math.round((next.startFrame as number) * scale));
    }
    if (typeof next.durationFrames === "number") {
      next.durationFrames = Math.max(1, Math.round((next.durationFrames as number) * scale));
    }
    return next;
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
      if (err.length > 8000) err = err.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim().slice(-600) || `ffmpeg exited ${code}`));
    });
  });
}

async function speedAudio(inputPath: string, speed: number, outputPath: string): Promise<void> {
  if (!(speed >= 0.5 && speed <= 2)) {
    throw new Error(`Speed ${speed.toFixed(3)} is outside the 0.5–2 range`);
  }
  const ext = path.extname(inputPath).toLowerCase();
  const args = ["-y", "-i", inputPath, "-vn", "-filter:a", `atempo=${speed.toFixed(6)}`];
  if (ext === ".mp3") args.push("-c:a", "libmp3lame", "-q:a", "2");
  else if (ext === ".wav") args.push("-c:a", "pcm_s16le");
  else args.push("-c:a", "aac", "-b:a", "192k");
  args.push(outputPath);
  await runFfmpeg(args);
}

async function scaleScenesInFile(name: string, jobId: string, targetDurationSec: number): Promise<number> {
  const file = jobDataFile(name, jobId);
  const data = await readJson<AssignmentFile>(file);
  if (!data?.scenes?.length) return 0;
  const span = data.scenes.reduce((max, scene) => Math.max(max, Number(scene.endTime) || 0), 0);
  if (!(span > 1) || Math.abs(span - targetDurationSec) < 1) return data.scenes.length;
  const scale = targetDurationSec / span;
  const before = visualFingerprint(data.scenes);
  const scenes = data.scenes.map((scene) => scaleScene(scene, scale));
  if (visualFingerprint(scenes) !== before) {
    throw new Error(`Refusing to write ${name}: a selected picture or line changed`);
  }
  data.scenes = scenes;
  if (typeof data.voiceoverDurationSec === "number") data.voiceoverDurationSec = targetDurationSec;
  if (data.locked && data.hash) data.hash = royalTimelineHash(scenes);
  await writeJson(file, data);
  return scenes.length;
}

async function fitAlignment(jobId: string, voiceoverPath: string, targetDurationSec: number): Promise<void> {
  const alignment = await readJson<VoiceAlignmentReport>(jobDataFile("voice-alignment", jobId));
  if (!alignment?.words?.length) return;
  const wordEnd = alignment.words[alignment.words.length - 1]?.end || 0;
  if (!(wordEnd > 1) || Math.abs(wordEnd - targetDurationSec) < 1) {
    if (alignment.voiceoverDurationSec !== targetDurationSec || alignment.voiceoverPath !== voiceoverPath) {
      alignment.voiceoverDurationSec = targetDurationSec;
      alignment.voiceoverPath = voiceoverPath;
      await writeJson(jobDataFile("voice-alignment", jobId), alignment);
    }
    return;
  }
  const scale = targetDurationSec / wordEnd;
  const words: TimedWord[] = alignment.words.map((word) => ({
    ...word,
    start: round3(word.start * scale),
    end: round3(word.end * scale),
  }));
  await writeJson(jobDataFile("voice-alignment", jobId), {
    ...alignment,
    words,
    voiceoverDurationSec: targetDurationSec,
    voiceoverPath,
  });
}

async function fitEventFile(name: string, jobId: string, targetDurationSec: number): Promise<void> {
  const file = jobDataFile(name, jobId);
  const data = await readJson<{ events?: Array<Record<string, unknown>> }>(file);
  if (!data?.events?.length) return;
  const span = data.events.reduce((max, event) => {
    const start = typeof event.startTime === "number" ? event.startTime : 0;
    const dur = typeof event.durationSec === "number" ? event.durationSec : 0;
    return Math.max(max, start + dur);
  }, 0);
  if (!(span > 1) || Math.abs(span - targetDurationSec) < 1.5) return;
  data.events = scaleEventList(data.events, targetDurationSec / span);
  await writeJson(file, data);
}

export async function retimeJobVoice(
  jobId: string,
  targetWpm = DEFAULT_TARGET_WPM
): Promise<RetimeVoiceResult> {
  if (!(targetWpm >= MIN_WPM && targetWpm <= MAX_WPM)) {
    throw new Error(`targetWpm must be between ${MIN_WPM} and ${MAX_WPM}`);
  }
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");
  if (job.status === "rendering" || job.status === "analyzing_full_script") {
    throw new Error("Cannot retime while the job is processing");
  }
  if (!job.voiceoverPath || !fs.existsSync(job.voiceoverPath)) {
    throw new Error("Voiceover file is missing");
  }

  const alignment = await readJson<VoiceAlignmentReport>(jobDataFile("voice-alignment", jobId));
  const words =
    alignment?.words?.length ||
    job.voiceAlignmentWordCount ||
    job.script.trim().split(/\s+/).filter(Boolean).length;
  if (!words) throw new Error("No word count for this voiceover");

  const beforeDuration = await probeMediaDurationSec(job.voiceoverPath);
  if (!(beforeDuration > 1)) throw new Error("Could not read the voiceover duration");
  const beforeWpm = wpmFor(words, beforeDuration);

  const assignment = await readJson<AssignmentFile>(
    jobDataFile("visual-intelligence-final-assignment", jobId)
  );
  const scenes = assignment?.scenes || [];
  if (!scenes.length) throw new Error("No timeline scenes to retime");
  const sceneSpan = scenes.reduce((max, scene) => Math.max(max, Number(scene.endTime) || 0), 0);

  const audioInBand = beforeWpm >= MIN_WPM - 0.05 && beforeWpm <= MAX_WPM + 0.05;
  if (audioInBand && Math.abs(sceneSpan - beforeDuration) < 1) {
    if (Math.abs((job.voiceoverDurationSec || 0) - beforeDuration) > 0.5) {
      job.voiceoverDurationSec = beforeDuration;
      job.updatedAt = new Date().toISOString();
      await saveJob(job);
    }
    return {
      ok: true,
      jobId,
      title: job.title,
      words,
      speed: 1,
      sceneCount: scenes.length,
      visualsUnchanged: true,
      before: { durationSec: round3(beforeDuration), wpm: round3(beforeWpm) },
      after: { durationSec: round3(beforeDuration), wpm: round3(beforeWpm) },
      audioReplaced: false,
      scenesScaled: false,
    };
  }
  const fingerprint = visualFingerprint(scenes);
  let newDuration = beforeDuration;
  let speed = 1;
  let audioReplaced = false;
  const backupPath = `${job.voiceoverPath}.before-wpm-retime`;
  let produced: string | null = null;

  if (!audioInBand) {
    const targetDuration = (words * 60) / targetWpm;
    speed = beforeDuration / targetDuration;
    const dir = path.dirname(job.voiceoverPath);
    const ext = path.extname(job.voiceoverPath) || ".mp3";
    produced = path.join(dir, `.retime-${Date.now()}${ext}`);
    await speedAudio(job.voiceoverPath, speed, produced);
    newDuration = await probeMediaDurationSec(produced);
    let producedWpm = wpmFor(words, newDuration);
    if (producedWpm < MIN_WPM - 0.05 || producedWpm > MAX_WPM + 0.05) {
      const correction = newDuration / targetDuration;
      if (correction < 0.5 || correction > 2) {
        fs.rmSync(produced, { force: true });
        throw new Error(`Retimed voice landed at ${producedWpm.toFixed(1)} wpm`);
      }
      const corrected = path.join(dir, `.retime-fix-${Date.now()}${ext}`);
      await speedAudio(produced, correction, corrected);
      fs.rmSync(produced, { force: true });
      produced = corrected;
      newDuration = await probeMediaDurationSec(produced);
      producedWpm = wpmFor(words, newDuration);
      speed *= correction;
    }
    if (producedWpm < MIN_WPM - 0.15 || producedWpm > MAX_WPM + 0.15) {
      fs.rmSync(produced, { force: true });
      throw new Error(`Retimed voice landed at ${producedWpm.toFixed(1)} wpm`);
    }
  }

  let sceneCount = scenes.length;
  const scenesNeedScale = !(sceneSpan > 1) ? false : Math.abs(sceneSpan - newDuration) >= 1;
  try {
    if (scenesNeedScale) {
      for (const name of ASSIGNMENT_FILES) {
        const count = await scaleScenesInFile(name, jobId, newDuration);
        if (name === "visual-intelligence-final-assignment") sceneCount = count;
      }
      const written = await readJson<AssignmentFile>(
        jobDataFile("visual-intelligence-final-assignment", jobId)
      );
      if (!written?.scenes?.length || visualFingerprint(written.scenes) !== fingerprint) {
        throw new Error("Scene pictures changed while retiming");
      }
    }
    await fitAlignment(jobId, job.voiceoverPath, newDuration);
    for (const name of EVENT_FILES) {
      await fitEventFile(name, jobId, newDuration);
    }

    if (produced) {
      if (!fs.existsSync(backupPath)) fs.copyFileSync(job.voiceoverPath, backupPath);
      fs.renameSync(produced, job.voiceoverPath);
      audioReplaced = true;
      produced = null;
    }
  } catch (error) {
    if (produced) fs.rmSync(produced, { force: true });
    throw error;
  }

  job.voiceoverDurationSec = newDuration;
  if (job.timelineLock?.locked) {
    const locked = await readJson<AssignmentFile>(jobDataFile("final-timeline", jobId));
    if (locked?.scenes?.length) {
      job.timelineLock = {
        ...job.timelineLock,
        hash: royalTimelineHash(locked.scenes),
        sceneCount: locked.scenes.length,
      };
    }
  }
  job.updatedAt = new Date().toISOString();
  await saveJob(job);

  const afterDuration = await probeMediaDurationSec(job.voiceoverPath);
  const afterWpm = wpmFor(words, afterDuration);
  return {
    ok: true,
    jobId,
    title: job.title,
    words,
    speed: round3(speed),
    sceneCount,
    visualsUnchanged: true,
    before: { durationSec: round3(beforeDuration), wpm: round3(beforeWpm) },
    after: { durationSec: round3(afterDuration), wpm: round3(afterWpm) },
    audioReplaced,
    scenesScaled: scenesNeedScale,
  };
}
