import { jobDataFile, readJson, saveJob, writeJson } from "../storage.js";
import { splitRoyalScriptIntoScenes } from "./royalV2/beats.js";
import { loadTimelineScenes } from "./timelineEditor.js";
import { spokenSpansForWindows, tokenizeScript, type VoiceAlignmentReport } from "./voiceAlignment.js";
import type { JobRecord, TimelineScene, VisualSource } from "../../shared/visualIntelligence.js";

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

/** Split a paragraph line into sentences. A period jammed against the next capital is already one line. */
export function splitParagraphSentences(line: string): string[] {
  return line
    .split(/(?<=[.!?])["”']?\s+(?=[A-Z0-9"“])/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * One sentence per scene, timed from the saved alignment.
 * The picture that was on the paragraph stays on each sentence from that paragraph.
 */
export async function splitJobParagraphsIntoSentences(job: JobRecord): Promise<{
  scenes: TimelineScene[];
  paragraphs: number;
}> {
  const alignment = await readJson<VoiceAlignmentReport>(jobDataFile("voice-alignment", job.jobId));
  if (!alignment || alignment.status !== "ready" || !alignment.words?.length) {
    throw new Error("Voice alignment is not ready for this job");
  }

  const paragraphs = job.script
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const groups = paragraphs.map((line) => {
    const sentences = splitParagraphSentences(line);
    return sentences.length ? sentences : [line];
  });
  const sentences = groups.flat();
  if (tokenizeScript(sentences.join(" ")).length !== tokenizeScript(job.script).length) {
    throw new Error("Sentence split changed the script words. Refusing to retiming.");
  }
  if (sentences.length <= paragraphs.length) {
    throw new Error("Script is already one sentence per line");
  }

  const total =
    alignment.voiceoverDurationSec ||
    job.voiceoverDurationSec ||
    alignment.words[alignment.words.length - 1]?.end ||
    0;
  const spans = spokenSpansForWindows(sentences, alignment.words, total);
  const previousScenes = await loadTimelineScenes(job.jobId);
  const scenes: TimelineScene[] = [];

  let cursor = 0;
  groups.forEach((group, paragraphIndex) => {
    const byIndex = previousScenes[paragraphIndex];
    const parent =
      byIndex && byIndex.narrationText.replace(/\s+/g, " ").trim() === paragraphs[paragraphIndex]
        ? byIndex
        : previousScenes.find(
            (scene) => scene.narrationText.replace(/\s+/g, " ").trim() === paragraphs[paragraphIndex]
          ) || byIndex;
    for (const text of group) {
      const span = spans[cursor];
      let startTime = Number(span.start.toFixed(3));
      let endTime = Number(Math.max(span.start, span.end).toFixed(3));
      const previous = cursor > 0 ? spans[cursor - 1] : undefined;
      if (previous) {
        const previousEnd = Number(previous.end.toFixed(3));
        if (startTime < previousEnd && previousEnd - startTime <= 0.08) {
          startTime = previousEnd;
          endTime = Math.max(startTime, endTime);
        }
      }
      const n = String(cursor + 1).padStart(3, "0");
      const kept = parent?.selectedVisualId
        ? {
            selectedVisualId: parent.selectedVisualId,
            approvedVisualId: parent.approvedVisualId,
            source: parent.source,
            reasonSelected: parent.reasonSelected,
            confidence: parent.confidence,
            fallbackUsed: false,
            needsBetterVisual: parent.needsBetterVisual,
            rawFootageUsed: parent.rawFootageUsed,
            mainPerson: parent.mainPerson,
            viewerShouldSee: parent.viewerShouldSee,
            editorNotes: parent.editorNotes,
            warnings: parent.warnings || [],
            alternativeAssetIds: parent.alternativeAssetIds,
          }
        : {
            selectedVisualId: "",
            source: "uploaded_asset" as VisualSource,
            reasonSelected: "Sentence split. No picture on the old paragraph.",
            confidence: 0,
            fallbackUsed: false,
            needsBetterVisual: true,
            warnings: ["No visual — waiting for a later pass"],
            whatIsMissing: "Visual not collected",
          };
      scenes.push({
        sceneId: `scene-${n}`,
        beatId: `beat-${n}`,
        startTime,
        endTime,
        duration: Number((endTime - startTime).toFixed(3)),
        narrationText: text,
        ...kept,
      });
      cursor += 1;
    }
  });

  for (let i = 1; i < scenes.length; i++) {
    const overlap = scenes[i - 1].endTime - scenes[i].startTime;
    if (overlap > 0 && overlap <= 0.3) {
      scenes[i - 1].endTime = scenes[i].startTime;
      scenes[i - 1].duration = Number((scenes[i - 1].endTime - scenes[i - 1].startTime).toFixed(3));
    }
  }

  const payload = {
    jobId: job.jobId,
    source: "sentence_split",
    lineCount: scenes.length,
    paragraphCount: paragraphs.length,
    voiceoverDurationSec: total,
    scenes,
    createdAt: new Date().toISOString(),
  };
  await writeJson(jobDataFile("visual-intelligence-final-assignment", job.jobId), payload);
  await writeJson(jobDataFile("royal-v2-final-assignment", job.jobId), payload);

  job.script = sentences.join("\n");
  job.sceneApprovals = {};
  job.status = "scene_review_ready";
  job.progressPercent = 100;
  job.error = undefined;
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  return { scenes, paragraphs: paragraphs.length };
}
