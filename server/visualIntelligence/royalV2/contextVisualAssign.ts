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
import { canonicalRoyalPerson, royalPersonMentions } from "./taxonomy.js";

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

function namedPeople(text: string): string[] {
  return [...new Set(royalPersonMentions(text).map((mention) => mention.person))];
}

function assetPeople(asset: LibraryAsset): string[] {
  return namedPeople(`${asset.person} ${asset.group || ""}`);
}

function scoreAsset(asset: LibraryAsset, plan: ScenePlan, onlyPerson?: string): number {
  const required = onlyPerson ? [onlyPerson] : namedPeople(plan.show);
  const people = assetPeople(asset);
  if (required.length && !required.some((person) => people.includes(person))) return 0;
  const text = haystack(asset);
  let score = required.length ? 50 : 0;
  for (const word of tokens(plan.search)) {
    if (namedPeople(word).length) continue;
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

type Placement = {
  at: number;
  assetId: string;
  fileKey: string;
  hash: string;
  person: string;
  tokens: string[];
};

function fileKey(asset: LibraryAsset): string {
  return (asset.r2Key || asset.assetId).replace(/\.(mp4|mov|webm|jpe?g|png|webp)$/i, "");
}

function shotTokens(asset: LibraryAsset): string[] {
  return [
    ...new Set(
      tokens(`${asset.person} ${asset.description || ""} ${asset.title || ""}`).filter(
        (word) => word.length > 3 && !/^\d+$/.test(word)
      )
    ),
  ];
}

/** Same file, or a different library id of a lookalike shot. */
function sameShot(asset: LibraryAsset, prior: Placement): boolean {
  if (prior.assetId === asset.assetId) return true;
  if (prior.fileKey === fileKey(asset)) return true;
  if (asset.contentHash && prior.hash === asset.contentHash) return true;
  const person = (canonicalRoyalPerson(asset.person) || asset.person || "").toLowerCase();
  if (!person || person !== prior.person) return false;
  const current = shotTokens(asset);
  let shared = 0;
  const seen = new Set(prior.tokens);
  for (const word of current) if (seen.has(word)) shared += 1;
  return shared >= 5;
}

function canPlace(asset: LibraryAsset, sceneStart: number, placements: Placement[]): boolean {
  const same = placements.filter((prior) => sameShot(asset, prior));
  if (same.length >= MAX_USES) return false;
  return same.every((prior) => sceneStart - prior.at >= MIN_REUSE_GAP_SEC);
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
      "You choose who is on screen for one narration line. Name only the person that line is about.",
      "A Panorama interview, a marriage, or 'her' after Diana is Princess Diana. Do not add King Charles or Prince William unless this line is about them.",
      "Charles Spencer, Earl Spencer, is not King Charles. Never substitute a relative who shares a first name.",
      "show is one canonical name, or two only when the line is about both. speaker can differ from show.",
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

export async function assignContextVisuals(jobId: string, options?: { reusePlans?: boolean }): Promise<void> {
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
    if (options?.reusePlans && scenes.some((scene) => scene.viewerShouldSee)) {
      for (const scene of scenes) {
        plans.push({
          sceneId: scene.sceneId,
          speaker: "",
          show: scene.viewerShouldSee || scene.narrationText,
          prefer: "either",
          search: scene.narrationText,
        });
      }
    } else {
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
    }

    const assets = await loadRoyalLibraryAssets();
    const placements: Placement[] = [];
    const recentClips: boolean[] = [];
    let placed = 0;
    let clipCount = 0;
    let forceNextClip = false;
    const approved = new Map<string, ApprovedVisual>();

    const covers = (asset: LibraryAsset, targetSec: number) => {
      const length = asset.duration || 0;
      return targetSec > 0 && length >= targetSec * 0.85 && length <= targetSec * 1.4;
    };

    const ranked = (plan: ScenePlan, clip: boolean, targetSec?: number, onlyPerson?: string) =>
      assets
        .filter((asset) => (clip ? isClipAsset(asset) : isUsableStill(asset)))
        .filter((asset) => !clip || targetSec === undefined || covers(asset, targetSec))
        .map((asset) => ({ asset, score: scoreAsset(asset, plan, onlyPerson) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

    for (let index = 0; index < scenes.length; index++) {
      const scene = scenes[index];
      const plan = plans[index];
      const mustFollowWithClip = forceNextClip;
      forceNextClip = false;
      const longScene = scene.duration > 5;
      const preferClip = wantClip(plan.prefer, placed, clipCount, recentClips, mustFollowWithClip || longScene);
      let chosen: { asset: LibraryAsset; score: number } | undefined;
      let second: { asset: LibraryAsset; score: number } | undefined;

      const differentShot = (lead: LibraryAsset, item: { asset: LibraryAsset }) =>
        item.asset.assetId !== lead.assetId &&
        !sameShot(item.asset, {
          at: scene.startTime,
          assetId: lead.assetId,
          fileKey: fileKey(lead),
          hash: lead.contentHash || "",
          person: (canonicalRoyalPerson(lead.person) || lead.person || "").toLowerCase(),
          tokens: shotTokens(lead),
        });

      const required = namedPeople(plan.show);
      const leadPerson = required[0];
      const otherPerson = required[1] || required[0];
      const pairFor = (target: number) => {
        const first = ranked(plan, true, target, leadPerson).find((item) =>
          canPlace(item.asset, scene.startTime, placements)
        );
        if (!first) return;
        const next = ranked(plan, true, target, otherPerson).find(
          (item) => differentShot(first.asset, item) && canPlace(item.asset, scene.startTime, placements)
        );
        if (!next) return;
        return { first, next };
      };

      if (longScene || preferClip) {
        const half = scene.duration / 2;
        if (!longScene) {
          chosen = ranked(plan, true, scene.duration, leadPerson).find((item) =>
            canPlace(item.asset, scene.startTime, placements)
          );
        }
        if (!chosen) {
          const pair = pairFor(half);
          if (pair) {
            chosen = pair.first;
            second = pair.next;
          }
        }
      }
      if (longScene && !chosen) {
        const half = scene.duration / 2;
        const pool = assets
          .filter((asset) => isClipAsset(asset) && (asset.duration || 0) > 0.4)
          .filter((asset) => canPlace(asset, scene.startTime, placements))
          .map((asset) => ({
            asset,
            score: scoreAsset(asset, plan, leadPerson) - Math.abs((asset.duration || 0) - half) * 8,
          }))
          .sort((a, b) => b.score - a.score);
        const first = pool.find((item) => item.score > 0);
        const secondPool =
          otherPerson === leadPerson
            ? pool
            : assets
                .filter((asset) => isClipAsset(asset) && (asset.duration || 0) > 0.4)
                .filter((asset) => canPlace(asset, scene.startTime, placements))
                .map((asset) => ({
                  asset,
                  score: scoreAsset(asset, plan, otherPerson) - Math.abs((asset.duration || 0) - half) * 8,
                }))
                .filter((item) => item.score > 0)
                .sort((a, b) => b.score - a.score);
        const next = first && secondPool.find((item) => differentShot(first.asset, item));
        if (first && next) {
          chosen = first;
          second = next;
        }
      }
      if (!chosen && !longScene && !mustFollowWithClip) {
        chosen = ranked(plan, false, undefined, leadPerson).find((item) =>
          canPlace(item.asset, scene.startTime, placements)
        );
      }

      scene.warnings = (scene.warnings || []).filter(
        (warning) => !/No library asset|Hold the last frame|following clip|Two clips/i.test(warning)
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
        placements.push({
          at: scene.startTime,
          assetId: chosen.asset.assetId,
          fileKey: fileKey(chosen.asset),
          hash: chosen.asset.contentHash || "",
          person: (canonicalRoyalPerson(chosen.asset.person) || chosen.asset.person || "").toLowerCase(),
          tokens: shotTokens(chosen.asset),
        });
        approved.set(chosen.asset.assetId, toApproved(chosen.asset, plan, chosen.score));
        scene.selectedVisualId = chosen.asset.assetId;
        scene.approvedVisualId = chosen.asset.assetId;
        scene.alternativeAssetIds = [];
        scene.source = clip ? "raw_footage" : "cached_approved";
        scene.rawFootageUsed = clip;
        scene.needsBetterVisual = false;
        scene.mainPerson = plan.show;
        scene.reasonSelected = `${plan.speaker ? `Speaker ${plan.speaker}. ` : ""}Show ${plan.show}. ${plan.search}`;
        scene.pickReason = scene.reasonSelected;
        scene.confidence = Math.min(0.95, chosen.score / 100);
        scene.viewerShouldSee = plan.show;
        const clipDuration = chosen.asset.duration || 0;
        if (second) {
          placements.push({
            at: scene.startTime,
            assetId: second.asset.assetId,
            fileKey: fileKey(second.asset),
            hash: second.asset.contentHash || "",
            person: (canonicalRoyalPerson(second.asset.person) || second.asset.person || "").toLowerCase(),
            tokens: shotTokens(second.asset),
          });
          approved.set(second.asset.assetId, toApproved(second.asset, plan, second.score));
          scene.alternativeAssetIds = [second.asset.assetId];
          const secondDuration = second.asset.duration || 0;
          scene.editorNotes = `Two clips, ${clipDuration.toFixed(2)}s then ${secondDuration.toFixed(2)}s, for a ${scene.duration.toFixed(2)}s line.`;
          scene.warnings.push(scene.editorNotes);
        } else {
          const short = clip && clipDuration > 0.4 && clipDuration + 0.15 < scene.duration;
          if (short) {
            const hold = Number((scene.duration - clipDuration).toFixed(2));
            scene.editorNotes = `Clip is ${clipDuration.toFixed(2)}s. Hold the last frame for ${hold.toFixed(2)}s. Next scene stays on a clip.`;
            scene.warnings.push(scene.editorNotes);
            if (!mustFollowWithClip) forceNextClip = true;
          } else {
            scene.editorNotes = plan.search;
          }
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
