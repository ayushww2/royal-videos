import { chatJson } from "../openaiClient.js";
import { jobDataFile, writeJson } from "../storage.js";
import { nicheRules } from "./nicheRules.js";
import { localMysteryBeats } from "./localFallbacks.js";
import { getJobTargetDurationSec } from "./jobDuration.js";
import { cheapPipeline, efficientPipeline } from "./pipelineMode.js";
import { alignedTimingsForBeats, ensureVoiceAlignment } from "./voiceAlignment.js";
import {
  celebrityHoldClamp,
  celebrityRecipeActive,
  celebrityTargetHoldSec,
} from "./celebrityV1/referenceRecipe.js";
import {
  mergeMysteryV2BeatsToHoldBand,
  MYSTERY_V2_MAX_HOLD,
  MYSTERY_V2_MIN_HOLD,
  MYSTERY_V2_TARGET_HOLD,
} from "./mysteryV2/beatMerge.js";
import type {
  FullScriptVisualMap,
  GlobalContextReport,
  JobRecord,
  TitleLock,
  VisualBeat,
} from "../../shared/visualIntelligence.js";

function normalizeEditorBeats(
  raw: VisualBeat[],
  targetDurationSec: number,
  niche?: string,
  /**
   * Sentence-aligned windows already carry correct spans — clamping them to the
   * hold band would drag cuts off the narration boundary.
   */
  preserveTiming = false
): VisualBeat[] {
  const celebrity = celebrityRecipeActive(niche);
  const war = niche === "War v1";
  const mysteryV2 = niche === "Mystery v2";
  const defaultHold = celebrity
    ? celebrityTargetHoldSec()
    : war
      ? 2.8
      : mysteryV2
        ? MYSTERY_V2_TARGET_HOLD
        : 3.5;
  const minHold = celebrity ? 3.5 : war ? 2.2 : mysteryV2 ? MYSTERY_V2_MIN_HOLD : 2.5;
  const maxHold = celebrity ? 7.5 : war ? 4.5 : mysteryV2 ? MYSTERY_V2_MAX_HOLD : 6;
  const beats = (raw || []).map((b, idx) => {
    const startTime = typeof b.startTime === "number" ? b.startTime : idx * defaultHold;
    let duration = typeof b.duration === "number" ? b.duration : defaultHold;
    if (!preserveTiming) {
      duration = celebrity
        ? celebrityHoldClamp(duration)
        : Math.max(minHold, Math.min(maxHold, duration));
    }
    const exactSubject = b.exactSubject || b.mustMatchEntity || "";
    return {
      beatId: b.beatId || `beat-${idx + 1}`,
      startTime,
      endTime: startTime + duration,
      duration,
      narrationText: b.narrationText || "",
      section: b.section || "documentary",
      mentionedPeople: b.mentionedPeople || [],
      mentionedCompanies: b.mentionedCompanies || [],
      mentionedPlaces: b.mentionedPlaces || [],
      mentionedEvents: b.mentionedEvents || [],
      mentionedDocuments: b.mentionedDocuments || [],
      mentionedObjects: b.mentionedObjects || [],
      mentionedDates: b.mentionedDates || [],
      visualIntent: b.visualIntent || b.viewerShouldSee || b.idealVisual || "support narration",
      idealVisualType: b.idealVisualType || "image",
      fallbackVisualType: "best_appropriate_visual",
      importanceScore: b.importanceScore ?? b.searchPriority ?? 60,
      mustMatchEntity: exactSubject || undefined,
      forbiddenVisuals: [
        ...(b.forbiddenVisuals || []),
        ...(b.shouldAvoid || []),
        "meme graphic",
        "YouTube thumbnail text overlay",
        "stock watermark",
        "tiny unreadable scientific chart",
      ],
      viewerShouldSee: b.viewerShouldSee || b.idealVisual || b.visualIntent || "",
      exactSubject,
      visualRole: b.visualRole || "main_subject",
      mustShow: b.mustShow || (exactSubject ? [exactSubject] : []),
      shouldAvoid: b.shouldAvoid || [],
      idealVisual: b.idealVisual || b.viewerShouldSee || "",
      fallbackVisual: "best appropriate clean real visual from library",
      searchPriority: b.searchPriority ?? b.importanceScore ?? 60,
    } satisfies VisualBeat;
  });

  if (beats.length) {
    const last = beats[beats.length - 1];
    last.endTime = Number(targetDurationSec.toFixed(2));
    const tail = last.endTime - last.startTime;
    last.duration = Number((preserveTiming ? Math.max(0.4, tail) : Math.max(minHold, tail)).toFixed(2));
  }
  return beats;
}

/**
 * Snap beat spans to real spoken word times from Whisper.
 * No-op (keeps word-share estimates) when the job has no usable alignment.
 */
async function retimeBeatsFromVoiceover(
  job: JobRecord,
  beats: VisualBeat[],
  totalDurationSec: number
): Promise<"voice_alignment" | "word_share_estimate"> {
  if (!beats.length) return "word_share_estimate";
  try {
    const alignment = await ensureVoiceAlignment(job);
    const timings = alignedTimingsForBeats(
      beats.map((b) => b.narrationText || ""),
      alignment,
      totalDurationSec
    );
    if (!timings) return "word_share_estimate";
    beats.forEach((beat, idx) => {
      const t = timings[idx];
      if (!t) return;
      beat.startTime = t.startTime;
      beat.endTime = t.endTime;
      beat.duration = t.duration;
    });
    return "voice_alignment";
  } catch (err) {
    console.warn(
      `[editorBeats] alignment retime failed for ${job.jobId}:`,
      err instanceof Error ? err.message : err
    );
    return "word_share_estimate";
  }
}

export async function createEditorVisualBeats(
  job: JobRecord,
  titleLock: TitleLock,
  visualMap: FullScriptVisualMap,
  context: GlobalContextReport
): Promise<VisualBeat[]> {
  const totalDuration = getJobTargetDurationSec(job);
  const celebrity = celebrityRecipeActive(job.niche);
  const war = job.niche === "War v1";
  const mysteryV2 = job.niche === "Mystery v2";
  const holdSec = celebrity
    ? celebrityTargetHoldSec()
    : war
      ? 2.8
      : mysteryV2
        ? MYSTERY_V2_TARGET_HOLD
        : 3.5;
  const expectedBeats = Math.max(1, Math.round(totalDuration / holdSec));
  const isMystery = job.niche === "Mystery v1" || job.niche === "Mystery v2";
  // GPT can't reliably return hundreds of beats — use VO-clock local windows for long jobs.
  // Mystery + PIPELINE_EFFICIENT/CHEAP: skip ContactBox beat planning (hangs on large JSON).
  const useLocalVoClock =
    expectedBeats > 60 ||
    (isMystery && (efficientPipeline() || cheapPipeline()));
  if (useLocalVoClock) {
    console.warn(
      `[editorBeats] ${totalDuration.toFixed(1)}s ≈ ${expectedBeats} beats — local VO windows` +
        (isMystery && (efficientPipeline() || cheapPipeline()) ? " (mystery efficient)" : "")
    );
    let local = normalizeEditorBeats(
      localMysteryBeats(job, context),
      totalDuration,
      job.niche,
      true
    );
    // Sentence windows give correct cut POINTS; Whisper gives correct cut TIMES.
    const timingSource = await retimeBeatsFromVoiceover(job, local, totalDuration);
    // Mystery v2 lock: fold short Whisper windows into ~4–5s holds.
    if (mysteryV2) {
      const before = local.length;
      local = mergeMysteryV2BeatsToHoldBand(local);
      console.log(
        `[editorBeats] Mystery v2 hold merge ${before} → ${local.length} beats @~${MYSTERY_V2_TARGET_HOLD}s`
      );
    }
    await writeJson(jobDataFile("editor-visual-beats", job.jobId), {
      jobId: job.jobId,
      beats: local,
      timingSource,
      segmentation: mysteryV2 ? "sentence_windows_merged_4_5s" : "sentence_windows",
      targetDurationSec: totalDuration,
      voiceoverDurationSec: job.voiceoverDurationSec,
      holdTargetSec: mysteryV2 ? MYSTERY_V2_TARGET_HOLD : holdSec,
      mode: war
        ? "local_vo_clock_war_fast"
        : mysteryV2
          ? "local_vo_clock_mystery_v2_4_5s"
          : isMystery && (efficientPipeline() || cheapPipeline())
            ? "local_vo_clock_mystery_efficient"
            : "local_vo_clock",
    });
    await writeJson(jobDataFile("mystery-v1-beats", job.jobId), { jobId: job.jobId, beats: local });
    await writeJson(jobDataFile("visual-intelligence-beats", job.jobId), {
      jobId: job.jobId,
      beats: local,
      targetDurationSec: totalDuration,
    });
    return local;
  }

  const script =
    job.script.length > 40_000 ? `${job.script.slice(0, 40_000)}\n\n[truncated]` : job.script;

  let beats: VisualBeat[] = [];
  try {
    const result = await chatJson<{ beats: VisualBeat[] }>({
      system: `You are a human documentary video editor creating a visual beat plan.
Break by MEANING, not random word chunks.
${
  celebrity
    ? `Celebrity v1 reference pacing: aim ~${holdSec.toFixed(1)}s holds (band 3.5–7.5s), ~11 cuts/min. Prefer archival interview/raw when available. Opener must show the correct person. Avoid flicker cuts under 3.5s.`
    : war
      ? `War v1 FAST PACE: aim ~${holdSec.toFixed(1)}s holds (band 2.2–4.5s), punchy cuts, ~20 cuts/min. Prefer archival military stills + 20–30% raw motion. Avoid long static holds.`
      : "Timing: normal 3–4s, strong evidence up to 5s, video/raw 3–6s. Do not cut mid-thought."
}
For EVERY beat answer like an editor: what should the viewer understand, exact subject, ideal visual.
visualRole must be one of: main_subject | supporting_context | evidence | map | document | atmosphere | transition.
Return JSON { beats: [...] } with:
beatId, startTime, endTime, duration, narrationText, section,
viewerShouldSee, exactSubject, visualRole, mustShow[], shouldAvoid[],
idealVisual, fallbackVisual, searchPriority (0-100),
mentionedPeople/Companies/Places/Events/Documents/Objects/Dates,
visualIntent, idealVisualType, importanceScore, mustMatchEntity, forbiddenVisuals.
Stay locked to the Title Lock. Cover the FULL target duration ~${totalDuration.toFixed(1)}s (voiceover length when provided). Do not stop early. No fixed 2-minute cap.
${nicheRules(job.niche)}`,
      user: JSON.stringify({
        title: job.title,
        titleLock,
        targetDurationSec: totalDuration,
        voiceoverDurationSec: job.voiceoverDurationSec,
        visualMapSummary: {
          mainVideoPromise: visualMap.mainVideoPromise,
          primaryVisualSubjects: visualMap.primaryVisualSubjects,
          exactPlaces: visualMap.exactPlaces,
          exactObjects: visualMap.exactObjects,
          exactPeople: visualMap.exactPeople,
          exactDiscoveries: visualMap.exactDiscoveries,
          mustNotShow: visualMap.mustNotShow,
        },
        contextSummary: {
          mainSubject: context.mainSubject,
          emotionalTone: context.emotionalTone,
        },
        fullScript: script,
      }),
    });
    beats = normalizeEditorBeats(result.beats || [], totalDuration, job.niche);
  } catch (err) {
    console.warn(`[editorBeats] GPT failed for ${job.jobId}:`, err instanceof Error ? err.message : err);
    beats = normalizeEditorBeats(localMysteryBeats(job, context), totalDuration, job.niche);
  }

  if (!beats.length) {
    beats = normalizeEditorBeats(localMysteryBeats(job, context), totalDuration, job.niche);
  }

  const covered = beats.reduce((m, b) => Math.max(m, b.endTime), 0);
  if (covered < totalDuration * 0.85) {
    beats = normalizeEditorBeats(localMysteryBeats(job, context), totalDuration, job.niche);
  }

  await writeJson(jobDataFile("editor-visual-beats", job.jobId), {
    jobId: job.jobId,
    beats,
    targetDurationSec: totalDuration,
    voiceoverDurationSec: job.voiceoverDurationSec,
  });
  await writeJson(jobDataFile("mystery-v1-beats", job.jobId), { jobId: job.jobId, beats });
  await writeJson(jobDataFile("visual-intelligence-beats", job.jobId), {
    jobId: job.jobId,
    beats,
    targetDurationSec: totalDuration,
  });
  return beats;
}
