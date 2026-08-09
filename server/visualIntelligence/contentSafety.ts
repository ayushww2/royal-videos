/**
 * Shared content-safety gate for Celebrity / Mystery / Space / Royal web candidates.
 * Rejects vulgar gestures, explicit NSFW, meme shock bait, and known unsafe war/child imagery.
 */

export type ContentSafetyHit = {
  unsafe: boolean;
  reasons: string[];
};

const OFFENSIVE_GESTURE = [
  "middle finger",
  "middle fingers",
  "flipping off",
  "flipping the bird",
  "flip the bird",
  "giving the finger",
  "the finger",
  "one finger salute",
  "fuck you gesture",
  "rude gesture",
];

const NSFW_EXPLICIT = [
  "nsfw",
  "nude",
  "nudes",
  "naked child",
  "child nude",
  "child nudity",
  "porn",
  "xxx",
  "onlyfans",
  "sex tape",
  "explicit sex",
];

const MEME_VULGAR = [
  "kids flipping",
  "children flipping",
  "kids giving the finger",
  "children giving the finger",
  "kids middle finger",
  "children middle finger",
  "shock meme",
  "offensive meme",
  "vulgar meme",
  "she was disgusting",
];

/** Famous unsafe / trauma images that must never enter celebrity/doc pipelines. */
const KNOWN_UNSAFE_SLUGS = [
  "napalm girl",
  "terror of war",
  "nick ut",
  "phan thi kim phuc",
  "kim phuc",
  "ap7206080850",
  "alex-hurst-documentary-photographer-liverpool",
  "alex hurst documentary photographer liverpool",
  "looking-through-trash",
  "looking through trash",
  "she was disgusting",
];

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "at",
  "of",
  "to",
  "in",
  "on",
  "for",
  "and",
  "or",
  "but",
  "with",
  "from",
  "his",
  "her",
  "their",
  "this",
  "that",
  "there",
  "was",
  "were",
  "been",
  "being",
  "just",
  "because",
  "about",
]);

function haystack(parts: Array<string | undefined | null>): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_\-+]+/g, " ");
}

export function assessContentSafety(input: {
  title?: string;
  url?: string;
  pageUrl?: string;
  query?: string;
  description?: string;
}): ContentSafetyHit {
  const hay = haystack([
    input.title,
    input.url,
    input.pageUrl,
    input.query,
    input.description,
  ]);
  const reasons: string[] = [];

  if (OFFENSIVE_GESTURE.some((k) => hay.includes(k))) {
    reasons.push("offensive gesture (middle finger / flipping off)");
  }
  if (NSFW_EXPLICIT.some((k) => hay.includes(k))) {
    reasons.push("explicit NSFW / child nudity risk");
  }
  if (MEME_VULGAR.some((k) => hay.includes(k))) {
    reasons.push("meme vulgarity / kids flipping-off bait");
  }
  if (KNOWN_UNSAFE_SLUGS.some((k) => hay.includes(k))) {
    reasons.push("known unsafe / trauma / offensive source image");
  }

  // URL path heuristics for the Liverpool kids middle-finger archive photo.
  if (
    /britishculturearchive/i.test(hay) &&
    (/alex[- ]hurst/i.test(hay) || /liverpool/i.test(hay))
  ) {
    reasons.push("british culture archive vulgar kids photo");
  }

  return { unsafe: reasons.length > 0, reasons: [...new Set(reasons)] };
}

/** Meaningful name tokens for person-centric matching (drops stopwords / short crumbs). */
export function personNameTokens(name: string | undefined | null): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * True when caption/URL/OCR-ish text appears to name the person.
 * Used to down-rank Google "exact match" when the subject name is absent.
 */
export function textMentionsPerson(
  personName: string | undefined | null,
  parts: Array<string | undefined | null>
): boolean {
  const tokens = personNameTokens(personName);
  if (!tokens.length) return true;
  const hay = haystack(parts);
  if (!hay.trim()) return false;
  // Require last name (usually last token) OR at least 2 name tokens.
  const last = tokens[tokens.length - 1];
  if (last && hay.includes(last)) return true;
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits >= Math.min(2, tokens.length);
}

export function isStopwordSubject(subject: string | undefined | null): boolean {
  const s = (subject || "").trim().toLowerCase();
  if (!s) return true;
  if (STOPWORDS.has(s)) return true;
  const words = s.split(/\s+/).filter(Boolean);
  return words.length === 1 && (STOPWORDS.has(words[0]) || words[0].length <= 2);
}
