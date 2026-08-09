/**
 * Celebrity v1 effect cadence — sparse lower-thirds, clean zoom presentations,
 * occasional split juxtaposition. Matches Tp5kwT3785Y density (not Royal pack).
 */
import {
  CELEBRITY_V1_RECIPE,
  celebrityEffectsPerMinuteCap,
  celebrityLowerThirdGapSec,
  celebrityMaxLowerThirds,
} from "./referenceRecipe.js";
import type {
  JobRecord,
  TitleLock,
  TimelineScene,
  VisualBeat,
} from "../../../shared/visualIntelligence.js";
import type { EffectTimelineEvent, SelectedPresetId } from "../effectPlanner.js";

const FPS = 30;

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

function sceneImage(scene: TimelineScene, libraryUrls: Map<string, string>): string | undefined {
  return libraryUrls.get(scene.approvedVisualId || scene.selectedVisualId);
}

function isTextHeavy(scene: TimelineScene): boolean {
  return Boolean(scene.isTextHeavy) || (scene.warnings || []).some((w) => w.includes("text-heavy"));
}

/**
 * Plan Celebrity v1 effects. Returns events only — caller validates/pushes.
 */
export function planCelebrityV1EditingEffects(params: {
  job: JobRecord;
  scenes: TimelineScene[];
  beats: VisualBeat[];
  titleLock?: TitleLock | null;
  libraryUrls: Map<string, string>;
}): EffectTimelineEvent[] {
  const { scenes, beats, titleLock, libraryUrls } = params;
  const beatById = new Map(beats.map((b) => [b.beatId, b]));
  const events: EffectTimelineEvent[] = [];
  const mentioned = new Set<string>();
  let lastLowerSec = -999;
  let lastMajorSec = -999;
  let lastGlitchSec = -999;
  let classicCount = 0;
  let zoomCount = 0;
  let splitCount = 0;
  let revealCount = 0;
  let glitchCount = 0;
  const minuteBuckets = new Map<number, number>();
  const perMinCap = Math.ceil(celebrityEffectsPerMinuteCap());
  const ltGap = celebrityLowerThirdGapSec();
  const videoEnd = scenes.reduce((m, s) => Math.max(m, s.endTime || 0), 0);
  const maxLowerThirds = celebrityMaxLowerThirds(videoEnd || 120);
  // Only name the main subject + 1–2 secondary people for LTs (not every beat entity).
  const ltWhitelist = new Set(
    [titleLock?.mainSubject, ...(beats[0]?.mentionedPeople || []).slice(0, 2)]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase())
  );

  const bump = (minute: number) => {
    minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
  };

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const beat = beatById.get(scene.beatId);
    const start = scene.startTime;
    const minute = Math.floor(start / 60);
    if ((minuteBuckets.get(minute) || 0) >= perMinCap) continue;

    const img = sceneImage(scene, libraryUrls);
    const textHeavy = isTextHeavy(scene);
    const exact =
      beat?.exactSubject ||
      beat?.mustMatchEntity ||
      beat?.mentionedPeople?.[0] ||
      titleLock?.mainSubject ||
      "";
    const role = beat?.visualRole || "main_subject";
    const narr = (scene.narrationText || "").toLowerCase();
    const isQuestion =
      /\b(why|what|how|who)\b/.test(narr) || (beat?.viewerShouldSee || "").includes("?");
    const isCompare =
      /\b(vs|versus|before|after|compared|unlike|instead)\b/.test(narr) ||
      role === "evidence";
    const isHero =
      role === "main_subject" &&
      (scene.matchType === "exact_match" || scene.matchType === "strong_match") &&
      !scene.rawFootageUsed;

    // Sparse classic lower third — whitelist names only, hard-capped.
    const exactKey = exact.toLowerCase();
    const allowedLtName =
      !!exact &&
      (ltWhitelist.has(exactKey) ||
        (titleLock?.mainSubject &&
          exactKey.includes(titleLock.mainSubject.toLowerCase().split(/\s+/).pop() || "___")));
    if (
      allowedLtName &&
      !textHeavy &&
      classicCount < maxLowerThirds &&
      start - lastLowerSec >= ltGap &&
      !mentioned.has(exactKey) &&
      role === "main_subject"
    ) {
      const useSecondary = classicCount > 0 && classicCount % 2 === 1;
      const presetId: SelectedPresetId = useSecondary
        ? "02_secondary_blue_lower_third"
        : "01_classic_blue_white_lower_third";
      events.push({
        id: `effect-${scene.sceneId}-lt`,
        presetId,
        startFrame: secToFrame(start + 0.35),
        durationFrames: clampDurationFrames(3.0, 2.4, 3.6),
        layer: 20,
        props: {
          primaryText: upperShort(exact, 5),
          secondaryText: upperShort(
            beat?.mentionedPlaces?.[0] && beat.mentionedPlaces[0] !== exact
              ? beat.mentionedPlaces[0]
              : titleLock?.centralObjectOrPlace || "DOCUMENTARY",
            4
          ),
          position: "bottom_left",
        },
        tags: ["auto_effect", "lower_third", "celebrity_v1"],
        sceneId: scene.sceneId,
        reason: `Celebrity recipe LT for ${exact}`,
        effectImportance: 80,
        blocksSubtitles: true,
      });
      mentioned.add(exact.toLowerCase());
      lastLowerSec = start;
      classicCount += 1;
      bump(minute);
    } else if (
      !textHeavy &&
      start - lastLowerSec >= ltGap + 8 &&
      /\b(19|20)\d{2}\b/.test(scene.narrationText || "") &&
      (minuteBuckets.get(minute) || 0) < perMinCap
    ) {
      const year = (scene.narrationText || "").match(/\b((?:19|20)\d{2})\b/)?.[1];
      if (year) {
        events.push({
          id: `effect-${scene.sceneId}-year`,
          presetId: "03_simple_text_overlay",
          startFrame: secToFrame(start + 0.3),
          durationFrames: clampDurationFrames(2.8, 2.2, 3.4),
          layer: 18,
          props: {
            text: year,
            position: "bottom_left",
            accentColor: "#1E3A5F",
          },
          tags: ["auto_effect", "year_marker", "celebrity_v1"],
          sceneId: scene.sceneId,
          reason: "Celebrity recipe year marker",
          effectImportance: 72,
          blocksSubtitles: true,
        });
        lastLowerSec = start;
        bump(minute);
      }
    }

    // Clean zoom / soft glass on still heroes (Ken Burns-style presentation).
    if (
      img &&
      isHero &&
      zoomCount < Math.ceil(scenes.length * 0.22) &&
      start - lastMajorSec >= 8 &&
      (minuteBuckets.get(minute) || 0) < perMinCap
    ) {
      const presetId: SelectedPresetId =
        zoomCount % 2 === 0 ? "25_clean_zoom_frame_slideshow" : "24_soft_glass_focus_slideshow";
      events.push({
        id: `effect-${scene.sceneId}-zoom`,
        presetId,
        startFrame: secToFrame(start),
        durationFrames: clampDurationFrames(Math.min(scene.duration, 6.5), 3.5, 7),
        layer: 5,
        props: {
          slides: [
            {
              src: img,
              caption: beat?.viewerShouldSee || "",
              kicker: upperShort(exact || titleLock?.mainSubject || "PROFILE", 4),
              focus: { x: 0.5, y: 0.42 },
            },
          ],
          intensity: CELEBRITY_V1_RECIPE.zoom.intensity,
          showPresetLabel: false,
        },
        tags: ["auto_effect", "clean_zoom", "celebrity_v1"],
        sceneId: scene.sceneId,
        reason: "Celebrity recipe Ken Burns / clean zoom on still",
        effectImportance: 76,
      });
      zoomCount += 1;
      lastMajorSec = start;
      bump(minute);
    } else if (
      img &&
      isCompare &&
      splitCount < 4 &&
      start - lastMajorSec >= 10 &&
      (minuteBuckets.get(minute) || 0) < perMinCap
    ) {
      const nextImg =
        i + 1 < scenes.length ? sceneImage(scenes[i + 1], libraryUrls) : undefined;
      if (nextImg && nextImg !== img) {
        events.push({
          id: `effect-${scene.sceneId}-split`,
          presetId: "07_split_comparison_slideshow",
          startFrame: secToFrame(start),
          durationFrames: clampDurationFrames(5.5, 4, 7),
          layer: 6,
          props: {
            leftImageSrc: img,
            rightImageSrc: nextImg,
            leftLabel: upperShort(exact || titleLock?.mainSubject || "LEFT", 3),
            rightLabel: upperShort(
              beatById.get(scenes[i + 1].beatId)?.exactSubject || "RIGHT",
              3
            ),
          },
          tags: ["auto_effect", "split_comparison", "celebrity_v1"],
          sceneId: scene.sceneId,
          reason: "Celebrity recipe juxtaposition split",
          effectImportance: 82,
        });
        splitCount += 1;
        lastMajorSec = start;
        bump(minute);
      }
    }

    // Rare section-hook reveal (questions only).
    const maxReveals = videoEnd < 180 ? 1 : 2;
    if (
      isQuestion &&
      revealCount < maxReveals &&
      start - lastMajorSec >= 14 &&
      (minuteBuckets.get(minute) || 0) < perMinCap
    ) {
      const q = upperShort(
        (beat?.viewerShouldSee || scene.narrationText || "WHAT HAPPENED NEXT?").replace(
          /\?$/,
          ""
        ) + "?",
        7
      );
      events.push({
        id: `effect-${scene.sceneId}-reveal`,
        presetId: "08_reveal_question",
        startFrame: secToFrame(start),
        durationFrames: clampDurationFrames(3.8, 3, 4.5),
        layer: 15,
        props: {
          question: q,
          primaryText: q,
          secondaryText: upperShort(
            titleLock?.mysteryOrConflict || "What changed everything?",
            8
          ),
          backgroundImage: img,
        },
        tags: ["auto_effect", "reveal_question", "celebrity_v1"],
        sceneId: scene.sceneId,
        reason: "Celebrity recipe section hook",
        effectImportance: 84,
      });
      revealCount += 1;
      lastMajorSec = start;
      bump(minute);
    }

    // Very sparse glitch — section accents only.
    if (
      glitchCount < 3 &&
      start - lastGlitchSec >= 45 &&
      start > 20 &&
      i + 1 < scenes.length &&
      (scene.matchType === "exact_match" || scene.matchType === "strong_match") &&
      (minuteBuckets.get(minute) || 0) < perMinCap
    ) {
      events.push({
        id: `effect-${scene.sceneId}-glitch`,
        presetId: "09_glitch_cut_transition",
        startFrame: secToFrame(Math.max(0, scene.endTime - 0.55)),
        durationFrames: clampDurationFrames(0.55, 0.4, 0.7),
        layer: 12,
        props: { intensity: 0.35 },
        tags: ["auto_effect", "glitch_cut", "celebrity_v1"],
        sceneId: scene.sceneId,
        reason: "Celebrity recipe sparse accent",
        effectImportance: 60,
      });
      glitchCount += 1;
      lastGlitchSec = start;
      bump(minute);
    }
  }

  return events;
}
