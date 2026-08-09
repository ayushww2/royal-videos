/**
 * Mystery v2 locked pacing: merge short Whisper windows + split long ones
 * so every hold lands in ~4–5s (band 4.0–5.5s, target 4.5s).
 * Cuts prefer clause punctuation / conjunctions — never mid-word.
 */
import type { VisualBeat } from "../../../shared/visualIntelligence.js";

export const MYSTERY_V2_MIN_HOLD = 4.0;
export const MYSTERY_V2_TARGET_HOLD = 4.5;
export const MYSTERY_V2_MAX_HOLD = 5.5;

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v.trim());
  }
  return out;
}

/**
 * Split narration into ~N clause-aware chunks so each visual hold is ~4–5s.
 * N = round(duration / 4.5), raised until duration/N ≤ max hold.
 */
function splitNarrationForHold(text: string, durationSec: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [text.trim() || ""];
  if (durationSec <= MYSTERY_V2_MAX_HOLD + 0.25) return [words.join(" ")];

  let pieces = Math.max(2, Math.round(durationSec / MYSTERY_V2_TARGET_HOLD));
  while (durationSec / pieces > MYSTERY_V2_MAX_HOLD + 0.05) pieces += 1;
  // Prefer fewer cuts when equal slices would sit just under min (e.g. 7.8s → 2×3.9).
  while (pieces > 2 && durationSec / (pieces - 1) <= MYSTERY_V2_MAX_HOLD + 0.05) {
    const cur = durationSec / pieces;
    const fewer = durationSec / (pieces - 1);
    if (cur < MYSTERY_V2_MIN_HOLD - 0.35 && fewer <= MYSTERY_V2_MAX_HOLD + 0.05) {
      pieces -= 1;
      continue;
    }
    break;
  }
  pieces = Math.min(pieces, Math.max(2, words.length));

  const chunks: string[] = [];
  let remaining = words;
  for (let p = 0; p < pieces - 1; p++) {
    const left = pieces - p;
    const targetCut = Math.round(remaining.length / left);
    const minWords = Math.max(3, Math.floor(remaining.length / left) - 3);
    const lo = Math.max(3, targetCut - 4, minWords);
    const hi = Math.min(remaining.length - 3, targetCut + 4);
    let cut = -1;

    for (let i = hi; i >= lo; i--) {
      if (/[,;:—–]$/.test(remaining[i - 1] || "")) {
        cut = i;
        break;
      }
    }
    if (cut < 0) {
      for (let i = hi; i >= lo; i--) {
        if (
          /^(and|but|then|so|while|because|however|yet|where|which|that|when|after|before)$/i.test(
            remaining[i] || ""
          )
        ) {
          cut = i;
          break;
        }
      }
    }
    if (cut < 0) cut = Math.max(3, Math.min(targetCut, remaining.length - 3));
    if (cut >= remaining.length) break;

    chunks.push(remaining.slice(0, cut).join(" "));
    remaining = remaining.slice(cut);
  }
  if (remaining.length) chunks.push(remaining.join(" "));
  return chunks.filter((c) => c.trim());
}

function cloneBeatShell(first: VisualBeat, overrides: Partial<VisualBeat>): VisualBeat {
  const exact =
    overrides.exactSubject ||
    first.exactSubject ||
    first.mustMatchEntity ||
    first.mentionedPlaces?.[0] ||
    first.mentionedPeople?.[0] ||
    "";
  return {
    ...first,
    ...overrides,
    exactSubject: exact,
    mustMatchEntity: exact || first.mustMatchEntity,
    idealVisualType: "image",
  };
}

function mergeShortForward(beats: VisualBeat[]): VisualBeat[] {
  if (!beats.length) return beats;
  const sorted = [...beats].sort((a, b) => a.startTime - b.startTime);
  const out: VisualBeat[] = [];
  let i = 0;

  while (i < sorted.length) {
    const first = sorted[i];
    let endIdx = i;
    let narr = first.narrationText || "";
    const people = [...(first.mentionedPeople || [])];
    const places = [...(first.mentionedPlaces || [])];
    const objects = [...(first.mentionedObjects || [])];
    const events = [...(first.mentionedEvents || [])];
    const docs = [...(first.mentionedDocuments || [])];

    const span = () => sorted[endIdx].endTime - first.startTime;

    const tryAbsorbNext = (allowUpTo: number) => {
      if (endIdx + 1 >= sorted.length) return false;
      const nextSpan = sorted[endIdx + 1].endTime - first.startTime;
      // Never re-glue past max — a slightly short hold beats an 8s hold.
      if (nextSpan > MYSTERY_V2_MAX_HOLD + 0.25) return false;
      if (span() >= allowUpTo) return false;
      endIdx += 1;
      narr = `${narr} ${sorted[endIdx].narrationText || ""}`.trim();
      people.push(...(sorted[endIdx].mentionedPeople || []));
      places.push(...(sorted[endIdx].mentionedPlaces || []));
      objects.push(...(sorted[endIdx].mentionedObjects || []));
      events.push(...(sorted[endIdx].mentionedEvents || []));
      docs.push(...(sorted[endIdx].mentionedDocuments || []));
      return true;
    };

    while (tryAbsorbNext(MYSTERY_V2_MIN_HOLD - 0.05)) {
      /* grow to clear minimum without exceeding max */
    }
    while (tryAbsorbNext(MYSTERY_V2_TARGET_HOLD - 0.15)) {
      /* ease toward target */
    }

    const last = sorted[endIdx];
    const duration = Number(Math.max(0.4, last.endTime - first.startTime).toFixed(2));
    out.push(
      cloneBeatShell(first, {
        beatId: `beat-${out.length + 1}`,
        startTime: Number(first.startTime.toFixed(2)),
        endTime: Number(last.endTime.toFixed(2)),
        duration,
        narrationText: narr,
        mentionedPeople: uniq(people),
        mentionedPlaces: uniq(places),
        mentionedObjects: uniq(objects),
        mentionedEvents: uniq(events),
        mentionedDocuments: uniq(docs),
        visualIntent: first.visualIntent || `Show visuals for: ${narr.slice(0, 120)}`,
        viewerShouldSee: first.viewerShouldSee || narr.slice(0, 80),
      })
    );
    i = endIdx + 1;
  }

  return out;
}

function splitLongHolds(beats: VisualBeat[]): VisualBeat[] {
  const out: VisualBeat[] = [];

  for (const beat of beats) {
    const duration = Number(beat.duration || beat.endTime - beat.startTime);
    if (duration <= MYSTERY_V2_MAX_HOLD + 0.25) {
      out.push(
        cloneBeatShell(beat, {
          beatId: `beat-${out.length + 1}`,
          duration: Number(duration.toFixed(2)),
          startTime: Number(beat.startTime.toFixed(2)),
          endTime: Number(beat.endTime.toFixed(2)),
        })
      );
      continue;
    }

    const chunks = splitNarrationForHold(beat.narrationText || "", duration);
    if (chunks.length <= 1) {
      out.push(
        cloneBeatShell(beat, {
          beatId: `beat-${out.length + 1}`,
          duration: Number(duration.toFixed(2)),
          startTime: Number(beat.startTime.toFixed(2)),
          endTime: Number(beat.endTime.toFixed(2)),
        })
      );
      continue;
    }

    const n = chunks.length;
    const equal = duration / n;
    let cursor = beat.startTime;
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const startTime = Number(cursor.toFixed(2));
      const endTime = Number((isLast ? beat.endTime : cursor + equal).toFixed(2));
      const dur = Number(Math.max(0.4, endTime - startTime).toFixed(2));
      const narr = chunks[i];
      out.push(
        cloneBeatShell(beat, {
          beatId: `beat-${out.length + 1}`,
          startTime,
          endTime,
          duration: dur,
          narrationText: narr,
          visualIntent: `Show visuals for: ${narr.slice(0, 120)}`,
          viewerShouldSee: narr.slice(0, 80),
        })
      );
      cursor = endTime;
    }
  }

  return out;
}

/**
 * After Whisper retimes sentence windows, fold shorts up and split longs down
 * so each hold lands in the 4–5.5s band (target 4.5s).
 */
export function mergeMysteryV2BeatsToHoldBand(beats: VisualBeat[]): VisualBeat[] {
  if (!beats.length) return beats;
  const merged = mergeShortForward(beats);
  const split = splitLongHolds(merged);
  // One more short-merge pass in case a proportional split left a <4s orphan.
  const finalized = mergeShortForward(split);
  return finalized.map((b, idx) => ({
    ...b,
    beatId: `beat-${idx + 1}`,
    idealVisualType: "image" as const,
  }));
}
