/**
 * Text extraction of roster people names from existing asset descriptions.
 * Used for Phase A safe text backfill of people[] only.
 */
import { ROYAL_PEOPLE } from "./describeRoyal.js";
import type { LibraryAsset, RoyalPeopleType } from "./types.js";

const ROSTER = new Set<string>(ROYAL_PEOPLE as unknown as string[]);

type NameAlias = { alias: string; canon: string };

/** Longest aliases first for greedy matching. */
const NAME_ALIASES: NameAlias[] = [
  { alias: "Sophie, Duchess of Edinburgh", canon: "Sophie Duchess of Edinburgh" },
  { alias: "Sophie Duchess of Edinburgh", canon: "Sophie Duchess of Edinburgh" },
  { alias: "Duchess of Edinburgh", canon: "Sophie Duchess of Edinburgh" },
  { alias: "Princess of Wales", canon: "Princess Catherine" },
  { alias: "Kate Middleton", canon: "Princess Catherine" },
  { alias: "Princess Catherine", canon: "Princess Catherine" },
  { alias: "Queen Camilla", canon: "Queen Camilla" },
  { alias: "King Charles III", canon: "King Charles" },
  { alias: "King Charles", canon: "King Charles" },
  { alias: "Prince William", canon: "Prince William" },
  { alias: "Prince Harry", canon: "Prince Harry" },
  { alias: "Meghan Markle", canon: "Meghan Markle" },
  { alias: "Princess Diana", canon: "Princess Diana" },
  { alias: "Princess Charlotte", canon: "Princess Charlotte" },
  { alias: "Prince George", canon: "Prince George" },
  { alias: "Prince Louis", canon: "Prince Louis" },
  { alias: "Princess Anne", canon: "Princess Anne" },
  { alias: "Sir Timothy Laurence", canon: "Sir Timothy Laurence" },
  { alias: "Timothy Laurence", canon: "Sir Timothy Laurence" },
  { alias: "Prince Edward", canon: "Prince Edward" },
  { alias: "Prince Andrew", canon: "Prince Andrew" },
  { alias: "Sarah Ferguson", canon: "Sarah Ferguson" },
  { alias: "Princess Beatrice", canon: "Princess Beatrice" },
  { alias: "Princess Eugenie", canon: "Princess Eugenie" },
  { alias: "Zara Tindall", canon: "Zara Tindall" },
  { alias: "Charles Spencer", canon: "Charles Spencer" },
  { alias: "Frances Shand Kydd", canon: "Frances Shand Kydd" },
  { alias: "Lady Sarah McCorquodale", canon: "Lady Sarah McCorquodale" },
  { alias: "Lady Jane Fellowes", canon: "Lady Jane Fellowes" },
  { alias: "Laura Lopes", canon: "Laura Lopes" },
  { alias: "Tom Parker Bowles", canon: "Tom Parker Bowles" },
  { alias: "Camilla", canon: "Queen Camilla" },
  { alias: "Catherine", canon: "Princess Catherine" },
  { alias: "William", canon: "Prince William" },
  { alias: "Harry", canon: "Prince Harry" },
  { alias: "Meghan", canon: "Meghan Markle" },
  { alias: "Diana", canon: "Princess Diana" },
  { alias: "Charlotte", canon: "Princess Charlotte" },
  { alias: "George", canon: "Prince George" },
  { alias: "Louis", canon: "Prince Louis" },
  { alias: "Beatrice", canon: "Princess Beatrice" },
  { alias: "Eugenie", canon: "Princess Eugenie" },
  { alias: "Zara", canon: "Zara Tindall" },
  { alias: "Andrew", canon: "Prince Andrew" },
].sort((a, b) => b.alias.length - a.alias.length);

export type PeopleBackfillTier = "safe_text" | "vision";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract roster people mentioned in description; primary always first when present. */
export function extractRosterPeopleFromDescription(description: string, primary: string): string[] {
  const text = String(description || "");
  const found: string[] = [];
  const seen = new Set<string>();

  for (const { alias, canon } of NAME_ALIASES) {
    if (!ROSTER.has(canon)) continue;
    if (new RegExp(`\\b${escapeRe(alias)}\\b`, "i").test(text) && !seen.has(canon)) {
      seen.add(canon);
      found.push(canon);
    }
  }

  const out: string[] = [];
  const primaryTrim = primary.trim();
  if (primaryTrim) {
    out.push(primaryTrim);
    seen.add(primaryTrim);
  }
  for (const name of found) {
    if (name !== primaryTrim && !out.includes(name)) out.push(name);
  }
  return out.length ? out : primaryTrim ? [primaryTrim] : [];
}

/** Whether asset already has people[] with folder person first. */
export function hasPeopleBackfill(asset: LibraryAsset): boolean {
  const primary = String(asset.person || "").trim();
  const people = asset.people || [];
  return people.length > 0 && people[0] === primary;
}

/** Classify which backfill path to use (Phase A text vs Phase B vision). */
export function peopleBackfillTier(asset: LibraryAsset): PeopleBackfillTier {
  const primary = String(asset.person || "").trim();
  const pt = (asset.peopleType || "solo") as RoyalPeopleType;
  const extracted = extractRosterPeopleFromDescription(asset.description || "", primary);

  if (pt === "solo") {
    if (extracted.length === 1 && extracted[0] === primary) return "safe_text";
    return "vision";
  }

  if (pt === "two_people") {
    if (extracted.length >= 2) return "safe_text";
    return "vision";
  }

  return "vision";
}

/** Safe text-only people[] for Phase A. Returns null if not safe. */
export function safeTextPeople(asset: LibraryAsset): string[] | null {
  if (peopleBackfillTier(asset) !== "safe_text") return null;
  const primary = String(asset.person || "").trim();
  const extracted = extractRosterPeopleFromDescription(asset.description || "", primary);
  if (peopleBackfillTier(asset) === "safe_text" && asset.peopleType === "two_people" && extracted.length < 2) {
    return null;
  }
  return extracted.length ? extracted : [primary];
}

export function normalizePeopleList(raw: unknown, primary: string): string[] {
  const primaryTrim = primary.trim();
  const fromRaw = Array.isArray(raw)
    ? raw.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const n = name.trim();
    if (!n || seen.has(n)) return;
    if (!ROSTER.has(n) && n !== primaryTrim) return;
    seen.add(n);
    out.push(n);
  };
  push(primaryTrim);
  for (const name of fromRaw) {
    if (name !== primaryTrim) push(name);
  }
  return out.length ? out : [primaryTrim];
}
