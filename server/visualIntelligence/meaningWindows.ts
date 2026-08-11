/**
 * Split narration into meaning-sized windows (sentence/clause aware)
 * and estimate word-share timings for fallback beat planning.
 */

export type MeaningWindowOptions = {
  targetWords?: number;
  maxWords?: number;
  minWords?: number;
};

export type EstimatedWindowTiming = {
  startTime: number;
  endTime: number;
  duration: number;
};

/**
 * Split narration on sentence/clause boundaries into meaning-sized windows.
 * `count` seeds default targetWords (totalWords / count); output length
 * follows linguistic splits, not a hard bucket count.
 */
export function splitMeaningWindows(
  script: string,
  count: number,
  options?: MeaningWindowOptions
): string[] {
  const clean = script.replace(/\s+/g, " ").trim();
  if (!clean) return [""];

  const allWords = clean.split(/\s+/);
  const targetWords =
    options?.targetWords ??
    Math.max(6, Math.min(11, Math.round(allWords.length / Math.max(1, count))));
  const maxWords = options?.maxWords ?? targetWords + 2;
  const minWords = options?.minWords ?? 5;

  const sentences = clean.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [clean];
  const windows: string[] = [];

  const pushSized = (input: string) => {
    let words = input.trim().split(/\s+/).filter(Boolean);
    while (words.length > maxWords) {
      let end = targetWords;
      const minEnd = Math.max(Math.max(1, minWords - 1), targetWords - 4);
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
      if (
        (pendingWords < minWords || clauseWords < 3) &&
        combinedWords <= maxWords + 6
      ) {
        pending = `${pending} ${clause}`;
      } else {
        clauses.push(pending);
        pending = clause;
      }
    }
    if (pending) clauses.push(pending);

    for (const clause of clauses) {
      pushSized(clause);
    }
  }

  const out = windows.filter((value) => value.trim());
  return out.length ? out : [clean];
}

/**
 * Word-share duration estimates across windows (VO-clock stretch).
 * Callers with Whisper retime via voice alignment.
 */
export function estimateWindowTimings(
  windows: string[],
  targetDurationSec: number
): EstimatedWindowTiming[] {
  if (!windows.length) return [];

  const weights = windows.map((w) =>
    Math.max(1, w.trim().split(/\s+/).filter(Boolean).length)
  );
  const totalWeight = weights.reduce((n, w) => n + w, 0) || 1;

  let cursor = 0;
  return weights.map((weight, index) => {
    const isLast = index === weights.length - 1;
    const duration = isLast
      ? Math.max(0.2, targetDurationSec - cursor)
      : (weight / totalWeight) * targetDurationSec;
    const startTime = cursor;
    const endTime = cursor + duration;
    cursor = endTime;
    return {
      startTime: Number(startTime.toFixed(3)),
      endTime: Number(endTime.toFixed(3)),
      duration: Number(duration.toFixed(3)),
    };
  });
}
