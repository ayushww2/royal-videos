import { chatJson } from "../openaiClient.js";
import { jobDataFile, writeJson } from "../storage.js";
import type {
  FullScriptVisualMap,
  JobRecord,
  TitleLock,
} from "../../shared/visualIntelligence.js";
import { localGlobalContext } from "./localFallbacks.js";

export async function createFullScriptVisualMap(
  job: JobRecord,
  titleLock: TitleLock
): Promise<FullScriptVisualMap> {
  const script =
    job.script.length > 14_000 ? `${job.script.slice(0, 14_000)}\n\n[truncated]` : job.script;

  try {
    const result = await chatJson<Omit<FullScriptVisualMap, "jobId" | "createdAt">>({
      system: `You are a documentary video editor reading the FULL title + script BEFORE any image search.
Identify what the viewer must see. Do not invent stock keywords.
Return JSON:
mainVideoPromise, primaryVisualSubjects[], repeatedVisualSubjects[],
exactPlaces[], exactObjects[], exactPeople[], exactCompanies[],
exactDiscoveries[], exactDocuments[], technicalConcepts[],
supportingContext[], mustNotShow[],
titleSupportNotes (how visuals should support the title).`,
      user: JSON.stringify({
        title: job.title,
        niche: job.niche,
        titleLock,
        fullScript: script,
      }),
    });

    const map: FullScriptVisualMap = {
      jobId: job.jobId,
      mainVideoPromise: result.mainVideoPromise || titleLock.emotionalPromise,
      primaryVisualSubjects: result.primaryVisualSubjects || [titleLock.mainSubject],
      repeatedVisualSubjects: result.repeatedVisualSubjects || [],
      exactPlaces: result.exactPlaces || [],
      exactObjects: result.exactObjects || [],
      exactPeople: result.exactPeople || [],
      exactCompanies: result.exactCompanies || [],
      exactDiscoveries: result.exactDiscoveries || [],
      exactDocuments: result.exactDocuments || [],
      technicalConcepts: result.technicalConcepts || [],
      supportingContext: result.supportingContext || [],
      mustNotShow: [
        ...(result.mustNotShow || []),
        ...(titleLock.forbiddenDrift || []),
        "watermarked stock",
        "meme text",
        "YouTube thumbnail text",
        "tiny unreadable scientific charts as main visual",
      ],
      titleSupportNotes: result.titleSupportNotes || "",
      createdAt: new Date().toISOString(),
    };

    await writeJson(jobDataFile("full-script-visual-map", job.jobId), map);
    return map;
  } catch (err) {
    console.warn(`[visualMap] GPT failed for ${job.jobId}:`, err instanceof Error ? err.message : err);
    const ctx = localGlobalContext(job);
    const map: FullScriptVisualMap = {
      jobId: job.jobId,
      mainVideoPromise: titleLock.emotionalPromise,
      primaryVisualSubjects: [titleLock.mainSubject, ...titleLock.expectedVisuals.slice(0, 6)],
      repeatedVisualSubjects: titleLock.expectedVisuals.slice(0, 4),
      exactPlaces: ctx.places,
      exactObjects: ctx.objectsProducts,
      exactPeople: ctx.people,
      exactCompanies: ctx.companies,
      exactDiscoveries: ctx.events,
      exactDocuments: ctx.documents,
      technicalConcepts: [],
      supportingContext: titleLock.expectedVisuals,
      mustNotShow: titleLock.forbiddenDrift,
      titleSupportNotes: "Local fallback map from title lock",
      createdAt: new Date().toISOString(),
    };
    await writeJson(jobDataFile("full-script-visual-map", job.jobId), { ...map, fallback: true });
    return map;
  }
}
