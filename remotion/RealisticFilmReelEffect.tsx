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

export type RealisticFilmReelProps = {
  imageSrc?: string;
  soundVolume?: number;
};

/**
 * Real-looking Super-8 projector look (matches classic 8mm gate reference):
 * fixed rounded aperture, scrolling film with adjacent frame lines,
 * glowing left sprockets, warm grade, grain/dust, weave + reel SFX.
 */
export const RealisticFilmReelEffect: React.FC<RealisticFilmReelProps> = ({
  imageSrc = staticFile('demo/statue.png'),
  soundVolume = 1,
}) => {
  const frame = useCurrentFrame();
  const {width, height, durationInFrames} = useVideoConfig();

  const jx =
    Math.sin(frame * 1.55) * 2.2 +
    Math.sin(frame * 0.41) * 1.1 +
    (random(`rjx-${frame}`) - 0.5) * 1.5;
  const jy =
    Math.cos(frame * 1.22) * 2.8 +
    Math.sin(frame * 0.55) * 1.3 +
    (random(`rjy-${frame}`) - 0.5) * 1.8;

  const flicker =
    0.88 +
    0.09 * Math.sin(frame * 2.15) +
    0.05 * Math.sin(frame * 4.7) +
    (random(`rfl-${Math.floor(frame / 2)}`) - 0.5) * 0.06;

  const zoom = interpolate(frame, [0, durationInFrames], [1.04, 1.12], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // ~4:3 gate in 16:9 letterbox (includes left sprocket gutter)
  const sprocketGutter = 52;
  const gateW = Math.round(width * 0.64);
  const gateH = Math.round(height * 0.88);
  const stripW = gateW + sprocketGutter;
  const cellH = gateH;
  const lineH = 26;
  const pitch = cellH + lineH;

  // Continuous vertical transport
  const scroll = (frame * 5.5) % pitch;

  const warm =
    'contrast(1.06) saturate(0.7) sepia(0.42) brightness(1.03) hue-rotate(-8deg)';

  const cells = [-1, 0, 1, 2].map((i) => {
    const top = i * pitch - scroll;
    return (
      <React.Fragment key={i}>
        <div
          style={{
            position: 'absolute',
            left: sprocketGutter,
            top,
            width: gateW,
            height: cellH,
            overflow: 'hidden',
          }}
        >
          <Img
            src={imageSrc}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${zoom})`,
              filter: `${warm} blur(0.35px)`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(255,205,130,0.14), rgba(50,20,6,0.3))',
              mixBlendMode: 'soft-light',
            }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            left: sprocketGutter - 6,
            top: top + cellH,
            width: gateW + 16,
            height: lineH,
            background: '#050302',
            boxShadow: 'inset 0 0 10px rgba(0,0,0,0.85)',
          }}
        />
      </React.Fragment>
    );
  });

  const sprockets = Array.from({length: 7}).map((_, i) => {
    const y = ((i * (pitch / 2.2) - scroll * 0.85) % (pitch * 2)) + 20;
    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: 10,
          top: y,
          width: 34,
          height: 27,
          borderRadius: 8,
          background:
            'radial-gradient(circle at 42% 38%, #1c140e 0%, #050302 78%)',
          border: '2px solid rgba(255,175,75,0.85)',
          boxShadow:
            '0 0 14px rgba(255,140,40,0.55), inset 0 0 8px rgba(255,200,100,0.25)',
          zIndex: 5,
        }}
      />
    );
  });

  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      <Html5Audio
        src={staticFile('sfx/film/8mm-film-reel.mp3')}
        volume={soundVolume}
        startFrom={0}
      />

      {/* Film strip assembly (jitters as a unit) */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: stripW,
          height: gateH + pitch * 2,
          marginLeft: -stripW / 2,
          marginTop: -(gateH + pitch) / 2,
          transform: `translate(${jx}px, ${jy}px)`,
          opacity: flicker,
          background:
            'linear-gradient(90deg, #120e0a 0%, #1e1610 20%, #1a140f 80%, #120e0a 100%)',
          overflow: 'hidden',
        }}
      >
        {cells}
        {sprockets}
      </div>

      {/* Fixed rounded projector aperture — includes sprocket gutter */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: stripW,
          height: gateH,
          marginLeft: -stripW / 2,
          marginTop: -gateH / 2,
          borderRadius: 52,
          boxShadow: '0 0 0 2000px #000',
          pointerEvents: 'none',
        }}
      />

      {/* Subtle warm rim inside aperture */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: stripW,
          height: gateH,
          marginLeft: -stripW / 2,
          marginTop: -gateH / 2,
          borderRadius: 52,
          boxShadow:
            'inset 0 0 40px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,190,100,0.12)',
          pointerEvents: 'none',
        }}
      />

      {/* Light leaks */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${10 + Math.sin(frame / 18) * 3}% 28%, rgba(255,130,40,${0.12 * flicker}), transparent 34%)`,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 90% ${72 + Math.cos(frame / 21) * 4}%, rgba(255,80,20,${0.08}), transparent 30%)`,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />

      {/* Grain */}
      <AbsoluteFill
        style={{
          opacity: 0.3,
          mixBlendMode: 'overlay',
          backgroundImage: `
            radial-gradient(circle at 20% 25%, rgba(255,255,255,0.4) 0 0.55px, transparent 1px),
            radial-gradient(circle at 65% 55%, rgba(0,0,0,0.45) 0 0.65px, transparent 1.1px),
            radial-gradient(circle at 40% 80%, rgba(255,255,255,0.28) 0 0.5px, transparent 0.9px),
            radial-gradient(circle at 80% 20%, rgba(0,0,0,0.35) 0 0.55px, transparent 1px)
          `,
          backgroundSize: '2.6px 2.6px, 3.2px 3.2px, 4px 4px, 3px 3px',
          transform: `translate(${(frame % 3) - 1}px, ${(frame % 4) - 2}px)`,
          pointerEvents: 'none',
        }}
      />

      {/* Dust / short hairs only (no full-height white scratches) */}
      {Array.from({length: 20}).map((_, i) => {
        const seed = `rd-${i}-${Math.floor(frame / 3)}`;
        const hair = random(`${seed}-h`) > 0.85;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${18 + random(`${seed}-x`) * 64}%`,
              top: `${8 + random(`${seed}-y`) * 84}%`,
              width: hair ? 1 : 1 + random(`${seed}-w`) * 2.2,
              height: hair ? 10 + random(`${seed}-hh`) * 22 : 1 + random(`${seed}-hh`) * 2.2,
              borderRadius: hair ? 1 : 2,
              background:
                random(`${seed}-c`) > 0.5
                  ? 'rgba(255,255,255,0.42)'
                  : 'rgba(0,0,0,0.48)',
              opacity: 0.28 + random(`${seed}-o`) * 0.35,
              transform: hair
                ? `rotate(${(random(`${seed}-r`) - 0.5) * 28}deg)`
                : undefined,
              pointerEvents: 'none',
            }}
          />
        );
      })}

      {/* Soft outer falloff */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.7) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};

export const REALISTIC_FILM_REEL_FRAMES = 120; // 4.00s @ 30fps
