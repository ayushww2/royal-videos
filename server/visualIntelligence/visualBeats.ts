import { chatJson } from "../openaiClient.js";
import { jobDataFile, writeJson } from "../storage.js";
import { nicheRules } from "./nicheRules.js";
import { localMysteryBeats } from "./localFallbacks.js";
import { skipGptExceptJudge } from "./pipelineMode.js";
import { getJobTargetDurationSec } from "./jobDuration.js";
import type {
  GlobalContextReport,
  JobRecord,
  VisualBeat,
} from "../../shared/visualIntelligence.js";

/** Split narration into ~3.5s meaning windows stretched/compressed to targetDurationSec (VO clock). */
export function splitNarrationToTargetDuration(
  script: string,
  targetDurationSec: number,
  beatSeconds = 3.5
): Array<{ text: string; start: number; end: number }> {
  const words = script.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [{ text: "", start: 0, end: Math.max(beatSeconds, targetDurationSec) }];
  }
  const target = Math.max(beatSeconds, targetDurationSec);
  const approxBeats = Math.max(1, Math.round(target / beatSeconds));
  const wordsPerBeat = Math.max(1, Math.ceil(words.length / approxBeats));
  const windows: Array<{ text: string; start: number; end: number }> = [];

  for (let i = 0, beatIdx = 0; i < words.length; i += wordsPerBeat, beatIdx++) {
    const chunk = words.slice(i, i + wordsPerBeat);
    const start = (beatIdx / Math.max(1, Math.ceil(words.length / wordsPerBeat))) * target;
    const end = Math.min(
      target,
      ((beatIdx + 1) / Math.max(1, Math.ceil(words.length / wordsPerBeat))) * target
    );
    windows.push({
      text: chunk.join(" "),
      start: Number(start.toFixed(3)),
      end: Number(Math.max(start + 2.5, end).toFixed(3)),
    });
  }

  if (windows.length) {
    windows[windows.length - 1].end = Number(target.toFixed(3));
  }
  return windows;
}

function windowsToLocalBeats(
  windows: Array<{ text: string; start: number; end: number }>,
  context: GlobalContextReport
): VisualBeat[] {
  return windows.map((w, idx) => {
    const duration = Math.max(2.5, Math.min(6, w.end - w.start || 3.5));
    const people =
      w.text.match(
        /\b(?:Princess\s+)?(?:Catherine|Kate|Camilla|Anne|Charles|William|Harry|Meghan|Queen|King|Diana)(?:\s+[A-Z][a-z]+)?\b/g
      ) || [];
    const uniqPeople = [...new Set(people.map((p) => p.trim()))];
    const places =
      w.text.match(
        /\b(?:Palace|Buckingham|Windsor|Westminster|London|Balmoral|Kensington|Sandringham|Abbey|Chapel)\b/gi
      ) || [];
    return {
      beatId: `beat-${idx + 1}`,
      startTime: Number(w.start.toFixed(2)),
      endTime: Number((w.start + duration).toFixed(2)),
      duration,
      narrationText: w.text,
      section: "main",
      mentionedPeople: uniqPeople,
      mentionedCompanies: [],
      mentionedPlaces: [...new Set(places.map((p) => p.trim()))],
      mentionedEvents: [],
      mentionedDocuments: [],
      mentionedObjects: [],
      mentionedDates: (w.text.match(/\b(?:1[0-9]{3}|20[0-9]{2})\b/g) || []).slice(0, 3),
      visualIntent: `Support narration: ${w.text.slice(0, 120)}`,
      idealVisualType: idx % 3 === 0 ? "clip" : "image",
      fallbackVisualType: "best_appropriate_visual",
      importanceScore: 70,
      mustMatchEntity: uniqPeople[0] || context.mainSubject,
      exactSubject: uniqPeople[0] || context.mainSubject,
      visualRole:
        idx % 4 === 0 ? "atmosphere" : uniqPeople[0] ? "main_subject" : "supporting_context",
      viewerShouldSee: uniqPeople[0] ? `${uniqPeople[0]} in royal context` : w.text.slice(0, 80),
      forbiddenVisuals: ["meme", "watermark", "horror"],
    } satisfies VisualBeat;
  });
}

export async function createVisualBeats(
  job: JobRecord,
  context: GlobalContextReport
): Promise<VisualBeat[]> {
  const targetDuration = getJobTargetDurationSec(job);
  const windows = splitNarrationToTargetDuration(job.script, targetDuration, 3.5);
  console.log(
    `[visualBeats] job=${job.jobId} targetDuration=${targetDuration.toFixed(1)}s beats=${windows.length} vo=${job.voiceoverDurationSec ?? "none"}`
  );

  // Long timelines: local windows cover full VO. GPT single-shot can't return hundreds of beats.
  const useLocal = skipGptExceptJudge() || windows.length > 60;

  if (useLocal) {
    const beats = windowsToLocalBeats(windows, context);
    // Snap last beat to exact VO end
    if (beats.length) {
      const last = beats[beats.length - 1];
      last.endTime = Number(targetDuration.toFixed(2));
      last.duration = Number(Math.max(2.5, last.endTime - last.startTime).toFixed(2));
    }
    await writeJson(jobDataFile("visual-intelligence-beats", job.jobId), {
      jobId: job.jobId,
      beats,
      targetDurationSec: targetDuration,
      voiceoverDurationSec: job.voiceoverDurationSec,
      mode: skipGptExceptJudge() ? "local_efficient_vo_clock" : "local_full_vo_clock",
    });
    return beats;
  }

  let result: { beats?: VisualBeat[] };
  try {
    result = await chatJson<{ beats: VisualBeat[] }>({
      system: `Create documentary visual beats for each narration window.
Timing rules: normal 3-4s, strong emotional up to 5s, weak fallback max 3s, raw/stock clip 3-6s.
Cover the FULL voiceover/target duration of ~${targetDuration.toFixed(1)} seconds. Do not stop early.
Return JSON { beats: [...] } with fields:
beatId, startTime, endTime, duration, narrationText, section,
mentionedPeople, mentionedCompanies, mentionedPlaces, mentionedEvents,
mentionedDocuments, mentionedObjects, mentionedDates,
visualIntent, idealVisualType, fallbackVisualType, importanceScore (0-100),
mustMatchEntity (string|null), forbiddenVisuals (string[]).
Use provided start/end times unless adjusting duration slightly for emotion.
Niche: ${nicheRules(job.niche)}`,
      user: JSON.stringify({
        title: job.title,
        niche: job.niche,
        targetDurationSec: targetDuration,
        voiceoverDurationSec: job.voiceoverDurationSec,
        contextSummary: {
          mainSubject: context.mainSubject,
          people: context.people,
          places: context.places,
          companies: context.companies,
          events: context.events,
          forbiddenEntities: context.forbiddenEntities,
          shortNameExpansions: context.shortNameExpansions,
        },
        windows,
      }),
    });
  } catch (err) {
    console.warn(
      `[visualBeats] GPT failed for ${job.jobId}, using local beats:`,
      err instanceof Error ? err.message : err
    );
    const beats = windowsToLocalBeats(windows, context);
    await writeJson(jobDataFile("visual-intelligence-beats", job.jobId), {
      jobId: job.jobId,
      beats,
      targetDurationSec: targetDuration,
      mode: "local_fallback",
    });
    return beats;
  }

  const beats = (result.beats || []).map((b, idx) => {
    const fallback = windows[idx];
    const startTime = typeof b.startTime === "number" ? b.startTime : fallback?.start ?? idx * 3.5;
    const endTime = typeof b.endTime === "number" ? b.endTime : fallback?.end ?? startTime + 3.5;
    const duration = Math.max(2.5, Math.min(6, endTime - startTime));
    return {
      beatId: b.beatId || `beat-${idx + 1}`,
      startTime,
      endTime: startTime + duration,
      duration,
      narrationText: b.narrationText || fallback?.text || "",
      section: b.section || context.sectionHeadings[0] || "main",
      mentionedPeople: b.mentionedPeople || [],
      mentionedCompanies: b.mentionedCompanies || [],
      mentionedPlaces: b.mentionedPlaces || [],
      mentionedEvents: b.mentionedEvents || [],
      mentionedDocuments: b.mentionedDocuments || [],
      mentionedObjects: b.mentionedObjects || [],
      mentionedDates: b.mentionedDates || [],
      visualIntent: b.visualIntent || "support narration",
      idealVisualType: b.idealVisualType || "image",
      fallbackVisualType: b.fallbackVisualType || "best_appropriate_visual",
      importanceScore: b.importanceScore ?? 50,
      mustMatchEntity: b.mustMatchEntity || undefined,
      forbiddenVisuals: b.forbiddenVisuals || [],
    } satisfies VisualBeat;
  });

  // If GPT under-covered VO, fill remaining with local windows
  const covered = beats.reduce((m, b) => Math.max(m, b.endTime), 0);
  if (covered < targetDuration * 0.85) {
    console.warn(
      `[visualBeats] GPT covered ${covered.toFixed(1)}s < target ${targetDuration.toFixed(1)}s — using local VO windows`
    );
    const local = windowsToLocalBeats(windows, context);
    await writeJson(jobDataFile("visual-intelligence-beats", job.jobId), {
      jobId: job.jobId,
      beats: local,
      targetDurationSec: targetDuration,
      mode: "local_after_gpt_undercount",
    });
    return local;
  }

  await writeJson(jobDataFile("visual-intelligence-beats", job.jobId), {
    jobId: job.jobId,
    beats,
    targetDurationSec: targetDuration,
    voiceoverDurationSec: job.voiceoverDurationSec,
  });
  return beats;
}
