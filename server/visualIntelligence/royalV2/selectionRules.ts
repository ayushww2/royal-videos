/**
 * Hard identity / selection rules for Royal v2 assignment.
 * Never assign an asset tagged as person B to a beat locked to person A.
 */
import type { LibraryAsset } from "../../library/types.js";
import type { VisualBeat } from "../../../shared/visualIntelligence.js";
import {
  canonicalRoyalPerson,
  extractRoyalPeople,
} from "./taxonomy.js";

export function lockedPeopleForBeat(beat: VisualBeat): string[] {
  const canon = (value?: string) => {
    const raw = String(value || "").trim();
    if (!raw || raw === "British Royal Family") return "";
    return canonicalRoyalPerson(raw) || raw;
  };

  if (beat.beatType === "exact_pair_or_group") {
    const pair = (beat.pairOrGroup || []).map(canon).filter(Boolean);
    if (pair.length) return [...new Set(pair)];
    const fallback = [beat.mainPerson, ...(beat.secondaryPeople || [])].map(canon).filter(Boolean);
    return [...new Set(fallback)];
  }

  if (beat.beatType !== "exact_person") return [];

  const people = [beat.mainPerson, beat.exactSubject, beat.mustMatchEntity]
    .map(canon)
    .filter(Boolean);
  return [...new Set(people)];
}

export function assetTaggedPeople(asset: LibraryAsset): string[] {
  const text = [
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
  const fromText = extractRoyalPeople(text);
  const primary = canonicalRoyalPerson(asset.person);
  return [...new Set([...fromText, primary].filter((p): p is string => Boolean(p)))];
}

export function assetPrimaryPerson(asset: LibraryAsset): string | undefined {
  return canonicalRoyalPerson(asset.person) || extractRoyalPeople(asset.person || "")[0];
}

/**
 * Description + tags must support the person lock.
 * Rejects Charles-tagged assets on Harry-locked beats (and vice versa).
 */
export function supportsPersonLock(asset: LibraryAsset, locked: string[]): boolean {
  if (!locked.length) return true;
  const primary = assetPrimaryPerson(asset);
  const tagged = assetTaggedPeople(asset);
  const lockSet = new Set(locked);

  if (primary && primary !== "British Royal Family" && !lockSet.has(primary)) {
    return false;
  }
  if (tagged.some((p) => lockSet.has(p))) return true;

  // No people tags — cannot support a person lock (place/context only).
  if (!tagged.length && !primary) return false;
  return false;
}

/** Hard reject: asset is clearly another royal than the lock. */
export function violatesHardIdentity(asset: LibraryAsset, beat: VisualBeat): boolean {
  const locked = lockedPeopleForBeat(beat);
  if (!locked.length) return false;
  return !supportsPersonLock(asset, locked);
}

export function pickReasonForMatch(params: {
  beat: VisualBeat;
  exactPerson: boolean;
  exactPair: boolean;
  exactPlace: boolean;
  isContext: boolean;
  score: number;
  compositePair?: boolean;
  identityRejected?: boolean;
}): string {
  const { beat, exactPerson, exactPair, exactPlace, isContext, score, compositePair } = params;
  if (compositePair) return `split-screen exact pair for ${(beat.pairOrGroup || []).join(" + ")}`;
  if (exactPerson) return `exact person lock (${beat.mainPerson}) score=${score}`;
  if (exactPair) return `exact pair lock score=${score}`;
  if (exactPlace) return `exact place lock (${beat.specificPlace}) score=${score}`;
  if (isContext) return `context/place match (${beat.contextType || beat.beatType}) score=${score}`;
  return `closest library match score=${score}`;
}

export function selectionIntentForBeat(beat: VisualBeat): string {
  const parts = [
    beat.beatType || "unknown",
    beat.mainPerson ? `person:${beat.mainPerson}` : "",
    (beat.pairOrGroup || []).length ? `pair:${(beat.pairOrGroup || []).join("+")}` : "",
    beat.specificPlace ? `place:${beat.specificPlace}` : "",
    beat.contextType ? `ctx:${beat.contextType}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}
