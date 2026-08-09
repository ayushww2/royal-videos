import { chatJson } from "../../openaiClient.js";
import { jobDataFile, writeJson } from "../../storage.js";
import { nicheRules } from "../nicheRules.js";
import { localQueryPacks } from "../localFallbacks.js";
import { skipGptExceptJudge } from "../pipelineMode.js";
import { getJobCostLimits, sampleBeatsForPrompt } from "../jobDuration.js";
import type {
  FullScriptVisualMap,
  JobRecord,
  QueryPack,
  TitleLock,
  VisualBeat,
  PipelineCostLimits,
} from "../../../shared/visualIntelligence.js";

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

function directorQueryGuidance(niche: string): string {
  switch (niche) {
    case "Celebrity v1":
      return `CELEBRITY DIRECTOR SEARCH RULES:
- Identity first: always include the FULL correct name in the query.
- Prefer Google Images queries like:
  "{Full Name} red carpet", "{Full Name} interview", "{Full Name} {event/year}", "{Full Name} portrait documentary", "{Couple Name} together"
- Add era/event/show when the narration specifies it (award, premiere, album, film, scandal year).
- Avoid vague beauty/stock queries ("beautiful woman", "famous actor").
- Avoid wrong same-name people: add disambiguators (band, movie, sport, country) when confusingSimilarEntities exist.
- Prefer clean press / Getty-style editorial LOOK via query wording, but do not require Getty host.
- For atmosphere beats: still keep the person OR their known world (stage, studio, city tied to them) — not random lifestyle stock.`;
    case "Mystery v1":
      return `MYSTERY DIRECTOR SEARCH RULES:
- Evidence first: exact place, artifact, document, map, discovery, company, or named investigator.
- Prefer:
  "{exact place} archaeological site", "{object} close up artifact", "{document} historical", "{discovery} excavation photo"
- Match narration literally: cave→cave, stone door→doorway/archaeology, researchers→field or lab, map→map.
- Allow serious dramatic documentary stills from news/blogs.
- Reject-oriented wording in forbiddenResultType: horror monster, meme, YouTube thumbnail text, stock watermark collage.`;
    case "Space v1":
      return `SPACE DIRECTOR SEARCH RULES:
- Prefer NASA/mission/telescope/planet/spacecraft/observatory/mission control queries.
- Good: "{mission} spacecraft", "Hubble deep field", "mission control room", "{planet} NASA"
- Avoid city lifestyle, offices, random tech stock.`;
    case "War v1":
      return `WAR DIRECTOR SEARCH RULES:
- Conflict / archive first: named battle, front, campaign, unit, weapon, aircraft, ship, or wartime place.
- Prefer:
  "{battle} archival photo", "{front} trench WWI/WWII", "{aircraft} wartime", "{city} wartime ruins", "military map {campaign}"
- Match era and theater when narration specifies them (WWI, WWII, Vietnam, Cold War, etc.).
- Prefer historical archive / newsreel / museum / battlefield photography look.
- Avoid lifestyle stock, fashion, offices, video-game art, toy soldiers, meme graphics.`;
    default:
      return "Prefer exact entity documentary photos over vague aesthetic stock.";
  }
}

/**
 * Director-grade query packs: group beats by visual need, write specific Google queries.
 */
export async function createDirectorQueryPacks(
  job: JobRecord,
  titleLock: TitleLock,
  visualMap: FullScriptVisualMap,
  beats: VisualBeat[],
  extras?: {
    confusingSimilarEntities?: string[];
    forbiddenEntities?: string[];
    /** Only write Google packs for these beats (War library-first fallback). */
    onlyBeatIds?: string[];
  }
): Promise<QueryPack[]> {
  const limits = getJobCostLimits(job);
  const beatScope =
    extras?.onlyBeatIds?.length
      ? beats.filter((b) => extras.onlyBeatIds!.includes(b.beatId))
      : beats;
  if (!beatScope.length) {
    await writeJson(jobDataFile("search-query-packs", job.jobId), {
      jobId: job.jobId,
      queryPacks: [],
      mode: "skipped_no_weak_beats",
      costLimits: limits,
    });
    return [];
  }
  let deduped: QueryPack[] = [];

  if (skipGptExceptJudge()) {
    console.warn(`[directorQueries] efficient/cheap — local packs for ${job.jobId}`);
    deduped = normalizePacks(localQueryPacks(job, beatScope, limits.maxQueryPacks), limits);
    await writeJson(jobDataFile("search-query-packs", job.jobId), {
      jobId: job.jobId,
      queryPacks: deduped,
      mode: "local_efficient_director",
      costLimits: limits,
    });
    return deduped;
  }

  try {
    const result = await chatJson<{ queryPacks: QueryPack[] }>({
      system: `You are the DOCUMENTARY DIRECTOR writing Google Image SEARCH QUERY PACKS.

Think like an editor planning what the audience must see — not SEO spam.

Hard cap ${limits.maxQueryPacks} packs. Later we will run at most ~${limits.maxImageQueries} image searches.
Group related beats that need the SAME visual subject into one pack.
Every query must be specific enough that a wrong image would be obviously wrong.

${directorQueryGuidance(job.niche)}

Niche rules: ${nicheRules(job.niche)}

Return JSON { queryPacks: [...] } with fields:
queryPackId, relatedBeatIds, entityContext, query, sourceType ("google"),
expectedVisualType, priority (higher = search first), maxCandidates,
whyNeeded, idealResultType, forbiddenResultType.

Priority guide:
90–100 exact main person/place named now
70–89 supporting evidence / event
50–69 atmosphere that still serves the title promise
<50 only if necessary transitions`,
      user: JSON.stringify({
        title: job.title,
        niche: job.niche,
        titleLock,
        targetDurationSec: job.voiceoverDurationSec,
        confusingSimilarEntities: extras?.confusingSimilarEntities || [],
        forbiddenEntities: extras?.forbiddenEntities || visualMap.mustNotShow || [],
        visualMap: {
          mainVideoPromise: visualMap.mainVideoPromise,
          primaryVisualSubjects: visualMap.primaryVisualSubjects,
          exactPlaces: visualMap.exactPlaces,
          exactObjects: visualMap.exactObjects,
          exactPeople: visualMap.exactPeople,
          exactCompanies: visualMap.exactCompanies,
          exactDiscoveries: visualMap.exactDiscoveries,
          exactDocuments: visualMap.exactDocuments,
          mustNotShow: visualMap.mustNotShow,
          titleSupportNotes: visualMap.titleSupportNotes,
        },
        beats: sampleBeatsForPrompt(beatScope, 90).map((b) => ({
          beatId: b.beatId,
          startTime: b.startTime,
          narrationText: (b.narrationText || "").slice(0, 200),
          exactSubject: b.exactSubject || b.mustMatchEntity,
          viewerShouldSee: b.viewerShouldSee,
          visualRole: b.visualRole,
          mustShow: b.mustShow,
          shouldAvoid: b.shouldAvoid,
          searchPriority: b.searchPriority,
          mentionedPlaces: b.mentionedPlaces,
          mentionedObjects: b.mentionedObjects,
          mentionedPeople: b.mentionedPeople,
          mentionedEvents: b.mentionedEvents,
          mentionedDocuments: b.mentionedDocuments,
        })),
      }),
    });
    deduped = normalizePacks(result.queryPacks || [], limits);
  } catch (err) {
    console.warn(
      `[directorQueries] GPT failed for ${job.jobId}:`,
      err instanceof Error ? err.message : err
    );
  }

  if (!deduped.length) {
    deduped = normalizePacks(localQueryPacks(job, beatScope, limits.maxQueryPacks), limits);
  }

  await writeJson(jobDataFile("search-query-packs", job.jobId), {
    jobId: job.jobId,
    queryPacks: deduped,
    mode: "director",
    costLimits: limits,
  });
  await writeJson(jobDataFile("visual-intelligence-query-packs", job.jobId), {
    jobId: job.jobId,
    queryPacks: deduped,
    mode: "director",
  });
  return deduped;
}
