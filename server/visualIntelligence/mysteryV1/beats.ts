import { chatJson } from "../../openaiClient.js";
import { jobDataFile, writeJson } from "../../storage.js";
import { nicheRules } from "../nicheRules.js";
import { localMysteryBeats } from "../localFallbacks.js";
import { getJobTargetDurationSec } from "../jobDuration.js";
import type {
  GlobalContextReport,
  JobRecord,
  VisualBeat,
} from "../../../shared/visualIntelligence.js";

function normalizeBeats(raw: VisualBeat[], targetDurationSec: number): VisualBeat[] {
  const beats = (raw || []).map((b, idx) => {
    const startTime = typeof b.startTime === "number" ? b.startTime : idx * 3.5;
    let duration = typeof b.duration === "number" ? b.duration : 3.5;
    duration = Math.max(2.5, Math.min(6, duration));
    return {
      beatId: b.beatId || `beat-${idx + 1}`,
      startTime,
      endTime: startTime + duration,
      duration,
      narrationText: b.narrationText || "",
      section: b.section || "mystery",
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
      forbiddenVisuals: [
        ...(b.forbiddenVisuals || []),
        "horror monster",
        "meme graphic",
        "YouTube thumbnail text overlay",
        "stock watermark",
      ],
    } satisfies VisualBeat;
  });
  if (beats.length) {
    const last = beats[beats.length - 1];
    last.endTime = Number(targetDurationSec.toFixed(2));
    last.duration = Number(Math.max(2.5, last.endTime - last.startTime).toFixed(2));
  }
  return beats;
}

export async function createMysteryBeats(
  job: JobRecord,
  context: GlobalContextReport
): Promise<VisualBeat[]> {
  const totalDuration = getJobTargetDurationSec(job);
  const expectedBeats = Math.max(1, Math.round(totalDuration / 3.5));

  if (expectedBeats > 60) {
    const beats = normalizeBeats(localMysteryBeats(job, context), totalDuration);
    await writeJson(jobDataFile("mystery-v1-beats", job.jobId), {
      jobId: job.jobId,
      beats,
      targetDurationSec: totalDuration,
      mode: "local_vo_clock",
    });
    await writeJson(jobDataFile("visual-intelligence-beats", job.jobId), {
      jobId: job.jobId,
      beats,
      targetDurationSec: totalDuration,
    });
    return beats;
  }

  const script =
    job.script.length > 40_000 ? `${job.script.slice(0, 40_000)}\n\n[truncated]` : job.script;

  let beats: VisualBeat[] = [];
  try {
    const result = await chatJson<{ beats: VisualBeat[] }>({
      system: `Create Mystery v1 documentary visual beats from the FULL script.
Break by MEANING, not random word chunks.
Timing:
- normal visual 3-4 seconds
- important evidence/reveal up to 5 seconds
- raw/stock clip 3-6 seconds
- weak fallback max 3 seconds
Change visual when subject/place/object/person/date/event changes.
Style: serious clean documentary evidence visuals — caves, stone doors, maps, documents, archaeology, researchers, artifacts.
${nicheRules(job.niche)}
Return JSON { beats: [...] } with:
beatId, startTime, endTime, duration, narrationText, section,
mentionedPeople, mentionedCompanies, mentionedPlaces, mentionedEvents,
mentionedDocuments, mentionedObjects, mentionedDates,
visualIntent, idealVisualType, fallbackVisualType, importanceScore,
mustMatchEntity, forbiddenVisuals.
Cover the FULL target duration ~${totalDuration.toFixed(1)} seconds (voiceover length when provided). No fixed 2-minute cap.`,
      user: JSON.stringify({
        title: job.title,
        niche: job.niche,
        totalDuration,
        voiceoverDurationSec: job.voiceoverDurationSec,
        contextSummary: {
          mainSubject: context.mainSubject,
          people: (context.people || []).slice(0, 12),
          places: (context.places || []).slice(0, 12),
          events: (context.events || []).slice(0, 12),
          documents: (context.documents || []).slice(0, 12),
          objectsProducts: (context.objectsProducts || []).slice(0, 12),
          emotionalTone: context.emotionalTone,
        },
        fullScript: script,
      }),
    });
    beats = normalizeBeats(result.beats || [], totalDuration);
  } catch (err) {
    console.warn(
      `[mysteryBeats] GPT failed for ${job.jobId}, using local fallback:`,
      err instanceof Error ? err.message : String(err)
    );
    beats = normalizeBeats(localMysteryBeats(job, context), totalDuration);
  }

  if (!beats.length) beats = normalizeBeats(localMysteryBeats(job, context), totalDuration);
  const covered = beats.reduce((m, b) => Math.max(m, b.endTime), 0);
  if (covered < totalDuration * 0.85) {
    beats = normalizeBeats(localMysteryBeats(job, context), totalDuration);
  }

  await writeJson(jobDataFile("mystery-v1-beats", job.jobId), {
    jobId: job.jobId,
    beats,
    targetDurationSec: totalDuration,
    voiceoverDurationSec: job.voiceoverDurationSec,
  });
  await writeJson(jobDataFile("visual-intelligence-beats", job.jobId), {
    jobId: job.jobId,
    beats,
    targetDurationSec: totalDuration,
  });
  return beats;
}
