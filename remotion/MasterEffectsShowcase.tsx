import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import {EffectCatalogAll, EFFECT_CATALOG_COUNT} from "./EffectCatalogAll";
import {TransitionPreviewAll, ALL_TRANSITIONS} from "./TransitionPreviewAll";
import {GlitchCatalogAll, GLITCH_CATALOG_COUNT} from "./GlitchCatalogAll";
import {MotionCatalogAll, MOTION_CATALOG_COUNT} from "./MotionCatalogAll";
import {
  RealisticFilmReelEffect,
  REALISTIC_FILM_REEL_FRAMES,
} from "./RealisticFilmReelEffect";
import {
  EightMmReelEffect,
  EIGHT_MM_REEL_DURATION_FRAMES,
} from "./EightMmReelEffect";
import {
  BlurFillImageEffect,
  BLUR_FILL_DURATION_FRAMES,
} from "./BlurFillImageEffect";
import {
  PurpleLowerThirdPreview,
  PURPLE_LOWER_THIRD_PREVIEW_FRAMES,
} from "./PurpleLowerThirdPreview";
import {CinematicIntro, INTRO_DURATION_SEC} from "./CinematicIntro";

const FPS = 30;
const EFFECT_HOLD = 2.8;
const TRANSITION_HOLD = 1.35;
const GLITCH_HOLD = 2.2;
const MOTION_HOLD = 2.6;
const SECTION_TITLE_SEC = 2.2;

function TitleCard({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = interpolate(frame, [0, 8, Math.round(fps * SECTION_TITLE_SEC) - 8, Math.round(fps * SECTION_TITLE_SEC)], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#05070b",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{textAlign: "center", padding: 48, maxWidth: 1600}}>
        <div
          style={{
            fontFamily: "Inter, Arial, sans-serif",
            fontSize: 28,
            letterSpacing: 6,
            color: "#8ff0a4",
            marginBottom: 18,
            fontWeight: 700,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 72,
            color: "#fff",
            fontWeight: 700,
            lineHeight: 1.15,
            marginBottom: 20,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "Inter, Arial, sans-serif",
            fontSize: 30,
            color: "#c9d4e4",
            lineHeight: 1.4,
          }}
        >
          {subtitle}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function LabeledSpecial({
  name,
  id,
  children,
}: {
  name: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <AbsoluteFill>
      {children}
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 36,
          padding: "14px 22px",
          background: "rgba(0,0,0,0.82)",
          borderLeft: "6px solid #ffd24a",
          zIndex: 50,
        }}
      >
        <div
          style={{
            fontFamily: "Inter, Arial, sans-serif",
            fontSize: 36,
            fontWeight: 800,
            color: "#fff",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: "Consolas, monospace",
            fontSize: 22,
            color: "#8ff0a4",
            marginTop: 4,
          }}
        >
          {id}
        </div>
      </div>
    </AbsoluteFill>
  );
}

const titleFrames = Math.round(SECTION_TITLE_SEC * FPS);
const effectsFrames = Math.round(EFFECT_HOLD * EFFECT_CATALOG_COUNT * FPS);
const transitionsFrames = Math.round(
  TRANSITION_HOLD * (ALL_TRANSITIONS.length + 1) * FPS
);
const glitchFrames = Math.round(GLITCH_HOLD * GLITCH_CATALOG_COUNT * FPS);
const motionFrames = Math.round(MOTION_HOLD * MOTION_CATALOG_COUNT * FPS);
const introFrames = Math.round(INTRO_DURATION_SEC * FPS);

export const MASTER_EFFECTS_SHOWCASE_FRAMES =
  titleFrames + // open
  titleFrames +
  effectsFrames +
  titleFrames +
  transitionsFrames +
  titleFrames +
  glitchFrames +
  titleFrames +
  motionFrames +
  titleFrames +
  REALISTIC_FILM_REEL_FRAMES +
  EIGHT_MM_REEL_DURATION_FRAMES +
  BLUR_FILL_DURATION_FRAMES +
  PURPLE_LOWER_THIRD_PREVIEW_FRAMES +
  titleFrames +
  introFrames;

/**
 * One continuous catalog: every production preset, transition, glitch,
 * motion treatment, and special Remotion effect — each named on screen.
 */
export const MasterEffectsShowcase: React.FC = () => {
  let at = 0;
  const sections: Array<{from: number; dur: number; node: React.ReactNode}> = [];

  const push = (dur: number, node: React.ReactNode) => {
    sections.push({from: at, dur, node});
    at += dur;
  };

  push(
    titleFrames,
    <TitleCard
      eyebrow="DOCUMENTARY VIDEO FACTORY"
      title="All Render Effects"
      subtitle="Production presets · transitions · glitches · motion · specials"
    />
  );

  push(
    titleFrames,
    <TitleCard
      eyebrow="SECTION 1"
      title="Production Effect Presets"
      subtitle={`${EFFECT_CATALOG_COUNT} labeled presets — lower thirds, slideshows, quotes, grids`}
    />
  );
  push(effectsFrames, <EffectCatalogAll holdSec={EFFECT_HOLD} />);

  push(
    titleFrames,
    <TitleCard
      eyebrow="SECTION 2"
      title="Cut Transition Overlays"
      subtitle={`${ALL_TRANSITIONS.length} film-burn / glitch transition MP4s`}
    />
  );
  push(
    transitionsFrames,
    <TransitionPreviewAll
      holdSec={TRANSITION_HOLD}
      transitionSec={0.85}
      speedFactor={1}
      transitionDarken={0.35}
      transitionVolume={0.55}
    />
  );

  push(
    titleFrames,
    <TitleCard
      eyebrow="SECTION 3"
      title="Glitch Overlays"
      subtitle={`${GLITCH_CATALOG_COUNT} overlays — approved + rejected (named)`}
    />
  );
  push(
    glitchFrames,
    <GlitchCatalogAll holdSec={GLITCH_HOLD} overlaySec={0.85} />
  );

  push(
    titleFrames,
    <TitleCard
      eyebrow="SECTION 4"
      title="Camera Motions"
      subtitle={`${MOTION_CATALOG_COUNT} Ken Burns / motion treatments`}
    />
  );
  push(motionFrames, <MotionCatalogAll holdSec={MOTION_HOLD} />);

  push(
    titleFrames,
    <TitleCard
      eyebrow="SECTION 5"
      title="Special Effects"
      subtitle="Film reel · 8mm · blur fill · purple LT · cinematic intro"
    />
  );
  push(
    REALISTIC_FILM_REEL_FRAMES,
    <LabeledSpecial name="Realistic Film Reel" id="RealisticFilmReel">
      <RealisticFilmReelEffect />
    </LabeledSpecial>
  );
  push(
    EIGHT_MM_REEL_DURATION_FRAMES,
    <LabeledSpecial name="8mm Film Reel" id="EightMmReel">
      <EightMmReelEffect />
    </LabeledSpecial>
  );
  push(
    BLUR_FILL_DURATION_FRAMES,
    <LabeledSpecial name="Blur Fill Image" id="BlurFillImage">
      <BlurFillImageEffect />
    </LabeledSpecial>
  );
  push(
    PURPLE_LOWER_THIRD_PREVIEW_FRAMES,
    <LabeledSpecial
      name="Classic Purple Lower Third"
      id="29_classic_purple_white_lower_third"
    >
      <PurpleLowerThirdPreview />
    </LabeledSpecial>
  );

  push(
    titleFrames,
    <TitleCard
      eyebrow="SECTION 6"
      title="Cinematic Intro"
      subtitle="Mystery-style opener package"
    />
  );
  push(introFrames, <CinematicIntro musicVolume={0.55} />);

  return (
    <AbsoluteFill style={{backgroundColor: "#000"}}>
      {/* Soft catalog bed under titles/sections — duck-ish low */}
      <Audio
        src={staticFile("music/royal/the_palace_decision.mp3")}
        volume={0.06}
      />
      {sections.map((s, i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.dur} layout="none">
          {s.node}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
