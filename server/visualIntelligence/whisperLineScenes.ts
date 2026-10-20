import { jobDataFile, readJson, saveJob, writeJson } from "../storage.js";
import { splitRoyalScriptIntoScenes } from "./royalV2/beats.js";
import { spokenSpansForWindows, type VoiceAlignmentReport } from "./voiceAlignment.js";
import type { JobRecord, TimelineScene } from "../../shared/visualIntelligence.js";

/** Job ids that should stop after Whisper line timings and skip visual collection. */
export function whisperLineScenesOnly(jobId: string): boolean {
  const raw = process.env.WHISPER_LINE_SCENES_JOB_IDS || "";
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(jobId);
}

/**
 * One script line = one scene, timed from the saved Whisper alignment.
 * No library search and no visual plan.
 */
export async function publishWhisperLineScenes(job: JobRecord): Promise<TimelineScene[]> {
  const alignment = await readJson<VoiceAlignmentReport>(jobDataFile("voice-alignment", job.jobId));
  if (!alignment || alignment.status !== "ready" || !alignment.words?.length) {
    throw new Error("Whisper alignment is not ready for this job");
  }

  const lines = splitRoyalScriptIntoScenes(job.script);
  const total =
    alignment.voiceoverDurationSec ||
    job.voiceoverDurationSec ||
    alignment.words[alignment.words.length - 1]?.end ||
    0;
  const spans = spokenSpansForWindows(lines, alignment.words, total);

  const scenes: TimelineScene[] = lines.map((text, index) => {
    const span = spans[index];
    let startTime = Number(span.start.toFixed(3));
    let endTime = Number(Math.max(span.start, span.end).toFixed(3));
    const previous = index > 0 ? spans[index - 1] : undefined;
    if (previous) {
      const previousEnd = Number(previous.end.toFixed(3));
      if (startTime < previousEnd && previousEnd - startTime <= 0.08) {
        startTime = previousEnd;
        endTime = Math.max(startTime, endTime);
      }
    }
    const timing = {
      startTime,
      endTime,
      duration: Number((endTime - startTime).toFixed(3)),
    };
    const n = String(index + 1).padStart(3, "0");
    return {
      sceneId: `scene-${n}`,
      beatId: `beat-${n}`,
      startTime: timing.startTime,
      endTime: timing.endTime,
      duration: timing.duration,
      narrationText: text,
      selectedVisualId: "",
      source: "uploaded_asset",
      reasonSelected: "Whisper line timing only. No visual selected.",
      confidence: 0,
      fallbackUsed: false,
      needsBetterVisual: true,
      warnings: ["No visual — waiting for a later pass"],
      whatIsMissing: "Visual not collected",
    };
  });

  const payload = {
    jobId: job.jobId,
    source: "whisper_line_scenes",
    lineCount: scenes.length,
    voiceoverDurationSec: total,
    scenes,
    createdAt: new Date().toISOString(),
  };
  await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), payload);
  await writeJson(jobDataFile("royal-v2-final-assignment", job.jobId), payload);

  job.status = "scene_review_ready";
  job.progressPercent = 100;
  job.error = undefined;
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  return scenes;
}
