/**
 * Re-window Celebrity beats to reference hold length (~5s).
 * Ensures retries don't keep stale 3.5s flicker pacing from older artifacts.
 */
import { jobDataFile, writeJson } from "../../storage.js";
import type { JobRecord, VisualBeat } from "../../../shared/visualIntelligence.js";
import { getJobTargetDurationSec } from "../jobDuration.js";
import {
  celebrityHoldClamp,
  celebrityTargetHoldSec,
} from "./referenceRecipe.js";

export function rewindowCelebrityBeats(
  beats: VisualBeat[],
  targetDurationSec: number
): VisualBeat[] {
  if (!beats.length) return beats;
  const hold = celebrityTargetHoldSec();
  const expected = Math.max(1, Math.round(targetDurationSec / hold));
  const avgCurrent =
    beats.reduce((n, b) => n + (b.duration || hold), 0) / Math.max(1, beats.length);

  // Already close to recipe — clamp + stretch last beat to VO end.
  if (Math.abs(avgCurrent - hold) < 0.55 && Math.abs(beats.length - expected) <= 2) {
    let t = 0;
    return beats.map((b, idx) => {
      const startTime = Number(t.toFixed(2));
      let duration = celebrityHoldClamp(b.duration || hold);
      let endTime = Number((startTime + duration).toFixed(2));
      if (idx === beats.length - 1) {
        endTime = Number(targetDurationSec.toFixed(2));
        duration = Number(Math.max(3.5, endTime - startTime).toFixed(2));
      }
      t = endTime;
      return { ...b, startTime, endTime, duration };
    });
  }

  // Rebuild VO clock from existing narration slices (preserve content, fix pacing).
  const totalNarr = beats.map((b) => b.narrationText || "").join(" ").trim();
  const words = totalNarr.split(/\s+/).filter(Boolean);
  const wordsPerBeat = Math.max(8, Math.round(words.length / expected));
  const out: VisualBeat[] = [];
  for (let i = 0; i < expected; i++) {
    const src = beats[Math.min(beats.length - 1, Math.floor((i / expected) * beats.length))];
    const w0 = i * wordsPerBeat;
    const slice = words.slice(w0, w0 + wordsPerBeat).join(" ") || src.narrationText || "";
    const startTime = Number((i * hold).toFixed(2));
    let duration = hold;
    let endTime = Number((startTime + duration).toFixed(2));
    if (i === expected - 1) {
      endTime = Number(targetDurationSec.toFixed(2));
      duration = Number(Math.max(3.5, endTime - startTime).toFixed(2));
    }
    out.push({
      ...src,
      beatId: `beat-${i + 1}`,
      startTime,
      endTime,
      duration,
      narrationText: slice || src.narrationText,
    });
  }
  return out;
}

export async function persistCelebrityBeats(job: JobRecord, beats: VisualBeat[]): Promise<void> {
  const targetDurationSec = getJobTargetDurationSec(job);
  await writeJson(jobDataFile("editor-visual-beats", job.jobId), {
    jobId: job.jobId,
    beats,
    targetDurationSec,
    voiceoverDurationSec: job.voiceoverDurationSec,
    mode: "celebrity_v1_reference_hold",
    recipeHoldSec: celebrityTargetHoldSec(),
  });
  await writeJson(jobDataFile("visual-intelligence-beats", job.jobId), {
    jobId: job.jobId,
    beats,
    targetDurationSec,
    mode: "celebrity_v1_reference_hold",
  });
}
