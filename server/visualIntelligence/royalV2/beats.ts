import { chatJson } from "../../openaiClient.js";
import { jobDataFile, writeJson } from "../../storage.js";
import { getJobTargetDurationSec, sampleBeatsForPrompt } from "../jobDuration.js";
import { skipGptExceptJudge } from "../pipelineMode.js";
import {
  alignedTimingsForBeats,
  ensureVoiceAlignment,
} from "../voiceAlignment.js";
import {
  classifyRoyalBeat,
  royalPersonMentions,
} from "./taxonomy.js";
import {
  buildEntityMemory,
  planRoyalVisualBeats,
  visualPlansToBeats,
} from "./visualPlanner.js";
import type {
  GlobalContextReport,
  JobRecord,
  RoyalBeatType,
  RoyalContextType,
  VisualBeat,
} from "../../../shared/visualIntelligence.js";
import { WORDS_PER_SECOND } from "../../../shared/visualIntelligence.js";

function splitMeaningWindows(script: string, count: number): string[] {
  const clean = script.replace(/\s+/g, " ").trim();
  if (!clean) return [""];
  const allWords = clean.split(/\s+/);
  const targetWords = Math.max(6, Math.min(11, Math.round(allWords.length / Math.max(1, count))));
  const maxWords = targetWords + 2;
  const sentences = clean.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [clean];
  const windows: string[] = [];

  const pushSized = (input: string) => {
    let words = input.trim().split(/\s+/).filter(Boolean);
    while (words.length > maxWords) {
      let end = targetWords;
      const minEnd = Math.max(4, targetWords - 4);
      const maxEnd = Math.min(words.length - 3, targetWords + 2);
      for (let index = maxEnd; index >= minEnd; index--) {
        if (/[,;:—–-]$/.test(words[index - 1] || "")) {
          end = index;
          break;
        }
      }
      windows.push(words.slice(0, end).join(" "));
      words = words.slice(end);
    }
    if (words.length) windows.push(words.join(" "));
  };

  for (const sentence of sentences) {
    const rawClauses = sentence
      .trim()
      .split(/(?<=[,;:—–])\s+|\s+(?=(?:but|however|because|while|so|then)\b)/i)
      .filter(Boolean);
    const clauses: string[] = [];
    let pending = "";
    for (const clause of rawClauses) {
      if (!pending) {
        pending = clause;
        continue;
      }
      const pendingWords = pending.split(/\s+/).length;
      const clauseWords = clause.split(/\s+/).length;
      const combinedWords = pendingWords + clauseWords;
      if ((pendingWords < 5 || clauseWords < 3) && combinedWords <= maxWords + 6) {
        pending = `${pending} ${clause}`;
      } else {
        clauses.push(pending);
        pending = clause;
      }
    }
    if (pending) clauses.push(pending);

    for (const clause of clauses) {
      const mentions = royalPersonMentions(clause);
      if (mentions.length >= 3 && mentions[1].index >= 3) {
        const lead = clause.slice(0, mentions[1].index).trim();
        const relationship = clause.slice(mentions[1].index).trim();
        if (lead.split(/\s+/).length >= 2) windows.push(lead);
        pushSized(relationship);
      } else {
        pushSized(clause);
      }
    }
  }
  return windows.filter((value) => value.trim());
}

function desiredDuration(text: string, beatType: RoyalBeatType, importance: number, index: number): number {
  const spokenDuration = text.trim().split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND;
  if (index < 2 || /\b(suddenly|but|revealed|shock|shocking|breaking|never|secret)\b/i.test(text)) {
    return Math.max(2.4, Math.min(3.4, spokenDuration));
  }
  if (
    beatType === "exact_person" ||
    beatType === "exact_pair_or_group" ||
    beatType === "exact_place" ||
    importance >= 85 ||
    /\b(died|death|wedding|funeral|coronation|verdict)\b/i.test(text)
  ) {
    // Keep named people on screen in the 3–4s documentary batch range.
    return Math.max(3, Math.min(4.2, Math.max(spokenDuration, 3)));
  }
  return Math.max(2.6, Math.min(4, spokenDuration));
}

const CONTEXT_VISUAL_NEEDS: Partial<Record<RoyalContextType, string>> = {
  palace_pressure: "palace interior or exterior pressure context",
  media_reaction: "press cameras or media reaction",
  public_attention: "crowds or public attention",
  court_legal: "court or legal document context",
  family_crisis: "serious royal family tension",
  private_meeting: "private palace meeting context",
  crowds: "royal crowds",
  arrivals: "royal arrival footage",
  security: "palace security or gates",
  documents: "royal statement or sealed document",
  church: "royal church or chapel",
  mourning: "mourning flowers or memorial",
  formal: "formal royal ceremony",
  transition: "narration-relevant royal context",
};

// retained for refineAmbiguousBeats / future GPT prompts
void CONTEXT_VISUAL_NEEDS;

function normalizeDurations(desired: number[], total: number): number[] {
  const values = desired.map((d) => Math.max(2, Math.min(5, d)));
  for (let pass = 0; pass < 20; pass++) {
    const sum = values.reduce((n, d) => n + d, 0);
    const delta = total - sum;
    if (Math.abs(delta) < 0.01) break;
    const adjustable = values
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => (delta > 0 ? value < 5 : value > 2));
    if (!adjustable.length) break;
    const each = delta / adjustable.length;
    for (const { index } of adjustable) values[index] = Math.max(2, Math.min(5, values[index] + each));
  }
  const sum = values.reduce((n, d) => n + d, 0);
  if (values.length) values[values.length - 1] += total - sum;
  return values;
}

async function refineAmbiguousBeats(
  job: JobRecord,
  context: GlobalContextReport,
  beats: VisualBeat[]
): Promise<number> {
  if (skipGptExceptJudge()) return 0;
  const ambiguous = beats.filter(
    (beat) =>
      beat.beatType === "generic_transition" &&
      beat.narrationText.split(/\s+/).length >= 8
  );
  if (!ambiguous.length) return 0;

  const sample = sampleBeatsForPrompt(ambiguous, 50);
  try {
    const result = await chatJson<{
      beats?: Array<{
        beatId: string;
        beatType: RoyalBeatType;
        contextType?: RoyalContextType;
        visualNeed?: string;
        emotionalTone?: string;
        importance?: number;
      }>;
    }>({
      system: `You classify ambiguous Royal documentary visual beats by meaning.
Use only these beatType values: exact_person, exact_pair_or_group, exact_place,
document_or_legal, media_or_palace_context, emotional_context,
formal_or_court_context, generic_transition.
Do not invent named people or places. Return JSON { beats: [...] }.`,
      user: JSON.stringify({
        title: job.title,
        story: {
          mainSubject: context.mainSubject,
          secondarySubjects: context.secondarySubjects,
          emotionalTone: context.emotionalTone,
        },
        beats: sample.map((beat) => ({
          beatId: beat.beatId,
          text: beat.narrationText,
          currentContext: beat.contextType,
        })),
      }),
    });
    const updates = new Map((result.beats || []).map((item) => [item.beatId, item]));
    for (const beat of beats) {
      const update = updates.get(beat.beatId);
      if (!update) continue;
      beat.beatType = update.beatType || beat.beatType;
      beat.contextType = update.contextType || beat.contextType;
      beat.visualNeed = update.visualNeed || beat.visualNeed;
      beat.emotionalTone = update.emotionalTone || beat.emotionalTone;
      beat.importanceScore = Math.max(0, Math.min(100, update.importance ?? beat.importanceScore));
    }
    return 1;
  } catch (error) {
    console.warn(`[royal-v2] ambiguous beat refinement failed ${job.jobId}:`, error);
    return 0;
  }
}

/**
 * ContactBox AI pass: decide who/what to show per beat using royal narration rules.
 * Batched for ~3s cadence (~400 beats on a 20+ min VO).
 */
async function refineBeatsWithAiPlan(
  job: JobRecord,
  context: GlobalContextReport,
  beats: VisualBeat[]
): Promise<number> {
  if (skipGptExceptJudge()) return 0;
  const batchSize = 36;
  let gptCalls = 0;
  let activePerson = context.mainSubject || "";
  for (let offset = 0; offset < beats.length; offset += batchSize) {
    const batch = beats.slice(offset, offset + batchSize);
    try {
      const result = await chatJson<{
        beats?: Array<{
          beatId: string;
          mainPerson?: string;
          secondaryPeople?: string[];
          pairOrGroup?: string[];
          specificPlace?: string;
          beatType?: RoyalBeatType;
          contextType?: RoyalContextType;
          visualNeed?: string;
          exactSubject?: string;
          shouldUseRawClip?: boolean;
          reason?: string;
        }>;
      }>({
        system: `You are the Royal documentary visual planner. For each narration beat, decide what to SHOW.
Rules (strict):
1) Follow the narration subject in THIS beat (and continuity pronouns from prior active person).
2) Priority: named person → action/event → place → document/legal → date → newspaper/press → archive → symbolic LAST.
3) When narration is about court / estate / press / document / palace / institution WITHOUT requiring a face, use place/document/press/context — do NOT force a person close-up.
4) Keep person lock only when a named or high-confidence implied person is the subject.
5) Diana / William / Harry / inheritance / palace / press / court: show the named person or exact context — never random royalty.
6) Prefer continuity of the active subject; do not invent people not in the story.
7) exactSubject = the on-screen entity that must match the library description.
Return JSON { beats: [{ beatId, mainPerson, secondaryPeople, pairOrGroup, specificPlace, beatType, contextType, visualNeed, exactSubject, shouldUseRawClip, reason }] }.
beatType must be one of: exact_person, exact_pair_or_group, exact_place, document_or_legal, media_or_palace_context, emotional_context, formal_or_court_context, generic_transition.`,
        user: JSON.stringify({
          title: job.title,
          story: {
            mainSubject: context.mainSubject,
            secondarySubjects: context.secondarySubjects,
            emotionalTone: context.emotionalTone,
          },
          previousActivePerson: activePerson,
          beats: batch.map((b) => ({
            beatId: b.beatId,
            text: b.narrationText,
            localPlan: {
              mainPerson: b.mainPerson,
              beatType: b.beatType,
              place: b.specificPlace,
              visualNeed: b.visualNeed,
            },
          })),
        }),
      });
      gptCalls += 1;
      const updates = new Map((result.beats || []).map((row) => [row.beatId, row]));
      for (const beat of batch) {
        const update = updates.get(beat.beatId);
        if (!update) continue;
        if (update.mainPerson) beat.mainPerson = update.mainPerson;
        if (update.secondaryPeople) beat.secondaryPeople = update.secondaryPeople;
        if (update.pairOrGroup) beat.pairOrGroup = update.pairOrGroup;
        if (update.specificPlace) beat.specificPlace = update.specificPlace;
        if (update.beatType) beat.beatType = update.beatType;
        if (update.contextType) beat.contextType = update.contextType;
        if (update.visualNeed) beat.visualNeed = update.visualNeed;
        // Non-face intents: do not keep a stale person lock from the local plan.
        const nonFaceTypes = new Set([
          "exact_place",
          "document_or_legal",
          "media_or_palace_context",
          "formal_or_court_context",
          "generic_transition",
          "emotional_context",
        ]);
        if (update.beatType && nonFaceTypes.has(update.beatType) && !update.mainPerson) {
          beat.mainPerson = undefined;
          beat.secondaryPeople = [];
          beat.pairOrGroup = [];
          if (update.specificPlace || beat.specificPlace) {
            beat.exactSubject = update.specificPlace || beat.specificPlace;
            beat.mustMatchEntity = beat.exactSubject;
          }
        } else if (update.exactSubject) {
          beat.exactSubject = update.exactSubject;
          beat.mustMatchEntity = update.exactSubject;
        } else if (update.mainPerson) {
          beat.exactSubject = update.mainPerson;
          beat.mustMatchEntity = update.mainPerson;
        }
        if (beat.mainPerson) activePerson = beat.mainPerson;
      }
    } catch (error) {
      console.warn(
        `[royal-v2] AI visual plan batch failed @${offset} ${job.jobId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  return gptCalls;
}

export async function createRoyalV2Beats(
  job: JobRecord,
  context: GlobalContextReport
): Promise<{ beats: VisualBeat[]; gptCallsUsed: number }> {
  const targetDuration = getJobTargetDurationSec(job);
  // ~3s visual change cadence for documentary pacing (~440 beats on a 22 min VO).
  const targetCount = Math.max(1, Math.round(targetDuration / 3));
  const windows = splitMeaningWindows(job.script, targetCount);
  const titlePerson =
    royalPersonMentions(context.mainSubject || "")[0]?.person ||
    royalPersonMentions(job.title)[0]?.person ||
    "";

  // Prefer real VO word timestamps over WPM stretch when voiceover is present.
  const alignment = await ensureVoiceAlignment(job);
  const alignedTimings = alignedTimingsForBeats(windows, alignment, targetDuration);
  const timingSource = alignedTimings ? "voice_alignment" : "wpm_stretch";

  // Duration pass uses lightweight classification; narrative planner decides subjects.
  // When alignment is ready, durations are derived from timed windows (WPM unused).
  const desired = windows.map((text, index) => {
    if (alignedTimings?.[index]) {
      return Math.max(0.35, alignedTimings[index].duration);
    }
    const cls = classifyRoyalBeat(text);
    return desiredDuration(text, cls.beatType, cls.importance, index);
  });
  const durations = alignedTimings
    ? desired
    : normalizeDurations(desired, targetDuration);

  const entityMemory = buildEntityMemory(windows, titlePerson === "British Royal Family" ? "" : titlePerson);
  const plans = planRoyalVisualBeats({
    job,
    context,
    windows,
    durations,
    timings: alignedTimings || undefined,
  });
  // Snap final beat end to exact VO/script duration.
  if (plans.length) {
    plans[plans.length - 1].endTime = Number(targetDuration.toFixed(3));
    plans[plans.length - 1].duration = Number(
      (plans[plans.length - 1].endTime - plans[plans.length - 1].startTime).toFixed(3)
    );
  }
  const beats = visualPlansToBeats(plans);

  // AI plan first (ContactBox): override local heuristics with narration-aware subjects.
  const aiPlanCalls = await refineBeatsWithAiPlan(job, context, beats);
  const gptCallsUsed = aiPlanCalls + (await refineAmbiguousBeats(job, context, beats));
  const impliedSubjectBeats = plans.filter(
    (plan) =>
      !royalPersonMentions(plan.text).some((m) => m.person === plan.mainPerson) &&
      Boolean(plan.currentImpliedPerson)
  ).length;
  const report = {
    jobId: job.jobId,
    targetDurationSec: targetDuration,
    timingSource,
    voiceAlignmentStatus: alignment.status,
    voiceAlignmentSource: alignment.source,
    averageBeatDuration: Number(
      (beats.reduce((n, beat) => n + beat.duration, 0) / Math.max(1, beats.length)).toFixed(2)
    ),
    entityMemory,
    plannerStats: {
      totalBeats: plans.length,
      impliedSubjectBeats,
      highConfidenceImplied: plans.filter((p) => p.impliedConfidence === "high" && !royalPersonMentions(p.text).length)
        .length,
      lowConfidenceImplied: plans.filter((p) => p.impliedConfidence === "low").length,
      exactPersonBeats: plans.filter((p) => p.visualType === "exact_person" || p.visualType === "emotional_reaction")
        .length,
      pairConflictBeats: plans.filter((p) => p.visualType === "pair_or_conflict").length,
      contextBeats: plans.filter((p) =>
        ["context_place", "transition_bridge", "document_or_legal", "raw_motion"].includes(p.visualType)
      ).length,
      placeBeats: plans.filter((p) => p.visualType === "exact_place" || p.visualType === "context_place").length,
      splitScreenBeats: plans.filter((p) => p.shouldUseSplitScreen).length,
      needsBetterVisualBeats: plans.filter((p) => p.needsBetterVisual).length,
    },
    visualPlans: plans,
    beats,
    gptCallsUsed,
    createdAt: new Date().toISOString(),
  };
  await writeJson(jobDataFile("royal-v2-visual-plan", job.jobId), report);
  await writeJson(jobDataFile("royal-v2-visual-planner", job.jobId), {
    jobId: job.jobId,
    entityMemory,
    plannerStats: report.plannerStats,
    plans,
    createdAt: report.createdAt,
  });
  await writeJson(jobDataFile("visual-intelligence-beats", job.jobId), report);
  return { beats, gptCallsUsed };
}

