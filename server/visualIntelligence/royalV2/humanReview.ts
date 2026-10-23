import { jobDataFile, readJson, writeJson } from "../../storage.js";
import type { TimelineScene } from "../../../shared/visualIntelligence.js";

const MAX_PER_JOB = 40;

const PEOPLE = [
  /\bcharles\b/i,
  /\bcamilla\b/i,
  /\bwilliam\b/i,
  /\b(catherine|kate)\b/i,
  /\bharry\b/i,
  /\bmeghan\b/i,
  /\bdiana\b/i,
  /\banne\b/i,
  /\bgeorge\b/i,
  /\bcharlotte\b/i,
  /\blouis\b/i,
  /\bandrew\b/i,
  /\bbeatrice\b/i,
  /\beugenie\b/i,
  /\belizabeth\b/i,
  /\bedward\b/i,
  /\blouise\b/i,
];

function nameCount(text: string): number {
  return PEOPLE.filter((pattern) => pattern.test(text)).length;
}

function bucket(scene: TimelineScene): "fix" | "doubt" | "specific" | null {
  const text = scene.narrationText || "";
  if (scene.softApproval === "fail") return "fix";
  if (
    nameCount(text) >= 2 ||
    /\b(his|her)\s+(wife|husband)\b/i.test(text) ||
    /\b(queen elizabeth|lady louise|king george|king edward)\b/i.test(text) ||
    /\b(iii|iv|vi|vii)\b/i.test(text)
  ) {
    return "doubt";
  }
  if (
    /\b(1[5-9]\d{2}|20\d{2})\b/.test(text) ||
    /\b(signed|handwriting|letter|order|will|chapel|palace|sandringham|balmoral|windsor)\b/i.test(text)
  ) {
    return "specific";
  }
  return null;
}

export async function markHumanReview(jobId: string): Promise<{ fix: number; doubt: number; specific: number }> {
  const assignmentPath = jobDataFile("visual-intelligence-final-assignment", jobId);
  const existing = (await readJson<{ scenes?: TimelineScene[] }>(assignmentPath)) || {};
  const scenes = existing.scenes || [];
  for (const scene of scenes) delete scene.humanReview;

  const ranked = scenes
    .map((scene) => ({ scene, kind: bucket(scene) }))
    .filter((item): item is { scene: TimelineScene; kind: "fix" | "doubt" | "specific" } => Boolean(item.kind))
    .sort((a, b) => {
      const order = { fix: 0, doubt: 1, specific: 2 };
      return order[a.kind] - order[b.kind];
    })
    .slice(0, MAX_PER_JOB);

  const counts = { fix: 0, doubt: 0, specific: 0 };
  for (const item of ranked) {
    item.scene.humanReview = item.kind;
    counts[item.kind] += 1;
  }

  await writeJson(assignmentPath, { ...existing, scenes });
  const royalPath = jobDataFile("royal-v2-final-assignment", jobId);
  const royal = await readJson<Record<string, unknown>>(royalPath);
  if (royal) await writeJson(royalPath, { ...royal, scenes });
  return counts;
}
