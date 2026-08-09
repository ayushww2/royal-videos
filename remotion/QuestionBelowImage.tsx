import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type QuestionBelowImageProps = {
  backgroundImage?: string;
  imageSrc?: string;
  question?: string;
  secondaryText?: string;
  subtext?: string;
  durationFrames?: number;
  soundVolume?: number;
  imageOnly?: boolean;
  showCursor?: boolean;
};

/**
 * Jesus-style reveal: framed still on black, question typed below in monospace.
 */
export const QuestionBelowImage: React.FC<QuestionBelowImageProps> = ({
  backgroundImage,
  imageSrc,
  question = '',
  durationFrames = 105,
  soundVolume = 0.16,
  imageOnly = false,
  showCursor = true,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const src = backgroundImage || imageSrc || '';
  const text = String(question || '').trim().toUpperCase();

  const imageIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const zoom = interpolate(frame, [0, durationFrames], [1.02, 1.08], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Typewriter: start after the frame lands, ~2.2 frames/char
  const typeStart = Math.round(0.35 * fps);
  const framesPerChar = 2.2;
  const typedCount = Math.max(
    0,
    Math.min(
      text.length,
      frame < typeStart ? 0 : Math.floor((frame - typeStart) / framesPerChar) + 1,
    ),
  );
  const typed = text.slice(0, typedCount);
  const typingDone = typedCount >= text.length;
  const cursorBlink = Math.floor(frame / 8) % 2 === 0;
  const showCaret =
    showCursor &&
    !imageOnly &&
    frame >= typeStart &&
    (!typingDone || cursorBlink);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#000',
        justifyContent: 'flex-start',
        alignItems: 'center',
      }}
    >
      {/* Framed evidence still */}
      <div
        style={{
          marginTop: 72,
          width: 1480,
          height: 760,
          borderRadius: 18,
          border: '3px solid rgba(255,255,255,0.92)',
          overflow: 'hidden',
          boxShadow: '0 28px 80px rgba(0,0,0,0.65)',
          opacity: imageIn,
          transform: `translateY(${(1 - imageIn) * 18}px)`,
          backgroundColor: '#0a0a0a',
        }}
      >
        {src ? (
          <Img
            src={src}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${zoom})`,
            }}
          />
        ) : null}
      </div>

      {/* Typewriter question under the frame */}
      {!imageOnly ? (
        <div
          style={{
            marginTop: 54,
            width: 1480,
            minHeight: 72,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            color: '#FFFFFF',
            fontFamily: '"Courier New", Courier, monospace',
            fontWeight: 700,
            fontSize: 54,
            letterSpacing: 3.5,
            textTransform: 'uppercase',
            textAlign: 'center',
            whiteSpace: 'pre',
          }}
        >
          <span>{typed}</span>
          {showCaret ? (
            <span
              style={{
                display: 'inline-block',
                width: 28,
                height: 54,
                marginLeft: 4,
                backgroundColor: '#FFFFFF',
                transform: 'translateY(2px)',
              }}
            />
          ) : (
            <span style={{display: 'inline-block', width: 28, height: 54}} />
          )}
        </div>
      ) : null}

      {soundVolume > 0 && !imageOnly ? (
        <Audio src={staticFile('sfx/royal/soft_whip.wav')} volume={soundVolume} />
      ) : null}
    </AbsoluteFill>
  );
};
