import { jobDataFile, loadJob, writeJson } from "../storage.js";
import type { FinalQAReport, TimelineScene } from "../../shared/visualIntelligence.js";

export async function runFinalQA(jobId: string, scenes: TimelineScene[]): Promise<FinalQAReport> {
  const criticalIssues: string[] = [];
  const warnings: string[] = [];
  const job = await loadJob(jobId).catch(() => null);
  const mysteryV2Lenient = job?.niche === "Mystery v2";

  const cardCount = scenes.filter((s) => s.source === "fallback_card" || s.fallbackUsed).length;
  if (cardCount > 0) {
    criticalIssues.push(`Card/fallback placeholders are disabled (${cardCount} scenes)`);
  }

  for (const scene of scenes) {
    if (!scene.selectedVisualId) criticalIssues.push(`${scene.sceneId}: scene without visual`);
    if (!scene.approvedVisualId) {
      criticalIssues.push(`${scene.sceneId}: visual not from approved library`);
    }
    // Mystery v2: prefer render-ready — low confidence is a warning, not a hard block.
    if (scene.confidence < (mysteryV2Lenient ? 0.32 : 0.5)) {
      if (mysteryV2Lenient) warnings.push(`${scene.sceneId}: confidence below 32`);
      else criticalIssues.push(`${scene.sceneId}: confidence below 50`);
    }
    if (scene.warnings.includes("possible wrong entity") || scene.warnings.includes("possible wrong context")) {
      const wrong = scene.confidenceScores?.wrongContextRisk ?? scene.confidenceScores?.wrongEntityRisk ?? 0;
      if (wrong > (mysteryV2Lenient ? 72 : 55)) criticalIssues.push(`${scene.sceneId}: clearly wrong context`);
      else warnings.push(`${scene.sceneId}: wrong entity risk`);
    }
    if (scene.repeatDistanceWarning) warnings.push(`${scene.sceneId}: repeated image too close`);
    if (scene.needsBetterVisual) warnings.push(`${scene.sceneId}: needs better visual`);
    if (scene.softApproval === "fail") {
      warnings.push(`${scene.sceneId}: soft approval fail (wrong person risk)`);
    } else if (scene.softApproval === "unsure") {
      warnings.push(`${scene.sceneId}: soft approval unsure`);
    }
    if (scene.confidence < 0.7) warnings.push(`${scene.sceneId}: low confidence`);
    if (scene.warnings.includes("watermark/text risk") || scene.warnings.includes("possible watermark")) {
      warnings.push(`${scene.sceneId}: watermarked images`);
    }
    if (scene.warnings.includes("portrait crop risk")) {
      warnings.push(`${scene.sceneId}: portrait crop risk`);
    }
    if (scene.isTextHeavy) warnings.push(`${scene.sceneId}: text-heavy visual`);
    if (scene.duration < 2 || scene.duration > 8) {
      warnings.push(`${scene.sceneId}: scene duration problems`);
    }
  }

  const report: FinalQAReport = {
    jobId,
    criticalIssues,
    warnings,
    canRender: criticalIssues.length === 0,
    checkedAt: new Date().toISOString(),
  };

  await writeJson(jobDataFile("editor-final-qa", jobId), report);
  await writeJson(jobDataFile("visual-intelligence-final-qa", jobId), report);
  return report;
}
