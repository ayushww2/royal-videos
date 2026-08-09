import { spawn } from "node:child_process";
import type { JobRecord } from "../../shared/visualIntelligence.js";
import {
  WORDS_PER_SECOND as WPS,
  costLimitsForDurationSec,
  type PipelineCostLimits,
} from "../../shared/visualIntelligence.js";

export function estimateScriptDurationSec(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(15, words / WPS);
}

/**
 * Master clock for a job:
 * 1) uploaded voiceover duration (preferred)
 * 2) else script word-count estimate
 */
export function getJobTargetDurationSec(job: JobRecord): number {
  const vo = Number(job.voiceoverDurationSec || 0);
  if (Number.isFinite(vo) && vo > 1) return vo;
  return estimateScriptDurationSec(job.script);
}

export function getJobCostLimits(job: JobRecord): PipelineCostLimits {
  const base = costLimitsForDurationSec(getJobTargetDurationSec(job));
  // Celebrity reference-ready: expand Google diversity so ≥15 unique assets is achievable.
  if (job.niche === "Celebrity v1") {
    return {
      ...base,
      maxImageQueries: Math.max(base.maxImageQueries, 36),
      maxQueryPacks: Math.max(base.maxQueryPacks, 28),
      maxCandidatesCollected: Math.max(base.maxCandidatesCollected, 220),
      maxCandidatesPerQuery: Math.max(base.maxCandidatesPerQuery, 12),
      maxGptVisionJudgments: Math.max(base.maxGptVisionJudgments, 200),
    };
  }
  if (job.niche === "Mystery v2") {
    // 10–12 unique stills/min @ ~4.5s holds → large Google + AI pools, max ~2× reuse.
    return {
      ...base,
      maxImageQueries: Math.max(base.maxImageQueries, 220),
      maxQueryPacks: Math.max(base.maxQueryPacks, 220),
      maxCandidatesCollected: Math.max(base.maxCandidatesCollected, 1400),
      maxCandidatesPerQuery: Math.max(base.maxCandidatesPerQuery, 8),
      maxGptVisionJudgments: Math.max(base.maxGptVisionJudgments, 800),
    };
  }
  return base;
}

/** Evenly sample beats for GPT context (avoid first-N bias on long videos). */
export function sampleBeatsForPrompt<T>(beats: T[], max: number): T[] {
  if (beats.length <= max) return beats;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.min(beats.length - 1, Math.floor((i / Math.max(1, max - 1)) * (beats.length - 1)));
    out.push(beats[idx]);
  }
  return out;
}

export function probeMediaDurationSec(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { windowsHide: true }
    );
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", () => resolve(0));
    child.on("close", (code) => {
      if (code !== 0) return resolve(0);
      const n = Number(stdout.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : 0);
    });
  });
}
