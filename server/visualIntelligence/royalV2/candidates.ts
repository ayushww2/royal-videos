import { jobDataFile, writeJson } from "../../storage.js";
import type { LibraryAsset } from "../../library/types.js";
import type {
  ApprovedVisual,
  RoyalCandidateScores,
  VisualBeat,
} from "../../../shared/visualIntelligence.js";
import { loadRoyalLibraryAssets, royalAssetUrl } from "./library.js";
import {
  canonicalRoyalPerson,
  canonicalRoyalPlace,
  extractRoyalPeople,
  extractRoyalPlaces,
} from "./taxonomy.js";
import { lockedPeopleForBeat, supportsPersonLock, violatesHardIdentity } from "./selectionRules.js";

export interface ScoredRoyalAsset {
  asset: LibraryAsset;
  scores: RoyalCandidateScores;
  exactPerson: boolean;
  exactPair: boolean;
  exactPlace: boolean;
  isContext: boolean;
  fingerprint: string;
}

interface RoyalAssetMetadata {
  text: string;
  primaryPerson?: string;
  people: string[];
  places: string[];
  cropSafety: number;
  qualityScore: number;
  fingerprint: string;
}

const assetMetadataCache = new Map<string, RoyalAssetMetadata>();

function norm(input: unknown): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assetText(asset: LibraryAsset): string {
  return [
    asset.person,
    asset.group,
    asset.category,
    ...(asset.categories || []),
    asset.title,
    asset.description,
    asset.queryUsed,
  ]
    .filter(Boolean)
    .join(" ");
}

export function royalAssetFingerprint(asset: LibraryAsset): string {
  const source = norm(asset.sourcePageUrl || asset.sourceUrl || "");
  if (source) return `source:${source}`;
  const descriptive = norm(`${asset.person}|${asset.title || ""}|${asset.description || ""}`);
  return descriptive ? `description:${descriptive}` : `asset:${asset.assetId}`;
}

function metadataFor(asset: LibraryAsset): RoyalAssetMetadata {
  const cached = assetMetadataCache.get(asset.assetId);
  if (cached) return cached;
  const rawText = assetText(asset);
  const width = asset.width || 0;
  const height = asset.height || 0;
  const metadata: RoyalAssetMetadata = {
    text: norm(rawText),
    primaryPerson: canonicalRoyalPerson(asset.person),
    people: [
      ...new Set(
        [...extractRoyalPeople(rawText), canonicalRoyalPerson(asset.person)].filter(
          (value): value is string => Boolean(value)
        )
      ),
    ],
    places: [
      ...new Set(
        [...extractRoyalPlaces(rawText), canonicalRoyalPlace(asset.person)].filter(
          (value): value is string => Boolean(value)
        )
      ),
    ],
    cropSafety: width && height ? (width / height >= 1.25 ? 95 : width / height >= 1 ? 72 : 35) : 80,
    qualityScore: width && height ? Math.min(100, Math.round(Math.sqrt(width * height) / 14)) : 78,
    fingerprint: royalAssetFingerprint(asset),
  };
  assetMetadataCache.set(asset.assetId, metadata);
  return metadata;
}

function overlapScore(needles: string[], haystack: string): number {
  const terms = needles
    .flatMap((value) => norm(value).split(" "))
    .filter((value) => value.length > 2);
  if (!terms.length) return 0;
  const matched = terms.filter((term) => haystack.includes(term)).length;
  return Math.round((matched / terms.length) * 100);
}

const SEMANTIC_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "already",
  "because",
  "been",
  "before",
  "being",
  "could",
  "does",
  "from",
  "have",
  "into",
  "made",
  "most",
  "need",
  "never",
  "only",
  "over",
  "people",
  "show",
  "that",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "through",
  "together",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
]);

function semanticTerms(input: string): string[] {
  return [
    ...new Set(
      norm(input)
        .split(" ")
        .filter((term) => term.length > 3 && !SEMANTIC_STOP_WORDS.has(term))
    ),
  ];
}

function semanticMatch(terms: string[], haystack: string): number {
  const matched = terms.filter((term) => haystack.includes(term)).length;
  return Math.min(100, matched * 22);
}

const CONTEXT_ASSET_TERMS: Record<string, string[]> = {
  palace_pressure: ["palace", "royal household", "corridor", "closed door"],
  media_reaction: ["press", "media", "camera", "journalist", "newspaper", "headline"],
  public_attention: ["crowd", "public", "barrier", "onlooker", "spectator"],
  court_legal: ["court", "legal", "judge", "hearing", "document", "justice"],
  family_crisis: ["family", "serious", "tension", "private"],
  private_meeting: ["meeting", "private", "palace", "arrival"],
  crowds: ["crowd", "mourners", "well wishers", "public"],
  arrivals: ["arrival", "car", "motorcade", "vehicle"],
  security: ["security", "police", "barrier", "gate"],
  documents: ["document", "letter", "statement", "record", "sealed"],
  church: ["church", "chapel", "abbey", "service"],
  mourning: ["mourning", "flowers", "tribute", "memorial", "grief"],
  formal: ["formal", "court", "ceremony", "reception", "engagement", "banquet"],
  transition: [],
};

export function scoreRoyalAsset(
  asset: LibraryAsset,
  beat: VisualBeat,
  usageCount = 0,
  usedInCurrentMinute = false
): ScoredRoyalAsset {
  const metadata = metadataFor(asset);
  const text = metadata.text;
  const assetPeople = metadata.people;
  const assetPlaces = metadata.places;
  const requestedPair =
    beat.beatType === "exact_pair_or_group"
      ? (beat.pairOrGroup || []).filter((value): value is string => Boolean(value))
      : [];
  const requiredPeople = (
    requestedPair.length
      ? requestedPair
      : [beat.mainPerson || beat.mentionedPeople?.[0]].filter(Boolean)
  ) as string[];
  const requiredPlace = beat.specificPlace || beat.mentionedPlaces?.[0] || "";

  const exactPeopleCount = requiredPeople.filter((person) => assetPeople.includes(person)).length;
  const locked = lockedPeopleForBeat(beat);
  const identityOk = !locked.length || supportsPersonLock(asset, locked);
  const exactPerson =
    identityOk &&
    requiredPeople.length === 1 &&
    (metadata.primaryPerson === requiredPeople[0] ||
      (!metadata.primaryPerson && exactPeopleCount === 1 && assetPeople.includes(requiredPeople[0])));
  const exactPair =
    identityOk &&
    ((requiredPeople.length >= 2 && exactPeopleCount >= requiredPeople.length) ||
      (requiredPeople.includes("British Royal Family") && exactPeopleCount >= 1));
  const exactPlace = Boolean(
    requiredPlace &&
      assetPlaces.some((place) => place === requiredPlace) &&
      canonicalRoyalPlace(requiredPlace)
  );
  const contextTerms = [
    beat.contextType || "",
    beat.emotionalTone || "",
    beat.visualNeed || "",
    beat.visualIntent || "",
  ];
  const group = norm(asset.group);
  const isGeneralContextAsset =
    group.includes("general context") ||
    group.includes("formal court") ||
    group.includes("extra formal");
  const narrationTerms = semanticTerms(
    `${beat.narrationText || ""} ${beat.visualNeed || ""} ${beat.emotionalTone || ""}`
  );
  const contextSpecificMatch = semanticMatch(
    CONTEXT_ASSET_TERMS[beat.contextType || "transition"] || [],
    text
  );
  const contextMatch = Math.max(
    overlapScore(contextTerms, text),
    semanticMatch(narrationTerms, text),
    contextSpecificMatch,
    isGeneralContextAsset ? (beat.contextType === "formal" ? 58 : 35) : 0
  );
  const toneMatch = overlapScore([beat.emotionalTone || ""], text);
  const cropSafety = metadata.cropSafety;
  const qualityScore = metadata.qualityScore;
  const entityMatch =
    requiredPeople.length === 0 ? 55 : exactPair ? 100 : exactPerson ? 100 : exactPeopleCount ? 75 : 0;
  const pairMatch = requiredPeople.length < 2 ? 0 : exactPair ? 100 : exactPeopleCount === 1 ? 45 : 0;
  const placeMatch = !requiredPlace ? 50 : exactPlace ? 100 : overlapScore([requiredPlace], text);
  const identityConfidence = exactPair || exactPerson ? 100 : exactPeopleCount ? 78 : requiredPeople.length ? 10 : 60;
  const rawSuitability =
    asset.mediaType === "raw_footage"
      ? Math.min(100, 72 + (contextMatch > 40 ? 15 : 0) + (asset.duration && asset.duration >= 2 ? 8 : 0))
      : 45;
  const repetitionRisk = usedInCurrentMinute ? 100 : usageCount >= 2 ? 100 : usageCount * 55;
  const freshnessScore = Math.max(0, 100 - usageCount * 70);

  // Description/title match is primary for library pick (not vibe-only scores).
  const descriptionHaystack = norm(
    `${asset.description || ""} ${asset.title || ""} ${asset.category || ""} ${(asset.categories || []).join(" ")} ${asset.person || ""} ${asset.group || ""}`
  );
  const planQuery = semanticTerms(
    `${beat.visualNeed || ""} ${beat.exactSubject || beat.mustMatchEntity || ""} ${beat.mainPerson || ""} ${beat.narrationText || ""}`
  );
  const descriptionMatch = Math.max(
    semanticMatch(planQuery, descriptionHaystack),
    overlapScore(
      [beat.visualNeed || "", beat.exactSubject || "", beat.mustMatchEntity || "", beat.mainPerson || ""],
      descriptionHaystack
    )
  );

  let finalMatchScore =
    entityMatch * 0.22 +
    pairMatch * 0.11 +
    placeMatch * 0.16 +
    descriptionMatch * 0.18 +
    contextMatch * 0.08 +
    toneMatch * 0.04 +
    qualityScore * 0.07 +
    identityConfidence * 0.07 +
    cropSafety * 0.04 +
    rawSuitability * 0.03 -
    repetitionRisk * 0.18 +
    freshnessScore * 0.05;
  if (descriptionMatch >= 60) finalMatchScore += 8;

  // Strict library-first priority: exact approved image, exact raw, close library, context.
  if ((exactPair || exactPerson || exactPlace) && asset.mediaType === "image") finalMatchScore += 24;
  else if ((exactPair || exactPerson || exactPlace) && asset.mediaType === "raw_footage") finalMatchScore += 20;
  else if (contextMatch >= 55) finalMatchScore += 10;
  if (
    asset.mediaType === "raw_footage" &&
    !["exact_person", "exact_pair_or_group", "exact_place"].includes(beat.beatType || "")
  ) {
    finalMatchScore += 8;
  }

  const exactRequired =
    beat.beatType === "exact_person" ||
    beat.beatType === "exact_pair_or_group" ||
    beat.beatType === "exact_place";
  if (exactRequired && !exactPerson && !exactPair && !exactPlace) finalMatchScore -= 35;
  if (beat.beatType === "exact_pair_or_group" && !exactPair) finalMatchScore -= 20;
  // Hard identity: never reward person-B assets on person-A locks.
  if (violatesHardIdentity(asset, beat)) finalMatchScore -= 90;
  if (locked.length && !identityOk) finalMatchScore -= 50;
  if (asset.mediaType === "raw_footage" && beat.contextType && beat.contextType !== "transition") finalMatchScore += 5;
  if (!requiredPeople.length && !requiredPlace) {
    if (isGeneralContextAsset) finalMatchScore += 18;
    if (assetPeople.length) finalMatchScore -= contextMatch >= 65 ? 10 : 24;
    if (beat.contextType && beat.contextType !== "transition") {
      finalMatchScore += contextSpecificMatch * 0.16;
      if (isGeneralContextAsset && contextSpecificMatch === 0) finalMatchScore -= 18;
    }
  }

  const scores: RoyalCandidateScores = {
    entityMatch,
    pairMatch,
    placeMatch,
    contextMatch,
    toneMatch,
    qualityScore,
    identityConfidence,
    cropSafety,
    rawFootageSuitability: rawSuitability,
    repetitionRisk,
    freshnessScore,
    finalMatchScore: Math.max(0, Math.min(100, Math.round(finalMatchScore))),
  };
  const isContext = !exactPerson && !exactPair && !exactPlace && contextMatch >= 30;
  return {
    asset,
    scores,
    exactPerson,
    exactPair,
    exactPlace,
    isContext,
    fingerprint: metadata.fingerprint,
  };
}

export function rankRoyalAssets(
  assets: LibraryAsset[],
  beat: VisualBeat,
  usage: Map<string, number>,
  usedThisMinute: Set<string>
): ScoredRoyalAsset[] {
  return assets
    .filter((asset) => !violatesHardIdentity(asset, beat))
    .map((asset) =>
      scoreRoyalAsset(asset, beat, usage.get(asset.assetId) || 0, usedThisMinute.has(asset.assetId))
    )
    .filter((item) => item.scores.cropSafety >= 55)
    .sort((a, b) => b.scores.finalMatchScore - a.scores.finalMatchScore);
}

export function toApprovedRoyalVisual(item: ScoredRoyalAsset, allowedBeatIds: string[]): ApprovedVisual {
  const { asset, scores } = item;
  const people = extractRoyalPeople(assetText(asset));
  const places = extractRoyalPlaces(assetText(asset));
  return {
    approvedVisualId: asset.assetId,
    candidateId: asset.assetId,
    source: asset.mediaType === "raw_footage" ? "raw_footage" : "cached_approved",
    filePathOrUrl: royalAssetUrl(asset),
    thumbnail: asset.thumbKey ? royalAssetUrl({ ...asset, r2Key: asset.thumbKey }) : undefined,
    matchedPeople: people,
    matchedCompanies: [],
    matchedPlaces: places,
    matchedEvents: [],
    matchedDocuments: asset.category.toLowerCase().includes("document") ? ["royal document"] : [],
    matchedObjects: [],
    allowedBeatIds,
    bestUseCase: asset.description || asset.title || `${asset.person} ${asset.category}`,
    confidenceScores: {
      entityMatch: scores.entityMatch,
      sceneMatch: scores.finalMatchScore,
      topicRelevance: Math.max(scores.contextMatch, scores.entityMatch, scores.placeMatch),
      eventPlaceYearRelevance: scores.placeMatch,
      visualQuality: scores.qualityScore,
      cropSafety16x9: scores.cropSafety,
      sourceReliability: 100,
      wrongEntityRisk: Math.max(0, 100 - scores.identityConfidence),
      watermarkTextRisk: 0,
      reusePotential: scores.freshnessScore,
      visualEditorScore: scores.finalMatchScore,
      titleSupportScore: Math.max(scores.entityMatch, scores.placeMatch, scores.contextMatch),
      narrationMatchScore: scores.finalMatchScore,
      instantClarityScore: Math.max(scores.entityMatch, scores.placeMatch, scores.contextMatch),
      exactSubjectMatch: Math.max(scores.entityMatch, scores.pairMatch, scores.placeMatch),
      horizontalUsability: scores.cropSafety,
      documentaryUsefulness: scores.finalMatchScore,
      wrongContextRisk: Math.max(0, 100 - Math.max(scores.entityMatch, scores.placeMatch, scores.contextMatch)),
    },
    reuseLimit: 1,
    durationRecommendation: asset.duration ? Math.min(5, asset.duration) : 3.5,
    warnings: [],
    supportsTitle: item.exactPerson || item.exactPair || item.exactPlace,
    matchedScriptSubjects: [...people, ...places],
    visualEditorScore: scores.finalMatchScore,
    titleSupportScore: Math.max(scores.entityMatch, scores.placeMatch),
    narrationMatchScore: scores.finalMatchScore,
    instantClarityScore: Math.max(scores.entityMatch, scores.placeMatch, scores.contextMatch),
    horizontalUsability: scores.cropSafety,
    isTextHeavy: false,
    libraryAssetId: asset.assetId,
    libraryGroup: asset.group,
    libraryCategory: asset.category,
    mediaType: asset.mediaType,
    royalScores: scores,
  };
}

export async function collectRoyalV2CandidatePool(
  jobId: string,
  beats: VisualBeat[]
): Promise<{ assets: LibraryAsset[]; topByBeat: Map<string, ScoredRoyalAsset[]> }> {
  const assets = await loadRoyalLibraryAssets();
  const topByBeat = new Map<string, ScoredRoyalAsset[]>();
  const emptyUsage = new Map<string, number>();
  for (let index = 0; index < beats.length; index++) {
    const beat = beats[index];
    topByBeat.set(beat.beatId, rankRoyalAssets(assets, beat, emptyUsage, new Set()).slice(0, 12));
    if (index > 0 && index % 10 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  await writeJson(jobDataFile("royal-v2-candidate-library", jobId), {
    jobId,
    source: "r2:library/royal-family",
    totalAssets: assets.length,
    imageAssets: assets.filter((asset) => asset.mediaType === "image").length,
    rawAssets: assets.filter((asset) => asset.mediaType === "raw_footage").length,
    topCandidatesByBeat: Object.fromEntries(
      [...topByBeat].map(([beatId, items]) => [
        beatId,
        items.map((item) => ({
          assetId: item.asset.assetId,
          person: item.asset.person,
          group: item.asset.group,
          mediaType: item.asset.mediaType,
          category: item.asset.category,
          scores: item.scores,
          exactPerson: item.exactPerson,
          exactPair: item.exactPair,
          exactPlace: item.exactPlace,
        })),
      ])
    ),
    createdAt: new Date().toISOString(),
  });
  return { assets, topByBeat };
}

