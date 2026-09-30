import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

export type RoyalTypewriterQuoteProps = {
  quote: string;
  personName: string;
  context?: string;
  portraitPath: string;
  durationFrames?: number;
  typingSoundPath?: string;
};

const sourceFor = (path: string) =>
  /^https?:\/\//i.test(path) ? path : staticFile(path);

export const RoyalTypewriterQuote: React.FC<
  RoyalTypewriterQuoteProps
> = ({
  quote,
  personName,
  context,
  portraitPath,
  durationFrames = 240,
  typingSoundPath = "sfx/royal/typewriter_typing.wav",
}) => {
  const frame = useCurrentFrame();
  const typingStart = 20;
  const typingEnd = Math.min(durationFrames - 62, 176);
  const typedCharacters = Math.floor(
    interpolate(
      frame,
      [typingStart, typingEnd],
      [0, quote.length],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
  );
  const typedQuote = quote.slice(0, typedCharacters);
  const typingComplete = typedCharacters >= quote.length;
  const cursorVisible = !typingComplete && Math.floor(frame / 7) % 2 === 0;
  const attributionOpacity = interpolate(
    frame,
    [typingEnd - 2, typingEnd + 14],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const introOpacity = interpolate(
    frame,
    [0, 14],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const outroOpacity = interpolate(
    frame,
    [Math.max(0, durationFrames - 20), durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const visible = introOpacity * outroOpacity;
  const portraitScale = interpolate(
    frame,
    [0, Math.max(1, durationFrames - 1)],
    [1.025, 1.065],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        backgroundColor: "#020203",
        color: "white",
        opacity: visible,
      }}
    >
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: "43%",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <Img
          src={sourceFor(portraitPath)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "50% 28%",
            transform: `scale(${portraitScale})`,
            filter: "grayscale(0.28) contrast(1.08) brightness(0.72)",
          }}
        />
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(90deg, #020203 0%, rgba(2,2,3,0.8) 18%, rgba(2,2,3,0.12) 58%, rgba(2,2,3,0.2) 100%)",
          }}
        />
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.12) 0%, transparent 48%, rgba(0,0,0,0.7) 100%)",
          }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: 112,
          top: 96,
          width: 44,
          height: 4,
          backgroundColor: "white",
          opacity: 0.92,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 110,
          top: 190,
          width: "54%",
          minHeight: 500,
        }}
      >
        <div
          style={{
            color: "rgba(255,255,255,0.36)",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: 106,
            lineHeight: 0.7,
            height: 72,
          }}
        >
          “
        </div>
        <div
          style={{
            color: "#FFFFFF",
            fontFamily: "'Courier New', Courier, monospace",
            fontWeight: 700,
            fontSize: quote.length > 105 ? 43 : quote.length > 78 ? 49 : 55,
            lineHeight: 1.3,
            letterSpacing: 0.4,
            whiteSpace: "pre-wrap",
            textWrap: "balance",
            textShadow: "0 2px 10px rgba(0,0,0,0.72)",
          }}
        >
          {typedQuote}
          {cursorVisible ? (
            <span
              style={{
                display: "inline-block",
                width: 4,
                height: "0.9em",
                marginLeft: 7,
                verticalAlign: "-0.08em",
                backgroundColor: "white",
              }}
            />
          ) : null}
        </div>

        <div
          style={{
            marginTop: 40,
            opacity: attributionOpacity,
            transform: `translateY(${(1 - attributionOpacity) * 10}px)`,
          }}
        >
          <div
            style={{
              color: "white",
              fontFamily: "Inter, Arial, sans-serif",
              fontWeight: 900,
              fontSize: 23,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            {personName}
          </div>
          {context ? (
            <div
              style={{
                marginTop: 9,
                color: "rgba(255,255,255,0.58)",
                fontFamily: "Inter, Arial, sans-serif",
                fontWeight: 650,
                fontSize: 16,
                letterSpacing: 2.1,
                textTransform: "uppercase",
              }}
            >
              {context}
            </div>
          ) : null}
        </div>
      </div>

      <AbsoluteFill
        style={{
          pointerEvents: "none",
          opacity: 0.035,
          mixBlendMode: "screen",
          backgroundImage: `
            radial-gradient(circle at 18% 24%, white 0 1px, transparent 1.3px),
            radial-gradient(circle at 68% 73%, white 0 1px, transparent 1.3px),
            radial-gradient(circle at 44% 52%, white 0 1px, transparent 1.3px)
          `,
          backgroundSize: "17px 17px, 23px 23px, 29px 29px",
        }}
      />

      <Sequence
        from={typingStart}
        durationInFrames={Math.max(1, typingEnd - typingStart + 6)}
        layout="none"
      >
        <Audio
          src={staticFile(typingSoundPath)}
          volume={(audioFrame) => {
            const fade = interpolate(
              audioFrame,
              [0, 6, Math.max(7, typingEnd - typingStart - 2), typingEnd - typingStart + 5],
              [0, 0.24, 0.24, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );
            return fade;
          }}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
