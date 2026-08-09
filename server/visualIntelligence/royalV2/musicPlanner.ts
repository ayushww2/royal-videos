/**
 * Royal v2 background music planner (international documentary bed).
 * Sparse beds under VO — max 3 tracks/video, GPT picks mood + placement.
 */
import { getOpenAI } from "../../openaiClient.js";
import { config, optionalEnv } from "../../config.js";
import { skipGptExceptJudge } from "../pipelineMode.js";
import type { TimelineScene } from "../../../shared/visualIntelligence.js";

export type RoyalMusicId =
  | "the_palace_decision"
  | "royal_backlash"
  | "the_sacred_crown"
  | "a_private_message_from_the_past"
  | "palace_papers_and_secret_wills"
  | "monarchy_in_crisis"
  | "royal_2"
  | "diana"
  | "royal";

export type RoyalMusicEvent = {
  id: string;
  musicId: RoyalMusicId;
  /** Path under Remotion public dir, e.g. music/royal/diana.mp3 */
  publicPath: string;
  startTime: number;
  durationSec: number;
  /** Remotion volume after source loudnorm (~-34 LUFS). Bed ~0.08–0.12. */
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  reason: string;
  role: "bed" | "chapter_boost" | "memorial";
};

type TrackMeta = {
  id: RoyalMusicId;
  file: string;
  sourceDurationSec: number;
  maxUseSec: number;
  defaultVolume: number;
  moods: string[];
};

const TRACKS: TrackMeta[] = [
  {
    id: "the_palace_decision",
    file: "the_palace_decision.mp3",
    sourceDurationSec: 120,
    maxUseSec: 100,
    defaultVolume: 0.1,
    moods: ["solemn", "decisive", "institutional"],
  },
  {
    id: "royal_backlash",
    file: "royal_backlash.mp3",
    sourceDurationSec: 240,
    maxUseSec: 110,
    defaultVolume: 0.1,
    moods: ["tense", "conflict", "public_backlash"],
  },
  {
    id: "the_sacred_crown",
    file: "the_sacred_crown.mp3",
    sourceDurationSec: 240,
    maxUseSec: 120,
    defaultVolume: 0.1,
    moods: ["regal", "ceremonial", "weighty"],
  },
  {
    id: "a_private_message_from_the_past",
    file: "a_private_message_from_the_past.mp3",
    sourceDurationSec: 240,
    maxUseSec: 100,
    defaultVolume: 0.09,
    moods: ["intimate", "nostalgic", "archival"],
  },
  {
    id: "palace_papers_and_secret_wills",
    file: "palace_papers_and_secret_wills.mp3",
    sourceDurationSec: 240,
    maxUseSec: 110,
    defaultVolume: 0.1,
    moods: ["archival", "investigative", "legal"],
  },
  {
    id: "monarchy_in_crisis",
    file: "monarchy_in_crisis.mp3",
    sourceDurationSec: 240,
    maxUseSec: 110,
    defaultVolume: 0.1,
    moods: ["crisis", "tense", "unstable"],
  },
  {
    id: "royal_2",
    file: "royal_2.mp3",
    sourceDurationSec: 572,
    maxUseSec: 140,
    defaultVolume: 0.1,
    moods: ["regal", "steady_bed", "documentary"],
  },
  {
    id: "diana",
    file: "diana.mp3",
    sourceDurationSec: 266,
    maxUseSec: 100,
    defaultVolume: 0.09,
    moods: ["memorial", "diana", "elegiac"],
  },
  {
    id: "royal",
    file: "royal.mp3",
    sourceDurationSec: 538,
    maxUseSec: 140,
    defaultVolume: 0.1,
    moods: ["regal", "steady_bed", "documentary"],
  },
];

const TRACK_BY_ID = new Map(TRACKS.map((t) => [t.id, t]));

const MAX_TRACKS = 3;
const MIN_GAP_SEC = 18;
const FADE_IN_SEC = 2.5;
const FADE_OUT_SEC = 3.5;
const BED_VOLUME = 0.1;
const DENSE_VO_VOLUME = 0.08;
const CHAPTER_BOOST_VOLUME = 0.16;
const HARD_MAX_VOLUME = 0.18;
/** Source files loudnorm'd to this; Remotion volume multiplies on top. */
const SOURCE_LUFS = -34;

function musicEnabled(): boolean {
  const raw = optionalEnv("ROYAL_BG_MUSIC");
  if (raw == null || raw === "") return true;
  const v = raw.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function musicModel(): string {
  return (
    optionalEnv("ROYAL_BG_MUSIC_MODEL") ||
    optionalEnv("OPENAI_MODEL") ||
    config.openaiModel ||
    "gpt-5.6"
  );
}

function publicPathFor(id: RoyalMusicId): string {
  const meta = TRACK_BY_ID.get(id);
  return `music/royal/${meta?.file || `${id}.mp3`}`;
}

function clampVolume(v: number): number {
  return Math.max(0.05, Math.min(HARD_MAX_VOLUME, v));
}

function timelineEnd(scenes: TimelineScene[]): number {
  return scenes.reduce((max, s) => Math.max(max, s.endTime || 0), 0);
}

function sampleNarration(scenes: TimelineScene[], maxChars = 4500): string {
  const sorted = [...scenes].sort((a, b) => a.startTime - b.startTime);
  const chunks: string[] = [];
  let used = 0;
  const step = Math.max(1, Math.floor(sorted.length / 28));
  for (let i = 0; i < sorted.length; i += step) {
    const s = sorted[i];
    const line = `[${s.startTime.toFixed(0)}s] ${(s.narrationText || "").slice(0, 140)}`;
    if (used + line.length > maxChars) break;
    chunks.push(line);
    used += line.length;
  }
  return chunks.join("\n");
}

function detectMoodHints(text: string): string[] {
  const hints: string[] = [];
  if (/\b(diana|princess of wales|her death|1997|memorial|grief|mother)\b/i.test(text)) {
    hints.push("diana_memorial");
  }
  if (/\b(will|estate|letter|letters|papers|document|archive|secret)\b/i.test(text)) {
    hints.push("legal_archive");
  }
  if (/\b(crisis|scandal|backlash|outrage|fury|feud|exile|cut off)\b/i.test(text)) {
    hints.push("crisis");
  }
  if (/\b(childhood|memory|private|intimate|past|young|boy)\b/i.test(text)) {
    hints.push("intimate_past");
  }
  if (/\b(crown|coronation|monarchy|palace|queen|king|institution)\b/i.test(text)) {
    hints.push("regal_institution");
  }
  if (/\b(decision|chose|chose to|finally|judgment|settlement)\b/i.test(text)) {
    hints.push("decision");
  }
  return hints;
}

type GptMusicPick = {
  musicId: RoyalMusicId;
  startTime: number;
  durationSec: number;
  role?: "bed" | "chapter_boost" | "memorial";
  reason: string;
};

async function pickMusicWithGpt(params: {
  totalDurationSec: number;
  narrationSample: string;
  moodHints: string[];
}): Promise<GptMusicPick[]> {
  if (skipGptExceptJudge()) return [];

  const catalog = TRACKS.map((t) => ({
    id: t.id,
    moods: t.moods,
    sourceDurationSec: t.sourceDurationSec,
    maxUseSec: t.maxUseSec,
  }));

  const model = musicModel();
  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model,
    temperature: 0.25,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You plan INTERNATIONAL royal documentary background MUSIC (BBC/Netflix doc style).
Rules:
- Max ${MAX_TRACKS} tracks total for the whole video. Prefer 2–3.
- Sparse beds: NOT wall-to-wall. Leave silent stretches (especially dense narration).
- Each piece: typically 45–120s (respect maxUseSec). Fade handles edges.
- Min ~${MIN_GAP_SEC}s silence between pieces when switching tracks.
- Match mood: diana → memorial; crisis/scandal → monarchy_in_crisis or royal_backlash;
  wills/papers/legal → palace_papers_and_secret_wills; intimate past/letters → a_private_message_from_the_past;
  crown/institution → the_sacred_crown or royal/royal_2; solemn decision → the_palace_decision.
- Prefer distinct moods across the 2–3 picks (don't pick royal + royal_2 together).
- Place chapter_boost only on major turns; memorial for Diana sections; bed elsewhere.
- startTime must be within [0, totalDurationSec). end = start+duration must not exceed totalDurationSec.
Return JSON: { "picks": [ { "musicId": "...", "startTime": 0, "durationSec": 90, "role": "bed"|"chapter_boost"|"memorial", "reason": "..." } ] }`,
      },
      {
        role: "user",
        content: JSON.stringify({
          totalDurationSec: Math.round(params.totalDurationSec),
          moodHints: params.moodHints,
          catalog,
          narrationSample: params.narrationSample,
          instruction: `Pick up to ${MAX_TRACKS} pieces. Cover roughly 35–55% of timeline with music; rest silent.`,
        }),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as { picks?: GptMusicPick[] };
    return Array.isArray(parsed.picks) ? parsed.picks : [];
  } catch {
    return [];
  }
}

function ruleFallbackPicks(params: {
  totalDurationSec: number;
  moodHints: string[];
}): GptMusicPick[] {
  const T = params.totalDurationSec;
  if (T < 40) return [];

  const picks: GptMusicPick[] = [];
  const hints = new Set(params.moodHints);

  // Opener bed (regal or decision)
  const openDur = Math.min(85, Math.max(50, T * 0.18));
  if (hints.has("decision") || hints.has("regal_institution")) {
    picks.push({
      musicId: hints.has("decision") ? "the_palace_decision" : "the_sacred_crown",
      startTime: Math.min(8, T * 0.02),
      durationSec: openDur,
      role: "bed",
      reason: "rule_opener",
    });
  } else {
    picks.push({
      musicId: "royal",
      startTime: Math.min(10, T * 0.025),
      durationSec: openDur,
      role: "bed",
      reason: "rule_opener_regal",
    });
  }

  // Mid: Diana / archive / crisis
  const midStart = Math.max(openDur + MIN_GAP_SEC + 5, T * 0.35);
  if (midStart + 50 < T && picks.length < MAX_TRACKS) {
    if (hints.has("diana_memorial")) {
      picks.push({
        musicId: "diana",
        startTime: midStart,
        durationSec: Math.min(95, T - midStart - 10),
        role: "memorial",
        reason: "rule_diana",
      });
    } else if (hints.has("legal_archive")) {
      picks.push({
        musicId: "palace_papers_and_secret_wills",
        startTime: midStart,
        durationSec: Math.min(100, T - midStart - 10),
        role: "bed",
        reason: "rule_legal_archive",
      });
    } else if (hints.has("intimate_past")) {
      picks.push({
        musicId: "a_private_message_from_the_past",
        startTime: midStart,
        durationSec: Math.min(90, T - midStart - 10),
        role: "bed",
        reason: "rule_intimate",
      });
    } else if (hints.has("crisis")) {
      picks.push({
        musicId: "monarchy_in_crisis",
        startTime: midStart,
        durationSec: Math.min(100, T - midStart - 10),
        role: "chapter_boost",
        reason: "rule_crisis",
      });
    }
  }

  // Late: backlash / crisis close if unused
  const last = picks[picks.length - 1];
  const lateStart = (last ? last.startTime + last.durationSec : T * 0.55) + MIN_GAP_SEC + 8;
  if (lateStart + 45 < T && picks.length < MAX_TRACKS && hints.has("crisis")) {
    const usedCrisis = picks.some(
      (p) => p.musicId === "monarchy_in_crisis" || p.musicId === "royal_backlash"
    );
    if (!usedCrisis) {
      picks.push({
        musicId: "royal_backlash",
        startTime: lateStart,
        durationSec: Math.min(90, T - lateStart - 5),
        role: "chapter_boost",
        reason: "rule_late_backlash",
      });
    } else if (!picks.some((p) => p.musicId === "royal_2" || p.musicId === "royal")) {
      picks.push({
        musicId: "royal_2",
        startTime: lateStart,
        durationSec: Math.min(80, T - lateStart - 5),
        role: "bed",
        reason: "rule_late_bed",
      });
    }
  }

  return picks.slice(0, MAX_TRACKS);
}

function voDensityAround(scenes: TimelineScene[], start: number, end: number): number {
  const overlap = scenes.filter((s) => s.endTime > start && s.startTime < end);
  if (!overlap.length) return 0;
  const chars = overlap.reduce((n, s) => n + (s.narrationText || "").length, 0);
  const span = Math.max(1, end - start);
  return chars / span;
}

function resolveVolume(
  role: RoyalMusicEvent["role"],
  meta: TrackMeta,
  density: number
): number {
  let v = meta.defaultVolume || BED_VOLUME;
  if (role === "memorial") v = Math.min(v, 0.09);
  if (role === "chapter_boost") v = CHAPTER_BOOST_VOLUME;
  // Dense VO → duck further
  if (density > 18) v = Math.min(v, DENSE_VO_VOLUME);
  else if (density > 12 && role !== "chapter_boost") v = Math.min(v, 0.09);
  return clampVolume(v);
}

function sanitizePicks(
  picks: GptMusicPick[],
  totalDurationSec: number,
  scenes: TimelineScene[]
): RoyalMusicEvent[] {
  const events: RoyalMusicEvent[] = [];
  const usedIds = new Set<RoyalMusicId>();
  let cursor = -MIN_GAP_SEC;

  const sorted = [...picks]
    .filter((p) => p && TRACK_BY_ID.has(p.musicId as RoyalMusicId))
    .sort((a, b) => a.startTime - b.startTime)
    .slice(0, MAX_TRACKS);

  // Avoid royal + royal_2 together
  const hasRoyal = sorted.some((p) => p.musicId === "royal");
  const filtered = sorted.filter((p, i) => {
    if (p.musicId === "royal_2" && hasRoyal && sorted.findIndex((x) => x.musicId === "royal") < i) {
      return false;
    }
    if (p.musicId === "royal" && sorted.some((x) => x.musicId === "royal_2") && !hasRoyal) {
      return p.musicId !== "royal";
    }
    return true;
  });

  for (const pick of filtered) {
    if (events.length >= MAX_TRACKS) break;
    const musicId = pick.musicId as RoyalMusicId;
    if (usedIds.has(musicId)) continue;
    const meta = TRACK_BY_ID.get(musicId);
    if (!meta) continue;

    let start = Math.max(0, Number(pick.startTime) || 0);
    if (start < cursor + MIN_GAP_SEC) start = cursor + MIN_GAP_SEC;
    if (start >= totalDurationSec - 20) continue;

    let duration = Math.max(40, Number(pick.durationSec) || 75);
    duration = Math.min(duration, meta.maxUseSec, meta.sourceDurationSec, totalDurationSec - start);
    if (duration < 35) continue;

    const role: RoyalMusicEvent["role"] =
      pick.role === "chapter_boost" || pick.role === "memorial" ? pick.role : "bed";
    const density = voDensityAround(scenes, start, start + duration);
    const volume = resolveVolume(role, meta, density);

    const startR = Math.round(start * 10) / 10;
    const durR = Math.round(duration * 10) / 10;
    events.push({
      id: `music-${musicId}-${Math.round(startR)}`,
      musicId,
      publicPath: publicPathFor(musicId),
      startTime: startR,
      durationSec: durR,
      volume,
      fadeInSec: FADE_IN_SEC,
      fadeOutSec: FADE_OUT_SEC,
      reason: pick.reason || "gpt",
      role,
    });
    usedIds.add(musicId);
    cursor = startR + durR;
  }

  return events;
}

/**
 * Plan Royal BG music: GPT (or rules) picks ≤3 sparse beds with fades under VO.
 */
export async function planRoyalV2BackgroundMusic(params: {
  scenes: TimelineScene[];
}): Promise<{ events: RoyalMusicEvent[]; gptCallsUsed: number; report: Record<string, unknown> }> {
  if (!musicEnabled()) {
    return {
      events: [],
      gptCallsUsed: 0,
      report: { enabled: false, reason: "ROYAL_BG_MUSIC disabled" },
    };
  }

  const scenes = [...params.scenes].sort((a, b) => a.startTime - b.startTime);
  const totalDurationSec = timelineEnd(scenes);
  if (totalDurationSec < 30 || !scenes.length) {
    return {
      events: [],
      gptCallsUsed: 0,
      report: { enabled: true, reason: "timeline_too_short", totalDurationSec },
    };
  }

  const narrationSample = sampleNarration(scenes);
  const moodHints = detectMoodHints(narrationSample);

  let gptCallsUsed = 0;
  let picks: GptMusicPick[] = [];
  try {
    picks = await pickMusicWithGpt({ totalDurationSec, narrationSample, moodHints });
    if (picks.length) gptCallsUsed = 1;
  } catch (err) {
    console.warn(
      "[royal-music] GPT music plan failed, using rules only:",
      err instanceof Error ? err.message : String(err)
    );
  }

  if (!picks.length) {
    picks = ruleFallbackPicks({ totalDurationSec, moodHints });
  }

  const events = sanitizePicks(picks, totalDurationSec, scenes);
  const musicCoverageSec = events.reduce((n, e) => n + e.durationSec, 0);

  return {
    events,
    gptCallsUsed,
    report: {
      enabled: true,
      model: musicModel(),
      totalDurationSec,
      trackCount: events.length,
      maxTracks: MAX_TRACKS,
      musicCoverageSec: Math.round(musicCoverageSec),
      coverageRatio: totalDurationSec > 0 ? Number((musicCoverageSec / totalDurationSec).toFixed(3)) : 0,
      moodHints,
      byMusicId: Object.fromEntries(events.map((e) => [e.musicId, e.durationSec])),
      minGapSec: MIN_GAP_SEC,
      fadeInSec: FADE_IN_SEC,
      fadeOutSec: FADE_OUT_SEC,
      volumes: {
        bed: BED_VOLUME,
        denseVoDuck: DENSE_VO_VOLUME,
        chapterBoost: CHAPTER_BOOST_VOLUME,
        hardMax: HARD_MAX_VOLUME,
        sourceLufs: SOURCE_LUFS,
      },
      strategy:
        "Sparse international royal beds; max 3; silence between pieces; duck under dense VO; slight boost only on chapter/memorial",
    },
  };
}
