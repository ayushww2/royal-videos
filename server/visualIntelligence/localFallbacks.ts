import type {
  GlobalContextReport,
  JobRecord,
  QueryPack,
  VisualBeat,
} from "../../shared/visualIntelligence.js";
import { getJobTargetDurationSec } from "./jobDuration.js";
import { estimateWindowTimings, splitMeaningWindows } from "./meaningWindows.js";
import {
  celebrityRecipeActive,
  celebrityTargetHoldSec,
} from "./celebrityV1/referenceRecipe.js";

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

function extractCapitalizedPhrases(text: string, limit = 12): string[] {
  const stop = new Set([
    "at",
    "the",
    "a",
    "an",
    "so",
    "and",
    "but",
    "for",
    "that",
    "this",
    "then",
    "when",
    "what",
    "why",
    "how",
    "his",
    "her",
    "their",
  ]);
  const matches = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g) || [];
  return unique(matches)
    .filter((m) => {
      const parts = m.split(/\s+/);
      if (parts.length === 1 && (stop.has(parts[0].toLowerCase()) || parts[0].length <= 2)) {
        return false;
      }
      if (stop.has(parts[0].toLowerCase())) return false;
      return true;
    })
    .slice(0, limit);
}

export function localGlobalContext(job: JobRecord): GlobalContextReport {
  const phrases = extractCapitalizedPhrases(job.script);
  const celebrityFromTitle =
    job.niche === "Celebrity v1"
      ? (job.title.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/) || [])[1]
      : null;
  return {
    jobId: job.jobId,
    title: job.title,
    niche: job.niche,
    fullScript: job.script,
    sectionHeadings: [],
    mainSubject: celebrityFromTitle || phrases[0] || job.title,
    secondarySubjects: phrases.slice(1, 6),
    people: phrases.slice(0, 8),
    places: phrases.filter((p) => /cave|door|temple|tomb|city|mountain|wall|chamber|palace|abbey/i.test(p)).slice(0, 8),
    companies: [],
    events: phrases.slice(0, 6),
    datesYears: unique((job.script.match(/\b(?:1[0-9]{3}|20[0-9]{2})\b/g) || []).slice(0, 8)),
    documents: phrases.filter((p) => /map|letter|report|document|inscription/i.test(p)).slice(0, 6),
    objectsProducts: phrases.filter((p) => /stone|door|artifact|tablet|seal|key/i.test(p)).slice(0, 8),
    quotesStatements: [],
    emotionalTone: "mysterious documentary",
    timelineShifts: [],
    confusingSimilarEntities: [],
    forbiddenEntities: [],
    shortNameExpansions: {},
    createdAt: new Date().toISOString(),
  };
}

export function localMysteryBeats(job: JobRecord, context: GlobalContextReport): VisualBeat[] {
  const targetDuration = getJobTargetDurationSec(job);
  const holdSec = celebrityRecipeActive(job.niche)
    ? celebrityTargetHoldSec()
    : job.niche === "Mystery v2"
      ? 4.5
      : 3.5;
  const approxBeats = Math.max(1, Math.round(targetDuration / holdSec));

  // Cut on narration boundaries, not equal word buckets — a beat must never
  // start mid-sentence. Timings here are word-share estimates; callers with a
  // voiceover retime these windows from Whisper alignment.
  // Mystery v2: tighter clause splits (~12 words ≈ 4.5s) so Whisper has
  // shorter windows to lock before the post-align hold-band merge/split.
  const windows =
    job.niche === "Mystery v2"
      ? splitMeaningWindows(job.script, approxBeats, {
          targetWords: 12,
          maxWords: 14,
          minWords: 5,
        })
      : splitMeaningWindows(job.script, approxBeats);
  const timings = estimateWindowTimings(windows, targetDuration);
  const chunks = windows.map((text, idx) => ({
    text,
    start: timings[idx].startTime,
    duration: timings[idx].duration,
  }));

  return chunks.map((w, idx) => {
    const phrases = extractCapitalizedPhrases(w.text, 4);
    const people =
      w.text.match(
        /\b(?:Princess\s+)?(?:Catherine|Kate|Camilla|Anne|Charles|William|Harry|Meghan|Diana)\b/g
      ) || [];
    const mysteryV2 = job.niche === "Mystery v2";
    return {
      beatId: `beat-${idx + 1}`,
      startTime: Number(w.start.toFixed(2)),
      endTime: Number((w.start + w.duration).toFixed(2)),
      duration: w.duration,
      narrationText: w.text,
      section: "main",
      mentionedPeople: [...new Set(people)],
      mentionedCompanies: [],
      mentionedPlaces: phrases.filter((p) =>
        /palace|cave|door|temple|tomb|wall|chamber|city|windsor|buckingham|london|abbey|chapel/i.test(p)
      ),
      mentionedEvents: [],
      mentionedDocuments: [],
      mentionedObjects: phrases.filter((p) => /stone|door|artifact|map|tablet|crown|jewel/i.test(p)),
      mentionedDates: [],
      visualIntent: `Show visuals for: ${w.text.slice(0, 120)}`,
      // Mystery v2 is images-only (Google + AI stills) — never request clips.
      idealVisualType: mysteryV2 ? "image" : idx % 3 === 0 ? "clip" : "image",
      fallbackVisualType: "best_appropriate_visual",
      importanceScore: 65,
      mustMatchEntity: people[0] || phrases[0] || context.mainSubject,
      exactSubject: people[0] || phrases[0] || context.mainSubject,
      visualRole: idx % 4 === 0 ? "atmosphere" : "main_subject",
      viewerShouldSee: (people[0] || phrases[0] || w.text).slice(0, 80),
      forbiddenVisuals: ["horror monster", "meme graphic", "YouTube thumbnail text overlay", "stock watermark"],
    } satisfies VisualBeat;
  });
}

export function localQueryPacks(job: JobRecord, beats: VisualBeat[], maxPacks: number): QueryPack[] {
  const packs: QueryPack[] = [];
  const seen = new Set<string>();

  const push = (query: string, beatIds: string[], entity: string, priority: number) => {
    const key = query.toLowerCase().trim();
    if (key.length < 3 || seen.has(key) || packs.length >= maxPacks) return;
    seen.add(key);
    packs.push({
      queryPackId: `qp-${packs.length + 1}`,
      relatedBeatIds: beatIds,
      entityContext: entity,
      query,
      sourceType: "google",
      expectedVisualType: "image",
      priority,
      maxCandidates: 8,
    });
  };

  const celebrityMain =
    job.niche === "Celebrity v1"
      ? (job.title.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/) || [])[1]
      : null;

  for (const beat of beats) {
    const entities = unique([
      beat.mustMatchEntity || "",
      ...beat.mentionedPlaces,
      ...beat.mentionedObjects,
      ...beat.mentionedPeople,
      ...beat.mentionedEvents,
      ...beat.mentionedDocuments,
    ])
      .filter((e) => {
        const w = e.trim();
        if (w.length < 4) return false;
        if (/^(at|the|a|an|so|and|of|to|in|on|for|his|her|tragedy|hollywoodlywood)$/i.test(w)) {
          return false;
        }
        // Ban title-crumb phrases that aren't people/places.
        if (/feels beyond|heartbreaking|confirmed the rumors/i.test(w)) return false;
        return true;
      })
      .slice(0, 3);

    for (const entity of entities) {
      if (job.niche === "Mystery v2") {
        // Locked: short 2–4 word subject queries only (no "documentary photo" suffix).
        const short = entity.split(/\s+/).slice(0, 4).join(" ");
        if (short.split(/\s+/).length >= 2) {
          push(short, [beat.beatId], short, 82);
        }
        continue;
      }
      push(`${entity} documentary photo`, [beat.beatId], entity, 80);
      if (job.niche === "Celebrity v1") {
        const subject =
          celebrityMain ||
          (beat.mentionedPeople || []).find((p) => p.split(/\s+/).length >= 2) ||
          (entity.split(/\s+/).length >= 2 ? entity : "") ||
          celebrityMain;
        if (!subject || subject.split(/\s+/).length < 2) continue;
        push(`${subject} red carpet`, [beat.beatId], subject, 88);
        push(`${subject} interview archival`, [beat.beatId], subject, 86);
        push(`${subject} portrait documentary photo`, [beat.beatId], subject, 84);
        push(`${subject} premiere event`, [beat.beatId], subject, 80);
        push(`${subject} press conference`, [beat.beatId], subject, 78);
        push(`${subject} young archival photo`, [beat.beatId], subject, 76);
        push(`${subject} stage performance`, [beat.beatId], subject, 74);
      } else if (job.niche === "Space v1") {
        push(`${entity} NASA`, [beat.beatId], entity, 78);
        push(`${entity} spacecraft telescope`, [beat.beatId], entity, 74);
      } else if (job.niche === "War v1") {
        push(`${entity} wartime archival photo`, [beat.beatId], entity, 78);
        push(`${entity} battle front documentary`, [beat.beatId], entity, 74);
        push(`${entity} military historical archive`, [beat.beatId], entity, 72);
      } else if (job.niche === "Royal v1" || job.niche === "Royal v2") {
        push(`${entity} royal family official photo`, [beat.beatId], entity, 78);
      } else {
        // Mystery and default — evidence oriented
        push(`${entity} archaeological evidence`, [beat.beatId], entity, 74);
        push(`${entity} historical documentary`, [beat.beatId], entity, 70);
      }
    }

    const keywords = beat.narrationText
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 6)
      .join(" ");
    if (keywords && job.niche !== "Mystery v2") {
      const suffix =
        job.niche === "Celebrity v1"
          ? "celebrity documentary"
          : job.niche === "Space v1"
            ? "space documentary"
            : job.niche === "War v1"
              ? "war documentary archival"
              : "mystery documentary";
      push(`${keywords} ${suffix}`, [beat.beatId], keywords, 55);
    }
  }

  if (!packs.length) {
    push(`${job.title} documentary visual`, beats.map((b) => b.beatId), job.title, 50);
  }

  return packs;
}
