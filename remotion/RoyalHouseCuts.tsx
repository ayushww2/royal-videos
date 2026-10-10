import React, {useEffect, useState} from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const SERIF = '"Royal Serif", "Noto Serif", Georgia, serif';

const STILLS = {
  palace: "william-promise/media/line-05-image.jpg",
  couple: "william-promise/media/line-01-image.jpg",
  william: "william-promise/media/line-07-image.jpg",
  formal: "william-promise/media/line-18-image.jpg",
  coronation: "william-promise/media/line-03-image.jpg",
  family: "william-promise/media/line-21-title.jpg",
  podium: "william-promise/media/line-09-image.jpg",
} as const;

const SOFT_LEAK = "overlays/transitions/soft-film-burn.mp4";
/** Native length of soft-film-burn.mp4. */
const LEAK_FRAMES = 21;

const SCENE = 39;
const YEAR = 24;
const QUOTE = 90;
const BEFORE_CHAPTER = 36;
const AFTER_CHAPTER = 48;
const CLOSE = 36;

type Block =
  | {kind: "still"; src: string; frames: number}
  | {kind: "year"; year: string; frames: number}
  | {kind: "quote"; src: string; quote: string; speaker: string; frames: number};

const BLOCKS: Block[] = [
  {kind: "still", src: STILLS.palace, frames: SCENE},
  {kind: "year", year: "1997", frames: YEAR},
  {kind: "still", src: STILLS.couple, frames: SCENE},
  {kind: "year", year: "2018", frames: YEAR},
  {kind: "still", src: STILLS.family, frames: SCENE},
  {kind: "year", year: "2020", frames: YEAR},
  {kind: "still", src: STILLS.palace, frames: 30},
  {
    kind: "quote",
    src: STILLS.william,
    quote: "I made a promise, and I intend to keep it.",
    speaker: "Prince William",
    frames: QUOTE,
  },
  {kind: "still", src: STILLS.formal, frames: BEFORE_CHAPTER},
  {kind: "still", src: STILLS.coronation, frames: AFTER_CHAPTER},
  {kind: "still", src: STILLS.podium, frames: CLOSE},
];

function startOf(index: number): number {
  return BLOCKS.slice(0, index).reduce((sum, block) => sum + block.frames, 0);
}

/** Chapter turn: the only soft cut in the reel. Every other join is a hard cut. */
const CHAPTER_CUT_FRAME = startOf(BLOCKS.findIndex((b) => b.kind === "still" && b.src === STILLS.coronation));

export const ROYAL_HOUSE_CUTS_FRAMES = BLOCKS.reduce((sum, block) => sum + block.frames, 0);

function useRoyalSerif(): boolean {
  const [handle] = useState(() => delayRender("royal-serif"));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const faces = [
      new FontFace("Royal Serif", `url(${staticFile("fonts/NotoSerif-Regular.ttf")})`, {
        weight: "400",
        style: "normal",
      }),
      new FontFace("Royal Serif", `url(${staticFile("fonts/NotoSerif-Italic.ttf")})`, {
        weight: "400",
        style: "italic",
      }),
      new FontFace("Royal Serif", `url(${staticFile("fonts/NotoSerif-Bold.ttf")})`, {
        weight: "700",
        style: "normal",
      }),
    ];
    Promise.all(faces.map((face) => face.load()))
      .then((loaded) => {
        loaded.forEach((face) => document.fonts.add(face));
        setReady(true);
        continueRender(handle);
      })
      .catch((error: unknown) => {
        cancelRender(error instanceof Error ? error : new Error(String(error)));
      });
  }, [handle]);

  return ready;
}

const Still: React.FC<{src: string}> = ({src}) => {
  const frame = useCurrentFrame();
  const scale = 1 + frame * 0.00045;
  return (
    <AbsoluteFill style={{backgroundColor: "#000", overflow: "hidden"}}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Full-frame year. The number is the scene. Held under one second. */
export const FullFrameYear: React.FC<{year: string}> = ({year}) => (
  <AbsoluteFill
    style={{
      backgroundColor: "#070707",
      justifyContent: "center",
      alignItems: "center",
    }}
  >
    <div
      style={{
        fontFamily: SERIF,
        fontWeight: 500,
        fontSize: 340,
        lineHeight: 0.9,
        color: "#f3efe6",
        letterSpacing: "-0.035em",
      }}
    >
      {year}
    </div>
  </AbsoluteFill>
);

/**
 * Spoken line in serif over the portrait.
 * Type only — no plate, no rule, no red grid.
 */
export const PortraitQuote: React.FC<{
  src: string;
  quote: string;
  speaker: string;
}> = ({src, quote, speaker}) => {
  const frame = useCurrentFrame();
  const scale = 1 + frame * 0.00035;
  const opacity = interpolate(frame, [6, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frame, [6, 18], [14, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const hold = 90;

  return (
    <AbsoluteFill style={{backgroundColor: "#000", overflow: "hidden"}}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center 30%",
          transform: `scale(${scale})`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.28) 34%, rgba(0,0,0,0) 58%)",
          opacity: interpolate(frame, [0, 10], [0.35, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 120,
          right: 120,
          bottom: 92,
          textAlign: "center",
          opacity,
          transform: `translateY(${rise}px)`,
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: quote.length > 70 ? 46 : 54,
            lineHeight: 1.28,
            color: "#f6f1e7",
            textShadow: "0 2px 22px rgba(0,0,0,0.72)",
          }}
        >
          “{quote}”
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: SERIF,
            fontStyle: "normal",
            fontWeight: 500,
            fontSize: 26,
            letterSpacing: "0.04em",
            color: "rgba(243,239,230,0.88)",
            textShadow: "0 2px 14px rgba(0,0,0,0.7)",
            opacity: interpolate(frame, [14, 24, hold], [0, 1, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {speaker}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SoftLightLeak: React.FC = () => {
  const frame = useCurrentFrame();
  const fade = 4;
  const veil = interpolate(
    frame,
    [0, fade, LEAK_FRAMES - fade, LEAK_FRAMES - 1],
    [0, 0.18, 0.18, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"}
  );
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{backgroundColor: "#000", opacity: veil}} />
      <AbsoluteFill style={{mixBlendMode: "screen"}}>
        <OffthreadVideo
          src={staticFile(SOFT_LEAK)}
          volume={0.22}
          style={{width: "100%", height: "100%", objectFit: "cover"}}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * Short royal cut:
 * year cards at 1997, 2018, and 2020;
 * one spoken line over the portrait;
 * one soft light leak at the chapter turn.
 * Every other cut is hard.
 */
export const RoyalHouseCuts: React.FC = () => {
  const fontsReady = useRoyalSerif();
  if (!fontsReady) return null;

  let cursor = 0;
  return (
    <AbsoluteFill style={{backgroundColor: "#000"}}>
      {BLOCKS.map((block, index) => {
        const from = cursor;
        cursor += block.frames;
        if (block.kind === "year") {
          return (
            <Sequence key={`year-${block.year}-${index}`} from={from} durationInFrames={block.frames}>
              <FullFrameYear year={block.year} />
            </Sequence>
          );
        }
        if (block.kind === "quote") {
          return (
            <Sequence key={`quote-${index}`} from={from} durationInFrames={block.frames}>
              <PortraitQuote src={block.src} quote={block.quote} speaker={block.speaker} />
            </Sequence>
          );
        }
        return (
          <Sequence key={`still-${index}`} from={from} durationInFrames={block.frames}>
            <Still src={block.src} />
          </Sequence>
        );
      })}
      <Sequence
        from={Math.max(0, CHAPTER_CUT_FRAME - Math.floor(LEAK_FRAMES / 2))}
        durationInFrames={LEAK_FRAMES}
      >
        <SoftLightLeak />
      </Sequence>
    </AbsoluteFill>
  );
};
