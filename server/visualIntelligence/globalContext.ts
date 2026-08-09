import { chatJson } from "../openaiClient.js";
import { jobDataFile, writeJson } from "../storage.js";
import { nicheRules } from "./nicheRules.js";
import { localGlobalContext } from "./localFallbacks.js";
import { skipGptExceptJudge } from "./pipelineMode.js";
import type { GlobalContextReport, JobRecord } from "../../shared/visualIntelligence.js";

export async function analyzeGlobalContext(job: JobRecord): Promise<GlobalContextReport> {
  if (skipGptExceptJudge()) {
    console.warn(`[globalContext] efficient/cheap — local context for ${job.jobId}`);
    const report = localGlobalContext(job);
    await writeJson(jobDataFile("visual-intelligence-global-context", job.jobId), report);
    return report;
  }
  try {
    const script = job.script.length > 14_000 ? `${job.script.slice(0, 14_000)}\n\n[truncated]` : job.script;
    const result = await chatJson<
      Omit<GlobalContextReport, "jobId" | "fullScript" | "title" | "niche" | "createdAt">
    >({
      system: `You are a documentary visual intelligence analyst. Analyze the FULL script before any visual search.
Return JSON with keys:
sectionHeadings (string[]), mainSubject (string), secondarySubjects (string[]),
people, places, companies, events, datesYears, documents, objectsProducts, quotesStatements (string[]),
emotionalTone (string), timelineShifts (string[]), confusingSimilarEntities (string[]),
forbiddenEntities (string[]), shortNameExpansions (object string->string).
Niche rules: ${nicheRules(job.niche)}`,
      user: `Title: ${job.title}\nNiche: ${job.niche}\n\nFULL SCRIPT:\n${script}`,
    });

    const report: GlobalContextReport = {
      jobId: job.jobId,
      title: job.title,
      niche: job.niche,
      fullScript: job.script,
      sectionHeadings: result.sectionHeadings || [],
      mainSubject: result.mainSubject || job.title,
      secondarySubjects: result.secondarySubjects || [],
      people: result.people || [],
      places: result.places || [],
      companies: result.companies || [],
      events: result.events || [],
      datesYears: result.datesYears || [],
      documents: result.documents || [],
      objectsProducts: result.objectsProducts || [],
      quotesStatements: result.quotesStatements || [],
      emotionalTone: result.emotionalTone || "neutral",
      timelineShifts: result.timelineShifts || [],
      confusingSimilarEntities: result.confusingSimilarEntities || [],
      forbiddenEntities: result.forbiddenEntities || [],
      shortNameExpansions: result.shortNameExpansions || {},
      createdAt: new Date().toISOString(),
    };

    await writeJson(jobDataFile("visual-intelligence-global-context", job.jobId), report);
    return report;
  } catch (err) {
    console.warn(
      `[globalContext] GPT failed for ${job.jobId}, using local fallback:`,
      err instanceof Error ? err.message : String(err)
    );
    const report = localGlobalContext(job);
    await writeJson(jobDataFile("visual-intelligence-global-context", job.jobId), {
      ...report,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    });
    return report;
  }
}
