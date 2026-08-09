import { chatJson } from "../openaiClient.js";
import { jobDataFile, writeJson } from "../storage.js";
import { sampleBeatsForPrompt } from "./jobDuration.js";
import { skipGptExceptJudge } from "./pipelineMode.js";
import type { ImportantEntityDetection, VisualBeat, JobRecord } from "../../shared/visualIntelligence.js";

function localEntityFallback(job: JobRecord, beats: VisualBeat[]): ImportantEntityDetection {
  return {
    jobId: job.jobId,
    beats: beats.map((b) => ({
      beatId: b.beatId,
      entities: [
        ...b.mentionedPeople.map((value) => ({ type: "person", value, importance: 80 })),
        ...b.mentionedPlaces.map((value) => ({ type: "place", value, importance: 85 })),
        ...b.mentionedCompanies.map((value) => ({ type: "company", value, importance: 70 })),
        ...b.mentionedEvents.map((value) => ({ type: "event", value, importance: 75 })),
        ...b.mentionedDocuments.map((value) => ({ type: "document", value, importance: 80 })),
        ...b.mentionedObjects.map((value) => ({ type: "product/object", value, importance: 80 })),
        ...b.mentionedDates.map((value) => ({ type: "date/year", value, importance: 70 })),
      ],
    })),
  };
}

export async function detectImportantEntities(
  job: JobRecord,
  beats: VisualBeat[]
): Promise<ImportantEntityDetection> {
  if (skipGptExceptJudge()) {
    const report = localEntityFallback(job, beats);
    await writeJson(jobDataFile("visual-intelligence-important-entities", job.jobId), report);
    return report;
  }
  // Keep payload small — evenly sample beats + already extracted mentions
  const slimBeats = sampleBeatsForPrompt(beats, 80).map((b) => ({
    beatId: b.beatId,
    narrationText: (b.narrationText || "").slice(0, 280),
    mentionedPeople: b.mentionedPeople?.slice(0, 8) || [],
    mentionedPlaces: b.mentionedPlaces?.slice(0, 8) || [],
    mentionedCompanies: b.mentionedCompanies?.slice(0, 8) || [],
    mentionedEvents: b.mentionedEvents?.slice(0, 8) || [],
    mentionedDocuments: b.mentionedDocuments?.slice(0, 8) || [],
    mentionedObjects: b.mentionedObjects?.slice(0, 8) || [],
    mentionedDates: b.mentionedDates?.slice(0, 8) || [],
  }));

  try {
    const result = await chatJson<ImportantEntityDetection>({
      system: `Detect important entities in each visual beat. Types:
person, company, place, city/country/location, event, date/year,
document/file/will/letter/report, court/trial/legal case, product/object,
quote/statement/tweet/interview, number/statistic, group/family/band/team,
institution/government/agency.
Only detect and report. Do not invent lower-thirds.
Return JSON { jobId, beats: [{ beatId, entities: [{ type, value, importance }] }] }`,
      user: JSON.stringify({ jobId: job.jobId, beats: slimBeats }),
    });

    const report: ImportantEntityDetection = {
      jobId: job.jobId,
      beats: result.beats || [],
    };
    await writeJson(jobDataFile("important-entity-detection", job.jobId), report);
    return report;
  } catch (err) {
    console.warn(
      `[entityDetection] GPT failed for ${job.jobId}, using local fallback:`,
      err instanceof Error ? err.message : String(err)
    );
    const report = localEntityFallback(job, beats);
    await writeJson(jobDataFile("important-entity-detection", job.jobId), {
      ...report,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    });
    return report;
  }
}
