import React from 'react';
import {Composition} from 'remotion';
import {SelectedPackPreview} from './SelectedPackPreview';
import {
  EffectCatalogStill,
  type EffectCatalogStillProps,
} from './EffectCatalogStill';
import {
  DocumentaryEditComposition,
  type DocumentaryEditProps,
  type DocumentarySceneClip,
} from './DocumentaryEditComposition';
import {
  TransitionPreview,
  type TransitionPreviewProps,
} from './TransitionPreview';
import {
  TransitionPreviewAll,
  type TransitionPreviewAllProps,
  ALL_TRANSITIONS,
} from './TransitionPreviewAll';
import {
  EffectCatalogAll,
  type EffectCatalogAllProps,
  EFFECT_CATALOG_COUNT,
} from './EffectCatalogAll';
import {
  MotionCatalogAll,
  type MotionCatalogAllProps,
  MOTION_CATALOG_COUNT,
} from './MotionCatalogAll';
import {
  GlitchCatalogAll,
  type GlitchCatalogAllProps,
  GLITCH_CATALOG_COUNT,
} from './GlitchCatalogAll';
import {
  CinematicIntro,
  type CinematicIntroProps,
  INTRO_DURATION_SEC,
} from './CinematicIntro';
import {
  MysteryV3FinalPreview,
  MYSTERY_V3_FINAL_PREVIEW_DURATION_SEC,
} from './MysteryV3FinalPreview';
import {
  PurpleLowerThirdPreview,
  PURPLE_LOWER_THIRD_PREVIEW_FRAMES,
} from './PurpleLowerThirdPreview';
import {
  EightMmReelEffect,
  EIGHT_MM_REEL_DURATION_FRAMES,
} from './EightMmReelEffect';
import {
  FilmReelWhiteBgEffect,
  FILM_REEL_WHITE_BG_FRAMES,
} from './FilmReelWhiteBgEffect';
import {
  RealisticFilmReelEffect,
  REALISTIC_FILM_REEL_FRAMES,
} from './RealisticFilmReelEffect';
import {
  BlurFillImageEffect,
  BLUR_FILL_DURATION_FRAMES,
} from './BlurFillImageEffect';
import type {ProductionTimelineEvent} from './productionRegistry';

/**
 * Remotion entry — production DocumentaryEdit uses the merged effect pack
 * (selected + earlier + final-clean soft glass / purple lower third).
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="RealisticFilmReel"
      component={RealisticFilmReelEffect}
      durationInFrames={REALISTIC_FILM_REEL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="FilmReelWhiteBg"
      component={FilmReelWhiteBgEffect}
      durationInFrames={FILM_REEL_WHITE_BG_FRAMES}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{reelScale: 0.75}}
    />
    <Composition
      id="EightMmReel"
      component={EightMmReelEffect}
      durationInFrames={EIGHT_MM_REEL_DURATION_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="BlurFillImage"
      component={BlurFillImageEffect}
      durationInFrames={BLUR_FILL_DURATION_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="PurpleLowerThirdPreview"
      component={PurpleLowerThirdPreview}
      durationInFrames={PURPLE_LOWER_THIRD_PREVIEW_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="MysteryV3FinalPreview"
      component={MysteryV3FinalPreview}
      durationInFrames={Math.round(MYSTERY_V3_FINAL_PREVIEW_DURATION_SEC * 30)}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="AWSelectedVisualPackPreview"
      component={SelectedPackPreview}
      durationInFrames={1476}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="EffectCatalogStill"
      component={EffectCatalogStill}
      durationInFrames={120}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={
        {
          presetId: '24_soft_glass_focus_slideshow',
        } satisfies EffectCatalogStillProps
      }
    />
    <Composition
      id="EffectCatalogAll"
      component={EffectCatalogAll}
      durationInFrames={EFFECT_CATALOG_COUNT * 4 * 30}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{holdSec: 4} satisfies EffectCatalogAllProps}
      calculateMetadata={({props}: {props: EffectCatalogAllProps}) => {
        const holdSec = props.holdSec ?? 4;
        return {
          durationInFrames: Math.round(holdSec * EFFECT_CATALOG_COUNT * 30),
        };
      }}
    />
    <Composition
      id="MotionCatalogAll"
      component={MotionCatalogAll}
      durationInFrames={MOTION_CATALOG_COUNT * 3.2 * 30}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{holdSec: 3.2} satisfies MotionCatalogAllProps}
      calculateMetadata={({props}: {props: MotionCatalogAllProps}) => {
        const holdSec = props.holdSec ?? 3.2;
        return {
          durationInFrames: Math.round(holdSec * MOTION_CATALOG_COUNT * 30),
        };
      }}
    />
    <Composition
      id="CinematicIntro"
      component={CinematicIntro}
      durationInFrames={Math.round(INTRO_DURATION_SEC * 30)}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{musicVolume: 0.9} satisfies CinematicIntroProps}
    />
    <Composition
      id="GlitchCatalogAll"
      component={GlitchCatalogAll}
      durationInFrames={GLITCH_CATALOG_COUNT * 2.4 * 30}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={
        {holdSec: 2.4, overlaySec: 0.9} satisfies GlitchCatalogAllProps
      }
      calculateMetadata={({props}: {props: GlitchCatalogAllProps}) => {
        const holdSec = props.holdSec ?? 2.4;
        return {
          durationInFrames: Math.round(holdSec * GLITCH_CATALOG_COUNT * 30),
        };
      }}
    />
    <Composition
      id="TransitionPreview"
      component={TransitionPreview}
      durationInFrames={162}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={
        {
          transitionPath: 'overlays/transitions/film-burn-woosh.mp4',
          holdSec: 1.8,
          transitionSec: 0.6,
          blendMode: 'screen',
          transitionVolume: 0.9,
          stillPaths: [
            'overlays/transitions/preview-stills/cave.png',
            'overlays/transitions/preview-stills/a.png',
            'overlays/transitions/preview-stills/b.png',
          ],
        } satisfies TransitionPreviewProps
      }
      calculateMetadata={({props}: {props: TransitionPreviewProps}) => {
        const holdSec = props.holdSec ?? 1.8;
        const n = Math.min(3, props.stillPaths?.length || 3);
        return {durationInFrames: Math.max(60, Math.round(holdSec * n * 30))};
      }}
    />
    <Composition
      id="TransitionPreviewAll"
      component={TransitionPreviewAll}
      durationInFrames={Math.round(1.4 * (ALL_TRANSITIONS.length + 1) * 30)}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={
        {
          holdSec: 1.4,
          transitionSec: 1,
          speedFactor: 1.3,
          blendMode: 'screen',
          transitionVolume: 0.9,
          transitionDarken: 0.38,
        } satisfies TransitionPreviewAllProps
      }
      calculateMetadata={({props}: {props: TransitionPreviewAllProps}) => {
        const holdSec = props.holdSec ?? 1.4;
        return {
          durationInFrames: Math.max(
            90,
            Math.round(holdSec * (ALL_TRANSITIONS.length + 1) * 30),
          ),
        };
      }}
    />
    <Composition
      id="DocumentaryEdit"
      component={DocumentaryEditComposition}
      durationInFrames={30 * 120}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={
        {
          scenes: [],
          effectEvents: [],
          sfxEvents: [],
          musicEvents: [],
          glitchEvents: [],
          fps: 30,
          voiceoverUrl: undefined,
        } satisfies DocumentaryEditProps
      }
      calculateMetadata={({props}: {props: DocumentaryEditProps}) => {
        const scenes = props.scenes || [];
        const effectEvents = props.effectEvents || [];
        const sfxEvents = props.sfxEvents || [];
        const musicEvents = props.musicEvents || [];
        const glitchEvents = props.glitchEvents || [];
        const fps = props.fps || 30;
        const introOn = Boolean(
          props.cinematicIntro?.enabled && (props.cinematicIntro.shots?.length || 0) > 0,
        );
        const introFrames = introOn
          ? Math.round((props.cinematicIntro?.durationSec || INTRO_DURATION_SEC) * fps)
          : 0;
        const last = scenes.reduce(
          (max: number, s: DocumentarySceneClip) =>
            Math.max(max, Math.round((s.endTime || 0) * fps)),
          30 * 30,
        );
        const effectEnd = effectEvents.reduce(
          (max: number, e: ProductionTimelineEvent) =>
            Math.max(max, (e.startFrame || 0) + (e.durationFrames || 0)),
          0,
        );
        const sfxEnd = sfxEvents.reduce(
          (max, e) =>
            Math.max(
              max,
              Math.round((e.startTime || 0) * fps) +
                Math.round((e.durationSec || 0.5) * fps),
            ),
          0,
        );
        const musicEnd = musicEvents.reduce(
          (max, e) =>
            Math.max(
              max,
              Math.round((e.startTime || 0) * fps) +
                Math.round((e.durationSec || 60) * fps),
            ),
          0,
        );
        const glitchEnd = glitchEvents.reduce(
          (max, e) =>
            Math.max(
              max,
              Math.round((e.startTime || 0) * fps) +
                Math.round((e.durationSec || 0.75) * fps),
            ),
          0,
        );
        const bodyEnd = Math.max(90, last, effectEnd, sfxEnd, musicEnd, glitchEnd);
        return {
          durationInFrames: bodyEnd + introFrames,
        };
      }}
    />
  </>
);
