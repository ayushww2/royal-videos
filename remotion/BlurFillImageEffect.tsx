import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type BlurFillImageProps = {
  imageSrc?: string;
  /** Blur radius for the fill background */
  blurPx?: number;
  /** Optional light film dust/scratches on top */
  filmDust?: boolean;
};

/**
 * Blur-fill / pillarbox effect: same still blown up + blurred behind a
 * sharp centered frame (matches the reference “blur image” look).
 */
export const BlurFillImageEffect: React.FC<BlurFillImageProps> = ({
  imageSrc = staticFile('demo/statue.png'),
  blurPx = 28,
  filmDust = true,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, width, height} = useVideoConfig();

  const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.06], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Keep a cinematic inset frame (~4:3 feel inside 16:9)
  const frameW = Math.round(width * 0.62);
  const frameH = Math.round(height * 0.92);

  return (
    <AbsoluteFill style={{backgroundColor: '#000', overflow: 'hidden'}}>
      {/* Blurred fill background */}
      <AbsoluteFill>
        <Img
          src={imageSrc}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${1.25 * zoom})`,
            filter: `blur(${blurPx}px) brightness(0.72) saturate(0.9)`,
          }}
        />
        <AbsoluteFill
          style={{
            background: 'rgba(0,0,0,0.18)',
            pointerEvents: 'none',
          }}
        />
      </AbsoluteFill>

      {/* Sharp centered image */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: frameW,
          height: frameH,
          transform: `translate(-50%, -50%) scale(${zoom})`,
          overflow: 'hidden',
          boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
        }}
      >
        <Img
          src={imageSrc}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'contrast(1.04) saturate(0.95)',
          }}
        />
      </div>

      {filmDust ? (
        <>
          {Array.from({length: 12}).map((_, i) => {
            const seed = `bf-dust-${i}-${Math.floor(frame / 5)}`;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${random(`${seed}-x`) * 100}%`,
                  top: `${random(`${seed}-y`) * 100}%`,
                  width: 1 + random(`${seed}-w`) * 2,
                  height: 1 + random(`${seed}-h`) * 2,
                  background:
                    random(`${seed}-c`) > 0.5
                      ? 'rgba(255,255,255,0.45)'
                      : 'rgba(0,0,0,0.4)',
                  opacity: 0.4,
                  pointerEvents: 'none',
                }}
              />
            );
          })}
          <AbsoluteFill
            style={{
              opacity: 0.12,
              mixBlendMode: 'overlay',
              backgroundImage: `
                radial-gradient(circle at 25% 40%, white 0 0.55px, transparent 1px),
                radial-gradient(circle at 75% 70%, black 0 0.6px, transparent 1px)
              `,
              backgroundSize: '3px 3px, 4px 4px',
              pointerEvents: 'none',
            }}
          />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

export const BLUR_FILL_DURATION_FRAMES = 120; // 4s @ 30fps
