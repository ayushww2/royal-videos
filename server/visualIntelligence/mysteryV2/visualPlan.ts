/**
 * Mystery v2 locked visual plan:
 * - Google vs AI per subject (not per beat)
 * - Short 2–4 word Google queries, subject-deduped
 * - Always uses ContactBox even when PIPELINE_EFFICIENT=1
 */
import { chatJson } from "../../openaiClient.js";
import { jobDataFile, writeJson } from "../../storage.js";
import { getJobCostLimits, getJobTargetDurationSec, sampleBeatsForPrompt } from "../jobDuration.js";
import type {
  FullScriptVisualMap,
  JobRecord,
  QueryPack,
  TitleLock,
  VisualBeat,
} from "../../../shared/visualIntelligence.js";

const MAX_QUERY_WORDS = 4;
/** Locked density: ≥10–12 unique stills used per minute of VO. */
export const MYSTERY_V2_UNIQUE_PER_MIN_MIN = 10;
export const MYSTERY_V2_UNIQUE_PER_MIN = 11;
export const MYSTERY_V2_UNIQUE_PER_MIN_MAX = 12;

export type MysteryAiStillPlan = {
  stillId: string;
  subject: string;
  visualIdea: string;
  whyAiNotGoogle: string;
  relatedBeatIds: string[];
  priority: number;
};

export type MysteryV2VisualPlan = {
  googlePacks: QueryPack[];
  aiStills: MysteryAiStillPlan[];
  mode: string;
};

function clampWords(q: string, max = MAX_QUERY_WORDS): string {
  return q
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max)
    .join(" ");
}

function normalizeGooglePacks(
  raw: Array<{
    query?: string;
    entityContext?: string;
    whyGoogle?: string;
    relatedBeatIds?: string[];
    priority?: number;
  }>,
  maxPacks: number
): QueryPack[] {
  const seen = new Set<string>();
  const out: QueryPack[] = [];
  for (const p of [...raw].sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
    const query = clampWords(String(p.query || "").trim());
    const key = query.toLowerCase();
    if (!query || key.split(/\s+/).length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      queryPackId: `m2-g-${out.length + 1}`,
      relatedBeatIds: p.relatedBeatIds || [],
      entityContext: p.entityContext || query,
      query,
      sourceType: "google",
      expectedVisualType: "image",
      priority: p.priority ?? 70,
      maxCandidates: 4,
      whyNeeded: p.whyGoogle || "established real subject",
      idealResultType: "horizontal documentary photo, no watermark text",
      forbiddenResultType: "watermark, burned text, meme, YouTube thumbnail, portrait stock model",
    });
    if (out.length >= maxPacks) break;
  }
  return out;
}

/** Pull a short Google-able query from narration when entity fields are thin. */
function queryFromNarration(text: string): string {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "were",
    "was",
    "are",
    "had",
    "have",
    "been",
    "their",
    "they",
    "beyond",
    "under",
    "over",
    "years",
    "later",
    "began",
    "would",
    "could",
    "one",
    "most",
  ]);
  const words = String(text || "")
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
  return clampWords(words.slice(0, 4).join(" "));
}

const INTERPRETIVE_RE =
  /\b(law|legal|quota|protection|danger|fear|mystery|possibility|connected|meaning|plan|policy|jurisdiction|boundary|would|could|should|might|spirit|legacy|aftermath|tension|conflict)\b/i;

function looksInterpretive(b: VisualBeat): boolean {
  return INTERPRETIVE_RE.test(`${b.narrationText || ""} ${b.visualIntent || ""}`);
}

/** Always return a Google + AI mix (used when GPT times out or under-plans AI). */
function localMixedPlan(
  beats: VisualBeat[],
  maxGoogle: number,
  maxAi: number
): MysteryV2VisualPlan {
  const packs: QueryPack[] = [];
  const aiStills: MysteryAiStillPlan[] = [];
  const seenG = new Set<string>();
  const seenAi = new Set<string>();

  const pushPack = (query: string, beatIds: string[], priority: number) => {
    if (packs.length >= maxGoogle) return;
    const q = clampWords(query);
    const key = q.toLowerCase();
    if (!q || q.split(/\s+/).length < 2 || seenG.has(key)) return;
    seenG.add(key);
    packs.push({
      queryPackId: `m2-local-${packs.length + 1}`,
      relatedBeatIds: beatIds,
      entityContext: q,
      query: q,
      sourceType: "google",
      expectedVisualType: "image",
      priority,
      maxCandidates: 4,
      whyNeeded: "local mixed plan",
    });
  };

  const pushAi = (b: VisualBeat, priority: number) => {
    if (aiStills.length >= maxAi) return;
    const subject = clampWords(
      b.exactSubject ||
        b.mustMatchEntity ||
        queryFromNarration(b.narrationText || "") ||
        `scene ${b.beatId}`,
      5
    );
    const key = `${subject.toLowerCase()}|${b.beatId}`;
    if (!subject || seenAi.has(key)) return;
    seenAi.add(key);
    aiStills.push({
      stillId: `m2-ai-${aiStills.length + 1}`,
      subject,
      visualIdea: `Documentary realism still for: ${(b.narrationText || subject).slice(0, 160)}`,
      whyAiNotGoogle: looksInterpretive(b)
        ? "interpretive / mood — better as AI realism"
        : "variety mix — AI still for visual diversity",
      relatedBeatIds: [b.beatId],
      priority,
    });
  };

  // Pass 1: concrete entities → Google; interpretive → AI.
  for (const b of beats) {
    const entity = clampWords(
      b.exactSubject ||
        b.mustMatchEntity ||
        b.mentionedPlaces?.[0] ||
        b.mentionedPeople?.[0] ||
        b.mentionedObjects?.[0] ||
        ""
    );
    if (looksInterpretive(b) && aiStills.length < maxAi) {
      pushAi(b, 70);
    } else if (entity) {
      pushPack(entity, [b.beatId], 75);
    }
  }

  // Pass 2: fill Google density from narration angles.
  for (let i = 0; i < beats.length && packs.length < maxGoogle; i += 2) {
    const q = queryFromNarration(beats[i].narrationText || "");
    if (q) pushPack(q, [beats[i].beatId], 60);
  }

  // Pass 3: fill AI mix to ~40% of combined unique budget (or maxAi).
  const aiTarget = Math.min(maxAi, Math.max(24, Math.round((maxGoogle + maxAi) * 0.4)));
  for (let i = 0; i < beats.length && aiStills.length < aiTarget; i += 3) {
    pushAi(beats[i], 62);
  }
  // If still short, walk remaining beats.
  for (const b of beats) {
    if (aiStills.length >= aiTarget) break;
    pushAi(b, 55);
  }

  return { googlePacks: packs, aiStills, mode: "local_mixed_fallback" };
}

/**
 * Build subject-deduped Google packs + AI still plan for Mystery v2.
 */
export async function createMysteryV2VisualPlan(params: {
  job: JobRecord;
  titleLock: TitleLock;
  visualMap: FullScriptVisualMap;
  beats: VisualBeat[];
}): Promise<MysteryV2VisualPlan> {
  const { job, titleLock, visualMap, beats } = params;
  const limits = getJobCostLimits(job);
  const voSec = getJobTargetDurationSec(job);
  const minutes = Math.max(1, voSec / 60);
  // Aim 10–12 unique/min in the cut. Plan a practical Google+AI mix that can
  // finish without multi-hour sequential gen (multi images per Google query).
  const uniqueTarget = Math.ceil(minutes * MYSTERY_V2_UNIQUE_PER_MIN);
  const maxGoogle = Math.min(
    limits.maxQueryPacks,
    Math.max(36, Math.round(minutes * 3.2)) // ~3 queries/min × ~4 stills each
  );
  const maxAi = Math.min(60, Math.max(18, Math.round(minutes * 1.6))); // ~1.6 AI/min

  // Local mixed plan is the safety net (Google + AI). GPT can refine.
  let plan: MysteryV2VisualPlan = localMixedPlan(beats, maxGoogle, maxAi);
  // Smaller GPT seed so the director call doesn't time out on long VO.
  const gptMaxGoogle = Math.min(64, maxGoogle);
  const gptMaxAi = Math.min(48, maxAi);

  try {
    const result = await chatJson<{
      googleSearches: Array<{
        query: string;
        entityContext: string;
        whyGoogle: string;
        relatedBeatIds: string[];
        priority: number;
      }>;
      aiGenerate: Array<{
        subject: string;
        visualIdea: string;
        whyAiNotGoogle: string;
        relatedBeatIds: string[];
        priority: number;
      }>;
    }>({
      system: `You are the DOCUMENTARY DIRECTOR for Mystery YouTube films (images-only).

YOU decide Google vs AI per visual — return a MIX of both (not Google-only, not AI-only).

A) GOOGLE — authentic real-world photos likely exist.
B) AI GENERATE — interpretive / mood / speculative / better as realism still.

Rules:
- Google queries: 2–4 words. Prefer 2–3.
- Return BOTH lists with real items. Aim ~60% Google / ~40% AI in your seed.
- Soft dedupe exact duplicate queries only.
- Prefer the source that looks most correct on screen.

Cap googleSearches at ${gptMaxGoogle}. Cap aiGenerate at ${gptMaxAi}.
Return JSON only.`,
      user: JSON.stringify({
        title: job.title,
        niche: "Mystery v2",
        voiceoverDurationSec: voSec,
        minutes: Number(minutes.toFixed(2)),
        uniqueTargetTotal: uniqueTarget,
        maxGoogle: gptMaxGoogle,
        maxAi: gptMaxAi,
        maxQueryWords: MAX_QUERY_WORDS,
        titleLock: {
          mainSubject: titleLock.mainSubject,
          centralObjectOrPlace: titleLock.centralObjectOrPlace,
          mysteryOrConflict: titleLock.mysteryOrConflict,
        },
        visualMap: {
          mainVideoPromise: visualMap.mainVideoPromise,
          primaryVisualSubjects: (visualMap.primaryVisualSubjects || []).slice(0, 20),
          exactPlaces: (visualMap.exactPlaces || []).slice(0, 16),
          exactPeople: (visualMap.exactPeople || []).slice(0, 12),
        },
        beats: sampleBeatsForPrompt(beats, 48).map((b) => ({
          beatId: b.beatId,
          startTime: b.startTime,
          narrationText: (b.narrationText || "").slice(0, 120),
          exactSubject: b.exactSubject || b.mustMatchEntity,
        })),
      }),
      temperature: 0.2,
    });

    const googlePacks = normalizeGooglePacks(result.googleSearches || [], maxGoogle);
    let aiStills: MysteryAiStillPlan[] = [];
    const seenAi = new Set<string>();
    for (const a of [...(result.aiGenerate || [])].sort(
      (x, y) => (y.priority || 0) - (x.priority || 0)
    )) {
      const subject = clampWords(String(a.subject || a.visualIdea || "").trim(), 6);
      const related = a.relatedBeatIds || [];
      const key = `${subject.toLowerCase()}|${related[0] || subject.toLowerCase()}`;
      if (!subject || seenAi.has(key)) continue;
      seenAi.add(key);
      aiStills.push({
        stillId: `m2-ai-${aiStills.length + 1}`,
        subject,
        visualIdea: String(a.visualIdea || subject).slice(0, 240),
        whyAiNotGoogle: String(a.whyAiNotGoogle || "interpretive"),
        relatedBeatIds: related,
        priority: a.priority ?? 60,
      });
      if (aiStills.length >= maxAi) break;
    }

    // Merge director seed with local mix so we keep density + AI share.
    const local = localMixedPlan(beats, maxGoogle, maxAi);
    const seenG = new Set(googlePacks.map((p) => p.query.toLowerCase()));
    for (const p of local.googlePacks) {
      if (googlePacks.length >= maxGoogle) break;
      if (seenG.has(p.query.toLowerCase())) continue;
      seenG.add(p.query.toLowerCase());
      googlePacks.push({ ...p, queryPackId: `m2-g-${googlePacks.length + 1}` });
    }
    for (const a of local.aiStills) {
      if (aiStills.length >= maxAi) break;
      const key = `${a.subject.toLowerCase()}|${(a.relatedBeatIds || [])[0] || a.subject.toLowerCase()}`;
      if (seenAi.has(key)) continue;
      seenAi.add(key);
      aiStills.push({ ...a, stillId: `m2-ai-${aiStills.length + 1}` });
    }

    if (googlePacks.length || aiStills.length) {
      plan = {
        googlePacks,
        aiStills,
        mode: "mystery_v2_mixed",
      };
    }
  } catch (err) {
    console.warn(
      `[mysteryV2/visualPlan] GPT failed for ${job.jobId} — using local Google+AI mix:`,
      err instanceof Error ? err.message : err
    );
    plan = localMixedPlan(beats, maxGoogle, maxAi);
  }

  // Hard guarantee: keep a real Google + AI mix (~35–40% AI of unique budget).
  const minAiMix = Math.min(maxAi, Math.max(18, Math.round(maxAi * 0.85)));
  const minGoogleMix = Math.min(maxGoogle, Math.max(24, Math.round(maxGoogle * 0.75)));
  if (plan.aiStills.length < minAiMix) {
    const fill = localMixedPlan(beats, maxGoogle, maxAi);
    const seenAi = new Set(
      plan.aiStills.map((a) => `${a.subject.toLowerCase()}|${(a.relatedBeatIds || []).join(",")}`)
    );
    for (const a of fill.aiStills) {
      if (plan.aiStills.length >= minAiMix) break;
      const key = `${a.subject.toLowerCase()}|${(a.relatedBeatIds || []).join(",")}`;
      if (seenAi.has(key)) continue;
      seenAi.add(key);
      plan.aiStills.push({ ...a, stillId: `m2-ai-${plan.aiStills.length + 1}` });
    }
    plan.mode = plan.mode.includes("mixed") ? plan.mode : `${plan.mode}+ai_mix_fill`;
  }
  if (plan.googlePacks.length < minGoogleMix) {
    const fill = localMixedPlan(beats, maxGoogle, maxAi);
    const seenG = new Set(plan.googlePacks.map((p) => p.query.toLowerCase()));
    for (const p of fill.googlePacks) {
      if (plan.googlePacks.length >= minGoogleMix) break;
      if (seenG.has(p.query.toLowerCase())) continue;
      seenG.add(p.query.toLowerCase());
      plan.googlePacks.push({
        ...p,
        queryPackId: `m2-g-${plan.googlePacks.length + 1}`,
      });
    }
  }

  // Soft-link orphan beats only when keyword overlap is clear — never dump onto pack #1.
  const covered = new Set<string>();
  for (const p of plan.googlePacks) for (const id of p.relatedBeatIds) covered.add(id);
  for (const a of plan.aiStills) for (const id of a.relatedBeatIds) covered.add(id);
  for (const b of beats) {
    if (covered.has(b.beatId)) continue;
    const text = (b.narrationText || "").toLowerCase();
    let best: QueryPack | undefined;
    let bestScore = 0;
    for (const p of plan.googlePacks) {
      const words = p.query.toLowerCase().split(/\s+/);
      const score = words.filter((w) => w.length > 2 && text.includes(w)).length;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best && bestScore >= 2) {
      best.relatedBeatIds = [...new Set([...best.relatedBeatIds, b.beatId])];
      covered.add(b.beatId);
    }
  }

  await writeJson(jobDataFile("mystery-v2-visual-plan", job.jobId), {
    jobId: job.jobId,
    ...plan,
    maxGoogle,
    maxAi,
    uniqueTarget,
    uniquePerMinuteTarget: MYSTERY_V2_UNIQUE_PER_MIN,
    beatCount: beats.length,
    createdAt: new Date().toISOString(),
  });
  await writeJson(jobDataFile("search-query-packs", job.jobId), {
    jobId: job.jobId,
    queryPacks: plan.googlePacks,
    mode: plan.mode,
    aiStillCount: plan.aiStills.length,
  });
  await writeJson(jobDataFile("visual-intelligence-query-packs", job.jobId), {
    jobId: job.jobId,
    queryPacks: plan.googlePacks,
    mode: plan.mode,
  });

  console.log(
    `[mysteryV2/visualPlan] ${job.jobId} google=${plan.googlePacks.length} ai=${plan.aiStills.length} uniqueTarget=${uniqueTarget} (~${MYSTERY_V2_UNIQUE_PER_MIN}/min) mode=${plan.mode}`
  );
  return plan;
}
