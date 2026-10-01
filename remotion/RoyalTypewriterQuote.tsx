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
          right: "5.2%",
          top: "25%",
          width: "26%",
          height: "50%",
          padding: 7,
          border: "3px solid rgba(255,255,255,0.94)",
          boxSizing: "border-box",
          backgroundColor: "#050506",
          overflow: "hidden",
          boxShadow: "0 28px 80px rgba(0,0,0,0.7)",
        }}
      >
        <Img
          src={sourceFor(portraitPath)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "50% 34%",
            transform: `scale(${portraitScale})`,
            filter: "grayscale(0.12) contrast(1.08) brightness(0.78)",
          }}
        />
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, transparent 62%, rgba(0,0,0,0.22) 100%)",
          }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: "9.8%",
          top: "25.4%",
          width: "52%",
          minHeight: 520,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -74,
            top: -24,
            color: "#FFFFFF",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontWeight: 700,
            fontSize: 92,
            lineHeight: 1,
          }}
        >
          “
        </div>
        <div
          style={{
            color: "#FFFFFF",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontWeight: 500,
            fontSize: quote.length > 130 ? 52 : quote.length > 88 ? 59 : 66,
            lineHeight: 1.28,
            letterSpacing: 0.15,
            whiteSpace: "pre-wrap",
            textWrap: "balance",
            textShadow: "0 2px 10px rgba(0,0,0,0.64)",
          }}
        >
          {typedQuote}
          {typingComplete ? (
            <span
              style={{
                display: "inline-block",
                marginLeft: 8,
                fontSize: "1.48em",
                fontWeight: 700,
                lineHeight: 0,
                verticalAlign: "-0.18em",
              }}
            >
              ”
            </span>
          ) : null}
          {cursorVisible ? (
            <span
              style={{
                display: "inline-block",
                width: 3,
                height: "0.9em",
                marginLeft: 6,
                verticalAlign: "-0.08em",
                backgroundColor: "white",
              }}
            />
          ) : null}
        </div>

        <div
          style={{
            marginTop: 42,
            opacity: attributionOpacity,
            transform: `translateY(${(1 - attributionOpacity) * 10}px)`,
          }}
        >
          <div
            style={{
              color: "white",
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontWeight: 700,
              fontSize: 20,
              letterSpacing: 4.2,
              textTransform: "uppercase",
            }}
          >
            — {personName}
          </div>
          {context ? (
            <div
              style={{
                marginTop: 9,
                color: "rgba(255,255,255,0.52)",
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontWeight: 600,
                fontSize: 14,
                letterSpacing: 2.8,
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
          opacity: 0.026,
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
