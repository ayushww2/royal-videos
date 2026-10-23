import { jobDataFile, loadJob, readJson, saveJob, writeJson } from "../../storage.js";
import { searchGoogleImages } from "../imageSearch.js";
import { royalPersonMentions } from "./taxonomy.js";
import { loadRoyalLibraryAssets, royalAssetUrl } from "./library.js";
import type { LibraryAsset } from "../../library/types.js";
import type { ApprovedVisual, JobRecord, TimelineScene } from "../../../shared/visualIntelligence.js";

const STOP = new Set(
  "the a an and or but with from that this those these into over after before about their they them his her she he him was were are is be been being has have had will would can could not just then than its it's for you your our".split(" ")
);

const MALE = new Set(["King Charles", "Prince William", "Prince Harry", "Prince Andrew", "Prince George", "Prince Louis", "Timothy Laurence"]);
const FEMALE = new Set(["Queen Camilla", "Catherine, Princess of Wales", "Princess Diana", "Princess Anne", "Meghan, Duchess of Sussex", "Princess Charlotte", "Princess Beatrice", "Princess Eugenie", "Sarah Ferguson", "Sophie, Duchess of Edinburgh"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function isClip(asset: LibraryAsset): boolean {
  return asset.mediaType === "raw_footage" || asset.mediaType === "trusted_clips";
}

function blankScores(): ApprovedVisual["confidenceScores"] {
  return {
    entityMatch: 70,
    sceneMatch: 60,
    topicRelevance: 60,
    eventPlaceYearRelevance: 40,
    visualQuality: 70,
    cropSafety16x9: 70,
    sourceReliability: 70,
    wrongEntityRisk: 15,
    watermarkTextRisk: 10,
    reusePotential: 40,
  };
}

function peopleForScene(text: string, recent: string[]): string[] {
  const named = royalPersonMentions(text).map((mention) => mention.person);
  if (named.length) return [...new Set(named)];
  const lower = text.toLowerCase();
  const lastFemale = [...recent].reverse().find((person) => FEMALE.has(person.toLowerCase()));
  const lastMale = [...recent].reverse().find((person) => MALE.has(person.toLowerCase()));
  if (/\bhis wife\b/.test(lower) && lastMale) {
    if (/charles/.test(lastMale.toLowerCase())) return ["Queen Camilla"];
    if (/william/.test(lastMale.toLowerCase())) return ["Catherine, Princess of Wales"];
  }
  if (/\bher husband\b/.test(lower) && lastFemale) {
    if (/camilla/.test(lastFemale.toLowerCase())) return ["King Charles"];
    if (/catherine|kate/.test(lastFemale.toLowerCase())) return ["Prince William"];
  }
  if (/\b(she|her|hers)\b/.test(lower) && lastFemale) return [lastFemale];
  if (/\b(he|his|him)\b/.test(lower) && lastMale) return [lastMale];
  if (/\b(they|their|them)\b/.test(lower) && recent.length) return recent.slice(-2);
  return recent.slice(-1);
}

function assetText(asset: LibraryAsset): string {
  return [asset.person, asset.title, asset.description, asset.category, ...(asset.categories || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreAsset(asset: LibraryAsset, people: string[], words: string[]): number {
  const hay = assetText(asset);
  let score = 0;
  const peopleHit = people.filter((person) => hay.includes(person.toLowerCase().split(",")[0]));
  if (people.length && peopleHit.length) score += 8 + peopleHit.length;
  else if (people.length) score -= 4;
  for (const word of words) if (hay.includes(word)) score += 1;
  return score;
}

function canUse(uses: Map<string, number[]>, assetId: string, index: number): boolean {
  const prior = uses.get(assetId) || [];
  if (prior.length >= 2) return false;
  if (prior.length === 1 && index - prior[0] < 50) return false;
  return true;
}

export async function fillTimedScenes(jobId: string): Promise<{ scenes: number; clips: number; images: number; google: number }> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");
  const assignmentPath = jobDataFile("visual-intelligence-final-assignment", jobId);
  const existing = (await readJson<{ scenes?: TimelineScene[] }>(assignmentPath)) || { scenes: [] };
  const scenes = existing.scenes || [];
  if (!scenes.length) throw new Error("No scenes to fill");

  const assets = await loadRoyalLibraryAssets();
  const clips = assets.filter(isClip).filter((asset) => (asset.duration || 0) >= 2.5);
  const images = assets.filter((asset) => asset.mediaType === "image");
  const uses = new Map<string, number[]>();
  const approved = new Map<string, ApprovedVisual>();
  let clipCount = 0;
  let imageCount = 0;
  let googleCount = 0;
  const recentPeople: string[] = [];

  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    if (scene.selectedVisualId) {
      const prior = uses.get(scene.selectedVisualId) || [];
      prior.push(index);
      uses.set(scene.selectedVisualId, prior);
      if (scene.source === "raw_footage") clipCount += 1;
      continue;
    }
    const namedNow = royalPersonMentions(scene.narrationText).map((mention) => mention.person);
    const people = peopleForScene(scene.narrationText, recentPeople);
    for (const person of namedNow) {
      if (!recentPeople.includes(person)) recentPeople.push(person);
      else {
        recentPeople.splice(recentPeople.indexOf(person), 1);
        recentPeople.push(person);
      }
    }
    const words = tokens(scene.narrationText);
    const need = Math.max(1, scene.duration || 4);
    const progress = (index + 1) / scenes.length;
    const clipRatio = clipCount / Math.max(1, index);
    const wantClip = clipRatio < 0.75 || progress < 0.1;

    const clipPool = clips
      .filter((asset) => (asset.duration || 0) + 0.05 >= need && canUse(uses, asset.assetId, index))
      .map((asset) => ({ asset, score: scoreAsset(asset, people, words) + Math.min(2, (asset.duration || 0) / 10) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || (b.asset.duration || 0) - (a.asset.duration || 0));

    const imagePool = images
      .filter((asset) => {
        const prior = uses.get(asset.assetId) || [];
        return prior.length < 4 && (prior.length === 0 || index - prior[prior.length - 1] >= 8);
      })
      .map((asset) => ({ asset, score: scoreAsset(asset, people, words) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    let chosen = wantClip && clipPool[0] ? clipPool[0] : imagePool[0] && imagePool[0].score >= (clipPool[0]?.score || 0) ? imagePool[0] : clipPool[0] || imagePool[0];
    if (clipRatio < 0.6 && clipPool[0]) chosen = clipPool[0];
    if (clipRatio > 0.8 && imagePool[0]) chosen = imagePool[0];

    if (chosen) {
      const visual = libraryVisual(chosen.asset, scene);
      approved.set(visual.approvedVisualId, visual);
      scene.selectedVisualId = visual.approvedVisualId;
      scene.approvedVisualId = visual.approvedVisualId;
      scene.source = isClip(chosen.asset) ? "raw_footage" : "cached_approved";
      scene.rawFootageUsed = isClip(chosen.asset);
      scene.reasonSelected = `${chosen.asset.person}: ${chosen.asset.title || chosen.asset.description || "library match"}`;
      scene.confidence = Math.min(0.95, 0.45 + chosen.score / 20);
      scene.needsBetterVisual = chosen.score < 4;
      scene.matchType = chosen.score >= 8 ? "exact_match" : chosen.score >= 4 ? "strong_match" : "good_context";
      scene.warnings = [];
      const prior = uses.get(chosen.asset.assetId) || [];
      prior.push(index);
      uses.set(chosen.asset.assetId, prior);
      if (isClip(chosen.asset)) clipCount += 1;
      else imageCount += 1;
      continue;
    }

    const query = [...people.slice(0, 2), ...words.slice(0, 4)].join(" ") || scene.narrationText.slice(0, 80);
    try {
      const hits = await searchGoogleImages(`${query} royal`, 4);
      const hit = hits.find((item) => item.url);
      if (hit) {
        const id = `google-${scene.sceneId}`;
        const visual: ApprovedVisual = {
          approvedVisualId: id,
          source: "google_image",
          filePathOrUrl: hit.url,
          thumbnail: hit.thumbnail,
          matchedPeople: people,
          matchedCompanies: [],
          matchedPlaces: [],
          matchedEvents: [],
          matchedDocuments: [],
          matchedObjects: [],
          allowedBeatIds: [scene.beatId],
          bestUseCase: hit.title,
          confidenceScores: blankScores(),
          reuseLimit: 1,
          warnings: ["Google image fallback"],
          candidateId: id,
        };
        approved.set(id, visual);
        scene.selectedVisualId = id;
        scene.approvedVisualId = id;
        scene.source = "google_image";
        scene.rawFootageUsed = false;
        scene.reasonSelected = `Google image: ${hit.title}`;
        scene.confidence = 0.4;
        scene.needsBetterVisual = true;
        scene.matchType = "related_context";
        scene.warnings = ["Google image fallback"];
        googleCount += 1;
        imageCount += 1;
      }
    } catch (error) {
      console.warn(`[fill] google failed ${scene.sceneId}`, error instanceof Error ? error.message : error);
    }
  }

  await writeJson(assignmentPath, { ...existing, scenes });
  const royalPath = jobDataFile("royal-v2-final-assignment", jobId);
  const royal = await readJson<Record<string, unknown>>(royalPath);
  if (royal) await writeJson(royalPath, { ...royal, scenes });
  await writeJson(jobDataFile("visual-intelligence-approved-library", jobId), {
    jobId,
    approved: [...approved.values()],
    source: "Timed scene fill: library clips first, Google image fallback",
    createdAt: new Date().toISOString(),
  });
  job.updatedAt = new Date().toISOString();
  job.stats = {
    ...(job.stats || {}),
    finalScenes: scenes.length,
    approvedLibrarySize: approved.size,
    rawFootagePercent: Number(((clipCount / scenes.length) * 100).toFixed(1)),
  } as JobRecord["stats"];
  await saveJob(job);
  console.log(`[fill] ${jobId} scenes=${scenes.length} clips=${clipCount} images=${imageCount} google=${googleCount}`);
  return { scenes: scenes.length, clips: clipCount, images: imageCount, google: googleCount };
}

function libraryVisual(asset: LibraryAsset, scene: TimelineScene): ApprovedVisual {
  return {
    approvedVisualId: asset.assetId,
    source: isClip(asset) ? "raw_footage" : "cached_approved",
    filePathOrUrl: royalAssetUrl(asset),
    thumbnail: asset.thumbKey ? royalAssetUrl({ ...asset, r2Key: asset.thumbKey }) : undefined,
    matchedPeople: [asset.person],
    matchedCompanies: [],
    matchedPlaces: [],
    matchedEvents: [],
    matchedDocuments: [],
    matchedObjects: [],
    allowedBeatIds: [scene.beatId],
    bestUseCase: asset.title || asset.description || asset.person,
    confidenceScores: blankScores(),
    reuseLimit: 2,
    durationRecommendation: asset.duration,
    warnings: [],
    candidateId: asset.assetId,
    libraryAssetId: asset.assetId,
    mediaType: isClip(asset) ? "raw_footage" : "image",
  };
}
