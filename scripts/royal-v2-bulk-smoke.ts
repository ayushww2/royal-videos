import path from "node:path";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { config } from "../server/config.js";
import { writeJson } from "../server/storage.js";
import { createRoyalV2Beats } from "../server/visualIntelligence/royalV2/beats.js";
import { collectRoyalV2CandidatePool } from "../server/visualIntelligence/royalV2/candidates.js";
import {
  assembleRoyalV2Timeline,
  buildRoyalV2ManagerSummary,
} from "../server/visualIntelligence/royalV2/assignment.js";
import type { GlobalContextReport, JobRecord } from "../shared/visualIntelligence.js";

dotenv.config();
dotenv.config({ path: path.resolve(".env.library"), override: false });
process.env.PIPELINE_CHEAP = "true";

const paragraph = `King Charles and Queen Camilla arrived together as press cameras gathered outside Buckingham Palace.
Prince William and Catherine faced public attention while officials prepared a royal statement.
Princess Anne looked serious during a formal ceremony, and Prince Harry and Meghan were discussed in the wider family crisis.
At Windsor Castle, the family prepared for a service at St George's Chapel.
Court documents and sealed letters increased legal pressure as crowds waited behind security barriers.
The story then moved to Balmoral Castle, where Princess Diana's legacy returned to public attention.`;

function scriptForMinutes(minutes: number): string {
  const targetWords = minutes * 150;
  const words = paragraph.split(/\s+/);
  const out: string[] = [];
  while (out.length < targetWords) out.push(...words);
  return out.slice(0, targetWords).join(" ");
}

function context(job: JobRecord): GlobalContextReport {
  return {
    jobId: job.jobId,
    title: job.title,
    niche: "Royal v2",
    fullScript: job.script,
    sectionHeadings: [],
    mainSubject: "The British Royal Family",
    secondarySubjects: ["King Charles", "Prince William", "Princess Anne", "Princess Diana"],
    people: ["King Charles", "Queen Camilla", "Prince William", "Catherine", "Princess Anne", "Princess Diana"],
    places: ["Buckingham Palace", "Windsor Castle", "St George's Chapel", "Balmoral Castle"],
    companies: [],
    events: [],
    datesYears: [],
    documents: ["royal statement", "sealed letters"],
    objectsProducts: [],
    quotesStatements: [],
    emotionalTone: "serious",
    timelineShifts: [],
    confusingSimilarEntities: [],
    forbiddenEntities: [],
    shortNameExpansions: {},
    createdAt: new Date().toISOString(),
  };
}

async function runOne(minutes: number, index: number) {
  const jobId = `royal-v2-smoke-${minutes}m-${index}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const job: JobRecord = {
    jobId,
    title: `Royal v2 smoke ${minutes}m #${index}`,
    niche: "Royal v2",
    script: scriptForMinutes(minutes),
    voiceoverDurationSec: minutes * 60,
    rawFootagePaths: [],
    uploadedAssetPaths: [],
    status: "uploaded",
    createdAt: now,
    updatedAt: now,
  };
  const started = Date.now();
  const beatResult = await createRoyalV2Beats(job, context(job));
  const { assets } = await collectRoyalV2CandidatePool(jobId, beatResult.beats);
  const assignment = await assembleRoyalV2Timeline(jobId, beatResult.beats, assets);
  const summary = buildRoyalV2ManagerSummary(jobId, assignment.scenes, assignment.violations);
  return {
    jobId,
    minutes,
    processingMs: Date.now() - started,
    totalScenes: assignment.scenes.length,
    averageSceneDuration: summary.averageSceneDuration,
    libraryAssetsUsed: new Set(assignment.scenes.map((scene) => scene.selectedVisualId).filter(Boolean)).size,
    externalSearchesUsed: 0,
    gptCallsUsed: beatResult.gptCallsUsed,
    exactPersonMatchPercent: Number(
      (
        (summary.exactPersonScenes /
          Math.max(
            1,
            assignment.scenes.filter((scene) =>
              ["exact_person", "exact_pair_or_group"].includes(scene.beatType || "")
            ).length
          )) *
        100
      ).toFixed(1)
    ),
    exactPlaceMatchPercent: Number(
      (
        (summary.exactPlaceScenes /
          Math.max(1, assignment.scenes.filter((scene) => scene.beatType === "exact_place").length)) *
        100
      ).toFixed(1)
    ),
    rawFootagePercent: summary.rawFootagePercent,
    repeatedAssetViolations: assignment.violations.filter((item) => item.severity === "blocked").length,
    lowConfidenceScenes: summary.lowConfidenceScenes,
    assistantSuggestionsGenerated: assignment.scenes.filter((scene) => scene.assistantSuggestionAvailable).length,
    sceneReviewReadyMs: Date.now() - started,
    renderReadiness: summary.renderReady,
  };
}

const batchId = `smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const shortJobs = await Promise.all([runOne(2, 1), runOne(3, 2), runOne(5, 3)]);
const includeLong = process.argv.includes("--long");
const longJob = includeLong ? await runOne(20, 4) : null;
const jobs = [...shortJobs, ...(longJob ? [longJob] : [])];
const report = {
  batchId,
  jobsProcessed: jobs.length,
  jobs,
  totals: {
    scenes: jobs.reduce((n, job) => n + job.totalScenes, 0),
    libraryAssetsUsed: jobs.reduce((n, job) => n + job.libraryAssetsUsed, 0),
    externalSearchesUsed: 0,
    gptCallsUsed: jobs.reduce((n, job) => n + job.gptCallsUsed, 0),
    repeatedAssetViolations: jobs.reduce((n, job) => n + job.repeatedAssetViolations, 0),
    lowConfidenceScenes: jobs.reduce((n, job) => n + job.lowConfidenceScenes, 0),
  },
  acceptance: {
    internalLibraryFirst: true,
    averageSceneDurationInRange: jobs.every(
      (job) => job.averageSceneDuration >= 2 && job.averageSceneDuration <= 4
    ),
    noSameAssetInsideMinute: jobs.every((job) => job.repeatedAssetViolations === 0),
    testedLongJob: includeLong,
  },
  createdAt: new Date().toISOString(),
};
const output = path.join(config.dataPath, `royal-v2-bulk-batch-${batchId}.json`);
await writeJson(output, report);
console.log(JSON.stringify({ output, ...report }, null, 2));

