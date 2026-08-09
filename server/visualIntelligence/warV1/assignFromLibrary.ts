/**
 * War v1: GPT scans R2 library first, assigns visuals, marks weak beats for Google.
 * Target 20–30% raw_footage by duration; rest images.
 */
import { chatJson } from "../../openaiClient.js";
import { jobDataFile, writeJson } from "../../storage.js";
import type { LibraryAsset } from "../../library/types.js";
import type {
  ApprovedVisual,
  CandidateJudgment,
  JobRecord,
  TitleLock,
  VisualBeat,
  VisualCandidate,
} from "../../../shared/visualIntelligence.js";
import {
  loadWarLibraryAssets,
  warAssetPreviewUrl,
  warAssetSearchText,
  warAssetUrl,
  WAR_RAW_TARGET,
  WAR_RAW_TARGET_MAX,
  WAR_RAW_TARGET_MIN,
} from "./library.js";

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "over",
  "under",
  "about",
  "after",
  "before",
  "while",
  "their",
  "there",
  "when",
  "what",
  "which",
  "were",
  "been",
  "have",
  "has",
  "had",
  "are",
  "was",
  "will",
  "just",
  "very",
  "more",
  "most",
  "than",
  "then",
  "also",
  "into",
  "onto",
  "only",
  "such",
  "some",
  "they",
  "them",
  "its",
  "his",
  "her",
  "our",
  "out",
  "not",
  "but",
  "can",
  "could",
  "would",
  "should",
  "being",
  "watch",
  "video",
  "footage",
]);

function tokens(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function beatNeedles(beat: VisualBeat): string[] {
  return [
    ...tokens(beat.narrationText),
    ...tokens(beat.viewerShouldSee || ""),
    ...(beat.mentionedPeople || []),
    ...(beat.mentionedPlaces || []),
    ...(beat.mentionedEvents || []),
    ...(beat.mentionedObjects || []),
    ...(beat.mentionedCompanies || []),
  ]
    .flatMap((x) => tokens(x))
    .filter(Boolean);
}

function scoreAsset(asset: LibraryAsset, needles: string[]): number {
  if (!needles.length) return 5;
  const hay = warAssetSearchText(asset);
  let hits = 0;
  for (const n of needles) {
    if (hay.includes(n)) hits += 1;
  }
  const base = Math.round((hits / Math.max(3, Math.min(needles.length, 12))) * 100);
  const rawBoost = asset.mediaType === "raw_footage" ? 6 : 0;
  const descBoost = (asset.description || "").toLowerCase().includes("use for") ? 4 : 0;
  return Math.min(100, base + rawBoost + descBoost);
}

type ShortlistItem = {
  assetId: string;
  mediaType: string;
  person: string;
  title: string;
  description: string;
  score: number;
};

type GptPick = {
  beatId: string;
  assetId: string | null;
  confidence: number;
  reason: string;
  useGoogle?: boolean;
};

function toCandidate(asset: LibraryAsset, beatIds: string[]): VisualCandidate {
  const isRaw = asset.mediaType === "raw_footage";
  return {
    candidateId: `war-lib-${asset.assetId}`,
    source: isRaw ? "raw_footage" : "cached_approved",
    urlOrPath: warAssetUrl(asset),
    thumbnail: warAssetPreviewUrl(asset),
    duration: asset.duration,
    title: asset.title || asset.person,
    snippet: (asset.description || "").slice(0, 280),
    sourcePageUrl: asset.sourceUrl,
    relatedEntities: [
      asset.person,
      ...(asset.categories || []).slice(0, 8),
    ].filter(Boolean) as string[],
    relatedBeatIds: beatIds,
    detectedVisualType: isRaw ? "video" : "image",
    metadata: {
      warLibrary: true,
      warGptPick: true,
      assetId: asset.assetId,
      qualityScore: 82,
      topics: asset.categories || [],
      person: asset.person,
      group: asset.group,
    },
  };
}

function toApproved(asset: LibraryAsset, beat: VisualBeat, reason: string): ApprovedVisual {
  const isRaw = asset.mediaType === "raw_footage";
  return {
    approvedVisualId: asset.assetId,
    source: isRaw ? "raw_footage" : "cached_approved",
    filePathOrUrl: warAssetUrl(asset),
    thumbnail: warAssetPreviewUrl(asset),
    matchedPeople: beat.mentionedPeople || [],
    matchedCompanies: beat.mentionedCompanies || [],
    matchedPlaces: beat.mentionedPlaces || [],
    matchedEvents: beat.mentionedEvents || [],
    matchedDocuments: beat.mentionedDocuments || [],
    matchedObjects: beat.mentionedObjects || [],
    matchedScriptSubjects: [asset.person, asset.category].filter(Boolean) as string[],
    allowedBeatIds: [beat.beatId],
    bestUseCase: reason || asset.description || `War library: ${asset.person}`,
    confidenceScores: {
      entityMatch: 78,
      sceneMatch: 80,
      topicRelevance: 82,
      eventPlaceYearRelevance: 75,
      visualQuality: 82,
      cropSafety16x9: 85,
      sourceReliability: 90,
      wrongEntityRisk: 18,
      watermarkTextRisk: 15,
      reusePotential: isRaw ? 55 : 35,
      visualEditorScore: 80,
      narrationMatchScore: 78,
    },
    reuseLimit: isRaw ? 3 : 2,
    cropInstructions: "center crop 16:9 when needed",
    durationRecommendation: isRaw
      ? Math.min(5, Math.max(2.5, asset.duration || 4))
      : 3.5,
    warnings: [],
    candidateId: `war-lib-${asset.assetId}`,
    mediaType: isRaw ? "raw_footage" : "image",
  };
}

function toJudgment(candidateId: string, reason: string): CandidateJudgment {
  return {
    candidateId,
    approved: true,
    matchedEntities: [],
    scores: {
      entityMatch: 78,
      sceneMatch: 80,
      topicRelevance: 82,
      eventPlaceYearRelevance: 75,
      visualQuality: 82,
      cropSafety16x9: 85,
      sourceReliability: 90,
      wrongEntityRisk: 18,
      watermarkTextRisk: 15,
      reusePotential: 40,
      visualEditorScore: 80,
      narrationMatchScore: 78,
    },
    reason: reason || "War library GPT pick",
    warnings: [],
  };
}

async function gptPickBatch(
  job: JobRecord,
  items: Array<{ beat: VisualBeat; shortlist: ShortlistItem[] }>
): Promise<GptPick[]> {
  if (!items.length) return [];
  const payload = items.map(({ beat, shortlist }) => ({
    beatId: beat.beatId,
    narration: (beat.narrationText || "").slice(0, 220),
    viewerShouldSee: (beat.viewerShouldSee || "").slice(0, 120),
    people: beat.mentionedPeople || [],
    places: beat.mentionedPlaces || [],
    events: beat.mentionedEvents || [],
    objects: beat.mentionedObjects || [],
    candidates: shortlist.map((s) => ({
      assetId: s.assetId,
      mediaType: s.mediaType,
      topic: s.person,
      title: s.title.slice(0, 80),
      description: s.description.slice(0, 160),
      score: s.score,
    })),
  }));

  try {
    const result = await chatJson<{ picks?: GptPick[] }>({
      system: `You are the picture editor for a fast-paced War documentary (~20–30% raw footage, rest stills).
For each beat, pick the BEST library asset OR set assetId=null and useGoogle=true if nothing fits.
Prefer archival/military/documentary look. Reject memes, games, cartoons, yellow map overlays, unrelated politics.
JSON only: {"picks":[{"beatId":"...","assetId":"..."|null,"confidence":0-100,"reason":"...","useGoogle":false}]}`,
      user: JSON.stringify({
        title: job.title,
        niche: "War v1",
        beats: payload,
      }),
      temperature: 0.2,
    });
    return Array.isArray(result?.picks) ? result.picks : [];
  } catch (err) {
    console.warn("[warV1] GPT library pick failed, using scores only", err);
    return items.map(({ beat, shortlist }) => ({
      beatId: beat.beatId,
      assetId: shortlist[0]?.score >= 28 ? shortlist[0].assetId : null,
      confidence: shortlist[0]?.score || 0,
      reason: "score fallback",
      useGoogle: !shortlist[0] || shortlist[0].score < 28,
    }));
  }
}

export type WarLibraryAssignResult = {
  approved: ApprovedVisual[];
  candidates: VisualCandidate[];
  judgments: CandidateJudgment[];
  weakBeatIds: string[];
  assignedBeatIds: string[];
  rawDurationSec: number;
  totalDurationSec: number;
  rawPercent: number;
  librarySize: number;
};

export async function assignWarBeatsFromLibrary(params: {
  job: JobRecord;
  beats: VisualBeat[];
  titleLock: TitleLock;
}): Promise<WarLibraryAssignResult> {
  const { job, beats } = params;
  const assets = await loadWarLibraryAssets();
  const byId = new Map(assets.map((a) => [a.assetId, a]));

  const shortlists = new Map<string, ShortlistItem[]>();
  for (const beat of beats) {
    const needles = beatNeedles(beat);
    const ranked = assets
      .map((asset) => ({
        asset,
        score: scoreAsset(asset, needles),
      }))
      .filter((x) => x.score >= 12)
      .sort((a, b) => b.score - a.score || a.asset.number - b.asset.number)
      .slice(0, 8)
      .map((x) => ({
        assetId: x.asset.assetId,
        mediaType: x.asset.mediaType,
        person: x.asset.person,
        title: x.asset.title || x.asset.person,
        description: (x.asset.description || "").slice(0, 200),
        score: x.score,
      }));
    shortlists.set(beat.beatId, ranked);
  }

  const BATCH = 10;
  const picks: GptPick[] = [];
  for (let i = 0; i < beats.length; i += BATCH) {
    const slice = beats.slice(i, i + BATCH).map((beat) => ({
      beat,
      shortlist: shortlists.get(beat.beatId) || [],
    }));
    picks.push(...(await gptPickBatch(job, slice)));
  }
  const pickByBeat = new Map(picks.map((p) => [p.beatId, p]));

  const used = new Map<string, number>();
  const approved: ApprovedVisual[] = [];
  const candidates: VisualCandidate[] = [];
  const judgments: CandidateJudgment[] = [];
  const weakBeatIds: string[] = [];
  const assignedBeatIds: string[] = [];
  let rawDurationSec = 0;
  const totalDurationSec = beats.reduce((n, b) => n + (b.duration || 0), 0) || 1;

  // First pass: GPT picks
  for (const beat of beats) {
    const pick = pickByBeat.get(beat.beatId);
    const wantGoogle = !pick?.assetId || pick.useGoogle || (pick.confidence || 0) < 45;
    let asset = pick?.assetId ? byId.get(pick.assetId) : undefined;

    // Soft raw quota: if behind on raw and a raw is in shortlist with decent score, prefer it
    const rawShare = rawDurationSec / totalDurationSec;
    if (asset && asset.mediaType !== "raw_footage" && rawShare < WAR_RAW_TARGET_MIN) {
      const rawAlt = (shortlists.get(beat.beatId) || [])
        .map((s) => byId.get(s.assetId))
        .find((a) => a && a.mediaType === "raw_footage" && (used.get(a.assetId) || 0) < 3);
      if (rawAlt && (pick?.confidence || 0) < 85) asset = rawAlt;
    }
    // If ahead of raw max, prefer image
    if (asset && asset.mediaType === "raw_footage" && rawShare > WAR_RAW_TARGET_MAX) {
      const imgAlt = (shortlists.get(beat.beatId) || [])
        .map((s) => byId.get(s.assetId))
        .find((a) => a && a.mediaType === "image" && (used.get(a.assetId) || 0) < 2);
      if (imgAlt) asset = imgAlt;
    }

    if (!asset || wantGoogle) {
      weakBeatIds.push(beat.beatId);
      continue;
    }

    const usage = used.get(asset.assetId) || 0;
    if (usage >= (asset.mediaType === "raw_footage" ? 3 : 2)) {
      weakBeatIds.push(beat.beatId);
      continue;
    }

    used.set(asset.assetId, usage + 1);
    assignedBeatIds.push(beat.beatId);
    const reason = pick?.reason || `Library match for ${asset.person}`;
    const cand = toCandidate(asset, [beat.beatId]);
    candidates.push(cand);
    judgments.push(toJudgment(cand.candidateId, reason));
    approved.push(toApproved(asset, beat, reason));
    if (asset.mediaType === "raw_footage") rawDurationSec += beat.duration || 3.5;
  }

  // Backfill raw toward 20% if short
  if (rawDurationSec / totalDurationSec < WAR_RAW_TARGET_MIN) {
    for (const beat of beats) {
      if (rawDurationSec / totalDurationSec >= WAR_RAW_TARGET) break;
      if (!assignedBeatIds.includes(beat.beatId)) continue;
      // already assigned — skip
    }
    for (const beat of beats) {
      if (rawDurationSec / totalDurationSec >= WAR_RAW_TARGET) break;
      if (assignedBeatIds.includes(beat.beatId)) continue;
      const rawAlt = (shortlists.get(beat.beatId) || [])
        .map((s) => byId.get(s.assetId))
        .find((a) => a && a.mediaType === "raw_footage" && (used.get(a.assetId) || 0) < 3);
      if (!rawAlt) continue;
      used.set(rawAlt.assetId, (used.get(rawAlt.assetId) || 0) + 1);
      assignedBeatIds.push(beat.beatId);
      const idx = weakBeatIds.indexOf(beat.beatId);
      if (idx >= 0) weakBeatIds.splice(idx, 1);
      const reason = `Raw backfill for ${rawAlt.person}`;
      const cand = toCandidate(rawAlt, [beat.beatId]);
      candidates.push(cand);
      judgments.push(toJudgment(cand.candidateId, reason));
      approved.push(toApproved(rawAlt, beat, reason));
      rawDurationSec += beat.duration || 3.5;
    }
  }

  const result: WarLibraryAssignResult = {
    approved,
    candidates,
    judgments,
    weakBeatIds: [...new Set(weakBeatIds)],
    assignedBeatIds: [...new Set(assignedBeatIds)],
    rawDurationSec,
    totalDurationSec,
    rawPercent: Number(((rawDurationSec / totalDurationSec) * 100).toFixed(1)),
    librarySize: assets.length,
  };

  await writeJson(jobDataFile("war-v1-library-assign", job.jobId), {
    jobId: job.jobId,
    at: new Date().toISOString(),
    ...result,
    approvedIds: approved.map((a) => a.approvedVisualId),
  });

  console.log(
    `[warV1] library-first assigned=${result.assignedBeatIds.length}/${beats.length} weak→google=${result.weakBeatIds.length} raw≈${result.rawPercent}% lib=${assets.length}`
  );
  return result;
}
