/** Cost modes for the visual pipeline. */

/** Skip GPT everywhere (local soft paths). */
export function cheapPipeline(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PIPELINE_CHEAP || "");
}

/**
 * Efficient editor mode: local context/beats/packs/effect-copy,
 * but keep ONE holistic GPT judge pass. Target ~<$1 GPT per minute of video.
 */
export function efficientPipeline(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PIPELINE_EFFICIENT || "");
}

/** Skip GPT for non-judge steps (cheap OR efficient). */
export function skipGptExceptJudge(): boolean {
  return cheapPipeline() || efficientPipeline();
}

/** Cap for holistic GPT judge when running efficient mode. */
export function maxJudgeCandidates(defaultCap: number): number {
  // 72-candidate holistic JSON often times out on Railway; keep the pass small.
  if (efficientPipeline()) return Math.min(defaultCap, 48);
  return defaultCap;
}
