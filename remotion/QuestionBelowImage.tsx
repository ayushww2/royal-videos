import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
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
 * Mystery reveal: full-bleed still + typewriter question (optional blink cursor).
 * Visual target matches remotion/public/reference/08-reveal-question.png.
 */
export const QuestionBelowImage: React.FC<QuestionBelowImageProps> = ({
  backgroundImage,
  imageSrc,
  question = '',
  secondaryText,
  subtext,
  durationFrames = 105,
  soundVolume = 0.16,
  imageOnly = false,
  showCursor = true,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const src = backgroundImage || imageSrc || '';
  const text = String(question || '').trim();
  const under = String(secondaryText || subtext || '').trim();

  const typeStart = Math.round(0.18 * fps);
  const typeEnd = Math.round(Math.min(durationFrames * 0.55, typeStart + text.length * 1.6));
  const typedCount = Math.max(
    0,
    Math.min(
      text.length,
      Math.floor(
        interpolate(frame, [typeStart, Math.max(typeStart + 1, typeEnd)], [0, text.length], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
      ),
    ),
  );
  const typed = text.slice(0, typedCount);
  const cursorOn =
    showCursor &&
    !imageOnly &&
    frame >= typeStart &&
    (frame < typeEnd + Math.round(0.35 * fps) || Math.floor(frame / 8) % 2 === 0);

  const ruleProgress = spring({
    frame: frame - Math.round(0.42 * fps),
    fps,
    config: {damping: 18, stiffness: 120},
  });
  const underOpacity = interpolate(
    frame,
    [Math.round(0.55 * fps), Math.round(0.75 * fps)],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const shade = interpolate(frame, [0, Math.round(0.35 * fps)], [0.35, 0.62], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{backgroundColor: '#05070a'}}>
      {src ? (
        <Img
          src={src}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${interpolate(frame, [0, durationFrames], [1.04, 1.12], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })})`,
          }}
        />
      ) : null}

      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 42%, rgba(8,17,31,${shade * 0.35}), rgba(1,4,8,${shade}) 75%), linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.45))`,
        }}
      />

      {!imageOnly ? (
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            padding: '0 150px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 1620,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 18,
            }}
          >
            <div
              style={{
                minHeight: 120,
                width: '100%',
                textAlign: 'center',
                color: '#fff',
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: 84,
                fontWeight: 800,
                letterSpacing: 1,
                textTransform: 'uppercase',
                textShadow: '0 8px 26px rgba(0,0,0,0.55)',
                lineHeight: 1.15,
              }}
            >
              {typed}
              {cursorOn ? (
                <span style={{opacity: 0.95, marginLeft: 4, color: '#ffd24a'}}>|</span>
              ) : null}
            </div>

            <div
              style={{
                width: 700,
                height: 8,
                borderRadius: 999,
                background: 'linear-gradient(90deg,#ff405a,#ff8998,#ff405a)',
                boxShadow: '0 0 18px rgba(255,64,90,0.42)',
                transform: `scaleX(${Math.max(0.08, ruleProgress)})`,
                opacity: ruleProgress,
              }}
            />

            {under ? (
              <div
                style={{
                  opacity: underOpacity,
                  textAlign: 'center',
                  color: 'rgba(255,255,255,0.94)',
                  fontFamily: 'system-ui, Arial, sans-serif',
                  fontSize: 34,
                  fontWeight: 750,
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                  marginTop: 8,
                }}
              >
                {under}
              </div>
            ) : null}
          </div>
        </AbsoluteFill>
      ) : null}

      {soundVolume > 0 && !imageOnly ? (
        <Audio src={staticFile('sfx/royal/cinematic_whoosh.wav')} volume={soundVolume} />
      ) : null}
    </AbsoluteFill>
  );
};
