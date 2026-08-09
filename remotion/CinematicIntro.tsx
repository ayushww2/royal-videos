import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * 7-second cinematic hook: 7 shots × 1s, hard punch cuts, film-burn overlay on
 * each cut, escalating dramatic text, trailer music. Designed to stop the scroll.
 */

export type IntroShot = {
  src: string;
  line1: string;
  line2?: string;
  /** Ken Burns direction for the 1s hold. */
  motion: "in" | "out";
  /** Transition overlay played over the cut into this shot. */
  overlay?: string;
};

const SHOTS: IntroShot[] = [
  {
    src: "intro/shot1.jpg",
    line1: "THE DEAD SEA",
    line2: "IS DYING",
    motion: "in",
  },
  {
    src: "intro/shot2.jpg",
    line1: "THE GROUND",
    line2: "IS COLLAPSING",
    motion: "out",
    overlay: "overlays/transitions/film-burn.mp4",
  },
  {
    src: "intro/shot3.jpg",
    line1: "WHOLE RESORTS",
    line2: "ABANDONED",
    motion: "in",
    overlay: "overlays/transitions/transition-glitch.mp4",
  },
  {
    src: "intro/shot4.jpg",
    line1: "THE WATER",
    line2: "IS GONE",
    motion: "in",
    overlay: "overlays/transitions/camera-shutter.mp4",
  },
  {
    src: "intro/shot5.jpg",
    line1: "SALT IS LOSING",
    line2: "CONTROL",
    motion: "out",
    overlay: "overlays/transitions/light-film-burn.mp4",
  },
  {
    src: "intro/shot6.png",
    line1: "SOMETHING IS",
    line2: "GROWING BELOW",
    motion: "in",
    overlay: "overlays/transitions/rgb-glitch-effect.mp4",
  },
  {
    src: "intro/shot7.jpg",
    line1: "EZEKIEL SAW THIS",
    line2: "2,600 YEARS AGO",
    motion: "in",
    overlay: "overlays/transitions/double-camera-film-burn.mp4",
  },
];

const SHOT_SEC = 1;

function mediaSrc(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return staticFile(src.replace(/^\/+/, ""));
}

function ShotMedia({ shot, durationInFrames }: { shot: IntroShot; durationInFrames: number }) {
  const frame = useCurrentFrame();
  // Aggressive push so a 1s hold still reads as motion.
  const amount = 0.14;
  const scale =
    shot.motion === "in"
      ? interpolate(frame, [0, durationInFrames], [1.02, 1.02 + amount], {
          extrapolateRight: "clamp",
        })
      : interpolate(frame, [0, durationInFrames], [1.02 + amount, 1.02], {
          extrapolateRight: "clamp",
        });

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <Img
        src={mediaSrc(shot.src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          filter: "contrast(1.12) saturate(0.92) brightness(0.88)",
        }}
      />
      {/* Cinematic vignette + bottom crush for text legibility */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.72) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background: "linear-gradient(0deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 45%)",
        }}
      />
    </AbsoluteFill>
  );
}

function ShotText({
  shot,
  index,
  total,
}: {
  shot: IntroShot;
  index: number;
  total: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Snap in hard, then settle — no slow fades in a 1s cut.
  const pop = spring({ frame, fps, config: { damping: 200, mass: 0.5 }, durationInFrames: 10 });
  const y = interpolate(pop, [0, 1], [26, 0]);
  const opacity = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: "clamp" });
  const letter = interpolate(pop, [0, 1], [14, 6]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 132,
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: "Impact, Haettenschweiler, 'Arial Black', sans-serif",
            fontSize: 96,
            lineHeight: 1.02,
            color: "#ffffff",
            letterSpacing: letter,
            textShadow: "0 6px 30px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,1)",
          }}
        >
          {shot.line1}
        </div>
        {shot.line2 ? (
          <div
            style={{
              fontFamily: "Impact, Haettenschweiler, 'Arial Black', sans-serif",
              fontSize: 96,
              lineHeight: 1.02,
              color: index === total - 1 ? "#ffd24a" : "#ffffff",
              letterSpacing: letter,
              textShadow: "0 6px 30px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,1)",
            }}
          >
            {shot.line2}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

/** Hard white flash on the cut — trailer-style impact. */
function CutFlash({ durationInFrames }: { durationInFrames: number }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 2, durationInFrames], [0.55, 0.18, 0], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: "#fff", opacity, pointerEvents: "none" }} />
  );
}

export type CinematicIntroProps = {
  musicVolume?: number;
  /** When provided (Mystery finals), overrides the Dead Sea catalog defaults. */
  shots?: IntroShot[];
};

export const CinematicIntro: React.FC<CinematicIntroProps> = ({
  musicVolume = 0.9,
  shots,
}) => {
  const { fps } = useVideoConfig();
  const activeShots = shots?.length ? shots : SHOTS;
  const shotFrames = Math.round(SHOT_SEC * fps);
  const overlayFrames = Math.round(0.5 * fps);
  const hookFrames = activeShots.length * shotFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Audio src={staticFile("intro/intro-music.mp3")} volume={musicVolume} />

      {activeShots.map((shot, i) => (
        <Sequence key={`shot-${i}`} from={i * shotFrames} durationInFrames={shotFrames}>
          <ShotMedia shot={shot} durationInFrames={shotFrames} />
          <ShotText shot={shot} index={i} total={activeShots.length} />
        </Sequence>
      ))}

      {/* Transition overlays + flash sit on the cut boundary between shots. */}
      {activeShots.map((shot, i) => {
        if (!shot.overlay || i === 0) return null;
        const from = Math.max(0, i * shotFrames - Math.floor(overlayFrames / 2));
        return (
          <Sequence key={`tx-${i}`} from={from} durationInFrames={overlayFrames}>
            <CutFlash durationInFrames={overlayFrames} />
            <AbsoluteFill style={{ mixBlendMode: "screen", pointerEvents: "none" }}>
              <OffthreadVideo
                src={mediaSrc(shot.overlay)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                muted
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* Final hard fade so it cuts cleanly into the documentary body. */}
      <Sequence from={hookFrames - 6} durationInFrames={6}>
        <FinalFade />
      </Sequence>
    </AbsoluteFill>
  );
};

function FinalFade() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ backgroundColor: "#000", opacity }} />;
}

export const INTRO_SHOT_COUNT = SHOTS.length;
export const INTRO_DURATION_SEC = SHOTS.length * SHOT_SEC;
