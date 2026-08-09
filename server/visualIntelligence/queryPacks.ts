import { chatJson } from "../openaiClient.js";
import { jobDataFile, writeJson } from "../storage.js";
import { nicheRules } from "./nicheRules.js";
import { localQueryPacks } from "./localFallbacks.js";
import { skipGptExceptJudge } from "./pipelineMode.js";
import type {
  FullScriptVisualMap,
  JobRecord,
  QueryPack,
  TitleLock,
  VisualBeat,
  PipelineCostLimits,
} from "../../shared/visualIntelligence.js";
import { getJobCostLimits, sampleBeatsForPrompt } from "./jobDuration.js";

function normalizePacks(raw: QueryPack[], limits: PipelineCostLimits): QueryPack[] {
  const packs = (raw || [])
    .slice(0, limits.maxQueryPacks)
    .map((p, idx) => ({
      queryPackId: p.queryPackId || `qp-${idx + 1}`,
      relatedBeatIds: p.relatedBeatIds || [],
      entityContext: p.entityContext || "",
      query: (p.query || "").trim(),
      sourceType: (p.sourceType === "brave" ? "google" : p.sourceType) || "google",
      expectedVisualType: p.expectedVisualType || p.idealResultType || "image",
      priority: p.priority ?? 50,
      maxCandidates: Math.min(p.maxCandidates || limits.maxCandidatesPerQuery, limits.maxCandidatesPerQuery),
      whyNeeded: p.whyNeeded || "",
      idealResultType: p.idealResultType || "horizontal documentary photo",
      forbiddenResultType:
        p.forbiddenResultType ||
        "portrait, square, watermark, meme text, tiny unreadable chart, YouTube thumbnail",
    }))
    .filter((p) => p.query.length > 4);

  const seen = new Set<string>();
  const deduped: QueryPack[] = [];
  for (const pack of packs.sort((a, b) => b.priority - a.priority)) {
    const key = pack.query.toLowerCase();
    if (seen.has(key)) continue;
    if (key.split(/\s+/).length < 2) continue;
    seen.add(key);
    deduped.push(pack);
    if (deduped.length >= limits.maxQueryPacks) break;
  }
  return deduped;
}

export async function createEditorQueryPacks(
  job: JobRecord,
  titleLock: TitleLock,
  visualMap: FullScriptVisualMap,
  beats: VisualBeat[]
): Promise<QueryPack[]> {
  const limits = getJobCostLimits(job);
  let deduped: QueryPack[] = [];

  if (skipGptExceptJudge()) {
    console.warn(`[queryPacks] efficient/cheap — local packs for ${job.jobId}`);
    deduped = normalizePacks(localQueryPacks(job, beats, limits.maxQueryPacks), limits);
    await writeJson(jobDataFile("search-query-packs", job.jobId), {
      jobId: job.jobId,
      queryPacks: deduped,
      mode: "local_efficient",
      costLimits: limits,
    });
    await writeJson(jobDataFile("visual-intelligence-query-packs", job.jobId), {
      jobId: job.jobId,
      queryPacks: deduped,
      mode: "local_efficient",
    });
    return deduped;
  }

  try {
    const result = await chatJson<{ queryPacks: QueryPack[] }>({
      system: `You are a documentary editor writing SEARCH QUERY PACKS — not keyword spam.
Group related beats into packs (same place/object/person/discovery/context).
Hard cap ${limits.maxQueryPacks} packs for this video length. Max ~${limits.maxImageQueries} searches later.
Queries MUST be specific:
Good: "{exact subject} documentary photo", "{exact place} archaeological site", "{exact object} close up"
Bad: "cave", "door", "researchers", "battery", "temple"
Never vague when an exact entity exists. Prefer horizontal documentary photos.
Return JSON { queryPacks: [...] } with:
queryPackId, relatedBeatIds, entityContext, query, sourceType (prefer google),
expectedVisualType, priority, maxCandidates, whyNeeded, idealResultType, forbiddenResultType.
Niche: ${nicheRules(job.niche)}`,
      user: JSON.stringify({
        title: job.title,
        titleLock,
        targetDurationSec: job.voiceoverDurationSec,
        visualMap: {
          primaryVisualSubjects: visualMap.primaryVisualSubjects,
          exactPlaces: visualMap.exactPlaces,
          exactObjects: visualMap.exactObjects,
          exactPeople: visualMap.exactPeople,
          exactCompanies: visualMap.exactCompanies,
          exactDiscoveries: visualMap.exactDiscoveries,
          exactDocuments: visualMap.exactDocuments,
          mustNotShow: visualMap.mustNotShow,
        },
        beats: sampleBeatsForPrompt(beats, 80).map((b) => ({
          beatId: b.beatId,
          narrationText: (b.narrationText || "").slice(0, 180),
          exactSubject: b.exactSubject || b.mustMatchEntity,
          viewerShouldSee: b.viewerShouldSee,
          visualRole: b.visualRole,
          mustShow: b.mustShow,
          searchPriority: b.searchPriority,
          mentionedPlaces: b.mentionedPlaces,
          mentionedObjects: b.mentionedObjects,
          mentionedPeople: b.mentionedPeople,
        })),
      }),
    });
    deduped = normalizePacks(result.queryPacks || [], limits);
  } catch (err) {
    console.warn(`[queryPacks] GPT failed for ${job.jobId}:`, err instanceof Error ? err.message : err);
  }

  if (!deduped.length) {
    deduped = normalizePacks(localQueryPacks(job, beats, limits.maxQueryPacks), limits);
  }

  await writeJson(jobDataFile("search-query-packs", job.jobId), {
    jobId: job.jobId,
    queryPacks: deduped,
    costLimits: limits,
  });
  await writeJson(jobDataFile("visual-intelligence-query-packs", job.jobId), {
    jobId: job.jobId,
    queryPacks: deduped,
  });
  return deduped;
}

/** @deprecated use createEditorQueryPacks */
export async function createQueryPacks(
  job: JobRecord,
  context: { mainSubject?: string; people?: string[]; places?: string[]; companies?: string[]; events?: string[]; documents?: string[]; objectsProducts?: string[]; datesYears?: string[]; emotionalTone?: string },
  beats: VisualBeat[]
): Promise<QueryPack[]> {
  const titleLock: TitleLock = {
    jobId: job.jobId,
    title: job.title,
    mainSubject: context.mainSubject || job.title,
    centralObjectOrPlace: context.mainSubject || job.title,
    emotionalPromise: context.emotionalTone || "documentary",
    mysteryOrConflict: job.title,
    expectedVisuals: [
      ...(context.places || []),
      ...(context.objectsProducts || []),
    ].slice(0, 10),
    forbiddenDrift: [],
    createdAt: new Date().toISOString(),
  };
  const visualMap: FullScriptVisualMap = {
    jobId: job.jobId,
    mainVideoPromise: titleLock.emotionalPromise,
    primaryVisualSubjects: [titleLock.mainSubject],
    repeatedVisualSubjects: [],
    exactPlaces: context.places || [],
    exactObjects: context.objectsProducts || [],
    exactPeople: context.people || [],
    exactCompanies: context.companies || [],
    exactDiscoveries: context.events || [],
    exactDocuments: context.documents || [],
    technicalConcepts: [],
    supportingContext: [],
    mustNotShow: [],
    titleSupportNotes: "",
    createdAt: new Date().toISOString(),
  };
  return createEditorQueryPacks(job, titleLock, visualMap, beats);
}
