import { jobDataFile, writeJson } from "../../storage.js";
import { clampScore } from "../editorScores.js";
import type { FinalQAReport, TimelineScene } from "../../../shared/visualIntelligence.js";

export async function runMysteryFinalQA(
  jobId: string,
  scenes: TimelineScene[]
): Promise<FinalQAReport> {
  const criticalIssues: string[] = [];
  const warnings: string[] = [];

  let cardFallbackUsed = 0;
  let needsBetter = 0;
  let exact = 0;
  let strong = 0;
  let good = 0;
  let related = 0;
  let noVisual = 0;
  let textHeavy = 0;
  const confidences: number[] = [];

  for (const scene of scenes) {
    const conf100 = clampScore(
      scene.confidence > 1 ? scene.confidence : scene.confidence * 100
    );
    confidences.push(conf100);

    if (!scene.selectedVisualId || !scene.approvedVisualId) {
      noVisual += 1;
      criticalIssues.push(`${scene.sceneId}: scene without visual`);
    }

    if (scene.source === "fallback_card" || scene.fallbackUsed) {
      cardFallbackUsed += 1;
      criticalIssues.push(`${scene.sceneId}: card/fallback placeholder is disabled — use real visual`);
    }

    if (scene.needsBetterVisual || scene.matchType === "needs_better_visual") needsBetter += 1;
    if (scene.matchType === "exact_match") exact += 1;
    if (scene.matchType === "strong_match") strong += 1;
    if (scene.matchType === "good_context") good += 1;
    if (scene.matchType === "related_context") related += 1;
    if (scene.isTextHeavy) {
      textHeavy += 1;
      warnings.push(`${scene.sceneId}: text-heavy visual`);
    }

    const wm = scene.confidenceScores?.watermarkRisk ?? scene.confidenceScores?.watermarkTextRisk ?? 0;
    const alt = scene.confidenceScores?.alteredTextRisk ?? 0;
    const wrong = scene.confidenceScores?.wrongContextRisk ?? scene.confidenceScores?.wrongEntityRisk ?? 0;

    if (wm > 40 || scene.warnings.some((w) => w.includes("watermark"))) {
      if (wm > 50) criticalIssues.push(`${scene.sceneId}: visible watermark`);
      else warnings.push(`${scene.sceneId}: possible watermark`);
    }
    if (alt > 40 || scene.warnings.some((w) => w.includes("altered text") || w.includes("baked"))) {
      if (alt > 50) criticalIssues.push(`${scene.sceneId}: big altered text`);
      else warnings.push(`${scene.sceneId}: possible altered text`);
    }
    if (wrong > 50 || scene.warnings.some((w) => w.includes("wrong context") || w.includes("wrong entity"))) {
      if (wrong > 55) criticalIssues.push(`${scene.sceneId}: clearly wrong context`);
      else warnings.push(`${scene.sceneId}: possible wrong context`);
    }

    // Hands-off Mystery finals: low confidence is a warning when a real still exists.
    // Empty / fallback scenes remain critical.
    if (conf100 < 50) {
      if (scene.approvedVisualId || scene.selectedVisualId) {
        warnings.push(`${scene.sceneId}: confidence below 50`);
      } else {
        criticalIssues.push(`${scene.sceneId}: confidence below 50`);
      }
    }
    if (conf100 < 70) warnings.push(`${scene.sceneId}: confidence below 70 — needs review`);
    if ((scene.confidenceScores?.visualEditorScore ?? conf100) < 70) {
      warnings.push(`${scene.sceneId}: editor score below 70`);
    }
    if (scene.repeatDistanceWarning) warnings.push(`${scene.sceneId}: repeated visual`);
    if (scene.needsBetterVisual) warnings.push(`${scene.sceneId}: needs better visual`);
  }

  const avg =
    confidences.length > 0
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : 0;

  const report: FinalQAReport = {
    jobId,
    criticalIssues,
    warnings,
    canRender: criticalIssues.length === 0,
    checkedAt: new Date().toISOString(),
    acceptance: {
      totalScenes: scenes.length,
      exactMatchScenes: exact,
      strongMatchScenes: strong,
      goodContextScenes: good,
      relatedContextScenes: related,
      needsBetterVisualScenes: needsBetter,
      scenesWithNoVisual: noVisual,
      textHeavyScenes: textHeavy,
      cardFallbackUsed,
      averageConfidence: avg,
      anyCardFallbackUsed: cardFallbackUsed > 0,
    },
  };

  await writeJson(jobDataFile("editor-final-qa", jobId), report);
  await writeJson(jobDataFile("mystery-v1-final-qa", jobId), report);
  await writeJson(jobDataFile("visual-intelligence-final-qa", jobId), report);
  return report;
}
