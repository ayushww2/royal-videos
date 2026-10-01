/**
 * Context visual pass.
 * GPT 6.1 decides who a line is about and whether a clip or still fits.
 * This module only enforces library limits: clip share, reuse, and short-clip handoff.
 */
import { chatJson } from "../../openaiClient.js";
import { jobDataFile, loadJob, readJson, saveJob, writeJson } from "../../storage.js";
import type { ApprovedVisual, JudgmentScores, TimelineScene } from "../../../shared/visualIntelligence.js";
import type { LibraryAsset } from "../../library/types.js";
import { loadRoyalLibraryAssets, royalAssetUrl } from "./library.js";
import { canonicalRoyalPerson } from "./taxonomy.js";

const REASONING_MODEL = process.env.ROYAL_REASONING_MODEL || "gpt-6.1-sol";
const MIN_REUSE_GAP_SEC = 8 * 60;
const MAX_USES = 2;
const CLIP_SHARE_LOW = 0.4;
const CLIP_SHARE_HIGH = 0.6;

type Prefer = "clip" | "image" | "either";

type ScenePlan = {
  sceneId: string;
  speaker: string;
  show: string;
  prefer: Prefer;
  search: string;
};

const running = new Set<string>();

const STOP = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "before", "but",
  "could", "for", "from", "had", "has", "have", "her", "his", "into", "its", "not",
  "one", "she", "that", "the", "their", "them", "then", "there", "they", "this",
  "was", "were", "what", "when", "who", "with", "would", "you",
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function isClipAsset(asset: LibraryAsset): boolean {
  return asset.mediaType === "raw_footage" || asset.mediaType === "trusted_clip";
}

function isUsableStill(asset: LibraryAsset): boolean {
  if (asset.mediaType !== "image") return false;
  if (asset.width && asset.height && asset.height > asset.width) return false;
  return true;
}

function haystack(asset: LibraryAsset): string {
  return [asset.person, asset.title, asset.description, asset.category, ...(asset.categories || []), asset.group]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreAsset(asset: LibraryAsset, plan: ScenePlan): number {
  const text = haystack(asset);
  let score = 0;
  const wanted = canonicalRoyalPerson(plan.show) || canonicalRoyalPerson(plan.speaker);
  const assetPerson = canonicalRoyalPerson(asset.person);
  if (wanted && assetPerson === wanted) score += 50;
  else if (wanted && text.includes(wanted.toLowerCase())) score += 28;
  for (const word of tokens(`${plan.show} ${plan.search}`)) {
    if (text.includes(word)) score += 7;
  }
  if (asset.description) score += 4;
  if (asset.duration && asset.duration >= 2) score += 3;
  return score;
}

function wantClip(prefer: Prefer, placed: number, clips: number, recent: boolean[], forceClip: boolean): boolean {
  if (forceClip) return true;
  const ratio = placed ? clips / placed : 0;
  const lastThree = recent.slice(-3);
  const streak =
    lastThree.length === 3 && lastThree.every((clip) => clip === lastThree[0]) ? lastThree[0] : undefined;
  if (streak === true && ratio >= CLIP_SHARE_LOW) return false;
  if (streak === false && ratio <= CLIP_SHARE_HIGH) return true;
  if (prefer === "clip") return ratio < CLIP_SHARE_HIGH;
  if (prefer === "image") return ratio < CLIP_SHARE_LOW;
  return ratio < 0.5;
}

function canReuse(uses: number[], sceneStart: number): boolean {
  if (uses.length >= MAX_USES) return false;
  if (!uses.length) return true;
  return sceneStart - uses[uses.length - 1] >= MIN_REUSE_GAP_SEC;
}

async function planBatch(scenes: TimelineScene[], all: TimelineScene[]): Promise<ScenePlan[]> {
  const indexById = new Map(all.map((scene, index) => [scene.sceneId, index]));
  const payload = scenes.map((scene) => {
    const index = indexById.get(scene.sceneId) ?? 0;
    return {
      sceneId: scene.sceneId,
      startSec: scene.startTime,
      durationSec: Number(scene.duration.toFixed(2)),
      line: scene.narrationText,
      previous: all[index - 1]?.narrationText || "",
      next: all[index + 1]?.narrationText || "",
    };
  });

  const result = await chatJson<{ scenes?: ScenePlan[] }>({
    model: REASONING_MODEL,
    temperature: 0.3,
    system: [
      "You choose the visual for each narration line of a royal documentary.",
      "You do not pick file names. You name who is on screen and whether a raw clip or a still photograph fits.",
      "Separate the person speaking from the person being remembered. If Anne is telling William what Diana wanted, Anne is the speaker; show Diana only when the line is about seeing Diana.",
      "Raw clips should land near half of all scenes, inside 40 to 60 percent, and only when that subject has footage. Thin footage means a still is correct. Rich footage should be preferred.",
      "Do not bunch clips at the start or in a repeating clip-image pattern. Mix them.",
      "A clip may be used at most twice, and the second use must be at least 8 minutes later. Do not plan a fixed interval.",
      "prefer is clip, image, or either. search is a short library query.",
      'Return JSON: {"scenes":[{"sceneId":"","speaker":"","show":"","prefer":"clip","search":""}]}',
    ].join(" "),
    user: JSON.stringify({ scenes: payload }),
  });

  const byId = new Map((result.scenes || []).map((plan) => [plan.sceneId, plan]));
  return scenes.map((scene) => {
    const plan = byId.get(scene.sceneId);
    const prefer = plan?.prefer === "clip" || plan?.prefer === "image" ? plan.prefer : "either";
    return {
      sceneId: scene.sceneId,
      speaker: String(plan?.speaker || "").slice(0, 80),
      show: String(plan?.show || scene.narrationText).slice(0, 140),
      prefer,
      search: String(plan?.search || scene.narrationText).slice(0, 180),
    };
  });
}

function emptyScores(score: number): JudgmentScores {
  return {
    entityMatch: score,
    sceneMatch: score,
    topicRelevance: score,
    eventPlaceYearRelevance: score,
    visualQuality: score,
    cropSafety16x9: score,
    sourceReliability: 80,
    wrongEntityRisk: 10,
    watermarkTextRisk: 10,
    reusePotential: 40,
  };
}

function toApproved(asset: LibraryAsset, plan: ScenePlan, score: number): ApprovedVisual {
  return {
    approvedVisualId: asset.assetId,
    source: isClipAsset(asset) ? "raw_footage" : "cached_approved",
    filePathOrUrl: royalAssetUrl(asset),
    thumbnail: royalAssetUrl({ ...asset, r2Key: asset.thumbKey || asset.r2Key }),
    matchedPeople: [canonicalRoyalPerson(asset.person) || asset.person].filter(Boolean),
    matchedCompanies: [],
    matchedPlaces: [],
    matchedEvents: [],
    matchedDocuments: [],
    matchedObjects: [],
    allowedBeatIds: [],
    bestUseCase: plan.show,
    confidenceScores: emptyScores(score),
    reuseLimit: MAX_USES,
    durationRecommendation: asset.duration,
    warnings: [],
    candidateId: asset.assetId,
    libraryAssetId: asset.assetId,
    libraryGroup: asset.group,
    libraryCategory: asset.category,
    mediaType: isClipAsset(asset) ? "raw_footage" : "image",
    visualEditorScore: score,
  };
}

export function contextVisualAssignRunning(jobId: string): boolean {
  return running.has(jobId);
}

export async function assignContextVisuals(jobId: string): Promise<void> {
  if (running.has(jobId)) return;
  running.add(jobId);
  const progressPath = jobDataFile("royal-context-visual-assign", jobId);
  try {
    const job = await loadJob(jobId);
    if (!job) throw new Error("Job not found");
    const stored = await readJson<{ scenes?: TimelineScene[] }>(
      jobDataFile("visual-intelligence-final-assignment", jobId)
    );
    const scenes = stored?.scenes || [];
    if (!scenes.length) throw new Error("No timed scenes to assign");

    await writeJson(progressPath, { jobId, status: "planning", done: 0, total: scenes.length });
    const plans: ScenePlan[] = [];
    const batchSize = 16;
    for (let offset = 0; offset < scenes.length; offset += batchSize) {
      const batch = scenes.slice(offset, offset + batchSize);
      plans.push(...(await planBatch(batch, scenes)));
      await writeJson(progressPath, {
        jobId,
        status: "planning",
        done: plans.length,
        total: scenes.length,
        model: REASONING_MODEL,
      });
    }

    const assets = await loadRoyalLibraryAssets();
    const uses = new Map<string, number[]>();
    const recentClips: boolean[] = [];
    let placed = 0;
    let clipCount = 0;
    let forceNextClip = false;
    const approved = new Map<string, ApprovedVisual>();

    const ranked = (plan: ScenePlan, clip: boolean) =>
      assets
        .filter((asset) => (clip ? isClipAsset(asset) : isUsableStill(asset)))
        .map((asset) => ({ asset, score: scoreAsset(asset, plan) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

    for (let index = 0; index < scenes.length; index++) {
      const scene = scenes[index];
      const plan = plans[index];
      const mustFollowWithClip = forceNextClip;
      forceNextClip = false;
      const preferClip = wantClip(plan.prefer, placed, clipCount, recentClips, mustFollowWithClip);
      const order = preferClip ? [true, false] : [false, true];
      let chosen: { asset: LibraryAsset; score: number } | undefined;
      for (const clip of order) {
        const pool = ranked(plan, clip);
        chosen = pool.find((item) => canReuse(uses.get(item.asset.assetId) || [], scene.startTime));
        if (chosen) break;
      }

      scene.warnings = (scene.warnings || []).filter(
        (warning) => !/No library asset|Hold the last frame|following clip/i.test(warning)
      );
      if (!chosen) {
        scene.selectedVisualId = "";
        scene.approvedVisualId = undefined;
        scene.rawFootageUsed = false;
        scene.needsBetterVisual = true;
        scene.warnings.push("No library asset passed the reuse and subject rules");
        recentClips.push(false);
      } else {
        const clip = isClipAsset(chosen.asset);
        const usedAt = uses.get(chosen.asset.assetId) || [];
        usedAt.push(scene.startTime);
        uses.set(chosen.asset.assetId, usedAt);
        approved.set(chosen.asset.assetId, toApproved(chosen.asset, plan, chosen.score));
        scene.selectedVisualId = chosen.asset.assetId;
        scene.approvedVisualId = chosen.asset.assetId;
        scene.source = clip ? "raw_footage" : "cached_approved";
        scene.rawFootageUsed = clip;
        scene.needsBetterVisual = false;
        scene.mainPerson = plan.show;
        scene.reasonSelected = `${plan.speaker ? `Speaker ${plan.speaker}. ` : ""}Show ${plan.show}. ${plan.search}`;
        scene.pickReason = scene.reasonSelected;
        scene.confidence = Math.min(0.95, chosen.score / 100);
        scene.viewerShouldSee = plan.show;
        const clipDuration = chosen.asset.duration || 0;
        const short = clip && clipDuration > 0.4 && clipDuration + 0.15 < scene.duration;
        if (short) {
          const hold = Number((scene.duration - clipDuration).toFixed(2));
          scene.editorNotes = `Clip is ${clipDuration.toFixed(2)}s. Hold the last frame for ${hold.toFixed(2)}s. Next scene stays on a clip.`;
          scene.warnings.push(scene.editorNotes);
          forceNextClip = true;
        } else {
          scene.editorNotes = plan.search;
        }
        if (mustFollowWithClip && !clip) {
          scene.warnings.push("Needed a following clip but none was available for this subject");
        }
        placed += 1;
        if (clip) clipCount += 1;
        recentClips.push(clip);
      }

      if (index % 20 === 0) {
        await writeJson(progressPath, {
          jobId,
          status: "selecting",
          done: index + 1,
          total: scenes.length,
          clips: clipCount,
          placed,
        });
      }
    }

    const payload = {
      jobId,
      source: "gpt_context_visuals",
      model: REASONING_MODEL,
      lineCount: scenes.length,
      clipCount,
      placed,
      clipShare: placed ? Number((clipCount / placed).toFixed(3)) : 0,
      scenes,
      createdAt: new Date().toISOString(),
    };
    await writeJson(jobDataFile("visual-intelligence-final-assignment", jobId), payload);
    await writeJson(jobDataFile("royal-v2-final-assignment", jobId), payload);
    await writeJson(jobDataFile("visual-intelligence-approved-library", jobId), {
      jobId,
      approved: [...approved.values()],
      createdAt: payload.createdAt,
    });
    await writeJson(progressPath, {
      jobId,
      status: "ready",
      done: scenes.length,
      total: scenes.length,
      clips: clipCount,
      placed,
      clipShare: payload.clipShare,
      model: REASONING_MODEL,
    });
    job.updatedAt = new Date().toISOString();
    job.status = "scene_review_ready";
    await saveJob(job);
  } catch (error) {
    await writeJson(progressPath, {
      jobId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    running.delete(jobId);
  }
}
