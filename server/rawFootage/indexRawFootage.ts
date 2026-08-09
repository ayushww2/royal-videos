import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { jobDataFile, writeJson, jobDir } from "../storage.js";
import { getJobCostLimits } from "../visualIntelligence/jobDuration.js";
import type { JobRecord, VisualBeat, VisualCandidate } from "../../shared/visualIntelligence.js";

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

/**
 * Index raw video into short chunks for the shared candidate pool.
 * No GPT here — chunks are judged later in the holistic editor pass with images.
 */
export async function indexRawFootage(job: JobRecord, beats: VisualBeat[]): Promise<VisualCandidate[]> {
  const limits = getJobCostLimits(job);
  const ranges: Array<{
    rangeId: string;
    sourcePath: string;
    start: number;
    end: number;
    thumbnail?: string;
  }> = [];
  const candidates: VisualCandidate[] = [];

  const outDir = path.join(jobDir(job.jobId), "raw-chunks");
  await fs.mkdir(outDir, { recursive: true });

  const videoPaths = (job.rawFootagePaths || []).filter(isVideoFile);
  for (const sourcePath of videoPaths) {
    let duration = 0;
    try {
      duration = await ffprobeDuration(sourcePath);
    } catch {
      continue;
    }

    await writeJson(
      path.join(outDir, `index-${crypto.createHash("md5").update(sourcePath).digest("hex").slice(0, 8)}.json`),
      { sourcePath, duration, createdAt: new Date().toISOString() }
    );

    // ~3–4s editorial chunks for timeline cuts
    const chunkLen = 3.5;
    for (let start = 0; start < duration; start += chunkLen) {
      if (candidates.length >= limits.maxRawFootageChunksDeeplyJudged) break;
      const end = Math.min(start + chunkLen, duration);
      if (end - start < 1.2) break;
      const rangeId = `rf-${ranges.length + 1}`;
      const thumb = path.join(outDir, `${rangeId}.jpg`);
      try {
        await run("ffmpeg", [
          "-y",
          "-ss",
          String(start + Math.min(0.8, (end - start) / 2)),
          "-i",
          sourcePath,
          "-frames:v",
          "1",
          "-q:v",
          "4",
          thumb,
        ]);
        ranges.push({ rangeId, sourcePath, start, end, thumbnail: thumb });
        candidates.push({
          candidateId: rangeId,
          source: "raw_footage",
          urlOrPath: sourcePath,
          thumbnail: thumb,
          duration: end - start,
          title: `Raw ${start.toFixed(1)}s–${end.toFixed(1)}s`,
          snippet: `raw chunk ${start.toFixed(1)}-${end.toFixed(1)} start=${start}`,
          relatedEntities: [],
          relatedBeatIds: beats.map((b) => b.beatId),
          detectedVisualType: "video",
          dimensions: undefined,
        });
      } catch {
        ranges.push({ rangeId, sourcePath, start, end });
        candidates.push({
          candidateId: rangeId,
          source: "raw_footage",
          urlOrPath: sourcePath,
          duration: end - start,
          title: `Raw ${start.toFixed(1)}s–${end.toFixed(1)}s`,
          snippet: `raw chunk ${start.toFixed(1)}-${end.toFixed(1)} start=${start}`,
          relatedEntities: [],
          relatedBeatIds: beats.map((b) => b.beatId),
          detectedVisualType: "video",
        });
      }
      if (candidates.length >= limits.maxRawFootageChunksDeeplyJudged) break;
    }
    if (candidates.length >= limits.maxRawFootageChunksDeeplyJudged) break;
  }

  await writeJson(jobDataFile("raw-footage-index", job.jobId), { jobId: job.jobId, ranges });
  await writeJson(jobDataFile("raw-footage-candidates", job.jobId), {
    jobId: job.jobId,
    candidates,
    note: "Chunks only — GPT editor judges these together with images after collection",
  });

  return candidates;
}
