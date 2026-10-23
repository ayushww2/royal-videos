/**
 * Script-aligned VO timing.
 *
 * AssemblyAI word timestamps, then map exact script tokens → timed words.
 * Whisper is not used. If AssemblyAI fails, the report is failed and callers
 * keep the WPM stretch.
 */
import fs from "node:fs";
import { optionalEnv } from "../config.js";
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
  source: "assemblyai" | "none";
  scriptWordCount: number;
  voiceoverPath?: string;
  voiceoverDurationSec?: number;
  words: TimedWord[];
  model?: string;
  createdAt: string;
  error?: string;
};

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

function voiceAlignmentEnabled(): boolean {
  const raw = optionalEnv("VOICE_ALIGNMENT");
  if (raw == null) return true;
  return !/^(0|false|off|no)$/i.test(raw);
}

function assemblyApiKey(): string {
  const key = optionalEnv("ASSEMBLYAI_API_KEY");
  if (!key) throw new Error("ASSEMBLYAI_API_KEY is not set");
  return key;
}

async function assemblyJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail = String(data.error || data.message || response.statusText || "request failed");
    throw new Error(`AssemblyAI ${response.status}: ${detail}`);
  }
  return data;
}

async function transcribeWithAssembly(
  audioPath: string
): Promise<{ words: TimedWord[]; durationSec: number; model: string }> {
  const key = assemblyApiKey();
  const audio = fs.readFileSync(audioPath);
  const uploaded = await assemblyJson("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { authorization: key, "content-type": "application/octet-stream" },
    body: audio,
  });
  const audioUrl = String(uploaded.upload_url || "");
  if (!audioUrl) throw new Error("AssemblyAI upload did not return an audio URL");

  const created = await assemblyJson("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: audioUrl, language_code: "en" }),
  });
  const id = String(created.id || "");
  if (!id) throw new Error("AssemblyAI did not return a transcript id");

  const deadline = Date.now() + 20 * 60 * 1000;
  let transcript: Record<string, unknown> = created;
  while (Date.now() < deadline) {
    const status = String(transcript.status || "");
    if (status === "completed") break;
    if (status === "error") throw new Error(String(transcript.error || "AssemblyAI transcript failed"));
    await new Promise((resolve) => setTimeout(resolve, 3000));
    transcript = await assemblyJson(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: key },
    });
  }
  if (String(transcript.status) !== "completed") {
    throw new Error("AssemblyAI transcript timed out");
  }

  const rawWords = Array.isArray(transcript.words) ? transcript.words : [];
  const words: TimedWord[] = rawWords
    .map((word) => {
      const row = word as { text?: string; start?: number; end?: number };
      const label = String(row.text || "").trim();
      const startMs = Number(row.start);
      const endMs = Number(row.end);
      if (!label || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
      const startSec = startMs / 1000;
      const endSec = endMs / 1000;
      return { text: label, start: startSec, end: Math.max(startSec + 0.04, endSec) };
    })
    .filter((word): word is TimedWord => Boolean(word));
  if (!words.length) throw new Error("AssemblyAI returned no word timestamps");

  const audioDuration = Number(transcript.audio_duration);
  const durationSec = audioDuration > 1 ? audioDuration : words[words.length - 1].end;
  return { words, durationSec, model: "assemblyai" };
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
    const { words: whisperWords, durationSec, model } = await transcribeWithAssembly(
      job.voiceoverPath
    );
    const totalDuration = job.voiceoverDurationSec && job.voiceoverDurationSec > 1
      ? job.voiceoverDurationSec
      : durationSec;
    const words = alignScriptToTimedWords(job.script, whisperWords, totalDuration);

    const report: VoiceAlignmentReport = {
      jobId: job.jobId,
      status: "ready",
      source: "assemblyai",
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
