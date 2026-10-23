import { planShortClipReplacements, type RepairClip, type RepairScene } from "../server/visualIntelligence/royalV2/repairShortClips.ts";

const clip = (id: string, file: string, duration: number, person: string): RepairClip => ({
  assetId: id,
  fileKey: file,
  duration,
  person,
  title: `${person} walks`,
  description: "",
  category: "",
  categories: [],
  filePathOrUrl: `https://example.com/${file}`,
});

const scenes: RepairScene[] = [
  { sceneId: "scene-001", duration: 5, narrationText: "King Charles signs the letter", isClip: true, fileKey: "short.mp4" },
  { sceneId: "scene-002", duration: 3, narrationText: "King Charles waves", isClip: true, fileKey: "ok.mp4" },
  { sceneId: "scene-003", duration: 5.2, narrationText: "Then Charles leaves the palace", isClip: true, fileKey: "short.mp4" },
];
const clips = [
  clip("short", "short.mp4", 3.2, "King Charles"),
  clip("ok", "ok.mp4", 4, "King Charles"),
  clip("long-a", "long-a.mp4", 6, "King Charles"),
  clip("long-b", "long-b.mp4", 7, "Queen Camilla"),
];
const plan = planShortClipReplacements(scenes, clips);
if (plan.affected !== 2) throw new Error(`affected ${plan.affected}`);
if (plan.replacements.length !== 1) throw new Error(`replaced ${JSON.stringify(plan)}`);
if (plan.replacements[0].fileKey !== "long-a.mp4") throw new Error("first clip");
if (plan.unchanged.length !== 1 || plan.unchanged[0].sceneId !== "scene-003") {
  throw new Error(`unchanged ${JSON.stringify(plan.unchanged)}`);
}
console.log("ok", plan.replacements[0].fileKey, plan.unchanged[0].sceneId);
