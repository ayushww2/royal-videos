/**
 * Emergency editor ops: inject a safe web still into the approved library,
 * swap it onto a scene, and soft-fail unsafe approved visuals for this job.
 */
import crypto from "crypto";
import { jobDataFile, loadJob, readJson, writeJson } from "../storage.js";
import type { ApprovedVisual, TimelineScene } from "../../shared/visualIntelligence.js";
import { assessContentSafety } from "./contentSafety.js";
import { runFinalQA } from "./finalQA.js";
import { loadTimelineScenes } from "./timelineEditor.js";

function scoresForManual(personName: string): ApprovedVisual["confidenceScores"] {
  return {
    entityMatch: 92,
    sceneMatch: 88,
    topicRelevance: 90,
    eventPlaceYearRelevance: 80,
    visualQuality: 88,
    cropSafety16x9: 90,
    sourceReliability: 85,
    wrongEntityRisk: 8,
    watermarkTextRisk: 8,
    reusePotential: 70,
    visualEditorScore: 90,
    titleSupportScore: 90,
    narrationMatchScore: 88,
    instantClarityScore: 90,
    exactSubjectMatch: 92,
    horizontalUsability: 90,
    documentaryUsefulness: 90,
    textHeavyPenalty: 10,
    watermarkRisk: 8,
    alteredTextRisk: 8,
    wrongContextRisk: 8,
  };
}

export async function softFailApprovedVisuals(
  jobId: string,
  approvedVisualIds: string[],
  reason = "content_safety soft-fail"
): Promise<{ softFailed: string[]; scenesCleared: string[] }> {
  const library = await readJson<{
    jobId: string;
    approved: ApprovedVisual[];
    softFailed?: Array<{ approvedVisualId: string; reason: string; at: string }>;
  }>(jobDataFile("visual-intelligence-approved-library", jobId));
  const approved = library?.approved || [];
  const idSet = new Set(approvedVisualIds.filter(Boolean));
  const softFailed: string[] = [];
  const nextApproved = approved.map((v) => {
    if (!idSet.has(v.approvedVisualId)) return v;
    softFailed.push(v.approvedVisualId);
    return {
      ...v,
      warnings: [...new Set([...(v.warnings || []), "soft_failed", reason])],
      reuseLimit: 0,
      bestUseCase: `SOFT-FAILED: ${reason}`,
    };
  });
  const log = [
    ...(library?.softFailed || []),
    ...softFailed.map((approvedVisualId) => ({
      approvedVisualId,
      reason,
      at: new Date().toISOString(),
    })),
  ];
  await writeJson(jobDataFile("visual-intelligence-approved-library", jobId), {
    jobId,
    approved: nextApproved,
    softFailed: log,
    updatedAt: new Date().toISOString(),
    source: "emergency soft-fail",
  });

  const scenes = await loadTimelineScenes(jobId);
  const scenesCleared: string[] = [];
  for (const s of scenes) {
    if (idSet.has(s.approvedVisualId || "") || idSet.has(s.selectedVisualId || "")) {
      scenesCleared.push(s.sceneId);
    }
  }
  return { softFailed, scenesCleared };
}

export async function setSceneVisualFromUrl(params: {
  jobId: string;
  sceneId: string;
  url: string;
  title?: string;
  thumbnail?: string;
  personName?: string;
  softFailIds?: string[];
}): Promise<{ scene: TimelineScene; approved: ApprovedVisual; softFailed: string[] }> {
  const job = await loadJob(params.jobId);
  if (!job) throw new Error("Job not found");
  if (job.timelineLock?.locked) {
    throw new Error("Timeline is locked. Unlock before swapping visuals.");
  }

  const url = String(params.url || "").trim();
  if (!/^https:\/\//i.test(url)) throw new Error("https url required");

  const safety = assessContentSafety({
    title: params.title,
    url,
    description: params.personName,
  });
  if (safety.unsafe) {
    throw new Error(`Refusing unsafe visual: ${safety.reasons.join("; ")}`);
  }

  const scenes = await loadTimelineScenes(params.jobId);
  const scene = scenes.find((s) => s.sceneId === params.sceneId);
  if (!scene) throw new Error(`Scene not found: ${params.sceneId}`);

  const library = await readJson<{ approved: ApprovedVisual[]; softFailed?: unknown[] }>(
    jobDataFile("visual-intelligence-approved-library", params.jobId)
  );
  let approvedList = library?.approved || [];

  const softFailIds = [
    ...(params.softFailIds || []),
    scene.approvedVisualId,
    scene.selectedVisualId,
  ].filter(Boolean) as string[];

  if (softFailIds.length) {
    const failed = await softFailApprovedVisuals(
      params.jobId,
      softFailIds,
      "replaced by emergency safe visual"
    );
    const refreshed = await readJson<{ approved: ApprovedVisual[] }>(
      jobDataFile("visual-intelligence-approved-library", params.jobId)
    );
    approvedList = refreshed?.approved || approvedList;
    void failed;
  }

  const person = params.personName || job.title;
  const hash = crypto.createHash("md5").update(url).digest("hex").slice(0, 10);
  const approvedVisualId = `av-safe-${hash}`;
  const approved: ApprovedVisual = {
    approvedVisualId,
    source: "google_image",
    filePathOrUrl: url,
    thumbnail: params.thumbnail || url,
    matchedPeople: personNameGuess(person),
    matchedCompanies: [],
    matchedPlaces: [],
    matchedEvents: [],
    matchedDocuments: [],
    matchedObjects: [],
    matchedScriptSubjects: personNameGuess(person),
    allowedBeatIds: [scene.beatId],
    bestUseCase: params.title || `Emergency safe visual for ${person}`,
    confidenceScores: scoresForManual(person),
    visualEditorScore: 90,
    reuseLimit: 3,
    cropInstructions: "center crop 16:9 when needed",
    durationRecommendation: Math.min(6, Math.max(3, scene.duration || 3.5)),
    warnings: ["manual_safe_swap"],
    candidateId: `safe-${hash}`,
    queryPackId: scene.queryPackId,
    mediaType: "image",
    supportsTitle: true,
  };

  const nextApproved = [
    ...approvedList.filter((v) => v.approvedVisualId !== approvedVisualId),
    approved,
  ];
  await writeJson(jobDataFile("visual-intelligence-approved-library", params.jobId), {
    jobId: params.jobId,
    approved: nextApproved,
    softFailed: library?.softFailed || [],
    updatedAt: new Date().toISOString(),
    source: "emergency set-visual",
  });

  const nextScene: TimelineScene = {
    ...scene,
    selectedVisualId: approvedVisualId,
    approvedVisualId,
    source: "google_image",
    reasonSelected: `Emergency safe swap: ${params.title || "dignified subject visual"}`,
    confidence: 0.9,
    fallbackUsed: false,
    needsBetterVisual: false,
    matchType: "strong_match",
    whyThisMatchesTitle: `Supports title subject: ${person}`,
    whyThisMatchesNarration: params.title || "Named-person safe still",
    whyThisIsAppropriate: "Manual content-safety replacement — dignified subject image",
    whatIsMissing: "",
    warnings: ["manual_safe_swap"],
    confidenceScores: approved.confidenceScores,
    queryPackId: scene.queryPackId,
  };

  const nextScenes = scenes.map((s) => (s.sceneId === params.sceneId ? nextScene : s));
  await writeJson(jobDataFile("visual-intelligence-final-assignment", params.jobId), {
    jobId: params.jobId,
    scenes: nextScenes,
  });
  await writeJson(jobDataFile("royal-v2-final-assignment", params.jobId), {
    jobId: params.jobId,
    scenes: nextScenes,
  });
  await runFinalQA(params.jobId, nextScenes);

  return { scene: nextScene, approved, softFailed: softFailIds };
}

function personNameGuess(raw: string): string[] {
  const cleaned = raw
    .replace(/^at\s+\d+,?\s*/i, "")
    .replace(/the tragedy of\s+/i, "")
    .replace(/\s+feels beyond.*$/i, "")
    .trim();
  // Prefer "Clint Eastwood" style two+ token names from title crumbs.
  const m = cleaned.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/);
  if (m) return [m[1]];
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 2).slice(0, 3);
  return tokens.length ? [tokens.join(" ")] : [cleaned.slice(0, 40)];
}
