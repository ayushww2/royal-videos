/**
 * Royal v2 Visual Planner Brain
 * script sentence → implied meaning → visual plan → (later) asset search
 *
 * Carries narrative memory across long 20–30 min scripts so pronouns and
 * implied subjects ("she", "the response", "the moment") stay visually coherent.
 */
import {
  extractRoyalPeople,
  extractRoyalPlaces,
  classifyRoyalBeat,
  personIsVisualSubject,
  preferNonFaceVisual,
  royalPersonMentions,
  royalOnScreenLabels,
} from "./taxonomy.js";
import type {
  GlobalContextReport,
  JobRecord,
  RoyalBeatType,
  RoyalContextType,
  VisualBeat,
} from "../../../shared/visualIntelligence.js";

export type RoyalVisualType =
  | "exact_person"
  | "pair_or_conflict"
  | "group_or_family"
  | "exact_place"
  | "context_place"
  | "document_or_legal"
  | "emotional_reaction"
  | "transition_bridge"
  | "raw_motion"
  | "effect_moment";

export type NarrativeState = {
  activeMainPerson: string;
  activeSecondaryPeople: string[];
  lastMentionedPerson: string;
  lastMentionedPlace: string;
  comingNextPerson: string;
  comingNextPlace: string;
  currentConflict: string;
  currentEmotionalTone: string;
  paragraphSubject: string;
  visualAnchor: string;
  scenePurpose: string;
};

export type EntityMemorySection = {
  sectionId: string;
  mainPerson: string;
  secondaryPeople: string[];
  conflictPair: string[];
  place: string;
  tone: string;
  visualAnchor: string;
};

export type RoyalVisualPlanBeat = {
  beatId: string;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  visualType: RoyalVisualType;
  bestVisualSubject: string;
  backupVisualSubject: string;
  lookBackPerson: string;
  currentImpliedPerson: string;
  lookAheadPerson: string;
  shouldUseSplitScreen: boolean;
  shouldUseRawClip: boolean;
  shouldUseLowerThird: boolean;
  librarySearchQuery: string;
  visualInstructionInternal: string;
  publicOnScreenText: string;
  reason: string;
  narrativeState: NarrativeState;
  beatType: RoyalBeatType;
  mainPerson: string;
  secondaryPeople: string[];
  pairOrGroup: string[];
  specificPlace: string;
  contextType: RoyalContextType | string;
  emotionalTone: string;
  /** Pronoun/subject ambiguity — assignment should prefer context or flag review. */
  needsBetterVisual?: boolean;
  impliedConfidence?: "high" | "low" | "none";
};

const HIGH_CONFIDENCE_PRONOUN =
  /\b(she|her|hers|he|his|him)\b/i;

const WEAK_IMPLIED_PHRASES =
  /\b(they|them|their|the moment|the response|the room|the confrontation|the silence|the decision|what happened next|the tension|the argument|the feud|the fallout|that moment|that response)\b/i;

const CONFLICT_WORDS =
  /\b(yell|yelling|confront|confrontation|against|vs|versus|fought|fight|feud|clash|argue|argument|attack|deny|denied|reject|rejected)\b/i;

const RESPONSE_WORDS = /\b(response|reacted|reaction|replied|answered|silence changed)\b/i;

const PERSON_GENDER: Record<string, "m" | "f"> = {
  "King Charles": "m",
  "Prince William": "m",
  "Prince Harry": "m",
  "Prince George": "m",
  "Prince Louis": "m",
  "Prince Andrew": "m",
  "Timothy Laurence": "m",
  "Tom Parker Bowles": "m",
  "Queen Camilla": "f",
  "Catherine, Princess of Wales": "f",
  "Meghan, Duchess of Sussex": "f",
  "Princess Anne": "f",
  "Princess Diana": "f",
  "Princess Charlotte": "f",
  "Princess Beatrice": "f",
  "Princess Eugenie": "f",
  "Zara Tindall": "f",
  "Sophie, Duchess of Edinburgh": "f",
  "Sarah Ferguson": "f",
  "Laura Lopes": "f",
};

function pronounGender(text: string): "m" | "f" | null {
  const lower = text.toLowerCase();
  const female = /\b(she|her|hers)\b/.test(lower);
  const male = /\b(he|his|him)\b/.test(lower);
  if (female && !male) return "f";
  if (male && !female) return "m";
  return null;
}

function emptyState(): NarrativeState {
  return {
    activeMainPerson: "",
    activeSecondaryPeople: [],
    lastMentionedPerson: "",
    lastMentionedPlace: "",
    comingNextPerson: "",
    comingNextPlace: "",
    currentConflict: "",
    currentEmotionalTone: "neutral",
    paragraphSubject: "",
    visualAnchor: "",
    scenePurpose: "",
  };
}

function titleMainPerson(job: JobRecord, context: GlobalContextReport): string {
  const fromContext = royalPersonMentions(context.mainSubject || "")[0]?.person;
  const fromTitle = royalPersonMentions(job.title)[0]?.person;
  const person = fromContext || fromTitle || "";
  return person === "British Royal Family" ? "" : person;
}

function peopleInText(text: string): string[] {
  return extractRoyalPeople(text).filter((p) => p !== "British Royal Family");
}

function isGroupMention(text: string): boolean {
  return extractRoyalPeople(text).includes("British Royal Family");
}

function needsSplitScreen(text: string, people: string[], visualType: RoyalVisualType): boolean {
  if (visualType !== "pair_or_conflict") return false;
  if (people.length < 2) return false;
  return CONFLICT_WORDS.test(text) || /\b(together|between|both)\b/i.test(text);
}

function classifyVisualType(params: {
  text: string;
  people: string[];
  place?: string;
  contextType: RoyalContextType;
  emotionalTone: string;
  usePair: boolean;
  isGroup: boolean;
  /** Explicit named people only — not weak pronoun carry. */
  explicitPeople: string[];
  forceNonFace: boolean;
}): RoyalVisualType {
  const {
    text,
    people,
    place,
    contextType,
    emotionalTone,
    usePair,
    isGroup,
    explicitPeople,
    forceNonFace,
  } = params;

  // Institution / place / document without a face requirement.
  if (forceNonFace || (preferNonFaceVisual(text, contextType, place) && !personIsVisualSubject(text, explicitPeople))) {
    if (place && /\b(buckingham|windsor|kensington|balmoral|sandringham|abbey|chapel)\b/i.test(text)) {
      return "exact_place";
    }
    if (contextType === "court_legal" || contextType === "documents") return "document_or_legal";
    if (place || contextType === "palace_pressure") return "context_place";
    if (["media_reaction", "public_attention"].includes(contextType)) return "context_place";
    if (contextType === "arrivals" || contextType === "crowds") return "raw_motion";
    if (contextType === "formal") return "context_place";
  }

  if (isGroup) return "group_or_family";
  if (usePair && people.length >= 2) return "pair_or_conflict";
  if (people.length === 1 && personIsVisualSubject(text, explicitPeople.length ? explicitPeople : people)) {
    if (RESPONSE_WORDS.test(text) || emotionalTone !== "neutral") return "emotional_reaction";
    return "exact_person";
  }
  if (place && /\b(buckingham|windsor|kensington|balmoral|sandringham|abbey|chapel)\b/i.test(text)) {
    return "exact_place";
  }
  if (place || contextType === "palace_pressure") return "context_place";
  if (contextType === "court_legal" || contextType === "documents") return "document_or_legal";
  if (contextType === "arrivals" || contextType === "crowds") return "raw_motion";
  if (emotionalTone !== "neutral") return "emotional_reaction";
  return "transition_bridge";
}

function decideOneVsTwo(params: {
  text: string;
  people: string[];
  titlePerson: string;
  activePerson: string;
}): { usePair: boolean; mainPerson: string; secondaryPeople: string[] } {
  const { text, people, titlePerson, activePerson } = params;
  if (people.length >= 2) {
    const conflict = CONFLICT_WORDS.test(text);
    const interaction = /\b(with|and|to|at|against|between)\b/i.test(text);
    // Emotional subject alone: "Catherine's response was powerful"
    if (RESPONSE_WORDS.test(text) && !conflict) {
      const subject =
        people.find((p) => RESPONSE_WORDS.test(text) && text.toLowerCase().includes(p.split(",")[0].toLowerCase().split(" ").pop() || "")) ||
        people[0];
      // Prefer named reaction subject
      const reactionOwner =
        people.find((p) => new RegExp(`${p.split(" ").pop()}['’]s\\s+response`, "i").test(text)) ||
        (titlePerson && people.includes(titlePerson) ? titlePerson : people[0]);
      return { usePair: false, mainPerson: reactionOwner || subject, secondaryPeople: [] };
    }
    if (conflict || interaction) {
      return {
        usePair: true,
        mainPerson: people[0],
        secondaryPeople: people.slice(1),
      };
    }
    // Background name + focus person: keep one
    return { usePair: false, mainPerson: people[0], secondaryPeople: people.slice(1) };
  }
  if (people.length === 1) {
    return { usePair: false, mainPerson: people[0], secondaryPeople: [] };
  }
  return {
    usePair: false,
    mainPerson: activePerson || titlePerson || "",
    secondaryPeople: [],
  };
}

export type ImpliedSubjectResult = {
  person: string;
  confidence: "high" | "low" | "none";
  /** When low/none and no safe face lock — prefer context over guessing a royal. */
  needsBetterVisual: boolean;
};

function resolveImpliedSubject(params: {
  text: string;
  explicitPeople: string[];
  state: NarrativeState;
  titlePerson: string;
  lookAheadPerson: string;
}): ImpliedSubjectResult {
  const { text, explicitPeople, state, lookAheadPerson } = params;
  if (explicitPeople[0]) {
    return { person: explicitPeople[0], confidence: "high", needsBetterVisual: false };
  }
  if (isGroupMention(text)) {
    return { person: "British Royal Family", confidence: "high", needsBetterVisual: false };
  }

  const lower = text.toLowerCase();
  const gender = pronounGender(text);
  const active = state.activeMainPerson;
  const activeGender = active ? PERSON_GENDER[active] : undefined;

  // High-confidence he/she only when gender matches the active subject.
  if (HIGH_CONFIDENCE_PRONOUN.test(text) && gender && active && activeGender === gender) {
    if (/\b(the response|her response|his response)\b/.test(lower)) {
      return { person: active, confidence: "high", needsBetterVisual: false };
    }
    return { person: active, confidence: "high", needsBetterVisual: false };
  }

  // Gendered pronoun that conflicts with active person — do not invent another royal.
  if (HIGH_CONFIDENCE_PRONOUN.test(text) && gender && active && activeGender && activeGender !== gender) {
    return { person: "", confidence: "none", needsBetterVisual: true };
  }

  // Weak they/them/the moment — keep memory for continuity but do not force a face.
  if (WEAK_IMPLIED_PHRASES.test(text)) {
    if (/\b(the confrontation|the tension|the feud|the argument)\b/.test(lower) && state.currentConflict) {
      return {
        person: state.currentConflict.split(" / ")[0] || active,
        confidence: "low",
        needsBetterVisual: false,
      };
    }
    return {
      person: active || state.lastMentionedPerson || "",
      confidence: "low",
      needsBetterVisual: !active && !state.lastMentionedPerson,
    };
  }

  // Transition cue into next named person (explicit ahead) — medium→high.
  if (!explicitPeople.length && lookAheadPerson && /\b(but|then|next|suddenly|meanwhile)\b/i.test(text)) {
    return { person: lookAheadPerson, confidence: "high", needsBetterVisual: false };
  }

  // No pronoun / no name: keep previous subject in memory only — do not guess title person as face.
  if (active) {
    return { person: active, confidence: "low", needsBetterVisual: false };
  }
  return { person: "", confidence: "none", needsBetterVisual: false };
}

function publicLabel(subject: string, place: string): string {
  if (subject && subject !== "British Royal Family") {
    const labels = royalOnScreenLabels(subject);
    return [labels.primary, labels.secondary].filter(Boolean).join(" · ");
  }
  if (subject === "British Royal Family") return "BRITISH ROYAL FAMILY";
  if (place) return royalOnScreenLabels(place).primary;
  return "";
}

function internalInstruction(plan: {
  visualType: RoyalVisualType;
  bestVisualSubject: string;
  pair: string[];
  place: string;
  tone: string;
}): string {
  if (plan.visualType === "pair_or_conflict" && plan.pair.length >= 2) {
    return `Backend: show ${plan.pair.join(" + ")} conflict/comparison (${plan.tone})`;
  }
  if (plan.bestVisualSubject) {
    return `Backend: show ${plan.bestVisualSubject} (${plan.tone}) for this narration beat`;
  }
  if (plan.place) return `Backend: show ${plan.place} context`;
  return "Backend: show relevant royal context";
}

function mapVisualTypeToBeatType(visualType: RoyalVisualType, place?: string): RoyalBeatType {
  switch (visualType) {
    case "exact_person":
    case "emotional_reaction":
      return "exact_person";
    case "pair_or_conflict":
    case "group_or_family":
      return "exact_pair_or_group";
    case "exact_place":
      return "exact_place";
    case "document_or_legal":
      return "document_or_legal";
    case "context_place":
      return place ? "media_or_palace_context" : "media_or_palace_context";
    case "raw_motion":
      return "media_or_palace_context";
    case "transition_bridge":
    case "effect_moment":
      return "generic_transition";
    default:
      return "generic_transition";
  }
}

/**
 * Build section-level entity memory from consecutive windows.
 */
export function buildEntityMemory(
  windows: string[],
  titlePerson: string
): EntityMemorySection[] {
  const sections: EntityMemorySection[] = [];
  let sectionStart = 0;
  let idx = 0;
  while (sectionStart < windows.length) {
    const end = Math.min(windows.length, sectionStart + 8);
    const chunk = windows.slice(sectionStart, end).join(" ");
    const people = peopleInText(chunk);
    const place = extractRoyalPlaces(chunk)[0] || "";
    const base = classifyRoyalBeat(chunk);
    const conflictPair =
      people.length >= 2 && CONFLICT_WORDS.test(chunk) ? people.slice(0, 2) : [];
    sections.push({
      sectionId: `section-${idx + 1}`,
      mainPerson: people[0] || titlePerson || "",
      secondaryPeople: people.slice(1),
      conflictPair,
      place,
      tone: base.emotionalTone,
      visualAnchor:
        conflictPair.length >= 2
          ? `${people[0]} witnessing/linked to ${conflictPair.join("-")} tension`
          : people[0] || place || "royal narrative continuity",
    });
    sectionStart = end;
    idx += 1;
  }
  return sections;
}

/**
 * Core planner: windows of narration → visual plans with narrative memory.
 */
export function planRoyalVisualBeats(params: {
  job: JobRecord;
  context: GlobalContextReport;
  windows: string[];
  durations: number[];
  /** When set (VO word-alignment), absolute times override duration-cursor stretch. */
  timings?: Array<{ startTime: number; endTime: number }>;
}): RoyalVisualPlanBeat[] {
  const { job, context, windows, durations, timings } = params;
  const titlePerson = titleMainPerson(job, context);
  const state = emptyState();
  if (titlePerson) {
    state.activeMainPerson = titlePerson;
    state.lastMentionedPerson = titlePerson;
    state.paragraphSubject = titlePerson;
    state.visualAnchor = titlePerson;
  }

  const explicitByIndex = windows.map((text) => peopleInText(text));
  const plans: RoyalVisualPlanBeat[] = [];
  let cursor = 0;

  for (let i = 0; i < windows.length; i++) {
    const text = windows[i];
    const aligned = timings?.[i];
    const duration = aligned
      ? Math.max(0.2, aligned.endTime - aligned.startTime)
      : durations[i] || 3;
    const startTime = aligned ? aligned.startTime : cursor;
    const endTime = aligned ? aligned.endTime : cursor + duration;
    cursor = endTime;

    const lookAheadPeople = [
      ...(explicitByIndex[i + 1] || []),
      ...(explicitByIndex[i + 2] || []),
    ];
    const lookAheadPerson = lookAheadPeople[0] || "";
    const lookAheadPlace = extractRoyalPlaces(windows[i + 1] || "")[0] || "";
    state.comingNextPerson = lookAheadPerson;
    state.comingNextPlace = lookAheadPlace;

    const base = classifyRoyalBeat(text);
    const explicit = explicitByIndex[i];
    const place = extractRoyalPlaces(text)[0] || "";
    const isGroup = isGroupMention(text);

    const oneVsTwo = decideOneVsTwo({
      text,
      people: explicit,
      titlePerson,
      activePerson: state.activeMainPerson,
    });

    const impliedResult = resolveImpliedSubject({
      text,
      explicitPeople: explicit,
      state,
      titlePerson,
      lookAheadPerson,
    });

    // Prefer decided main when explicit names are present.
    let implied = impliedResult.person;
    let impliedConfidence = impliedResult.confidence;
    let needsBetterVisual = impliedResult.needsBetterVisual;
    if (oneVsTwo.mainPerson && explicit.length) {
      implied = oneVsTwo.mainPerson;
      impliedConfidence = "high";
      needsBetterVisual = false;
    }

    const usePair = oneVsTwo.usePair && oneVsTwo.secondaryPeople.length >= 1;
    const pair = usePair
      ? [oneVsTwo.mainPerson, ...oneVsTwo.secondaryPeople].filter(Boolean)
      : isGroup
        ? ["British Royal Family"]
        : [];

    const forceNonFace =
      !explicit.length &&
      (preferNonFaceVisual(text, base.contextType, place) ||
        (impliedConfidence !== "high" && Boolean(place || ["court_legal", "documents", "media_reaction", "palace_pressure", "formal"].includes(base.contextType))));

    // Only lock a face when explicit or high-confidence pronoun; low-confidence stay contextual.
    const facePeople =
      usePair
        ? pair
        : impliedConfidence === "high" && implied
          ? [implied]
          : explicit.length
            ? explicit
            : [];

    const visualType = classifyVisualType({
      text,
      people: facePeople,
      place,
      contextType: base.contextType,
      emotionalTone: base.emotionalTone,
      usePair,
      isGroup,
      explicitPeople: explicit,
      forceNonFace,
    });

    // Context-only beats: palace / media without forcing a wrong person
    let bestVisualSubject = facePeople[0] || "";
    if (
      visualType === "exact_place" ||
      visualType === "context_place" ||
      visualType === "document_or_legal" ||
      visualType === "transition_bridge" ||
      visualType === "raw_motion"
    ) {
      bestVisualSubject =
        place ||
        (visualType === "document_or_legal" ? "Royal Courts of Justice" : "") ||
        (impliedConfidence === "high" ? implied : "");
    }
    if (visualType === "exact_person" || visualType === "emotional_reaction") {
      bestVisualSubject = impliedConfidence === "high" || explicit.length ? implied || facePeople[0] : "";
      if (!bestVisualSubject) {
        needsBetterVisual = true;
      }
    }
    if (visualType === "group_or_family") bestVisualSubject = "British Royal Family";

    // Transition into upcoming person
    if (
      visualType === "transition_bridge" &&
      !explicit.length &&
      lookAheadPerson &&
      /\b(but|then|next|suddenly)\b/i.test(text)
    ) {
      bestVisualSubject = lookAheadPerson;
    }

    const backupVisualSubject =
      (usePair ? oneVsTwo.secondaryPeople[0] : "") ||
      (impliedConfidence === "high" ? state.lastMentionedPerson : "") ||
      place ||
      "";

    const split = needsSplitScreen(text, pair, visualType);
    const beatType = mapVisualTypeToBeatType(visualType, place);
    const mainPerson =
      bestVisualSubject === "British Royal Family"
        ? ""
        : extractRoyalPlaces(bestVisualSubject)[0]
          ? ""
          : bestVisualSubject;

    // Update narrative memory — carry active person on high-confidence only;
    // low-confidence keeps previous subject without overwriting to a guess.
    if (mainPerson && (impliedConfidence === "high" || explicit.length)) {
      state.activeMainPerson = mainPerson;
      state.lastMentionedPerson = mainPerson;
      state.paragraphSubject = mainPerson;
    } else if (impliedConfidence === "low" && implied && !state.activeMainPerson) {
      state.activeMainPerson = implied;
      state.lastMentionedPerson = implied;
    }
    if (oneVsTwo.secondaryPeople.length) {
      state.activeSecondaryPeople = oneVsTwo.secondaryPeople;
    }
    if (usePair && pair.length >= 2) {
      state.currentConflict = `${pair[0]} / ${pair[1]}`;
    }
    if (place) state.lastMentionedPlace = place;
    state.currentEmotionalTone = base.emotionalTone;
    state.visualAnchor = bestVisualSubject || state.visualAnchor;
    state.scenePurpose = visualType;

    const publicOnScreenText = publicLabel(
      bestVisualSubject === place ? "" : bestVisualSubject,
      place
    );
    const visualInstructionInternal = internalInstruction({
      visualType,
      bestVisualSubject,
      pair,
      place,
      tone: base.emotionalTone,
    });

    const customHint = (job.customEditInstructions || "").trim().slice(0, 180);
    const librarySearchQuery = [
      bestVisualSubject,
      visualType === "pair_or_conflict" ? pair.join(" ") : "",
      base.emotionalTone !== "neutral" ? base.emotionalTone : "",
      place,
      visualType === "raw_motion" ? "arrival ceremony walking" : "",
      customHint ? `editor:${customHint}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    plans.push({
      beatId: `royal-v2-beat-${i + 1}`,
      text,
      startTime: Number(startTime.toFixed(3)),
      endTime: Number(endTime.toFixed(3)),
      duration: Number((endTime - startTime).toFixed(3)),
      visualType,
      bestVisualSubject,
      backupVisualSubject,
      lookBackPerson: state.lastMentionedPerson,
      currentImpliedPerson: implied,
      lookAheadPerson,
      shouldUseSplitScreen: split,
      shouldUseRawClip:
        visualType === "raw_motion" ||
        base.contextType === "arrivals" ||
        base.contextType === "crowds",
      shouldUseLowerThird: Boolean(mainPerson || place) && (i === 0 || Boolean(explicit[0])),
      librarySearchQuery,
      visualInstructionInternal: customHint
        ? `${visualInstructionInternal} | custom editor: ${customHint}`
        : visualInstructionInternal,
      publicOnScreenText,
      reason: `${visualType} ← ${
        explicit.length
          ? "named subject"
          : impliedConfidence === "high"
            ? "high-confidence pronoun"
            : impliedConfidence === "low"
              ? "low-confidence continuity (non-face preferred)"
              : "context"
      } (${base.emotionalTone})${customHint ? " · custom instructions applied" : ""}`,
      narrativeState: { ...state },
      beatType,
      mainPerson,
      secondaryPeople: usePair ? oneVsTwo.secondaryPeople : [],
      pairOrGroup: pair,
      specificPlace: place,
      contextType: base.contextType,
      emotionalTone: base.emotionalTone,
      needsBetterVisual,
      impliedConfidence,
    });
  }

  return plans;
}

/** Convert planner output into VisualBeat records for assignment. */
export function visualPlansToBeats(plans: RoyalVisualPlanBeat[]): VisualBeat[] {
  return plans.map((plan) => {
    const isGroup = plan.bestVisualSubject === "British Royal Family";
    const isPlace =
      Boolean(plan.specificPlace) &&
      (plan.visualType === "exact_place" || plan.bestVisualSubject === plan.specificPlace);
    const personLocked =
      (plan.visualType === "exact_person" ||
        plan.visualType === "pair_or_conflict" ||
        plan.visualType === "emotional_reaction") &&
      Boolean(plan.mainPerson);

    return {
      beatId: plan.beatId,
      startTime: plan.startTime,
      endTime: plan.endTime,
      duration: plan.duration,
      narrationText: plan.text,
      section: "royal-documentary",
      mentionedPeople: [
        ...new Set(
          [plan.mainPerson, ...plan.secondaryPeople, ...plan.pairOrGroup].filter(Boolean)
        ),
      ],
      mentionedCompanies: [],
      mentionedPlaces: plan.specificPlace ? [plan.specificPlace] : [],
      mentionedEvents: [],
      mentionedDocuments: plan.visualType === "document_or_legal" ? ["royal document"] : [],
      mentionedObjects: [],
      mentionedDates: [],
      // Keep viewerShouldSee as short public subject — never long "Show …" director text.
      visualIntent: plan.publicOnScreenText || plan.bestVisualSubject || "Royal context",
      idealVisualType: plan.shouldUseRawClip ? "raw clip" : "approved library image",
      fallbackVisualType: plan.backupVisualSubject || "approved royal context",
      importanceScore:
        plan.visualType === "pair_or_conflict" || plan.visualType === "exact_place"
          ? 90
          : plan.visualType === "exact_person" || plan.visualType === "emotional_reaction"
            ? 86
            : 70,
      mustMatchEntity: plan.mainPerson || plan.specificPlace || (isGroup ? "British Royal Family" : undefined),
      forbiddenVisuals: [
        "wrong royal person",
        "wrong royal place",
        "watermark",
        "tiktok",
        "pinterest",
        ...(personLocked ? [`not ${plan.mainPerson}`] : []),
      ],
      viewerShouldSee: plan.publicOnScreenText || plan.bestVisualSubject,
      exactSubject:
        plan.mainPerson ||
        (isGroup ? "British Royal Family" : "") ||
        (isPlace ? plan.specificPlace : "") ||
        undefined,
      visualRole:
        plan.visualType === "exact_person" ||
        plan.visualType === "pair_or_conflict" ||
        plan.visualType === "emotional_reaction"
          ? "main_subject"
          : plan.visualType === "exact_place"
            ? "evidence"
            : plan.visualType === "document_or_legal"
              ? "document"
              : "supporting_context",
      mustShow: plan.pairOrGroup.length
        ? plan.pairOrGroup
        : [plan.mainPerson || plan.specificPlace || ""].filter(Boolean),
      shouldAvoid: [
        "generic palace when exact person required",
        "repeated identical pose",
        "wrong royal identity for locked person",
      ],
      idealVisual: plan.visualInstructionInternal,
      fallbackVisual: plan.backupVisualSubject || "closest approved Royal Media Library context",
      searchPriority: plan.shouldUseSplitScreen ? 95 : 80,
      beatType: plan.beatType,
      mainPerson: plan.mainPerson,
      secondaryPeople: plan.secondaryPeople,
      pairOrGroup: plan.pairOrGroup,
      specificPlace: plan.specificPlace,
      contextType: plan.contextType,
      emotionalTone: plan.emotionalTone,
      // Backend-only instruction — effect planner must never put this on screen.
      visualNeed: plan.visualInstructionInternal,
    };
  });
}
