/**
 * Script-aligned VO timing.
 *
 * Preferred path on Railway: OpenAI Whisper (API) with word timestamps, then
 * map exact script tokens → timed words (forced-align style). Local Whisper
 * is not practical on the slim Railway image (no GPU / large model).
 *
 * Fallback: callers keep WPM stretch when no VO or transcription fails.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import OpenAI, { toFile } from "openai";
import { getOpenAiKey, config, optionalEnv } from "../config.js";
import { jobDataFile, readJson, writeJson, saveJob } from "../storage.js";
import type { JobRecord } from "../../shared/visualIntelligence.js";

export type TimedWord = {
  text: string;
  start: number;
  end: number;
};

export type WindowTiming = {
  startTime: number;
  endTime: number;
  duration: number;
};

export type VoiceAlignmentReport = {
  jobId: string;
  status: "ready" | "failed" | "skipped";
  source: "openai_whisper" | "none";
  scriptWordCount: number;
  voiceoverPath?: string;
  voiceoverDurationSec?: number;
  words: TimedWord[];
  model?: string;
  createdAt: string;
  error?: string;
};

const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
const ALIGN_LOOKAHEAD = 12;

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}']+/gu, "");
}

export function tokenizeScript(script: string): string[] {
  return script.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

function interpolateMissing(aligned: TimedWord[], totalDurationSec: number): void {
  const n = aligned.length;
  for (let i = 0; i < n; i++) {
    if (aligned[i].start >= 0 && aligned[i].end >= 0) continue;
    let prev = i - 1;
    while (prev >= 0 && aligned[prev].start < 0) prev--;
    let next = i + 1;
    while (next < n && aligned[next].start < 0) next++;

    const prevEnd = prev >= 0 ? aligned[prev].end : 0;
    const nextStart = next < n ? aligned[next].start : Math.max(prevEnd, totalDurationSec);
    const gap = Math.max(0, nextStart - prevEnd);
    const missing = next - prev - 1;
    const slot = missing > 0 ? gap / missing : 0;
    const offset = i - prev - 1;
    const start = prevEnd + slot * offset;
    const end = prevEnd + slot * (offset + 1);
    aligned[i].start = Number(start.toFixed(3));
    aligned[i].end = Number(Math.max(start + 0.05, end).toFixed(3));
  }
}

/**
 * Sequential forced-align: script is the exact VO text, so walk Whisper words
 * in order with a small lookahead for insertions / minor ASR drift.
 */
export function alignScriptToTimedWords(
  script: string,
  whisperWords: TimedWord[],
  totalDurationSec: number
): TimedWord[] {
  const scriptTokens = tokenizeScript(script);
  const whisper = whisperWords
    .map((w) => ({
      text: w.text,
      start: w.start,
      end: Math.max(w.start + 0.04, w.end),
      norm: normalizeToken(w.text),
    }))
    .filter((w) => w.norm);

  const aligned: TimedWord[] = [];
  let wi = 0;

  for (const token of scriptTokens) {
    const want = normalizeToken(token);
    if (!want) {
      aligned.push({ text: token, start: -1, end: -1 });
      continue;
    }

    let found = -1;
    const limit = Math.min(whisper.length, wi + ALIGN_LOOKAHEAD);
    for (let j = wi; j < limit; j++) {
      if (tokensMatch(whisper[j].norm, want)) {
        found = j;
        break;
      }
    }

    if (found >= 0) {
      aligned.push({
        text: token,
        start: whisper[found].start,
        end: whisper[found].end,
      });
      wi = found + 1;
    } else {
      aligned.push({ text: token, start: -1, end: -1 });
    }
  }

  interpolateMissing(aligned, totalDurationSec);
  return aligned;
}

/**
 * Map meaning windows onto aligned script words (in order) and produce
 * contiguous beat timings locked to the VO clock.
 */
export function timingsForWindows(
  windows: string[],
  alignedWords: TimedWord[],
  totalDurationSec: number
): WindowTiming[] {
  if (!windows.length) return [];

  let cursor = 0;
  const raw: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < windows.length; i++) {
    const count = Math.max(1, tokenizeScript(windows[i]).length);
    const remainingWindows = windows.length - i;
    const remainingWords = Math.max(0, alignedWords.length - cursor);
    const take =
      i === windows.length - 1
        ? remainingWords || count
        : Math.min(count, Math.max(1, remainingWords - (remainingWindows - 1)));

    const slice =
      alignedWords.length > 0
        ? alignedWords.slice(cursor, Math.min(alignedWords.length, cursor + take))
        : [];
    cursor += slice.length || take;

    if (slice.length) {
      raw.push({
        start: Math.max(0, slice[0].start),
        end: Math.max(slice[0].start + 0.2, slice[slice.length - 1].end),
      });
    } else {
      const fallbackStart = raw.length ? raw[raw.length - 1].end : 0;
      const fallbackDur = totalDurationSec / windows.length;
      raw.push({
        start: fallbackStart,
        end: fallbackStart + fallbackDur,
      });
    }
  }

  // Contiguous timeline: each beat ends where the next begins.
  const timings: WindowTiming[] = raw.map((span) => ({
    startTime: span.start,
    endTime: span.end,
    duration: Math.max(0.2, span.end - span.start),
  }));

  for (let i = 0; i < timings.length - 1; i++) {
    const boundary = Math.max(timings[i].startTime + 0.35, timings[i + 1].startTime);
    timings[i].endTime = boundary;
    timings[i].duration = Number((timings[i].endTime - timings[i].startTime).toFixed(3));
    timings[i + 1].startTime = boundary;
  }

  if (timings.length) {
    timings[0].startTime = 0;
    timings[timings.length - 1].endTime = Number(totalDurationSec.toFixed(3));
    for (const t of timings) {
      t.startTime = Number(t.startTime.toFixed(3));
      t.endTime = Number(Math.max(t.startTime + 0.2, t.endTime).toFixed(3));
      t.duration = Number((t.endTime - t.startTime).toFixed(3));
    }
  }

  return timings;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(0, 400) || `ffmpeg exited ${code}`));
    });
  });
}

async function prepareAudioForWhisper(
  inputPath: string
): Promise<{ path: string; cleanup?: () => void }> {
  const stat = fs.statSync(inputPath);
  if (stat.size <= WHISPER_MAX_BYTES) {
    return { path: inputPath };
  }

  const outPath = path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}.whisper64k.mp3`
  );
  console.log(
    `[voice-alignment] compressing ${path.basename(inputPath)} (${(stat.size / 1e6).toFixed(1)}MB) for Whisper`
  );
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    outPath,
  ]);
  const outStat = fs.statSync(outPath);
  if (outStat.size > WHISPER_MAX_BYTES) {
    try {
      fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    throw new Error(
      `Voiceover still too large for Whisper after compression (${(outStat.size / 1e6).toFixed(1)}MB)`
    );
  }
  return {
    path: outPath,
    cleanup: () => {
      try {
        fs.unlinkSync(outPath);
      } catch {
        /* ignore */
      }
    },
  };
}

function whisperApiKey(): string {
  // Prefer a dedicated OpenAI key for /audio/transcriptions (ContactBox chat proxy often lacks it).
  return optionalEnv("OPENAI_WHISPER_API_KEY") || getOpenAiKey();
}

function whisperClient(): OpenAI {
  const whisperBase =
    optionalEnv("OPENAI_WHISPER_BASE_URL") || config.openaiBaseUrl;
  return new OpenAI({
    apiKey: whisperApiKey(),
    baseURL: whisperBase,
    maxRetries: 3,
    timeout: 600_000,
  });
}

function whisperModel(): string {
  return optionalEnv("OPENAI_WHISPER_MODEL") || "whisper-1";
}

function voiceAlignmentEnabled(): boolean {
  const raw = optionalEnv("VOICE_ALIGNMENT");
  if (raw == null) return true;
  return !/^(0|false|off|no)$/i.test(raw);
}

type WhisperVerbose = {
  text?: string;
  duration?: number;
  words?: Array<{ word?: string; text?: string; start?: number; end?: number }>;
};

/** Max parallel Whisper uploads (default 1). Env: WHISPER_CONCURRENCY */
function whisperConcurrency(): number {
  const value = Number(process.env.WHISPER_CONCURRENCY || "1");
  return Math.max(1, Math.min(3, Number.isFinite(value) ? Math.floor(value) : 1));
}

const whisperWaiters: Array<() => void> = [];
let whisperActive = 0;

async function withWhisperSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (whisperActive >= whisperConcurrency()) {
    await new Promise<void>((resolve) => whisperWaiters.push(resolve));
  }
  whisperActive += 1;
  try {
    return await fn();
  } finally {
    whisperActive -= 1;
    const next = whisperWaiters.shift();
    if (next) next();
  }
}

async function transcribeWithWordTimestamps(
  audioPath: string
): Promise<{ words: TimedWord[]; durationSec: number; model: string }> {
  return withWhisperSlot(async () => {
    const prepared = await prepareAudioForWhisper(audioPath);
    const model = whisperModel();
    try {
      const openai = whisperClient();
      const file = await toFile(createReadStream(prepared.path), path.basename(prepared.path));
      const result = (await openai.audio.transcriptions.create({
        file,
        model,
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
      })) as unknown as WhisperVerbose;

      const words: TimedWord[] = (result.words || [])
        .map((w) => {
          const text = String(w.word || w.text || "").trim();
          const start = Number(w.start);
          const end = Number(w.end);
          if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return null;
          return { text, start, end: Math.max(start + 0.04, end) };
        })
        .filter((w): w is TimedWord => Boolean(w));

      if (!words.length) {
        throw new Error(
          "Whisper returned no word timestamps (proxy may not support timestamp_granularities)",
        );
      }

      const durationSec =
        Number(result.duration) > 1
          ? Number(result.duration)
          : words[words.length - 1]?.end || 0;

      return { words, durationSec, model };
    } finally {
      prepared.cleanup?.();
    }
  });
}

function cacheMatches(job: JobRecord, cached: VoiceAlignmentReport | null): boolean {
  if (!cached || cached.status !== "ready" || !cached.words?.length) return false;
  if (cached.voiceoverPath !== job.voiceoverPath) return false;
  if (cached.scriptWordCount !== tokenizeScript(job.script).length) return false;
  return true;
}

/**
 * Produce (or load cached) script-aligned timed words for a job with VO.
 * Safe to call repeatedly; does not throw — returns skipped/failed reports.
 */
export async function ensureVoiceAlignment(job: JobRecord): Promise<VoiceAlignmentReport> {
  const cachePath = jobDataFile("voice-alignment", job.jobId);
  const cached = await readJson<VoiceAlignmentReport>(cachePath);
  if (cacheMatches(job, cached)) return cached!;

  const createdAt = new Date().toISOString();
  const scriptWordCount = tokenizeScript(job.script).length;

  if (!voiceAlignmentEnabled()) {
    const skipped: VoiceAlignmentReport = {
      jobId: job.jobId,
      status: "skipped",
      source: "none",
      scriptWordCount,
      voiceoverPath: job.voiceoverPath,
      voiceoverDurationSec: job.voiceoverDurationSec,
      words: [],
      createdAt,
      error: "VOICE_ALIGNMENT disabled",
    };
    await writeJson(cachePath, skipped);
    return skipped;
  }

  if (!job.voiceoverPath || !fs.existsSync(job.voiceoverPath)) {
    const skipped: VoiceAlignmentReport = {
      jobId: job.jobId,
      status: "skipped",
      source: "none",
      scriptWordCount,
      voiceoverPath: job.voiceoverPath,
      voiceoverDurationSec: job.voiceoverDurationSec,
      words: [],
      createdAt,
      error: "No voiceover file on job",
    };
    await writeJson(cachePath, skipped);
    return skipped;
  }

  try {
    console.log(`[voice-alignment] transcribing ${job.jobId}…`);
    const { words: whisperWords, durationSec, model } = await transcribeWithWordTimestamps(
      job.voiceoverPath
    );
    const totalDuration = job.voiceoverDurationSec && job.voiceoverDurationSec > 1
      ? job.voiceoverDurationSec
      : durationSec;
    const words = alignScriptToTimedWords(job.script, whisperWords, totalDuration);

    const report: VoiceAlignmentReport = {
      jobId: job.jobId,
      status: "ready",
      source: "openai_whisper",
      scriptWordCount,
      voiceoverPath: job.voiceoverPath,
      voiceoverDurationSec: totalDuration,
      words,
      model,
      createdAt,
    };
    await writeJson(cachePath, report);

    job.voiceAlignmentStatus = "ready";
    job.voiceAlignmentWordCount = words.length;
    job.updatedAt = createdAt;
    await saveJob(job);

    console.log(
      `[voice-alignment] ready ${job.jobId}: ${words.length} words, ${totalDuration.toFixed(1)}s via ${model}`
    );
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[voice-alignment] failed ${job.jobId}: ${message}`);
    const failed: VoiceAlignmentReport = {
      jobId: job.jobId,
      status: "failed",
      source: "none",
      scriptWordCount,
      voiceoverPath: job.voiceoverPath,
      voiceoverDurationSec: job.voiceoverDurationSec,
      words: [],
      createdAt,
      error: message,
    };
    await writeJson(cachePath, failed);
    job.voiceAlignmentStatus = "failed";
    job.updatedAt = createdAt;
    await saveJob(job);
    return failed;
  }
}

/** Build beat timings from a ready alignment + meaning windows. */
export function alignedTimingsForBeats(
  windows: string[],
  alignment: VoiceAlignmentReport,
  totalDurationSec: number
): WindowTiming[] | null {
  if (alignment.status !== "ready" || !alignment.words.length || !windows.length) return null;
  return timingsForWindows(windows, alignment.words, totalDurationSec);
}
