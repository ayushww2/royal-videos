import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type EightMmReelProps = {
  imageSrc?: string;
  soundVolume?: number;
};

const SPROCKETS = 7;

/**
 * 4-second Super-8 / 8mm projector look: gate jitter, flicker, grain,
 * warm grade, sprocket strip, rounded gate, projector reel SFX.
 */
export const EightMmReelEffect: React.FC<EightMmReelProps> = ({
  imageSrc = staticFile('demo/statue.png'),
  soundVolume = 1,
}) => {
  const frame = useCurrentFrame();
  const {width, height, durationInFrames} = useVideoConfig();

  // Gate jitter (~frame weave)
  const jx =
    Math.sin(frame * 1.7) * 2.2 +
    Math.sin(frame * 0.37) * 1.4 +
    (random(`jx-${frame}`) - 0.5) * 1.8;
  const jy =
    Math.cos(frame * 1.3) * 2.6 +
    Math.sin(frame * 0.51) * 1.1 +
    (random(`jy-${frame}`) - 0.5) * 2.2;

  // Exposure flicker
  const flicker =
    0.88 +
    0.1 * Math.sin(frame * 2.3) +
    0.06 * Math.sin(frame * 5.1) +
    (random(`fl-${Math.floor(frame / 2)}`) - 0.5) * 0.08;

  // Soft Ken Burns
  const zoom = interpolate(frame, [0, durationInFrames], [1.04, 1.12], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Sprocket scroll
  const sprocketShift = (frame * 7.2) % 78;

  const gateW = width * 0.78;
  const gateH = height * 0.78;
  const stripLeft = (width - gateW) / 2 - 86;

  return (
    <AbsoluteFill style={{backgroundColor: '#050302'}}>
      {/* Film strip body */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(90deg, #0a0705 0%, #14100c 12%, #1a1510 50%, #14100c 88%, #0a0705 100%)',
        }}
      />

      {/* Sprocket column */}
      <div
        style={{
          position: 'absolute',
          left: stripLeft,
          top: -40,
          width: 54,
          height: height + 80,
          transform: `translateY(${-sprocketShift}px)`,
        }}
      >
        {Array.from({length: SPROCKETS + 2}).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 10,
              top: i * 78,
              width: 34,
              height: 28,
              borderRadius: 7,
              background:
                'radial-gradient(circle at 40% 35%, #2a2218 0%, #0a0806 70%)',
              boxShadow:
                'inset 0 0 0 2px rgba(255,170,70,0.35), 0 0 10px rgba(255,140,40,0.18)',
              border: '1px solid rgba(255,190,90,0.45)',
            }}
          />
        ))}
      </div>

      {/* Projected gate */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: gateW,
          height: gateH,
          transform: `translate(-50%, -50%) translate(${jx}px, ${jy}px)`,
          borderRadius: 28,
          overflow: 'hidden',
          boxShadow:
            '0 0 0 3px rgba(255,200,120,0.18), 0 30px 80px rgba(0,0,0,0.75)',
          opacity: flicker,
          filter: 'contrast(1.08) saturate(0.78) sepia(0.28) brightness(0.96)',
        }}
      >
        <Img
          src={imageSrc}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            filter: 'blur(0.35px)',
          }}
        />

        {/* Warm grade wash */}
        <AbsoluteFill
          style={{
            background:
              'linear-gradient(180deg, rgba(255,180,80,0.08), rgba(80,30,10,0.22))',
            mixBlendMode: 'multiply',
            pointerEvents: 'none',
          }}
        />

        {/* Vignette inside gate */}
        <AbsoluteFill
          style={{
            background:
              'radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.55) 100%)',
            pointerEvents: 'none',
          }}
        />

        {/* Dust / hair specs */}
        {Array.from({length: 18}).map((_, i) => {
          const seed = `dust-${i}-${Math.floor(frame / 4)}`;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${random(`${seed}-x`) * 100}%`,
                top: `${random(`${seed}-y`) * 100}%`,
                width: 1 + random(`${seed}-s`) * 2.5,
                height: 1 + random(`${seed}-s2`) * 2.5,
                borderRadius: random(`${seed}-r`) > 0.6 ? 2 : 0,
                background:
                  random(`${seed}-c`) > 0.5
                    ? 'rgba(255,255,255,0.55)'
                    : 'rgba(0,0,0,0.55)',
                opacity: 0.35 + random(`${seed}-o`) * 0.45,
                pointerEvents: 'none',
              }}
            />
          );
        })}

        {/* Grain overlay */}
        <AbsoluteFill
          style={{
            opacity: 0.22,
            mixBlendMode: 'overlay',
            backgroundImage: `
              radial-gradient(circle at 20% 30%, rgba(255,255,255,0.35) 0 0.6px, transparent 1px),
              radial-gradient(circle at 70% 60%, rgba(0,0,0,0.4) 0 0.7px, transparent 1.1px),
              radial-gradient(circle at 40% 80%, rgba(255,255,255,0.25) 0 0.5px, transparent 0.9px)
            `,
            backgroundSize: '3px 3px, 4px 4px, 5px 5px',
            transform: `translate(${(frame % 3) - 1}px, ${(frame % 5) - 2}px)`,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Outer film edge darkness */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at center, transparent 52%, rgba(0,0,0,0.72) 100%)',
          pointerEvents: 'none',
        }}
      />

      <Audio
        src={staticFile('sfx/film/8mm-film-reel.wav')}
        volume={1}
        startFrom={0}
      />
    </AbsoluteFill>
  );
};

export const EIGHT_MM_REEL_DURATION_FRAMES = 120; // exactly 4.00s @ 30fps
export const EIGHT_MM_REEL_DURATION_SEC = 4;
