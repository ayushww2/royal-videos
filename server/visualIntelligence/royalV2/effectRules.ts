/**
 * Royal v2 Remotion editing cadence for ~30-minute documentaries.
 *
 * Per full minute targets:
 * - 2–3 lower thirds (people / places / dates / events)
 * - 2 split-screen comparisons
 * - 2 glass / soft-glass / clean-zoom presentations (different backgrounds)
 * - 1 red-grid archive beat
 * - frequent quote + reveal-question overlays when narration supports them
 *
 * On-screen copy is public-facing titles only — never backend instructions.
 */
import type { EffectTimelineEvent, SelectedPresetId } from "../effectPlanner.js";
import type { JobRecord, TimelineScene, VisualBeat } from "../../../shared/visualIntelligence.js";
import {
  isDirectorInstructionText,
  royalOnScreenLabels,
} from "./taxonomy.js";

const FPS = 30;

type MinuteCounts = {
  lowerThirds: number;
  splits: number;
  glass: number;
  redGrid: number;
  quotes: number;
  questions: number;
  softGlass: number;
};

const TARGETS = {
  lowerThirdsMin: 2,
  lowerThirdsMax: 4,
  splits: 2,
  glass: 2,
  redGrid: 1,
  softGlass: 1,
  quotesMax: 2,
  questionsMin: 1,
  questionsMax: 3,
};

const GLASS_VARIANTS: SelectedPresetId[] = [
  "04_glass_gallery_slideshow",
  "24_soft_glass_focus_slideshow",
  "25_clean_zoom_frame_slideshow",
  "26_minimal_blur_backdrop_slideshow",
  "28_crystal_stage_slideshow",
];

function secToFrame(sec: number): number {
  return Math.max(0, Math.round(sec * FPS));
}

function clampDurationFrames(sec: number, min: number, max: number): number {
  return Math.max(1, Math.round(Math.max(min, Math.min(max, sec)) * FPS));
}

function upperShort(text: string, maxWords = 6): string {
  return text
    .replace(/[^a-zA-Z0-9\s'’-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ")
    .toUpperCase();
}

function cleanOnScreen(text?: string | null, maxWords = 6): string {
  const value = String(text || "").trim();
  if (!value || isDirectorInstructionText(value)) return "";
  return upperShort(value, maxWords);
}

function lowerThirdCopy(
  scene: TimelineScene,
  beat: VisualBeat | undefined,
  exact: string
): {
  primaryText: string;
  secondaryText: string;
  tagText: string;
} {
  const labels = royalOnScreenLabels(
    exact || scene.mainPerson || scene.specificPlace || beat?.exactSubject || beat?.mustMatchEntity
  );
  const place = cleanOnScreen(scene.specificPlace || beat?.mentionedPlaces?.[0] || "", 4);
  const primaryText = labels.primary || cleanOnScreen(exact, 5);
  let secondaryText = labels.secondary;
  if (!secondaryText && place && place !== primaryText) secondaryText = place;
  if (/ROYAL\s*V\s*2|ROYAL DOCUMENTARY|EXACT PERSON|CONTEXT/i.test(secondaryText)) {
    secondaryText = "";
  }
  return {
    primaryText,
    secondaryText,
    tagText: "",
  };
}

function emptyMinute(): MinuteCounts {
  return {
    lowerThirds: 0,
    splits: 0,
    glass: 0,
    redGrid: 0,
    quotes: 0,
    questions: 0,
    softGlass: 0,
  };
}

function sceneImage(
  scene: TimelineScene,
  libraryUrls: Map<string, string>
): string | undefined {
  return libraryUrls.get(scene.approvedVisualId || scene.selectedVisualId);
}

function neighborImages(
  scenes: TimelineScene[],
  index: number,
  libraryUrls: Map<string, string>,
  count = 3
): string[] {
  const urls: string[] = [];
  for (let i = Math.max(0, index - 1); i < Math.min(scenes.length, index + 4); i++) {
    const url = sceneImage(scenes[i], libraryUrls);
    if (url && !urls.includes(url)) urls.push(url);
    if (urls.length >= count) break;
  }
  return urls;
}

function entityLabel(scene: TimelineScene, beat?: VisualBeat): string {
  return (
    beat?.exactSubject ||
    beat?.mustMatchEntity ||
    scene.mainPerson ||
    scene.specificPlace ||
    beat?.mentionedPlaces?.[0] ||
    beat?.mentionedPeople?.[0] ||
    ""
  );
}

function isQuestionNarration(text: string): boolean {
  return /\?/.test(text) || /\b(why|what|how|who|will|did)\b/i.test(text);
}

function isQuoteLike(text: string): boolean {
  return (
    /[“"]/.test(text) ||
    /\b(said|told|response|replied|declared|insisted|admitted)\b/i.test(text)
  );
}

function isDateOrEvent(text: string): boolean {
  return /\b(\d{4}|january|february|march|april|may|june|july|august|september|october|november|december|coronation|wedding|funeral|birthday|anniversary)\b/i.test(
    text
  );
}

export function planRoyalV2EditingEffects(params: {
  job: JobRecord;
  scenes: TimelineScene[];
  beats: VisualBeat[];
  libraryUrls: Map<string, string>;
}): EffectTimelineEvent[] {
  const { scenes, beats, libraryUrls } = params;
  const beatById = new Map(beats.map((b) => [b.beatId, b]));
  const events: EffectTimelineEvent[] = [];
  const minuteCounts = new Map<number, MinuteCounts>();
  const mentioned = new Set<string>();
  let lastLowerSec = -99;
  let lastMajorSec = -99;
  let lastQuoteSec = -99;
  let lastQuestionSec = -99;
  let glassVariantCursor = 0;
  let lowerAlt = 0;

  const getMinute = (start: number) => {
    const minute = Math.floor(start / 60);
    if (!minuteCounts.has(minute)) minuteCounts.set(minute, emptyMinute());
    return minuteCounts.get(minute)!;
  };

  const push = (ev: EffectTimelineEvent) => {
    events.push(ev);
  };

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const beat = beatById.get(scene.beatId);
    const start = scene.startTime;
    const minute = getMinute(start);
    const img = sceneImage(scene, libraryUrls);
    const narr = scene.narrationText || "";
    const exact = entityLabel(scene, beat);
    const pair = (scene.pairOrGroup || beat?.pairOrGroup || []).filter(
      (p) => p && p !== "British Royal Family"
    );
    const isSplitPair =
      /split-screen library match/i.test(scene.reasonSelected || "") || pair.length >= 2;
    const related = neighborImages(scenes, i, libraryUrls, 4);

    if (
      exact &&
      start - lastLowerSec >= 3.2 &&
      minute.lowerThirds < TARGETS.lowerThirdsMax &&
      (!mentioned.has(exact.toLowerCase()) ||
        isDateOrEvent(narr) ||
        minute.lowerThirds < TARGETS.lowerThirdsMin)
    ) {
      const usePurple = lowerAlt % 5 === 4;
      const useSecondary = !usePurple && lowerAlt % 3 === 1;
      const presetId: SelectedPresetId = usePurple
        ? "29_classic_purple_white_lower_third"
        : useSecondary
          ? "02_secondary_blue_lower_third"
          : "01_classic_blue_white_lower_third";
      const copy = lowerThirdCopy(scene, beat, exact);
      push({
        id: `effect-${scene.sceneId}-lt`,
        presetId,
        startFrame: secToFrame(start + 0.25),
        durationFrames: clampDurationFrames(Math.min(3.4, scene.duration + 0.4), 2.4, 3.6),
        layer: 20,
        props: {
          primaryText: copy.primaryText,
          secondaryText: copy.secondaryText,
          tagText: copy.tagText,
          locationTag: copy.tagText,
          position: "bottom_left",
          showPresetLabel: false,
        },
        tags: ["royal_v2", "lower_third", "important_entity"],
        sceneId: scene.sceneId,
        reason: `Lower third for ${exact}`,
        effectImportance: 88,
        blocksSubtitles: true,
      });
      mentioned.add(exact.toLowerCase());
      lastLowerSec = start;
      minute.lowerThirds += 1;
      lowerAlt += 1;
    }

    if (
      img &&
      minute.splits < TARGETS.splits &&
      start - lastMajorSec >= 2.8 &&
      (isSplitPair ||
        /\b(vs|versus|confront|against|between|both|together)\b/i.test(narr) ||
        (pair.length >= 2 && minute.splits === 0))
    ) {
      const right =
        (scene.alternativeAssetIds || [])
          .map((id) => libraryUrls.get(id))
          .find((url) => url && url !== img) || related.find((url) => url !== img);
      if (right) {
        const leftLabel =
          royalOnScreenLabels(pair[0] || exact).primary ||
          upperShort(pair[0] || exact || "LEFT", 3);
        const rightLabel =
          royalOnScreenLabels(pair[1] || "").primary || upperShort(pair[1] || "RIGHT", 3);
        push({
          id: `effect-${scene.sceneId}-split`,
          presetId: "07_split_comparison_slideshow",
          startFrame: secToFrame(start),
          durationFrames: clampDurationFrames(Math.min(scene.duration, 4.2), 2.6, 4.5),
          layer: 6,
          props: {
            leftImageSrc: img,
            rightImageSrc: right,
            leftLabel,
            rightLabel,
            showPresetLabel: false,
          },
          tags: ["royal_v2", "split_comparison"],
          sceneId: scene.sceneId,
          reason:
            pair.length >= 2
              ? `Side-by-side: ${pair[0]} / ${pair[1]}`
              : "Narration comparison split screen",
          effectImportance: 90,
        });
        minute.splits += 1;
        lastMajorSec = start;
      }
    }

    if (
      img &&
      related.length >= 1 &&
      minute.glass < TARGETS.glass &&
      start - lastMajorSec >= 3.0 &&
      (exact || scene.matchType === "exact_match" || scene.beatType === "exact_place")
    ) {
      const presetId = GLASS_VARIANTS[glassVariantCursor % GLASS_VARIANTS.length];
      glassVariantCursor += 1;
      const label = cleanOnScreen(exact, 4);
      const slides = [...new Set([img, ...related])]
        .slice(0, Math.max(2, Math.min(3, related.length + 1)))
        .map((src, idx) => ({
          src,
          caption: "",
          kicker: idx === 0 ? label : "",
          focus: { x: 0.5, y: 0.48 },
        }));
      push({
        id: `effect-${scene.sceneId}-glass`,
        presetId,
        startFrame: secToFrame(start),
        durationFrames: clampDurationFrames(Math.min(scene.duration, 4.8), 2.8, 5),
        layer: 5,
        props: {
          slides,
          durationPerSlide: 70,
          transitionFrames: 14,
          showPresetLabel: false,
        },
        tags: ["royal_v2", "glass_presentation", presetId],
        sceneId: scene.sceneId,
        reason: `Glass/framed presentation for ${exact || "scene"}`,
        effectImportance: 86,
      });
      minute.glass += 1;
      if (
        presetId === "24_soft_glass_focus_slideshow" ||
        presetId === "25_clean_zoom_frame_slideshow"
      ) {
        minute.softGlass += 1;
      }
      lastMajorSec = start;
    }

    if (
      img &&
      minute.softGlass < TARGETS.softGlass &&
      minute.glass < TARGETS.glass &&
      start - lastMajorSec >= 3.5
    ) {
      const softPreset: SelectedPresetId =
        minute.softGlass % 2 === 0
          ? "24_soft_glass_focus_slideshow"
          : "25_clean_zoom_frame_slideshow";
      push({
        id: `effect-${scene.sceneId}-soft`,
        presetId: softPreset,
        startFrame: secToFrame(start),
        durationFrames: clampDurationFrames(Math.min(scene.duration, 4), 2.5, 4.2),
        layer: 5,
        props: {
          slides: [
            { src: img, caption: "", focus: { x: 0.5, y: 0.5 } },
            ...(related[0]
              ? [{ src: related[0], caption: "", focus: { x: 0.5, y: 0.5 } }]
              : []),
          ],
          showPresetLabel: false,
        },
        tags: ["royal_v2", "soft_glass"],
        sceneId: scene.sceneId,
        reason: "Soft glass / clean zoom fill",
        effectImportance: 80,
      });
      minute.softGlass += 1;
      minute.glass += 1;
      lastMajorSec = start;
    }

    if (
      img &&
      minute.redGrid < TARGETS.redGrid &&
      start - lastMajorSec >= 4 &&
      (/\b(palace|pressure|secret|evidence|history|rules|rank|tension|crisis|confront)\b/i.test(
        narr
      ) ||
        scene.contextType === "palace_pressure" ||
        scene.contextType === "court_legal" ||
        scene.contextType === "family_crisis")
    ) {
      push({
        id: `effect-${scene.sceneId}-redgrid`,
        presetId: "10_red_grid_archive_background",
        startFrame: secToFrame(start),
        durationFrames: clampDurationFrames(Math.min(scene.duration, 4.5), 2.8, 5),
        layer: 4,
        props: {
          mainImage: img,
          sideImages: related.slice(0, 2),
          title: cleanOnScreen(exact, 4) || "ARCHIVE",
          subtitle: cleanOnScreen(scene.specificPlace || scene.mainPerson, 5),
          showPresetLabel: false,
        },
        tags: ["royal_v2", "red_grid"],
        sceneId: scene.sceneId,
        reason: "Investigation / palace pressure red grid",
        effectImportance: 84,
      });
      minute.redGrid += 1;
      lastMajorSec = start;
    }

    if (
      img &&
      start - lastMajorSec >= 5 &&
      (scene.pairOrGroup?.includes("British Royal Family") ||
        /\b(royal family|history|archive|years)\b/i.test(narr))
    ) {
      const label = cleanOnScreen(exact || "Royal Family", 4);
      push({
        id: `effect-${scene.sceneId}-royal-archive`,
        presetId: "21_royal_archive_slideshow",
        startFrame: secToFrame(start),
        durationFrames: clampDurationFrames(Math.min(scene.duration, 4.5), 2.8, 5),
        layer: 5,
        props: {
          slides: [...new Set([img, ...related])].slice(0, 3).map((src, idx) => ({
            src,
            kicker: idx === 0 ? label : "",
            caption: "",
            focus: { x: 0.5, y: 0.5 },
          })),
          showPresetLabel: false,
        },
        tags: ["royal_v2", "royal_archive"],
        sceneId: scene.sceneId,
        reason: "Royal archive presentation",
        effectImportance: 82,
      });
      lastMajorSec = start;
    }

    if (
      img &&
      isQuoteLike(narr) &&
      minute.quotes < TARGETS.quotesMax &&
      start - lastQuoteSec >= 8
    ) {
      push({
        id: `effect-${scene.sceneId}-quote`,
        presetId: "15_quote_only",
        startFrame: secToFrame(start + 0.15),
        durationFrames: clampDurationFrames(Math.min(scene.duration, 4), 2.5, 4.2),
        layer: 16,
        props: {
          quote: narr.replace(/^["“]|["”]$/g, "").slice(0, 140),
          attribution: cleanOnScreen(exact, 4) || "ROYAL SOURCE",
          context: "",
          backgroundImage: img,
          showPresetLabel: false,
        },
        tags: ["royal_v2", "quote"],
        sceneId: scene.sceneId,
        reason: "Quote/testimony overlay from narration",
        effectImportance: 83,
        blocksSubtitles: true,
      });
      minute.quotes += 1;
      lastQuoteSec = start;
    }

    if (
      isQuestionNarration(narr) &&
      minute.questions < TARGETS.questionsMax &&
      start - lastQuestionSec >= 5
    ) {
      push({
        id: `effect-${scene.sceneId}-question`,
        presetId: "08_reveal_question",
        startFrame: secToFrame(start),
        durationFrames: clampDurationFrames(Math.min(scene.duration, 3.8), 2.4, 4),
        layer: 15,
        props: {
          question: upperShort(narr.replace(/\?+$/, "") + "?", 8),
          secondaryText: "",
          backgroundImage: img,
          showPresetLabel: false,
        },
        tags: ["royal_v2", "reveal_question"],
        sceneId: scene.sceneId,
        reason: "Narration question / cliffhanger",
        effectImportance: 85,
        blocksSubtitles: true,
      });
      minute.questions += 1;
      lastQuestionSec = start;
    }
  }

  const byMinute = new Map<number, TimelineScene[]>();
  for (const scene of scenes) {
    const minute = Math.floor(scene.startTime / 60);
    const list = byMinute.get(minute) || [];
    list.push(scene);
    byMinute.set(minute, list);
  }

  for (const [minute, minuteScenes] of byMinute) {
    const counts = minuteCounts.get(minute) || emptyMinute();
    minuteCounts.set(minute, counts);

    if (counts.lowerThirds < TARGETS.lowerThirdsMin) {
      for (const scene of minuteScenes) {
        if (counts.lowerThirds >= TARGETS.lowerThirdsMin) break;
        const beat = beatById.get(scene.beatId);
        const exact = entityLabel(scene, beat);
        if (!exact) continue;
        if (events.some((e) => e.sceneId === scene.sceneId && e.presetId.includes("lower_third"))) {
          continue;
        }
        if (scene.startTime - lastLowerSec < 2.8) continue;
        const copy = lowerThirdCopy(scene, beat, exact);
        push({
          id: `effect-${scene.sceneId}-lt-fill`,
          presetId:
            counts.lowerThirds % 2 === 0
              ? "01_classic_blue_white_lower_third"
              : "02_secondary_blue_lower_third",
          startFrame: secToFrame(scene.startTime + 0.2),
          durationFrames: clampDurationFrames(2.8, 2.2, 3.2),
          layer: 20,
          props: {
            primaryText: copy.primaryText,
            secondaryText: copy.secondaryText,
            showPresetLabel: false,
          },
          tags: ["royal_v2", "lower_third", "cadence_fill"],
          sceneId: scene.sceneId,
          reason: "Cadence fill: lower third quota",
          effectImportance: 70,
          blocksSubtitles: true,
        });
        counts.lowerThirds += 1;
        lastLowerSec = scene.startTime;
      }
    }

    if (counts.glass < TARGETS.glass) {
      for (const scene of minuteScenes) {
        if (counts.glass >= TARGETS.glass) break;
        const img = sceneImage(scene, libraryUrls);
        if (!img) continue;
        if (events.some((e) => e.sceneId === scene.sceneId && e.tags?.includes("glass_presentation"))) {
          continue;
        }
        if (scene.startTime - lastMajorSec < 2.5) continue;
        const related = neighborImages(scenes, scenes.indexOf(scene), libraryUrls, 3);
        const presetId = GLASS_VARIANTS[glassVariantCursor % GLASS_VARIANTS.length];
        glassVariantCursor += 1;
        push({
          id: `effect-${scene.sceneId}-glass-fill`,
          presetId,
          startFrame: secToFrame(scene.startTime),
          durationFrames: clampDurationFrames(Math.min(scene.duration, 3.6), 2.4, 4),
          layer: 5,
          props: {
            slides: [...new Set([img, ...related])].slice(0, 2).map((src) => ({
              src,
              caption: "",
              focus: { x: 0.5, y: 0.5 },
            })),
            showPresetLabel: false,
          },
          tags: ["royal_v2", "glass_presentation", "cadence_fill"],
          sceneId: scene.sceneId,
          reason: "Cadence fill: glass presentation quota",
          effectImportance: 72,
        });
        counts.glass += 1;
        lastMajorSec = scene.startTime;
      }
    }

    if (counts.redGrid < TARGETS.redGrid) {
      const candidate = minuteScenes.find((scene) => sceneImage(scene, libraryUrls));
      if (candidate && candidate.startTime - lastMajorSec >= 2) {
        const img = sceneImage(candidate, libraryUrls)!;
        const related = neighborImages(scenes, scenes.indexOf(candidate), libraryUrls, 2);
        push({
          id: `effect-${candidate.sceneId}-redgrid-fill`,
          presetId: "10_red_grid_archive_background",
          startFrame: secToFrame(candidate.startTime),
          durationFrames: clampDurationFrames(3.2, 2.5, 4),
          layer: 4,
          props: {
            mainImage: img,
            sideImages: related,
            title: cleanOnScreen(candidate.mainPerson || candidate.specificPlace, 4) || "ARCHIVE",
            subtitle: "",
            showPresetLabel: false,
          },
          tags: ["royal_v2", "red_grid", "cadence_fill"],
          sceneId: candidate.sceneId,
          reason: "Cadence fill: red grid quota",
          effectImportance: 70,
        });
        counts.redGrid += 1;
        lastMajorSec = candidate.startTime;
      }
    }

    if (counts.questions < TARGETS.questionsMin) {
      for (const scene of minuteScenes) {
        if (counts.questions >= TARGETS.questionsMin) break;
        if (!isQuestionNarration(scene.narrationText || "") && counts.questions > 0) continue;
        if (events.some((e) => e.sceneId === scene.sceneId && e.presetId === "08_reveal_question")) {
          continue;
        }
        if (scene.startTime - lastQuestionSec < 4) continue;
        const img = sceneImage(scene, libraryUrls);
        push({
          id: `effect-${scene.sceneId}-question-fill`,
          presetId: "08_reveal_question",
          startFrame: secToFrame(scene.startTime),
          durationFrames: clampDurationFrames(Math.min(scene.duration, 3.4), 2.2, 3.8),
          layer: 15,
          props: {
            question: upperShort((scene.narrationText || "WHAT HAPPENED NEXT") + "?", 8),
            secondaryText: "",
            backgroundImage: img,
            showPresetLabel: false,
          },
          tags: ["royal_v2", "reveal_question", "cadence_fill"],
          sceneId: scene.sceneId,
          reason: "Cadence fill: reveal question quota",
          effectImportance: 73,
          blocksSubtitles: true,
        });
        counts.questions += 1;
        lastQuestionSec = scene.startTime;
      }
    }

    if (counts.splits < TARGETS.splits) {
      for (const scene of minuteScenes) {
        if (counts.splits >= TARGETS.splits) break;
        const img = sceneImage(scene, libraryUrls);
        if (!img) continue;
        const right =
          (scene.alternativeAssetIds || [])
            .map((id) => libraryUrls.get(id))
            .find((url) => url && url !== img) ||
          neighborImages(scenes, scenes.indexOf(scene), libraryUrls, 2).find((u) => u !== img);
        if (!right) continue;
        if (
          events.some(
            (e) => e.sceneId === scene.sceneId && e.presetId === "07_split_comparison_slideshow"
          )
        ) {
          continue;
        }
        if (scene.startTime - lastMajorSec < 2.2) continue;
        push({
          id: `effect-${scene.sceneId}-split-fill`,
          presetId: "07_split_comparison_slideshow",
          startFrame: secToFrame(scene.startTime),
          durationFrames: clampDurationFrames(Math.min(scene.duration, 3.4), 2.4, 3.8),
          layer: 6,
          props: {
            leftImageSrc: img,
            rightImageSrc: right,
            leftLabel: royalOnScreenLabels(scene.mainPerson || "LEFT").primary || "LEFT",
            rightLabel: royalOnScreenLabels(scene.pairOrGroup?.[1] || "").primary || "RIGHT",
            showPresetLabel: false,
          },
          tags: ["royal_v2", "split_comparison", "cadence_fill"],
          sceneId: scene.sceneId,
          reason: "Cadence fill: split-screen quota",
          effectImportance: 74,
        });
        counts.splits += 1;
        lastMajorSec = scene.startTime;
      }
    }
  }

  return events.sort((a, b) => a.startFrame - b.startFrame || (a.layer || 0) - (b.layer || 0));
}

export function royalV2EffectCadenceReport(
  events: EffectTimelineEvent[]
): Record<string, MinuteCounts & { total: number }> {
  const out: Record<string, MinuteCounts & { total: number }> = {};
  for (const event of events) {
    const minute = Math.floor(event.startFrame / FPS / 60) + 1;
    const key = String(minute);
    if (!out[key]) out[key] = { ...emptyMinute(), total: 0 };
    const bucket = out[key];
    bucket.total += 1;
    if (String(event.presetId).includes("lower_third")) bucket.lowerThirds += 1;
    if (event.presetId === "07_split_comparison_slideshow") bucket.splits += 1;
    if (
      [
        "04_glass_gallery_slideshow",
        "24_soft_glass_focus_slideshow",
        "25_clean_zoom_frame_slideshow",
        "26_minimal_blur_backdrop_slideshow",
        "28_crystal_stage_slideshow",
      ].includes(event.presetId)
    ) {
      bucket.glass += 1;
    }
    if (event.presetId === "10_red_grid_archive_background") bucket.redGrid += 1;
    if (event.presetId === "15_quote_only") bucket.quotes += 1;
    if (event.presetId === "08_reveal_question") bucket.questions += 1;
    if (
      event.presetId === "24_soft_glass_focus_slideshow" ||
      event.presetId === "25_clean_zoom_frame_slideshow"
    ) {
      bucket.softGlass += 1;
    }
  }
  return out;
}
