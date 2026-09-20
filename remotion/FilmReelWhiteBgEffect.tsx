import React from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  Img,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type FilmReelWhiteBgProps = {
  imageSrc?: string;
  soundVolume?: number;
  /** Fraction of frame the reel occupies (default 0.75) */
  reelScale?: number;
};

const SPROCKETS = 8;

/**
 * White-canvas film reel: clean white stage with the 8mm gate centered
 * at ~75% of the frame, plus projector reel SFX.
 */
export const FilmReelWhiteBgEffect: React.FC<FilmReelWhiteBgProps> = ({
  imageSrc = staticFile('demo/statue.png'),
  soundVolume = 1,
  reelScale = 0.75,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();

  const jx =
    Math.sin(frame * 1.7) * 1.8 +
    Math.sin(frame * 0.37) * 1.1 +
    (random(`wjx-${frame}`) - 0.5) * 1.4;
  const jy =
    Math.cos(frame * 1.3) * 2.0 +
    Math.sin(frame * 0.51) * 0.9 +
    (random(`wjy-${frame}`) - 0.5) * 1.6;

  const flicker =
    0.9 +
    0.08 * Math.sin(frame * 2.3) +
    0.05 * Math.sin(frame * 5.1) +
    (random(`wfl-${Math.floor(frame / 2)}`) - 0.5) * 0.06;

  const zoom = interpolate(frame, [0, durationInFrames], [1.03, 1.1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const sprocketShift = (frame * 7.2) % 78;
  const gatePulse = Math.pow(
    Math.max(0, Math.sin(frame * ((18 * Math.PI * 2) / fps))),
    8,
  );

  const scale = Math.max(0.4, Math.min(0.95, reelScale));
  const reelW = Math.round(width * scale);
  const reelH = Math.round(height * scale);
  const stripW = 52;
  const gateW = reelW - stripW - 28;
  const gateH = reelH - 36;

  return (
    <AbsoluteFill style={{backgroundColor: '#FFFFFF'}}>
      <Html5Audio
        src={staticFile('sfx/film/8mm-film-reel.mp3')}
        volume={soundVolume}
        startFrom={0}
      />

      {/* Soft paper shadow under the reel card */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: reelW,
          height: reelH,
          transform: 'translate(-50%, -50%)',
          borderRadius: 18,
          boxShadow: '0 28px 80px rgba(0,0,0,0.18), 0 2px 0 rgba(0,0,0,0.04)',
          overflow: 'hidden',
          background:
            'linear-gradient(90deg, #0c0907 0%, #16120e 14%, #1b1612 50%, #16120e 86%, #0c0907 100%)',
        }}
      >
        {/* Sprocket strip */}
        <div
          style={{
            position: 'absolute',
            left: 10,
            top: -40,
            width: stripW,
            height: reelH + 80,
            transform: `translateY(${-sprocketShift}px)`,
          }}
        >
          {Array.from({length: SPROCKETS + 3}).map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 9,
                top: i * 78,
                width: 32,
                height: 26,
                borderRadius: 6,
                background:
                  'radial-gradient(circle at 40% 35%, #2a2218 0%, #0a0806 70%)',
                boxShadow:
                  'inset 0 0 0 2px rgba(255,170,70,0.32), 0 0 8px rgba(255,140,40,0.14)',
                border: '1px solid rgba(255,190,90,0.4)',
              }}
            />
          ))}
        </div>

        {/* Projected gate (image) */}
        <div
          style={{
            position: 'absolute',
            left: stripW + 14,
            top: '50%',
            width: gateW,
            height: gateH,
            transform: `translateY(-50%) translate(${jx}px, ${jy}px)`,
            borderRadius: 22,
            overflow: 'hidden',
            boxShadow:
              '0 0 0 2px rgba(255,200,120,0.16), 0 18px 50px rgba(0,0,0,0.55)',
            opacity: flicker,
            filter: 'contrast(1.08) saturate(0.78) sepia(0.26) brightness(0.97)',
          }}
        >
          <Img
            src={imageSrc}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${zoom})`,
              filter: 'blur(0.3px)',
            }}
          />

          <AbsoluteFill
            style={{
              background:
                'linear-gradient(180deg, rgba(255,180,80,0.08), rgba(80,30,10,0.2))',
              mixBlendMode: 'multiply',
              pointerEvents: 'none',
            }}
          />
          <AbsoluteFill
            style={{
              background:
                'radial-gradient(circle at center, transparent 42%, rgba(0,0,0,0.5) 100%)',
              pointerEvents: 'none',
            }}
          />

          {Array.from({length: 14}).map((_, i) => {
            const seed = `wdust-${i}-${Math.floor(frame / 4)}`;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${random(`${seed}-x`) * 100}%`,
                  top: `${random(`${seed}-y`) * 100}%`,
                  width: 1 + random(`${seed}-s`) * 2.2,
                  height: 1 + random(`${seed}-s2`) * 2.2,
                  borderRadius: random(`${seed}-r`) > 0.6 ? 2 : 0,
                  background:
                    random(`${seed}-c`) > 0.5
                      ? 'rgba(255,255,255,0.5)'
                      : 'rgba(0,0,0,0.5)',
                  opacity: 0.35 + random(`${seed}-o`) * 0.4,
                  pointerEvents: 'none',
                }}
              />
            );
          })}

          <AbsoluteFill
            style={{
              opacity: 0.2,
              mixBlendMode: 'overlay',
              backgroundImage: `
                radial-gradient(circle at 20% 30%, rgba(255,255,255,0.35) 0 0.6px, transparent 1px),
                radial-gradient(circle at 70% 60%, rgba(0,0,0,0.4) 0 0.7px, transparent 1.1px)
              `,
              backgroundSize: '3px 3px, 4px 4px',
              transform: `translate(${(frame % 3) - 1}px, ${(frame % 5) - 2}px)`,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      {/* SFX indicator */}
      <div
        style={{
          position: 'absolute',
          right: 40,
          bottom: 36,
          padding: '10px 16px',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid rgba(0,0,0,0.12)',
          color: '#7a4a12',
          fontFamily: 'Courier New, monospace',
          fontWeight: 700,
          fontSize: 20,
          letterSpacing: 1.4,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 99,
            background: `rgba(255,140,40,${0.35 + gatePulse * 0.65})`,
            boxShadow:
              gatePulse > 0.4 ? '0 0 10px rgba(255,160,40,0.85)' : 'none',
          }}
        />
        REEL SFX · 75%
      </div>
    </AbsoluteFill>
  );
};

export const FILM_REEL_WHITE_BG_FRAMES = 120; // 4.00s @ 30fps
