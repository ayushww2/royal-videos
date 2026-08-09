/**
 * Royal v2 scene-change SFX planner (international documentary bed).
 * Soft whooshes on scene boundaries + GPT accents for press/archive/legal turns.
 */
import { getOpenAI } from "../../openaiClient.js";
import { config, optionalEnv } from "../../config.js";
import { skipGptExceptJudge } from "../pipelineMode.js";
import type { TimelineScene } from "../../../shared/visualIntelligence.js";
import type { EffectTimelineEvent } from "../effectPlanner.js";

export type RoyalSfxId =
  | "soft_whip"
  | "soft_swipe"
  | "slide_change"
  | "camera_shutter"
  | "camera_flash"
  | "film_gate"
  | "cinematic_whoosh"
  | "cinematic_hit";

export type RoyalSfxEvent = {
  id: string;
  sfxId: RoyalSfxId;
  /** Path under Remotion public dir, e.g. sfx/royal/soft_whip.wav */
  publicPath: string;
  startTime: number;
  durationSec: number;
  volume: number;
  reason: string;
  sceneId?: string;
};

const SOFT_ROTATION: RoyalSfxId[] = ["soft_whip", "soft_swipe", "slide_change"];
const ACCENT_IDS: RoyalSfxId[] = [
  "camera_shutter",
  "camera_flash",
  "film_gate",
  "cinematic_whoosh",
  "cinematic_hit",
];

const DEFAULT_VOLUME: Record<RoyalSfxId, number> = {
  soft_whip: 0.22,
  soft_swipe: 0.2,
  slide_change: 0.24,
  camera_shutter: 0.28,
  camera_flash: 0.26,
  film_gate: 0.3,
  cinematic_whoosh: 0.2,
  cinematic_hit: 0.18,
};

const MAX_DURATION: Record<RoyalSfxId, number> = {
  soft_whip: 0.65,
  soft_swipe: 0.45,
  slide_change: 0.9,
  camera_shutter: 0.65,
  camera_flash: 1.1,
  film_gate: 1.6,
  cinematic_whoosh: 2.0,
  cinematic_hit: 2.2,
};

/** Global duck under VO — extra attenuation on top of normalized -28 LUFS files. */
const MASTER_DUCK = 0.85;
/** Target ~2 scene-change SFX events per minute (soft bed + accents share this budget). */
const TARGET_SFX_PER_MINUTE = 2;
/** Min seconds between any scene-change SFX (soft or accent). */
const MIN_SFX_SPACING_SEC = 25;

function sfxEnabled(): boolean {
  const raw = optionalEnv("ROYAL_SFX");
  if (raw == null || raw === "") return true;
  const v = raw.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function publicPathFor(id: RoyalSfxId): string {
  return `sfx/royal/${id}.wav`;
}

function volumeFor(id: RoyalSfxId, scale = 1): number {
  return Math.max(0.05, Math.min(0.45, DEFAULT_VOLUME[id] * MASTER_DUCK * scale));
}

function sfxModel(): string {
  return optionalEnv("ROYAL_SFX_MODEL") || optionalEnv("OPENAI_MODEL") || config.openaiModel || "gpt-5.6";
}

function beatLooksPress(text: string): boolean {
  return /\b(press|paparazzi|camera|cameras|flash|newspaper|tabloid|media|photographer|headline|masthead)\b/i.test(
    text
  );
}

function beatLooksArchive(text: string): boolean {
  return /\b(diana|1997|archive|legacy|memorial|childhood|young|vintage|letter|letters|will|estate document)\b/i.test(
    text
  );
}

function beatLooksLegal(text: string): boolean {
  return /\b(court|high court|judgment|settlement|barrister|lawsuit|legal|damages|hearing)\b/i.test(
    text
  );
}

function beatLooksChapter(text: string, index: number, total: number): boolean {
  if (index === 0) return false;
  if (index % 40 === 0) return true;
  return /\b(but|however|so when|the truth|meanwhile|years later|finally)\b/i.test(text);
}

type GptAccentPick = {
  sceneId: string;
  sfxId: RoyalSfxId | "none";
  reason: string;
};

async function pickAccentsWithGpt(params: {
  candidates: Array<{
    sceneId: string;
    startTime: number;
    narrationText: string;
    beatType?: string;
    effectPresetIds: string[];
  }>;
}): Promise<GptAccentPick[]> {
  if (!params.candidates.length || skipGptExceptJudge()) return [];

  const model = sfxModel();
  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You plan INTERNATIONAL royal documentary transition accents (BBC/Netflix doc style).
Rules:
- Accents only on meaningful scene changes (never mid-scene).
- Prefer subtle. Most cuts already have a soft whoosh — only add accents when earned.
- Allowed accent ids: camera_shutter, camera_flash, film_gate, cinematic_whoosh, cinematic_hit, or none.
- camera_flash/shutter: press, paparazzi, newspapers, photos.
- film_gate: archive, Diana legacy, vintage, letters/estate docs.
- cinematic_whoosh: rare chapter turns.
- cinematic_hit: very rare legal judgment / major reveal.
- No sci-fi, glitch, risers, meme sounds.
Return JSON: { "picks": [ { "sceneId": "...", "sfxId": "camera_flash"|"none"|..., "reason": "..." } ] }`,
      },
      {
        role: "user",
        content: JSON.stringify({
          candidates: params.candidates.slice(0, 80),
          instruction: "Pick accents for up to ~12-18% of these candidates; rest none.",
        }),
      },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as { picks?: GptAccentPick[] };
    return Array.isArray(parsed.picks) ? parsed.picks : [];
  } catch {
    return [];
  }
}

/**
 * Plan Royal SFX: soft cut on each scene change (rotated), GPT accents on select beats.
 * Soft SFX repeat by rotation every scene change; same soft id max every 3rd cut.
 * Accents: min ~12s apart; same accent id min ~45s.
 */
export async function planRoyalV2SceneSfx(params: {
  scenes: TimelineScene[];
  effectEvents?: EffectTimelineEvent[];
}): Promise<{ events: RoyalSfxEvent[]; gptCallsUsed: number; report: Record<string, unknown> }> {
  if (!sfxEnabled()) {
    return {
      events: [],
      gptCallsUsed: 0,
      report: { enabled: false, reason: "ROYAL_SFX disabled" },
    };
  }

  const scenes = [...params.scenes].sort((a, b) => a.startTime - b.startTime);
  const effectsByScene = new Map<string, string[]>();
  for (const ev of params.effectEvents || []) {
    const sid = String((ev as { sceneId?: string }).sceneId || "");
    if (!sid) continue;
    const list = effectsByScene.get(sid) || [];
    list.push(ev.presetId);
    effectsByScene.set(sid, list);
  }

  const events: RoyalSfxEvent[] = [];
  let softIdx = 0;
  let lastAccentAt = -999;
  let lastSfxAt = -999;
  const lastAccentIdAt = new Map<string, number>();
  const timelineSec = Math.max(
    1,
    scenes.reduce((max, s) => Math.max(max, s.endTime || 0), 0)
  );
  const maxSoftBudget = Math.max(
    2,
    Math.round((timelineSec / 60) * TARGET_SFX_PER_MINUTE)
  );

  // Soft bed on paced scene changes (~2/min), not every cut — avoids dense whoosh stacks.
  for (let i = 1; i < scenes.length; i++) {
    const scene = scenes[i];
    if (events.filter((e) => e.reason === "scene_change_soft").length >= maxSoftBudget) break;
    if (scene.startTime - lastSfxAt < MIN_SFX_SPACING_SEC) continue;
    const sfxId = SOFT_ROTATION[softIdx % SOFT_ROTATION.length];
    softIdx += 1;
    events.push({
      id: `sfx-soft-${scene.sceneId}`,
      sfxId,
      publicPath: publicPathFor(sfxId),
      startTime: scene.startTime,
      durationSec: MAX_DURATION[sfxId],
      volume: volumeFor(sfxId),
      reason: "scene_change_soft",
      sceneId: scene.sceneId,
    });
    lastSfxAt = scene.startTime;
  }

  // Accent candidates (rule prefilter → GPT).
  const accentCandidates = scenes
    .slice(1)
    .filter((scene, idx) => {
      const text = `${scene.narrationText || ""} ${scene.viewerShouldSee || ""} ${scene.selectionIntent || ""}`;
      const presets = effectsByScene.get(scene.sceneId) || [];
      return (
        beatLooksPress(text) ||
        beatLooksArchive(text) ||
        beatLooksLegal(text) ||
        beatLooksChapter(text, idx + 1, scenes.length) ||
        presets.some((p) =>
          /08_reveal|09_glitch|10_red_grid|07_split|15_quote|05_archive|21_royal/i.test(p)
        )
      );
    })
    .map((scene) => ({
      sceneId: scene.sceneId,
      startTime: scene.startTime,
      narrationText: (scene.narrationText || "").slice(0, 180),
      beatType: scene.beatType,
      effectPresetIds: effectsByScene.get(scene.sceneId) || [],
    }));

  let gptCallsUsed = 0;
  let picks: GptAccentPick[] = [];
  try {
    picks = await pickAccentsWithGpt({ candidates: accentCandidates });
    if (picks.length) gptCallsUsed = 1;
  } catch (err) {
    console.warn(
      "[royal-sfx] GPT accent plan failed, using rules only:",
      err instanceof Error ? err.message : String(err)
    );
  }

  const pickByScene = new Map(picks.map((p) => [p.sceneId, p]));

  const totalSfxBudget = Math.max(2, Math.round((timelineSec / 60) * TARGET_SFX_PER_MINUTE));

  for (const cand of accentCandidates) {
    const scene = scenes.find((s) => s.sceneId === cand.sceneId);
    if (!scene) continue;
    const text = cand.narrationText;
    let sfxId: RoyalSfxId | "none" = pickByScene.get(cand.sceneId)?.sfxId || "none";
    let reason = pickByScene.get(cand.sceneId)?.reason || "gpt";

    if (sfxId === "none" || !ACCENT_IDS.includes(sfxId as RoyalSfxId)) {
      // Rule fallback if GPT said none / missing
      if (beatLooksPress(text)) {
        sfxId = /flash|paparazzi|swarm|cameras/i.test(text) ? "camera_flash" : "camera_shutter";
        reason = "rule_press";
      } else if (beatLooksArchive(text)) {
        sfxId = "film_gate";
        reason = "rule_archive";
      } else if (beatLooksLegal(text) && /judgment|damages|settlement|finally/i.test(text)) {
        sfxId = "cinematic_hit";
        reason = "rule_legal_hit";
      } else if (beatLooksChapter(text, scenes.indexOf(scene), scenes.length)) {
        sfxId = "cinematic_whoosh";
        reason = "rule_chapter";
      } else {
        continue;
      }
    }

    // After rule fallback, sfxId is a concrete accent id.
    const accentId = sfxId as RoyalSfxId;
    if (scene.startTime - lastAccentAt < 12) continue;
    const prevSame = lastAccentIdAt.get(accentId) ?? -999;
    if (scene.startTime - prevSame < 45) continue;

    // Replace soft at this boundary with accent (avoid double hit).
    const softIdxEvent = events.findIndex(
      (e) => e.sceneId === scene.sceneId && e.reason === "scene_change_soft"
    );
    if (softIdxEvent >= 0) {
      events.splice(softIdxEvent, 1);
    } else if (events.length >= totalSfxBudget) {
      // Prefer accents over the nearest soft when budget is full.
      const dropSoft = events.findIndex((e) => e.reason === "scene_change_soft");
      if (dropSoft < 0) continue;
      events.splice(dropSoft, 1);
    }

    events.push({
      id: `sfx-accent-${scene.sceneId}`,
      sfxId: accentId,
      publicPath: publicPathFor(accentId),
      startTime: scene.startTime,
      durationSec: MAX_DURATION[accentId],
      volume: volumeFor(accentId, 0.95),
      reason,
      sceneId: scene.sceneId,
    });
    lastAccentAt = scene.startTime;
    lastAccentIdAt.set(accentId, scene.startTime);
  }

  // Hard-cap to ~2/min after accents (keep earliest spaced events).
  if (events.length > totalSfxBudget) {
    events.sort((a, b) => a.startTime - b.startTime);
    const kept: RoyalSfxEvent[] = [];
    let prev = -999;
    for (const ev of events) {
      if (kept.length >= totalSfxBudget) break;
      if (ev.startTime - prev < MIN_SFX_SPACING_SEC && kept.length) continue;
      kept.push(ev);
      prev = ev.startTime;
    }
    events.length = 0;
    events.push(...kept);
  }

  events.sort((a, b) => a.startTime - b.startTime);

  const softCount = events.filter((e) => e.reason === "scene_change_soft").length;
  const accentCount = events.length - softCount;
  const byId: Record<string, number> = {};
  for (const e of events) byId[e.sfxId] = (byId[e.sfxId] || 0) + 1;

  return {
    events,
    gptCallsUsed,
    report: {
      enabled: true,
      model: sfxModel(),
      totalEvents: events.length,
      softCutCount: softCount,
      accentCount,
      bySfxId: byId,
      softRepeatPolicy: `rotate soft_whip → soft_swipe → slide_change; paced ~${TARGET_SFX_PER_MINUTE}/min on scene changes`,
      targetSfxPerMinute: TARGET_SFX_PER_MINUTE,
      minSfxSpacingSec: MIN_SFX_SPACING_SEC,
      totalSfxBudget,
      accentSpacingSec: { minBetweenAny: 12, minSameId: 45 },
      masterDuck: MASTER_DUCK,
      loudnessPrepLufs: -28,
      rejectedPackItems: [
        "glitch",
        "dslr-burst",
        "sci-fi-scanner",
        "digital-snap-malfunction",
        "riser",
      ],
    },
  };
}
