import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { jobDataFile, writeJson, readJson, jobDir } from "../../storage.js";
import { getJobCostLimits } from "../jobDuration.js";
import type { JobRecord, VisualBeat, VisualCandidate } from "../../../shared/visualIntelligence.js";

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} failed (${code}): ${stderr}`));
    });
  });
}

async function ffprobeDuration(filePath: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return Number(stdout.trim()) || 0;
}

function isVideoFile(filePath: string): boolean {
  return /\.(mp4|mov|webm|mkv|m4v)$/i.test(filePath);
}

export interface MysteryRawChunk {
  rawChunkId: string;
  sourceFile: string;
  startTime: number;
  endTime: number;
  thumbnail?: string;
  description: string;
  detectedPlace: string;
  detectedObject: string;
  detectedSceneType: string;
  qualityScore: number;
  mysteryUsefulnessScore: number;
  matchedBeatIds: string[];
  warnings: string[];
}

/**
 * Chunk raw video into the shared candidate pool.
 * No GPT describe here — the holistic editorJudge pass judges raw + images together.
 */
export async function indexMysteryRawFootage(
  job: JobRecord,
  beats: VisualBeat[]
): Promise<{ chunks: MysteryRawChunk[]; candidates: VisualCandidate[]; indexedCount: number }> {
  const outDir = path.join(jobDir(job.jobId), "raw-chunks");
  await fs.mkdir(outDir, { recursive: true });
  const ranges: Array<{
    rawChunkId: string;
    sourceFile: string;
    startTime: number;
    endTime: number;
    thumbnail?: string;
  }> = [];
  const candidates: VisualCandidate[] = [];
  const limits = getJobCostLimits(job);

  const videoPaths = (job.rawFootagePaths || []).filter(isVideoFile);
  for (const sourceFile of videoPaths) {
    let duration = 0;
    try {
      duration = await ffprobeDuration(sourceFile);
    } catch {
      continue;
    }
    const chunkLen = 3.5;
    for (let start = 0; start < duration; start += chunkLen) {
      if (ranges.length >= limits.maxRawFootageChunksDeeplyJudged) break;
      const end = Math.min(start + chunkLen, duration);
      if (end - start < 1.2) break;
      const rawChunkId = `mraw-${ranges.length + 1}`;
      const thumbnail = path.join(outDir, `${rawChunkId}.jpg`);
      try {
        await run("ffmpeg", [
          "-y",
          "-ss",
          String(start + Math.min(0.8, (end - start) / 2)),
          "-i",
          sourceFile,
          "-frames:v",
          "1",
          "-q:v",
          "4",
          thumbnail,
        ]);
        const st = await fs.stat(thumbnail);
        if (st.size < 1200) continue;
        ranges.push({ rawChunkId, sourceFile, startTime: start, endTime: end, thumbnail });
        candidates.push({
          candidateId: rawChunkId,
          source: "raw_footage",
          urlOrPath: sourceFile,
          thumbnail,
          duration: end - start,
          title: `Raw ${start.toFixed(1)}s–${end.toFixed(1)}s`,
          snippet: `raw chunk ${start.toFixed(1)}-${end.toFixed(1)}`,
          relatedEntities: [],
          relatedBeatIds: beats.map((b) => b.beatId),
          detectedVisualType: "video",
        });
      } catch {
        // skip corrupt
      }
    }
    if (ranges.length >= limits.maxRawFootageChunksDeeplyJudged) break;
  }

  const chunks: MysteryRawChunk[] = ranges.map((r) => ({
    rawChunkId: r.rawChunkId,
    sourceFile: r.sourceFile,
    startTime: r.startTime,
    endTime: r.endTime,
    thumbnail: r.thumbnail,
    description: "",
    detectedPlace: "",
    detectedObject: "",
    detectedSceneType: "",
    qualityScore: 70,
    mysteryUsefulnessScore: 70,
    matchedBeatIds: beats.map((b) => b.beatId),
    warnings: [],
  }));

  await writeJson(jobDataFile("mystery-v1-raw-footage-index", job.jobId), {
    jobId: job.jobId,
    indexedCount: chunks.length,
    note: "Chunks only — holistic editorJudge judges with images after collection",
    chunks,
  });
  await writeJson(jobDataFile("raw-footage-index", job.jobId), { jobId: job.jobId, chunks });
  await writeJson(jobDataFile("raw-footage-candidates", job.jobId), {
    jobId: job.jobId,
    candidates,
  });

  return { chunks, candidates, indexedCount: chunks.length };
}

export async function writeMysteryRawUsage(
  jobId: string,
  scenes: Array<{ duration: number; source: string; rawFootageUsed?: boolean }>
): Promise<void> {
  const total = scenes.reduce((n, s) => n + (s.duration || 0), 0) || 1;
  const rawDurationUsed = scenes
    .filter(
      (s) =>
        s.source === "raw_footage" ||
        s.source === "user_youtube_raw" ||
        s.rawFootageUsed
    )
    .reduce((n, s) => n + (s.duration || 0), 0);
  const actualRawPercent = (rawDurationUsed / total) * 100;

  // Prefer the assignment report written by assembleEditorTimeline when present.
  const share = await readJson<{
    targetRawMinPercent?: number;
    targetRawMaxPercent?: number;
    effectiveRawTargetPercent?: number;
    rawReducedReason?: string;
    useUserYoutubeMix?: boolean;
  }>(jobDataFile("raw-footage-timeline-share", jobId));

  const targetMin = share?.targetRawMinPercent ?? (share?.useUserYoutubeMix ? 16 : 10);
  const targetMax = share?.targetRawMaxPercent ?? (share?.useUserYoutubeMix ? 24 : 30);
  const targetMet = actualRawPercent >= targetMin - 0.5 && actualRawPercent <= targetMax + 2;
  await writeJson(jobDataFile("mystery-v1-raw-footage-usage", jobId), {
    targetRawMinPercent: targetMin,
    targetRawMaxPercent: targetMax,
    effectiveRawTargetPercent: share?.effectiveRawTargetPercent,
    rawReducedReason: share?.rawReducedReason,
    useUserYoutubeMix: Boolean(share?.useUserYoutubeMix),
    actualRawPercent: Number(actualRawPercent.toFixed(1)),
    rawDurationUsed: Number(rawDurationUsed.toFixed(1)),
    targetMet,
    reasonIfNotMet: targetMet
      ? ""
      : actualRawPercent < targetMin
        ? share?.rawReducedReason || "Not enough relevant raw footage matched narration"
        : `Raw footage share exceeded ${targetMax}% target`,
  });
}
