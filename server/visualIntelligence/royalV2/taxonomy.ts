import type { RoyalBeatType, RoyalContextType } from "../../../shared/visualIntelligence.js";

const PERSON_ALIASES: Record<string, string[]> = {
  "British Royal Family": ["british royal family", "royal family", "members of the royal family", "the royals"],
  "King Charles": ["king charles", "charles iii", "prince charles", "charles"],
  "Queen Camilla": ["queen camilla", "camilla parker bowles", "camilla"],
  "Prince William": ["prince william", "duke of cambridge", "william"],
  "Catherine, Princess of Wales": [
    "catherine princess of wales",
    "princess catherine",
    "kate middleton",
    "catherine",
    "kate",
  ],
  "Prince Harry": ["prince harry", "duke of sussex", "harry"],
  "Meghan, Duchess of Sussex": ["meghan markle", "duchess of sussex", "meghan"],
  "Princess Anne": ["princess anne", "princess royal", "anne"],
  "Princess Diana": ["princess diana", "diana spencer", "lady diana", "diana"],
  "Prince George": ["prince george"],
  "Princess Charlotte": ["princess charlotte"],
  "Prince Louis": ["prince louis"],
  "Prince Andrew": ["prince andrew", "duke of york", "andrew"],
  "Princess Beatrice": ["princess beatrice", "beatrice"],
  "Princess Eugenie": ["princess eugenie", "eugenie"],
  "Zara Tindall": ["zara tindall", "zara phillips", "zara"],
  "Sophie, Duchess of Edinburgh": ["duchess of edinburgh", "sophie rhys-jones", "sophie"],
  "Sarah Ferguson": ["sarah ferguson", "fergie"],
  "Timothy Laurence": ["timothy laurence", "tim laurence"],
  "Tom Parker Bowles": ["tom parker bowles"],
  "Laura Lopes": ["laura lopes"],
};

const PLACE_ALIASES: Record<string, string[]> = {
  "Buckingham Palace": ["buckingham palace"],
  "Windsor Castle": ["windsor castle"],
  "Kensington Palace": ["kensington palace"],
  "St George's Chapel": ["st george's chapel", "st georges chapel"],
  "Westminster Abbey": ["westminster abbey"],
  "Balmoral Castle": ["balmoral castle", "balmoral"],
  Sandringham: ["sandringham house", "sandringham"],
  "Clarence House": ["clarence house"],
  Highgrove: ["highgrove house", "highgrove"],
  "Royal Courts of Justice": ["royal courts of justice", "high court", "royal court"],
  "Parliament / Downing Street": [
    "houses of parliament",
    "westminster parliament",
    "downing street",
    "number 10",
    "parliament",
  ],
  "London streets": ["london street", "streets of london", "central london"],
};

const CONTEXT_RULES: Array<{ type: RoyalContextType; words: string[] }> = [
  { type: "media_reaction", words: ["press", "media", "headline", "newspaper", "camera", "journalist"] },
  {
    type: "palace_pressure",
    words: ["palace", "palace pressure", "palace aides", "royal statement", "royal household", "inside the palace"],
  },
  { type: "public_attention", words: ["public attention", "public reaction", "onlookers", "spectators"] },
  { type: "court_legal", words: ["court", "legal", "lawsuit", "judge", "hearing", "trial", "evidence"] },
  { type: "family_crisis", words: ["family crisis", "rift", "feud", "fallout", "tension", "conflict"] },
  { type: "private_meeting", words: ["private meeting", "behind closed doors", "private talks"] },
  { type: "crowds", words: ["crowd", "mourners", "well-wishers", "well wishers"] },
  { type: "arrivals", words: ["arrived", "arrival", "motorcade", "black car", "vehicle"] },
  { type: "security", words: ["security", "barrier", "police", "protection officer", "gates"] },
  { type: "documents", words: ["letter", "document", "statement", "report", "sealed", "records"] },
  { type: "church", words: ["church", "chapel", "abbey", "service", "funeral"] },
  { type: "mourning", words: ["mourning", "flowers", "tribute", "grief", "memorial"] },
  {
    type: "formal",
    words: [
      "ceremony",
      "banquet",
      "reception",
      "court dress",
      "formal",
      "rank",
      "protocol",
      "royal rules",
      "silent rules",
      "rules everyone",
      "duty",
    ],
  },
];

function normalized(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  const hay = ` ${normalized(text)} `;
  const needle = ` ${normalized(phrase)} `;
  return hay.includes(needle);
}

export function canonicalRoyalPerson(value: string): string | undefined {
  const exact = normalized(value);
  for (const [canonical, aliases] of Object.entries(PERSON_ALIASES)) {
    if (normalized(canonical) === exact || aliases.some((alias) => normalized(alias) === exact)) return canonical;
  }
  return undefined;
}

export function canonicalRoyalPlace(value: string): string | undefined {
  const exact = normalized(value);
  for (const [canonical, aliases] of Object.entries(PLACE_ALIASES)) {
    if (normalized(canonical) === exact || aliases.some((alias) => normalized(alias) === exact)) return canonical;
  }
  return undefined;
}

export function extractRoyalPeople(text: string): string[] {
  return royalPersonMentions(text).map((mention) => mention.person);
}

export function royalPersonMentions(text: string): Array<{
  person: string;
  index: number;
  matchedText: string;
}> {
  const lower = text.toLowerCase().replace(/[’]/g, "'");
  const found: Array<{ person: string; index: number; matchedText: string }> = [];
  for (const [canonical, aliases] of Object.entries(PERSON_ALIASES)) {
    let best: { index: number; matchedText: string } | undefined;
    for (const alias of [canonical, ...aliases].sort((a, b) => b.length - a.length)) {
      const needle = alias.toLowerCase().replace(/[’]/g, "'");
      let from = 0;
      while (from < lower.length) {
        const index = lower.indexOf(needle, from);
        if (index < 0) break;
        const before = lower[index - 1] || " ";
        const after = lower[index + needle.length] || " ";
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
          if (!best || index < best.index || (index === best.index && needle.length > best.matchedText.length)) {
            best = { index, matchedText: text.slice(index, index + needle.length) };
          }
          break;
        }
        from = index + needle.length;
      }
    }
    if (best) found.push({ person: canonical, ...best });
  }
  return found.sort((a, b) => a.index - b.index);
}

export function extractRoyalPlaces(text: string): string[] {
  const found: string[] = [];
  for (const [canonical, aliases] of Object.entries(PLACE_ALIASES)) {
    if (aliases.some((alias) => containsPhrase(text, alias))) found.push(canonical);
  }
  return [...new Set(found)];
}

export function detectRoyalContext(text: string): RoyalContextType {
  for (const rule of CONTEXT_RULES) {
    if (rule.words.some((word) => containsPhrase(text, word))) return rule.type;
  }
  return "transition";
}

/** Court / estate / press / document / palace / institution — may not need a face. */
const NON_FACE_CONTEXT_TYPES = new Set<RoyalContextType>([
  "court_legal",
  "documents",
  "media_reaction",
  "palace_pressure",
  "public_attention",
  "security",
  "formal",
]);

const FACE_ACTION =
  /\b(said|says|spoke|speaking|walked|arrived|arrival|smiled|cried|weep|reacted|responded|denied|claimed|appeared|looked|stood|sat|wore|left|entered|faced|told|asked|yelled|yell|confronted|fought|met|meets|greeted|waved|addressed|testified)\b/i;

const INSTITUTION_FOCUS =
  /\b(court|courts|estate|press|media|newspaper|headline|document|documents|letter|statement|record|records|palace|household|institution|protocol|hearing|trial|lawsuit|cameras?|journalists?|aides?|staff|lawyers?|solicitors?|inheritance|will|sealed)\b/i;

function personShortTokens(person: string): string[] {
  const aliases = PERSON_ALIASES[person] || [person];
  return [...new Set(aliases.map((a) => normalized(a)).filter((a) => a.length > 2))];
}

/**
 * True when a named person is the visual subject (face lock), not merely a
 * possessive / institutional reference ("Harry's lawyers", "Diana's estate").
 */
export function personIsVisualSubject(text: string, people: string[]): boolean {
  const named = people.filter((p) => p !== "British Royal Family");
  if (!named.length) return false;
  if (FACE_ACTION.test(text)) return true;

  const lower = normalized(text);
  let possessiveOnly = 0;
  for (const person of named) {
    const tokens = personShortTokens(person);
    const possessive = tokens.some((token) => {
      const re = new RegExp(
        `\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['']s\\s+(lawyers?|team|staff|aides?|statement|letter|case|estate|inheritance|documents?|records?|solicitors?)\\b`
      );
      return re.test(lower);
    });
    if (possessive) possessiveOnly += 1;
  }
  if (possessiveOnly === named.length && INSTITUTION_FOCUS.test(text)) return false;

  // Name early in the clause usually means subject.
  for (const person of named) {
    for (const token of personShortTokens(person)) {
      const idx = lower.indexOf(token);
      if (idx >= 0 && idx < Math.min(48, Math.floor(lower.length * 0.45))) return true;
    }
  }

  // Institution/place-led narration with a trailing name mention → prefer non-face.
  if (INSTITUTION_FOCUS.test(text) || NON_FACE_CONTEXT_TYPES.has(detectRoyalContext(text))) {
    return false;
  }
  return true;
}

/** Prefer place/document/press/context over forcing a face. */
export function preferNonFaceVisual(
  text: string,
  contextType: RoyalContextType,
  place?: string
): boolean {
  if (place && !FACE_ACTION.test(text)) return true;
  if (NON_FACE_CONTEXT_TYPES.has(contextType) && INSTITUTION_FOCUS.test(text) && !FACE_ACTION.test(text)) {
    return true;
  }
  return false;
}

export function classifyRoyalBeat(text: string): {
  beatType: RoyalBeatType;
  people: string[];
  place?: string;
  contextType: RoyalContextType;
  emotionalTone: string;
  importance: number;
} {
  const people = extractRoyalPeople(text);
  const namedPeople = people.filter((p) => p !== "British Royal Family");
  const hasGroup = people.includes("British Royal Family");
  const place = extractRoyalPlaces(text)[0];
  const contextType = detectRoyalContext(text);
  const lower = normalized(text);
  const emotionalTone = /\b(grief|mourning|tragic|death|died|tears|heartbreak)\b/.test(lower)
    ? "somber"
    : /\b(shock|shocking|crisis|scandal|anger|furious|yell|feud|tension|confront|fight)\b/.test(lower)
      ? "tense"
      : /\b(powerful|force|pressure|rank|history|silent|silence|serious)\b/.test(lower)
        ? "serious"
      : /\b(celebrat|wedding|jubilee|joy|smil)\b/.test(lower)
        ? "positive"
        : "neutral";

  // Priority: named person (as subject) → action → place → document → press → archive/context → symbolic.
  const faceSubject = personIsVisualSubject(text, namedPeople);
  const nonFace = preferNonFaceVisual(text, contextType, place) && !faceSubject;

  let beatType: RoyalBeatType;
  if (!nonFace && (hasGroup || (namedPeople.length >= 2 && faceSubject))) {
    beatType = "exact_pair_or_group";
  } else if (!nonFace && namedPeople.length >= 1 && faceSubject) {
    beatType = "exact_person";
  } else if (place) {
    beatType = "exact_place";
  } else if (contextType === "court_legal" || contextType === "documents") {
    beatType = "document_or_legal";
  } else if (contextType === "formal") {
    beatType = "formal_or_court_context";
  } else if (["media_reaction", "palace_pressure", "public_attention"].includes(contextType)) {
    beatType = "media_or_palace_context";
  } else if (emotionalTone !== "neutral" || ["family_crisis", "mourning"].includes(contextType)) {
    beatType = "emotional_context";
  } else {
    beatType = "generic_transition";
  }

  const importance =
    beatType === "exact_pair_or_group" || beatType === "exact_place"
      ? 90
      : beatType === "exact_person"
        ? 85
        : beatType === "document_or_legal"
          ? 78
          : emotionalTone !== "neutral"
            ? 74
            : 60;

  return { beatType, people, place, contextType, emotionalTone, importance };
}

export function royalEntityAliases(): { people: Record<string, string[]>; places: Record<string, string[]> } {
  return { people: PERSON_ALIASES, places: PLACE_ALIASES };
}

/** Short on-screen labels only — never director instructions. */
export function royalOnScreenLabels(entity?: string | null): {
  primary: string;
  secondary: string;
} {
  const raw = String(entity || "").trim();
  if (!raw) return { primary: "", secondary: "" };
  const person = canonicalRoyalPerson(raw) || canonicalRoyalPlace(raw) || raw;
  if (person.includes(",")) {
    const [name, role] = person.split(",").map((part) => part.trim());
    return {
      primary: name.replace(/\s+/g, " ").toUpperCase(),
      secondary: role.replace(/\s+/g, " ").toUpperCase(),
    };
  }
  return {
    primary: person.replace(/\s+/g, " ").toUpperCase(),
    secondary: "",
  };
}

export function isDirectorInstructionText(text?: string | null): boolean {
  const value = String(text || "").trim();
  if (!value) return false;
  return (
    /^(show|use|prefer|display|render|select|choose)\b/i.test(value) ||
    /\b(narration-matching|footage or imagery|visual instruction|royal v2|royal documentary)\b/i.test(
      value
    ) ||
    /\b(exact_person|exact_place|exact_pair|beatType|contextType)\b/i.test(value)
  );
}

