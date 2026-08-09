import { jobDataFile, writeJson } from "../storage.js";
import { chatJson } from "../openaiClient.js";
import { mapEffectsToShotstack } from "../render/shotstackEffectMapper.js";
import { skipGptExceptJudge } from "./pipelineMode.js";
import {
  planRoyalV2EditingEffects,
  royalV2EffectCadenceReport,
} from "./royalV2/effectRules.js";
import { planCelebrityV1EditingEffects } from "./celebrityV1/effectRules.js";
import { celebrityRecipeActive } from "./celebrityV1/referenceRecipe.js";
import { isDirectorInstructionText } from "./royalV2/taxonomy.js";
import type {
  JobRecord,
  TitleLock,
  TimelineScene,
  VisualBeat,
} from "../../shared/visualIntelligence.js";

export type SelectedPresetId =
  | "01_classic_blue_white_lower_third"
  | "02_secondary_blue_lower_third"
  | "03_simple_text_overlay"
  | "04_glass_gallery_slideshow"
  | "05_archive_ribbon_slideshow"
  | "06_cinematic_stage_slideshow"
  | "07_split_comparison_slideshow"
  | "08_reveal_question"
  | "09_glitch_cut_transition"
  | "10_red_grid_archive_background"
  | "15_quote_only"
  | "21_royal_archive_slideshow"
  | "24_soft_glass_focus_slideshow"
  | "25_clean_zoom_frame_slideshow"
  | "26_minimal_blur_backdrop_slideshow"
  | "27_editorial_soft_pan_slideshow"
  | "28_crystal_stage_slideshow"
  | "29_classic_purple_white_lower_third";

export interface EffectTimelineEvent {
  id: string;
  presetId: SelectedPresetId;
  startFrame: number;
  durationFrames: number;
  layer: number;
  props: Record<string, unknown>;
  tags: string[];
  sceneId?: string;
  reason?: string;
  effectImportance?: number;
  blocksSubtitles?: boolean;
}

export interface EffectPlannerReport {
  jobId: string;
  fps: number;
  totalScenes: number;
  totalEffectEvents: number;
  plannedEffectsCount?: number;
  renderableEffectsCount?: number;
  skippedEffectsCount?: number;
  effectsPerMinute: number;
  effectsPerMinuteRenderable?: number;
  cadenceMetFinalRender?: boolean;
  presetIdsUsed: string[];
  presetIdsRenderable?: string[];
  presetIdsSimplified?: string[];
  presetIdsSkipped?: string[];
  lowerThirdsCount: number;
  slideshowPresentationCount: number;
  revealGlitchCount: number;
  spacingWarnings: string[];
  subtitleOverlapWarnings: string[];
  validationErrors: string[];
  events: EffectTimelineEvent[];
  createdAt: string;
}

const FPS = 30;
const SUPPORTED = new Set<SelectedPresetId>([
  "01_classic_blue_white_lower_third",
  "02_secondary_blue_lower_third",
  "03_simple_text_overlay",
  "04_glass_gallery_slideshow",
  "05_archive_ribbon_slideshow",
  "06_cinematic_stage_slideshow",
  "07_split_comparison_slideshow",
  "08_reveal_question",
  "09_glitch_cut_transition",
  "10_red_grid_archive_background",
  "15_quote_only",
  "21_royal_archive_slideshow",
  "24_soft_glass_focus_slideshow",
  "25_clean_zoom_frame_slideshow",
  "26_minimal_blur_backdrop_slideshow",
  "27_editorial_soft_pan_slideshow",
  "28_crystal_stage_slideshow",
  "29_classic_purple_white_lower_third",
]);

function secToFrame(sec: number): number {
  return Math.max(0, Math.round(sec * FPS));
}

function clampDurationFrames(sec: number, min: number, max: number): number {
  const d = Math.max(min, Math.min(max, sec));
  return Math.max(1, Math.round(d * FPS));
}

function upperShort(text: string, maxWords = 6): string {
  const words = text
    .replace(/[^a-zA-Z0-9\s'’-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  return words.join(" ").toUpperCase();
}

function isTextHeavyScene(scene: TimelineScene): boolean {
  return Boolean(scene.isTextHeavy) || (scene.warnings || []).some((w) => w.includes("text-heavy"));
}

function sceneImage(scene: TimelineScene, libraryUrls: Map<string, string>): string | undefined {
  return libraryUrls.get(scene.approvedVisualId || scene.selectedVisualId);
}

function validateEvent(event: EffectTimelineEvent, videoEndFrame: number): string[] {
  const errors: string[] = [];
  if (!event.id) errors.push(`${event.presetId}: missing id`);
  if (!SUPPORTED.has(event.presetId)) errors.push(`${event.id}: unsupported presetId ${event.presetId}`);
  if (event.durationFrames <= 0) errors.push(`${event.id}: negative/zero duration`);
  if (event.startFrame < 0) errors.push(`${event.id}: negative startFrame`);
  if (event.startFrame + event.durationFrames > videoEndFrame + FPS) {
    errors.push(`${event.id}: effect extends past video end`);
  }
  const p = event.props || {};
  switch (event.presetId) {
    case "01_classic_blue_white_lower_third":
    case "02_secondary_blue_lower_third":
    case "29_classic_purple_white_lower_third":
      if (!String(p.primaryText || "").trim()) errors.push(`${event.id}: missing primaryText`);
      break;
    case "03_simple_text_overlay":
      if (!String(p.text || "").trim()) errors.push(`${event.id}: missing text`);
      break;
    case "04_glass_gallery_slideshow":
    case "05_archive_ribbon_slideshow":
    case "06_cinematic_stage_slideshow":
    case "21_royal_archive_slideshow":
    case "24_soft_glass_focus_slideshow":
    case "25_clean_zoom_frame_slideshow":
    case "26_minimal_blur_backdrop_slideshow":
    case "27_editorial_soft_pan_slideshow":
    case "28_crystal_stage_slideshow": {
      const slides = p.slides as Array<{ src?: string }> | undefined;
      if (!slides?.length) errors.push(`${event.id}: missing slides`);
      else slides.forEach((s, i) => {
        if (!s.src) errors.push(`${event.id}: slides[${i}] missing image`);
      });
      break;
    }
    case "07_split_comparison_slideshow":
      if (!p.leftImageSrc || !p.rightImageSrc) errors.push(`${event.id}: missing comparison images`);
      break;
    case "08_reveal_question":
      if (!String(p.question || p.primaryText || "").trim()) errors.push(`${event.id}: missing question`);
      break;
    case "09_glitch_cut_transition":
      if (!p.fromImageSrc || !p.toImageSrc) errors.push(`${event.id}: missing glitch images`);
      break;
    case "10_red_grid_archive_background":
      if (!p.mainImage) errors.push(`${event.id}: missing mainImage`);
      if (!String(p.title || "").trim()) errors.push(`${event.id}: missing title`);
      break;
    case "15_quote_only":
      if (!String(p.quote || p.text || "").trim()) errors.push(`${event.id}: missing quote`);
      break;
  }
  return errors;
}

function sanitizeOnScreenValue(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (isDirectorInstructionText(text)) return "";
  if (/\bROYAL\s*V\s*2\b|\bROYAL DOCUMENTARY\b/i.test(text)) return "";
  return text;
}

function sanitizeRoyalEffectProps(event: EffectTimelineEvent): EffectTimelineEvent {
  const props = { ...event.props };
  for (const key of [
    "primaryText",
    "secondaryText",
    "tagText",
    "locationTag",
    "text",
    "question",
    "subtext",
    "title",
    "subtitle",
    "kicker",
    "caption",
    "attribution",
    "context",
    "leftLabel",
    "rightLabel",
  ]) {
    if (key in props) props[key] = sanitizeOnScreenValue(props[key]);
  }
  if (Array.isArray(props.slides)) {
    props.slides = (props.slides as Array<Record<string, unknown>>).map((slide) => ({
      ...slide,
      caption: sanitizeOnScreenValue(slide.caption),
      kicker: sanitizeOnScreenValue(slide.kicker),
    }));
  }
  return { ...event, props };
}

async function gptOptimizeEffectCopy(params: {
  job: JobRecord;
  titleLock?: TitleLock | null;
  events: EffectTimelineEvent[];
  scenes: TimelineScene[];
  beats: VisualBeat[];
}): Promise<EffectTimelineEvent[]> {
  if (!params.events.length) return params.events;
  if (skipGptExceptJudge()) {
    console.warn(`[effectPlanner] efficient/cheap — skip GPT copy for ${params.job.jobId}`);
    return params.events;
  }
  // Royal v2 keeps planner-authored public titles; GPT must not invent niche labels or director text.
  if (params.job.niche === "Royal v2") {
    return params.events.map((event) => sanitizeRoyalEffectProps(event));
  }

  const beatById = new Map(params.beats.map((b) => [b.beatId, b]));
  const slim = params.events.map((e) => {
    const scene = params.scenes.find((s) => s.sceneId === e.sceneId);
    const beat = scene ? beatById.get(scene.beatId) : undefined;
    return {
      id: e.id,
      presetId: e.presetId,
      narrationText: (scene?.narrationText || "").slice(0, 220),
      exactSubject: beat?.exactSubject || beat?.mustMatchEntity || "",
      viewerShouldSee: beat?.viewerShouldSee || "",
      currentProps: {
        primaryText: e.props.primaryText,
        secondaryText: e.props.secondaryText,
        text: e.props.text,
        question: e.props.question,
        subtext: e.props.subtext,
        quote: e.props.quote,
        attribution: e.props.attribution,
        context: e.props.context,
        leftLabel: e.props.leftLabel,
        rightLabel: e.props.rightLabel,
        title: e.props.title,
        subtitle: e.props.subtitle,
        kicker: e.props.kicker,
        caption: e.props.caption,
      },
    };
  });

  try {
    const result = await chatJson<{
      items: Array<{
        id: string;
        primaryText?: string;
        secondaryText?: string;
        text?: string;
        question?: string;
        subtext?: string;
        quote?: string;
        attribution?: string;
        context?: string;
        leftLabel?: string;
        rightLabel?: string;
        title?: string;
        subtitle?: string;
        kicker?: string;
        caption?: string;
      }>;
    }>({
      system: `You write ON-SCREEN documentary graphics copy.
Rules:
- Text must match THIS script/topic only (never generic demo names like DR. ROBERT HAYES unless in script).
- Lower thirds: short uppercase entity names (person/place/org/object).
- Simple text: max 5–7 words, factual, no full sentences.
- Reveal questions: dramatic but grounded in narration.
- Quotes: keep attribution short; quote text can be a concise paraphrase of narration.
- Labels/titles: short, uppercase, no preset names, no debug words.
- Leave image URLs alone; only return text fields.
Return JSON { items: [{ id, ...textFields }] }.`,
      user: JSON.stringify({
        title: params.job.title,
        niche: params.job.niche,
        titleLock: params.titleLock
          ? {
              mainSubject: params.titleLock.mainSubject,
              centralObjectOrPlace: params.titleLock.centralObjectOrPlace,
              mysteryOrConflict: params.titleLock.mysteryOrConflict,
            }
          : null,
        effects: slim,
      }),
    });

    const byId = new Map((result.items || []).map((i) => [i.id, i]));
    return params.events.map((e) => {
      const g = byId.get(e.id);
      if (!g) return e;
      const props = { ...e.props };
      const set = (key: string, val?: string, maxWords?: number) => {
        if (!val || !String(val).trim()) return;
        props[key] = maxWords ? upperShort(String(val), maxWords) : String(val).trim();
      };
      if (e.presetId === "08_reveal_question") {
        const q = g.question || g.primaryText;
        const sub = g.subtext || g.secondaryText;
        set("question", q, 8);
        set("primaryText", q, 8);
        set("subtext", sub, 10);
        set("secondaryText", sub, 10);
      } else if (e.presetId === "15_quote_only") {
        if (g.quote || g.text) props.quote = String(g.quote || g.text).trim().slice(0, 160);
        set("attribution", g.attribution || g.primaryText, 5);
        set("context", g.context || g.secondaryText, 5);
      } else if (e.presetId === "03_simple_text_overlay") {
        set("text", g.text || g.primaryText, 7);
        set("secondaryText", g.secondaryText || g.subtext, 8);
      } else if (e.presetId === "07_split_comparison_slideshow") {
        set("leftLabel", g.leftLabel, 4);
        set("rightLabel", g.rightLabel, 4);
      } else if (e.presetId === "10_red_grid_archive_background") {
        set("title", g.title || g.primaryText, 5);
        set("subtitle", g.subtitle || g.secondaryText, 8);
      } else {
        set("primaryText", g.primaryText, 6);
        set("secondaryText", g.secondaryText, 6);
        set("text", g.text, 7);
        set("kicker", g.kicker, 4);
        set("caption", g.caption, 12);
        set("title", g.title, 5);
        set("subtitle", g.subtitle, 8);
      }
      // Keep slideshow captions/kickers inside slides if present
      if (Array.isArray(props.slides) && (g.kicker || g.caption)) {
        props.slides = (props.slides as Array<Record<string, unknown>>).map((s, idx) =>
          idx === 0
            ? {
                ...s,
                kicker: g.kicker ? upperShort(g.kicker, 4) : s.kicker,
                caption: g.caption ? String(g.caption).trim() : s.caption,
              }
            : s
        );
      }
      return { ...e, props };
    });
  } catch (err) {
    console.warn(
      `[effectPlanner] GPT copy optimize failed for ${params.job.jobId}:`,
      err instanceof Error ? err.message : err
    );
    return params.events;
  }
}

/**
 * Documentary editor effect planner — 2–3 smart moments per minute.
 * Never uses effects as fallback for bad visuals. Props are script-relevant only.
 */
export async function planEditingEffects(params: {
  job: JobRecord;
  scenes: TimelineScene[];
  beats: VisualBeat[];
  titleLock?: TitleLock | null;
  libraryUrls: Map<string, string>;
}): Promise<EffectPlannerReport> {
  const { job, scenes, beats, titleLock, libraryUrls } = params;
  const events: EffectTimelineEvent[] = [];
  const spacingWarnings: string[] = [];
  const subtitleOverlapWarnings: string[] = [];
  const validationErrors: string[] = [];

  const videoEnd = scenes.reduce((m, s) => Math.max(m, s.endTime || 0), 0);
  const videoEndFrame = secToFrame(videoEnd || 120);
  const durationMin = Math.max(1, videoEnd / 60);

  const beatById = new Map(beats.map((b) => [b.beatId, b]));
  const mentioned = new Set<string>();
  let lastMajorSec = -999;
  let lastLowerSec = -999;
  let lastGlitchSec = -999;
  let classicCount = 0;
  let secondaryCount = 0;
  let revealCount = 0;
  let glitchCount = 0;
  let cinematicCount = 0;

  const push = (ev: EffectTimelineEvent) => {
    const errs = validateEvent(ev, videoEndFrame);
    if (errs.length) {
      validationErrors.push(...errs);
      return;
    }
    events.push(ev);
  };

  // Per-minute effect budgets tracked while iterating
  const minuteBuckets = new Map<number, number>();
  const isRoyalV2 = job.niche === "Royal v2";
  const isCelebrityV1 = celebrityRecipeActive(job.niche);

  if (isRoyalV2) {
    const royalEvents = planRoyalV2EditingEffects({
      job,
      scenes,
      beats,
      libraryUrls,
    });
    for (const ev of royalEvents) {
      push(ev);
      const minute = Math.floor(ev.startFrame / FPS / 60);
      minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
    }
  }

  if (isCelebrityV1) {
    const celebrityEvents = planCelebrityV1EditingEffects({
      job,
      scenes,
      beats,
      titleLock,
      libraryUrls,
    });
    for (const ev of celebrityEvents) {
      push(ev);
      const minute = Math.floor(ev.startFrame / FPS / 60);
      minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
    }
  }

  if (!isRoyalV2 && !isCelebrityV1) for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const beat = beatById.get(scene.beatId);
    const start = scene.startTime;
    const minute = Math.floor(start / 60);
    const minuteCount = minuteBuckets.get(minute) || 0;
    if (minuteCount >= 7) continue;

    const img = sceneImage(scene, libraryUrls);
    const textHeavy = isTextHeavyScene(scene);
    const exact =
      beat?.exactSubject ||
      beat?.mustMatchEntity ||
      beat?.mentionedPlaces?.[0] ||
      beat?.mentionedPeople?.[0] ||
      beat?.mentionedObjects?.[0] ||
      "";
    const role = beat?.visualRole || "main_subject";
    const narr = (scene.narrationText || "").toLowerCase();
    const isQuestion = /\b(why|what|how|who|but)\b/.test(narr) || (beat?.viewerShouldSee || "").includes("?");
    const isSplitPair = /split-screen library match/i.test(scene.reasonSelected || "");
    const nextIsSplitPair =
      i + 1 < scenes.length &&
      /split-screen library match/i.test(scenes[i + 1].reasonSelected || "");
    const isCompare =
      /\b(vs|versus|before|after|compared|unlike|instead|old|new)\b/.test(narr) ||
      role === "evidence" ||
      isSplitPair;
    const isArchive =
      /\b(archive|recorded|documented|years ago|historical|first recorded|discovered)\b/.test(narr) ||
      role === "document";
    const isHero =
      role === "main_subject" &&
      (scene.matchType === "exact_match" || scene.matchType === "strong_match") &&
      !isSplitPair &&
      !nextIsSplitPair &&
      cinematicCount < 3;

    // --- Information effect: lower third / text ---
    if (
      exact &&
      !textHeavy &&
      start - lastLowerSec >= 3.5 &&
      minuteCount < 7 &&
      !mentioned.has(exact.toLowerCase())
    ) {
      const importance = 78 + (role === "main_subject" ? 10 : 0);
      if (importance >= 70) {
        const useSecondary = classicCount > 0 && classicCount % 3 === 0;
        const presetId: SelectedPresetId = useSecondary
          ? "02_secondary_blue_lower_third"
          : "01_classic_blue_white_lower_third";
        const primary = upperShort(exact, 5);
        const secondary = upperShort(
          beat?.mentionedPlaces?.[0] && beat.mentionedPlaces[0] !== exact
            ? beat.mentionedPlaces[0]
            : titleLock?.centralObjectOrPlace || beat?.visualRole || "DOCUMENTARY",
          4
        );
        push({
          id: `effect-${scene.sceneId}-lt`,
          presetId,
          startFrame: secToFrame(start + 0.35),
          durationFrames: clampDurationFrames(3.2, 2.5, 4),
          layer: 20,
          props: {
            primaryText: primary,
            secondaryText: secondary,
            position: "bottom_left",
          },
          tags: ["auto_effect", "lower_third", "important_entity"],
          sceneId: scene.sceneId,
          reason: `First/clear mention of ${exact}`,
          effectImportance: importance,
          blocksSubtitles: true,
        });
        mentioned.add(exact.toLowerCase());
        lastLowerSec = start;
        minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
        if (useSecondary) secondaryCount += 1;
        else classicCount += 1;
        subtitleOverlapWarnings.push(
          `${scene.sceneId}: lower third may overlap subtitles — keep captions higher or shorter`
        );
      }
    } else if (
      !textHeavy &&
      start - lastLowerSec >= 5 &&
      (minuteBuckets.get(minute) || 0) < 6 &&
      /\b(\d{2,}|million|thousand|percent|%|years)\b/i.test(scene.narrationText || "")
    ) {
      const fact = upperShort(scene.narrationText || "", 6);
      if (fact.split(" ").length <= 7) {
        push({
          id: `effect-${scene.sceneId}-text`,
          presetId: "03_simple_text_overlay",
          startFrame: secToFrame(start + 0.4),
          durationFrames: clampDurationFrames(3, 2.5, 4),
          layer: 18,
          props: {
            text: fact,
            position: "bottom_center",
            accentColor: "#74B7FF",
          },
          tags: ["auto_effect", "simple_text"],
          sceneId: scene.sceneId,
          reason: "Key fact/number callout",
          effectImportance: 74,
          blocksSubtitles: true,
        });
        lastLowerSec = start;
        minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
      }
    }

    // --- Visual presentation effects ---
    if (
      img &&
      (isSplitPair || start - lastMajorSec >= 5.5) &&
      (minuteBuckets.get(minute) || 0) < 7
    ) {
      if (isHero && cinematicCount < 4) {
        push({
          id: `effect-${scene.sceneId}-cinematic`,
          presetId: "06_cinematic_stage_slideshow",
          startFrame: secToFrame(start),
          durationFrames: clampDurationFrames(Math.min(scene.duration, 7), 2.5, 8),
          layer: 5,
          props: {
            slides: [
              {
                src: img,
                caption: beat?.viewerShouldSee || "",
                kicker: upperShort(exact || titleLock?.mainSubject || "DISCOVERY", 4),
                focus: { x: 0.5, y: 0.5 },
              },
            ],
            showPresetLabel: false,
          },
          tags: ["auto_effect", "cinematic_stage", "presentation"],
          sceneId: scene.sceneId,
          reason: "Hero / title-supporting visual",
          effectImportance: 88,
        });
        lastMajorSec = start;
        cinematicCount += 1;
        minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
      } else if (isArchive && img) {
        const neighbors = scenes
          .slice(Math.max(0, i - 1), i + 3)
          .map((s) => sceneImage(s, libraryUrls))
          .filter(Boolean) as string[];
        const slides = [...new Set([img, ...neighbors])].slice(0, 3).map((src, idx) => ({
          src,
          kicker: "FIELD RECORD",
          caption: idx === 0 ? beat?.viewerShouldSee || "" : "",
          focus: { x: 0.5, y: 0.5 },
        }));
        if (slides.length >= 1) {
          push({
            id: `effect-${scene.sceneId}-archive`,
            presetId: "05_archive_ribbon_slideshow",
            startFrame: secToFrame(start),
            durationFrames: clampDurationFrames(Math.min(scene.duration, 7), 5, 8),
            layer: 5,
            props: { slides, showPresetLabel: false },
            tags: ["auto_effect", "archive_ribbon", "presentation"],
            sceneId: scene.sceneId,
            reason: "Archive / historical presentation",
            effectImportance: 80,
          });
          lastMajorSec = start;
          minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
        }
      } else if (isCompare) {
        const pair = (beat?.pairOrGroup || []).filter((person) => person !== "British Royal Family");
        const pairedAlternative = (scene.alternativeAssetIds || [])
          .map((assetId) => libraryUrls.get(assetId))
          .find((url) => url && url !== img);
        const nextImg = pairedAlternative || (i + 1 < scenes.length ? sceneImage(scenes[i + 1], libraryUrls) : undefined);
        if (nextImg && nextImg !== img) {
          push({
            id: `effect-${scene.sceneId}-split`,
            presetId: "07_split_comparison_slideshow",
            startFrame: secToFrame(start),
            durationFrames: isSplitPair
              ? clampDurationFrames(scene.duration, 2.5, 4.5)
              : clampDurationFrames(6, 5, 8),
            layer: 6,
            props: {
              leftImageSrc: img,
              rightImageSrc: nextImg,
              leftLabel: upperShort(pair[0] || exact || "LEFT", 3),
              rightLabel: upperShort(
                pair[1] ||
                  (i + 1 < scenes.length
                    ? beatById.get(scenes[i + 1].beatId)?.exactSubject
                    : undefined) ||
                  "RIGHT",
                3
              ),
            },
            tags: ["auto_effect", "split_comparison", "presentation"],
            sceneId: scene.sceneId,
            reason: pair.length >= 2 ? `Side-by-side Royal match: ${pair[0]} and ${pair[1]}` : "Narration compares two ideas/visuals",
            effectImportance: 84,
          });
          lastMajorSec = start;
          minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
        }
      } else if (
        role === "supporting_context" ||
        (beat?.mustShow?.length || 0) > 1
      ) {
        const related = scenes
          .slice(i, i + 4)
          .map((s) => sceneImage(s, libraryUrls))
          .filter(Boolean) as string[];
        const uniq = [...new Set(related)].slice(0, 4);
        if (uniq.length >= 2) {
          push({
            id: `effect-${scene.sceneId}-glass`,
            presetId: "04_glass_gallery_slideshow",
            startFrame: secToFrame(start),
            durationFrames: clampDurationFrames(Math.min(8, uniq.length * 2.5), 6, 10),
            layer: 5,
            props: {
              slides: uniq.map((src) => ({
                src,
                focus: { x: 0.5, y: 0.5 },
                caption: "",
              })),
              showPresetLabel: false,
            },
            tags: ["auto_effect", "glass_gallery", "presentation"],
            sceneId: scene.sceneId,
            reason: "Related evidence/image sequence",
            effectImportance: 76,
          });
          lastMajorSec = start;
          minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
        }
      } else if (
        /\b(investigation|scan|report|map|data|evidence board)\b/.test(narr) &&
        img
      ) {
        const sides = scenes
          .slice(Math.max(0, i - 2), i + 3)
          .map((s) => sceneImage(s, libraryUrls))
          .filter((u): u is string => !!u && u !== img)
          .slice(0, 2);
        push({
          id: `effect-${scene.sceneId}-redgrid`,
          presetId: "10_red_grid_archive_background",
          startFrame: secToFrame(start),
          durationFrames: clampDurationFrames(6, 5, 10),
          layer: 4,
          props: {
            mainImage: img,
            sideImages: sides,
            title: upperShort(exact || titleLock?.mainSubject || "FIELD INVESTIGATION", 4),
            subtitle: upperShort(beat?.viewerShouldSee || "Archive sequence", 6),
          },
          tags: ["auto_effect", "red_grid", "presentation"],
          sceneId: scene.sceneId,
          reason: "Investigation / archive board moment",
          effectImportance: 78,
        });
        lastMajorSec = start;
        minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
      }
    }

    // --- Dramatic: reveal question / glitch ---
    if (
      isQuestion &&
      revealCount < 8 &&
      start - lastMajorSec >= 6 &&
      (minuteBuckets.get(minute) || 0) < 7
    ) {
      const q = upperShort(
        (beat?.viewerShouldSee || scene.narrationText || "WHAT HAPPENED NEXT?").replace(/\?$/, "") + "?",
        7
      );
      push({
        id: `effect-${scene.sceneId}-reveal`,
        presetId: "08_reveal_question",
        startFrame: secToFrame(start),
        durationFrames: clampDurationFrames(4, 3, 5),
        layer: 15,
        props: {
          question: q,
          primaryText: q,
          secondaryText: upperShort(titleLock?.mysteryOrConflict || "And what were they trying to hide?", 8),
          backgroundImage: img,
        },
        tags: ["auto_effect", "reveal_question"],
        sceneId: scene.sceneId,
        reason: "Major question / section hook",
        effectImportance: 86,
      });
      revealCount += 1;
      lastMajorSec = start;
      minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
    }

    if (
      glitchCount < 12 &&
      start - lastGlitchSec >= 35 &&
      start - lastMajorSec >= 4 &&
      i + 1 < scenes.length &&
      (scene.matchType === "exact_match" ||
        isQuestion ||
        /\b(suddenly|reveal|but then|history|response|yelling|caught)\b/.test(narr) ||
        i % 4 === 0)
    ) {
      const nextImg = sceneImage(scenes[i + 1], libraryUrls);
      if (img && nextImg) {
        push({
          id: `effect-${scene.sceneId}-glitch`,
          presetId: "09_glitch_cut_transition",
          startFrame: secToFrame(scene.endTime - 0.8),
          durationFrames: clampDurationFrames(1.2, 1, 1.5),
          layer: 25,
          props: {
            fromImageSrc: img,
            toImageSrc: nextImg,
          },
          tags: ["auto_effect", "glitch_cut", "transition"],
          sceneId: scene.sceneId,
          reason: "Major scene turn / reveal transition",
          effectImportance: 82,
        });
        glitchCount += 1;
        lastGlitchSec = start;
        lastMajorSec = start;
        minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
      }
    }
  }

  // Dense fill: every scene without an effect gets a lower-third or text callout when possible
  // (Royal v2 / Celebrity v1 use their own cadence planners — do NOT pack LTs.)
  const covered = new Set(events.map((e) => e.sceneId).filter(Boolean));
  if (!isRoyalV2 && !isCelebrityV1) for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (covered.has(scene.sceneId)) continue;
    if (isTextHeavyScene(scene)) continue;
    const beat = beatById.get(scene.beatId);
    const img = sceneImage(scene, libraryUrls);
    const exact =
      beat?.exactSubject ||
      beat?.mustMatchEntity ||
      beat?.mentionedPeople?.[0] ||
      beat?.mentionedPlaces?.[0] ||
      "";
    const minute = Math.floor(scene.startTime / 60);
    if ((minuteBuckets.get(minute) || 0) >= 8) continue;

    if (exact) {
      push({
        id: `effect-${scene.sceneId}-fill-lt`,
        presetId: classicCount % 2 === 0 ? "01_classic_blue_white_lower_third" : "02_secondary_blue_lower_third",
        startFrame: secToFrame(scene.startTime + 0.25),
        durationFrames: clampDurationFrames(2.8, 2.2, 3.5),
        layer: 20,
        props: {
          primaryText: upperShort(exact, 5),
          secondaryText: upperShort(titleLock?.centralObjectOrPlace || job.niche || "ROYAL", 4),
          position: "bottom_left",
        },
        tags: ["auto_effect", "lower_third", "density_fill"],
        sceneId: scene.sceneId,
        reason: "Density fill — ensure scene has editorial graphic",
        effectImportance: 72,
        blocksSubtitles: true,
      });
      classicCount += 1;
      covered.add(scene.sceneId);
      minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
    } else if (img && i + 1 < scenes.length) {
      const nextImg = sceneImage(scenes[i + 1], libraryUrls);
      if (nextImg && nextImg !== img && glitchCount < 14) {
        push({
          id: `effect-${scene.sceneId}-fill-glitch`,
          presetId: "09_glitch_cut_transition",
          startFrame: secToFrame(Math.max(scene.startTime, scene.endTime - 0.9)),
          durationFrames: clampDurationFrames(1.1, 0.9, 1.4),
          layer: 25,
          props: { fromImageSrc: img, toImageSrc: nextImg },
          tags: ["auto_effect", "glitch_cut", "density_fill"],
          sceneId: scene.sceneId,
          reason: "Density fill — transition energy",
          effectImportance: 70,
        });
        glitchCount += 1;
        covered.add(scene.sceneId);
        minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
      }
    }
  }

  // Spacing QA
  const sorted = [...events].sort((a, b) => a.startFrame - b.startFrame);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const gapSec = (cur.startFrame - (prev.startFrame + prev.durationFrames)) / FPS;
    if (isRoyalV2) {
      // Royal v2 intentionally packs lower-thirds + glass + splits densely; only flag collisions.
      if (gapSec < -0.05) {
        spacingWarnings.push(`${cur.id}: overlaps ${prev.id} by ${Math.abs(gapSec).toFixed(1)}s`);
      }
      continue;
    }
    const bothMajor = ![prev, cur].every((e) =>
      e.presetId.startsWith("01_") || e.presetId.startsWith("02_") || e.presetId.startsWith("03_") || e.presetId.startsWith("29_")
    );
    if (bothMajor && gapSec < 10 && gapSec >= 0) {
      spacingWarnings.push(`${cur.id}: major effect only ${gapSec.toFixed(1)}s after ${prev.id}`);
    }
    if (
      (cur.presetId.startsWith("01_") || cur.presetId.startsWith("02_") || cur.presetId.startsWith("03_") || cur.presetId.startsWith("29_")) &&
      (prev.presetId.startsWith("01_") || prev.presetId.startsWith("02_") || prev.presetId.startsWith("03_") || prev.presetId.startsWith("29_")) &&
      gapSec < 6
    ) {
      spacingWarnings.push(`${cur.id}: text/lower-third only ${gapSec.toFixed(1)}s after ${prev.id}`);
    }
  }

  // Per-minute soft fill: ensure ~2 effects/min when possible
  for (let m = 0; m < Math.ceil(durationMin); m++) {
    const count = minuteBuckets.get(m) || 0;
    if (isRoyalV2) {
      if (count > 16) spacingWarnings.push(`Minute ${m}: unusually dense effects (${count})`);
      if (count < 4 && scenes.length > 4) {
        spacingWarnings.push(`Minute ${m}: below Royal v2 density target (${count})`);
      }
      continue;
    }
    if (count > 4) spacingWarnings.push(`Minute ${m}: more than 4 effects (${count})`);
    if (count < 2 && scenes.length > 4) {
      spacingWarnings.push(`Minute ${m}: fewer than 2 effect moments (${count}) — quality-first, may be sparse`);
    }
  }

  // GPT chooses on-screen copy from script/topic (not demo placeholders)
  let finalized = await gptOptimizeEffectCopy({
    job,
    titleLock,
    events,
    scenes,
    beats,
  });

  // Re-validate after GPT copy
  const postVal: string[] = [];
  for (const ev of finalized) postVal.push(...validateEvent(ev, videoEndFrame));
  validationErrors.push(...postVal);
  finalized = finalized.filter((ev) => validateEvent(ev, videoEndFrame).length === 0);

  const mapped = await mapEffectsToShotstack({
    jobId: job.jobId,
    events: finalized,
    scenes,
    fps: FPS,
  });

  // Cadence counts ONLY renderable effects
  const renderableIds = new Set(mapped.map.filter((m) => m.renderable).map((m) => m.effectId));
  const renderableEvents = finalized.filter((e) => renderableIds.has(e.id));
  const skippedIds = mapped.map.filter((m) => !m.renderable).map((m) => m.presetId);
  const simplifiedIds = mapped.map.filter((m) => m.simplified && m.renderable).map((m) => m.presetId);

  // Attach renderability onto events for Scene Review
  finalized = finalized.map((e) => {
    const m = mapped.map.find((x) => x.effectId === e.id);
    return {
      ...e,
      props: {
        ...e.props,
        _renderable: m?.renderable ?? false,
        _simplified: m?.simplified ?? false,
        _renderReason: m?.reason,
        _renderWarning: m?.warning,
      },
      tags: [
        ...e.tags,
        m?.renderable ? "renderable_shotstack" : "not_renderable_shotstack",
        ...(m?.simplified ? ["simplified_shotstack"] : []),
      ],
    };
  });

  const presetIdsUsed = [...new Set(finalized.map((e) => e.presetId))];
  const slideshowPresets = new Set([
    "04_glass_gallery_slideshow",
    "05_archive_ribbon_slideshow",
    "06_cinematic_stage_slideshow",
    "07_split_comparison_slideshow",
    "10_red_grid_archive_background",
    "21_royal_archive_slideshow",
    "24_soft_glass_focus_slideshow",
    "25_clean_zoom_frame_slideshow",
    "26_minimal_blur_backdrop_slideshow",
    "27_editorial_soft_pan_slideshow",
    "28_crystal_stage_slideshow",
  ]);
  const report: EffectPlannerReport = {
    jobId: job.jobId,
    fps: FPS,
    totalScenes: scenes.length,
    totalEffectEvents: finalized.length,
    plannedEffectsCount: finalized.length,
    renderableEffectsCount: mapped.qa.renderableEffectsCount,
    skippedEffectsCount: mapped.qa.skippedEffectsCount,
    effectsPerMinute: Number((finalized.length / durationMin).toFixed(2)),
    effectsPerMinuteRenderable: mapped.qa.effectsPerMinuteRenderable,
    cadenceMetFinalRender: mapped.qa.cadenceMetFinalRender,
    presetIdsUsed,
    presetIdsRenderable: [...new Set(renderableEvents.map((e) => e.presetId))],
    presetIdsSimplified: [...new Set(simplifiedIds)],
    presetIdsSkipped: [...new Set(skippedIds)],
    lowerThirdsCount: renderableEvents.filter(
      (e) =>
        e.presetId.startsWith("01_") ||
        e.presetId.startsWith("02_") ||
        e.presetId.startsWith("29_")
    ).length,
    slideshowPresentationCount: renderableEvents.filter((e) => slideshowPresets.has(e.presetId))
      .length,
    revealGlitchCount: renderableEvents.filter(
      (e) =>
        e.presetId === "08_reveal_question" ||
        e.presetId === "09_glitch_cut_transition" ||
        e.presetId === "15_quote_only"
    ).length,
    spacingWarnings,
    subtitleOverlapWarnings,
    validationErrors: [...new Set([...validationErrors, ...mapped.qa.criticalIssues])],
    events: finalized,
    createdAt: new Date().toISOString(),
  };

  await writeJson(jobDataFile("effect-planner", job.jobId), report);
  await writeJson(jobDataFile("effect-timeline", job.jobId), {
    jobId: job.jobId,
    fps: FPS,
    events: finalized,
    renderableOnly: renderableEvents,
    ...(isRoyalV2
      ? { royalV2CadenceByMinute: royalV2EffectCadenceReport(finalized) }
      : {}),
  });

  const qa = {
    jobId: job.jobId,
    canRenderEffects: mapped.qa.renderableEffectsCount > 0 || finalized.length === 0,
    criticalIssues: mapped.qa.criticalIssues,
    warnings: [...spacingWarnings, ...subtitleOverlapWarnings, ...mapped.qa.warnings],
    plannedEffectsCount: report.plannedEffectsCount,
    renderableEffectsCount: report.renderableEffectsCount,
    skippedEffectsCount: report.skippedEffectsCount,
    effectsPerMinuteRenderable: report.effectsPerMinuteRenderable,
    cadenceMetFinalRender: report.cadenceMetFinalRender,
    acceptance: {
      totalScenes: scenes.length,
      plannedEffectsCount: report.plannedEffectsCount,
      renderableEffectsCount: report.renderableEffectsCount,
      skippedEffectsCount: report.skippedEffectsCount,
      effectsPerMinute: report.effectsPerMinute,
      effectsPerMinuteRenderable: report.effectsPerMinuteRenderable,
      cadenceMetFinalRender: report.cadenceMetFinalRender,
      presetIdsUsed,
      presetIdsRenderable: report.presetIdsRenderable,
      presetIdsSimplified: report.presetIdsSimplified,
      presetIdsSkipped: report.presetIdsSkipped,
      lowerThirdsCount: report.lowerThirdsCount,
      slideshowPresentationCount: report.slideshowPresentationCount,
      revealGlitchCount: report.revealGlitchCount,
      spacingWarningCount: spacingWarnings.length,
      subtitleOverlapWarningCount: subtitleOverlapWarnings.length,
    },
    checkedAt: new Date().toISOString(),
  };
  await writeJson(jobDataFile("effect-final-qa", job.jobId), qa);

  return report;
}
