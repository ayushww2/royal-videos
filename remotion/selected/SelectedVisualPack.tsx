import React from 'react';
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {
  CleanDocumentarySlideshow,
  type CleanDocumentarySlideshowProps,
  type CleanSlide,
} from './CleanSlideshowPresets';
import {QuestionBelowImage} from '../QuestionBelowImage';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const phase = (frame: number, from: number, to: number) =>
  clamp01(
    interpolate(frame, [from, to], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

const easeOut = (value: number) => 1 - Math.pow(1 - clamp01(value), 3);

export type FocusPoint = {x: number; y: number};
export type EvidenceTarget = {x: number; y: number; width?: number; height?: number};

export type SlideItem = CleanSlide & {
  focus?: FocusPoint;
  durationFrames?: number;
};

export type ClassicBlueWhiteLowerThirdProps = {
  primaryText: string;
  secondaryText?: string;
  durationFrames?: number;
  position?: 'bottom_left' | 'bottom_center';
  fillColor?: string;
  fillColorEnd?: string;
  textColor?: string;
  outlineColor?: string;
};

export const ClassicBlueWhiteLowerThird: React.FC<
  ClassicBlueWhiteLowerThirdProps
> = ({
  primaryText,
  secondaryText,
  durationFrames = 90,
  position = 'bottom_left',
  fillColor = '#1E3F8F',
  fillColorEnd = '#102F72',
  textColor = '#FFFFFF',
  outlineColor = '#FFFFFF',
}) => {
  const frame = useCurrentFrame();
  const {fps, width} = useVideoConfig();

  const intro = clamp01(
    spring({
      frame,
      fps,
      durationInFrames: 18,
      config: {damping: 15, stiffness: 145, mass: 0.8},
    }),
  );

  const outro = interpolate(
    frame,
    [Math.max(0, durationFrames - 14), durationFrames],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const p = intro * outro;
  const slide = interpolate(intro, [0, 1], [-620, 0]) - (1 - outro) * 260;
  const maxLength = Math.max(primaryText.length, secondaryText?.length ?? 0);
  // Fit bar tightly to short 2–3 word titles; grow for longer copy.
  const boxWidth = Math.min(
    width * 0.72,
    Math.max(280, 168 + maxLength * 28 + (secondaryText ? 40 : 0)),
  );
  const boxHeight = secondaryText ? 110 : 78;

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          left: position === 'bottom_center' ? '50%' : 92,
          bottom: 82,
          width: boxWidth + 32,
          height: boxHeight + 24,
          opacity: p,
          transform:
            position === 'bottom_center'
              ? `translateX(-50%) translateX(${slide}px)`
              : `translateX(${slide}px)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 22,
            top: 18,
            width: boxWidth,
            height: boxHeight,
            border: `4px solid ${outlineColor}`,
            opacity: 0.94,
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: boxWidth,
            height: boxHeight,
            background: `linear-gradient(180deg, ${fillColor} 0%, ${fillColorEnd} 100%)`,
            boxShadow: '0 15px 40px rgba(0,0,0,0.5)',
            boxSizing: 'border-box',
            padding: secondaryText ? '15px 22px 12px' : '14px 22px',
          }}
        >
          <div
            style={{
              color: textColor,
              fontFamily: 'Arial Narrow, Oswald, Impact, Inter, sans-serif',
              fontWeight: 950,
              fontSize: primaryText.length > 32 ? 39 : 48,
              letterSpacing: 2.5,
              lineHeight: 1,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textShadow: '0 3px 6px rgba(0,0,0,0.55)',
            }}
          >
            {primaryText}
          </div>

          {secondaryText ? (
            <div
              style={{
                marginTop: 9,
                color: 'rgba(255,255,255,0.84)',
                fontFamily: 'Inter, Arial, sans-serif',
                fontWeight: 800,
                fontSize: 20,
                letterSpacing: 2,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {secondaryText}
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Same slide/outline animation as classic blue — purple fill, white type. */
export type ClassicPurpleWhiteLowerThirdProps = ClassicBlueWhiteLowerThirdProps;

export const ClassicPurpleWhiteLowerThird: React.FC<
  ClassicPurpleWhiteLowerThirdProps
> = (props) => (
  <ClassicBlueWhiteLowerThird
    {...props}
    fillColor={props.fillColor ?? '#6B2CB8'}
    fillColorEnd={props.fillColorEnd ?? '#3D1578'}
    textColor={props.textColor ?? '#FFFFFF'}
    outlineColor={props.outlineColor ?? '#FFFFFF'}
  />
);

export type SecondaryBlueLowerThirdProps = {
  primaryText: string;
  secondaryText?: string;
  durationFrames?: number;
  position?: 'bottom_left' | 'bottom_center';
  blueColor?: string;
};

export const SecondaryBlueLowerThird: React.FC<
  SecondaryBlueLowerThirdProps
> = ({
  primaryText,
  secondaryText,
  durationFrames = 90,
  position = 'bottom_left',
  blueColor = '#173C87',
}) => {
  const frame = useCurrentFrame();
  const {width} = useVideoConfig();

  const intro = phase(frame, 0, 18);
  const secondaryIntro = phase(frame, 5, 23);
  const outro = interpolate(
    frame,
    [Math.max(0, durationFrames - 12), durationFrames],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const mainWidth = Math.min(width * 0.62, Math.max(520, 250 + primaryText.length * 17));
  const whiteWidth = Math.min(mainWidth * 0.8, 180 + (secondaryText?.length ?? 0) * 12);

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          left: position === 'bottom_center' ? '50%' : 80,
          bottom: 82,
          width: mainWidth,
          height: 122,
          transform: position === 'bottom_center' ? 'translateX(-50%)' : undefined,
          opacity: outro,
        }}
      >
        {secondaryText ? (
          <div
            style={{
              position: 'absolute',
              left: 38,
              top: 0,
              width: whiteWidth * secondaryIntro,
              height: 40,
              backgroundColor: 'rgba(255,255,255,0.96)',
              overflow: 'hidden',
              boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
            }}
          >
            <div
              style={{
                width: whiteWidth,
                padding: '9px 14px',
                color: blueColor,
                fontFamily: 'Inter, Arial, sans-serif',
                fontWeight: 900,
                fontSize: 17,
                letterSpacing: 2,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {secondaryText}
            </div>
          </div>
        ) : null}

        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            width: mainWidth * intro,
            height: 76,
            backgroundColor: blueColor,
            overflow: 'hidden',
            boxShadow: '0 15px 40px rgba(0,0,0,0.48)',
          }}
        >
          <div
            style={{
              width: mainWidth,
              padding: '15px 20px',
              color: '#FFFFFF',
              fontFamily: 'Impact, Arial Black, Arial Narrow, sans-serif',
              fontSize: primaryText.length > 32 ? 36 : 43,
              letterSpacing: 2,
              lineHeight: 1,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {primaryText}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export type SimpleTextOverlayProps = {
  text: string;
  secondaryText?: string;
  durationFrames?: number;
  position?: 'center' | 'bottom_left' | 'bottom_center' | 'top_left';
  accentColor?: string;
  textColor?: string;
  backgroundOpacity?: number;
};

export const SimpleTextOverlay: React.FC<SimpleTextOverlayProps> = ({
  text,
  secondaryText,
  durationFrames = 90,
  position = 'center',
  accentColor = '#74B7FF',
  textColor = '#FFFFFF',
  backgroundOpacity = 0.54,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const intro = clamp01(
    spring({
      frame,
      fps,
      durationInFrames: 22,
      config: {damping: 15, stiffness: 130, mass: 0.82},
    }),
  );

  const outro = interpolate(
    frame,
    [Math.max(0, durationFrames - 12), durationFrames],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const p = intro * outro;
  const positions = {
    center: {left: '50%', top: '50%', transform: 'translate(-50%, -50%)'},
    bottom_left: {left: 72, bottom: 68, transform: 'none'},
    bottom_center: {left: '50%', bottom: 68, transform: 'translateX(-50%)'},
    top_left: {left: 72, top: 68, transform: 'none'},
  } as const;
  const pos = positions[position];

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          ...pos,
          maxWidth: '78%',
          minWidth: position === 'center' ? '45%' : undefined,
          padding: '18px 28px 17px',
          backgroundColor: `rgba(0,0,0,${backgroundOpacity})`,
          borderBottom: `5px solid ${accentColor}`,
          boxShadow: '0 18px 52px rgba(0,0,0,0.48)',
          opacity: p,
          transform: `${pos.transform} scale(${0.92 + p * 0.08})`,
          textAlign: position === 'center' || position === 'bottom_center' ? 'center' : 'left',
        }}
      >
        <div
          style={{
            color: textColor,
            fontFamily: 'Arial Narrow, Oswald, Impact, Inter, sans-serif',
            fontWeight: 950,
            fontSize: text.length > 42 ? 44 : 58,
            lineHeight: 1.02,
            letterSpacing: 2.1,
            textTransform: 'uppercase',
            textShadow: '0 4px 12px rgba(0,0,0,0.68)',
          }}
        >
          {text}
        </div>
        {secondaryText ? (
          <div
            style={{
              marginTop: 14,
              color: 'rgba(255,255,255,0.82)',
              fontFamily: 'Inter, Arial, sans-serif',
              fontWeight: 750,
              fontSize: 22,
              letterSpacing: 1.2,
            }}
          >
            {secondaryText}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export type SlideshowProps = {
  slides: SlideItem[];
  defaultSlideFrames?: number;
  transitionFrames?: number;
  intensity?: number;
  showPresetLabel?: boolean;
};

/** Stage wash colors for #11 Cinematic Stage Slideshow. */
export type CinematicStageThemeId = 'amber' | 'steel' | 'teal' | 'crimson';

export const CINEMATIC_STAGE_THEMES: Record<
  CinematicStageThemeId,
  {bg: string; glowA: string; glowB: string; label: string}
> = {
  amber: {
    bg: '#241104',
    glowA: 'rgba(205,104,31,0.46)',
    glowB: 'rgba(89,24,8,0.42)',
    label: 'Amber',
  },
  steel: {
    bg: '#0a1628',
    glowA: 'rgba(72,128,190,0.44)',
    glowB: 'rgba(18,40,72,0.5)',
    label: 'Steel',
  },
  teal: {
    bg: '#041816',
    glowA: 'rgba(28,168,148,0.4)',
    glowB: 'rgba(8,52,46,0.5)',
    label: 'Teal',
  },
  crimson: {
    bg: '#1a0608',
    glowA: 'rgba(190,42,62,0.44)',
    glowB: 'rgba(62,10,22,0.52)',
    label: 'Crimson',
  },
};

export type CinematicStageSlideshowProps = SlideshowProps & {
  theme?: CinematicStageThemeId;
};

const getSlideEntries = (
  slides: SlideItem[],
  defaultSlideFrames: number,
  transitionFrames: number,
) => {
  let cursor = 0;
  return slides.map((slide, index) => {
    const duration = slide.durationFrames ?? defaultSlideFrames;
    const start = cursor;
    cursor += duration - (index === slides.length - 1 ? 0 : transitionFrames);
    return {slide, index, duration, start};
  });
};

export const GlassGallerySlideshow: React.FC<SlideshowProps> = ({
  slides,
  defaultSlideFrames = 105,
  transitionFrames = 20,
  intensity = 0.75,
  showPresetLabel = false,
}) => (
  <CleanDocumentarySlideshow
    preset="glass_gallery"
    slides={slides.map((slide) => ({
      ...slide,
      focusX: slide.focus?.x ?? slide.focusX,
      focusY: slide.focus?.y ?? slide.focusY,
    }))}
    durationPerSlide={defaultSlideFrames}
    transitionFrames={transitionFrames}
    intensity={intensity}
    showPresetLabel={showPresetLabel}
  />
);

export const ArchiveRibbonSlideshow: React.FC<SlideshowProps> = ({
  slides,
  defaultSlideFrames = 105,
  transitionFrames = 20,
  intensity = 0.72,
  showPresetLabel = false,
}) => (
  <CleanDocumentarySlideshow
    preset="archive_ribbon"
    slides={slides.map((slide) => ({
      ...slide,
      focusX: slide.focus?.x ?? slide.focusX,
      focusY: slide.focus?.y ?? slide.focusY,
    }))}
    durationPerSlide={defaultSlideFrames}
    transitionFrames={transitionFrames}
    intensity={intensity}
    showPresetLabel={showPresetLabel}
  />
);

const FilmFinish: React.FC = () => (
  <>
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        opacity: 0.04,
        mixBlendMode: 'screen',
        backgroundImage: `
          radial-gradient(circle at 18% 24%, white 0 1px, transparent 1.4px),
          radial-gradient(circle at 68% 73%, white 0 1px, transparent 1.4px),
          radial-gradient(circle at 44% 52%, white 0 1px, transparent 1.4px)
        `,
        backgroundSize: '13px 13px, 17px 17px, 19px 19px',
      }}
    />
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        background:
          'radial-gradient(circle at center, transparent 0%, transparent 58%, rgba(0,0,0,0.62) 100%)',
      }}
    />
  </>
);

export const CinematicStageSlideshow: React.FC<CinematicStageSlideshowProps> = ({
  slides,
  defaultSlideFrames = 105,
  transitionFrames = 20,
  intensity = 0.72,
  theme = 'amber',
}) => {
  const entries = getSlideEntries(slides, defaultSlideFrames, transitionFrames);
  const palette = CINEMATIC_STAGE_THEMES[theme] ?? CINEMATIC_STAGE_THEMES.amber;

  if (!slides.length) return <AbsoluteFill style={{backgroundColor: '#000'}} />;

  return (
    <AbsoluteFill style={{backgroundColor: palette.bg, overflow: 'hidden'}}>
      {entries.map(({slide, start, duration, index}) => (
        <Sequence key={`${slide.src}-${index}`} from={start} durationInFrames={duration}>
          <CinematicStageSlide
            slide={slide}
            duration={duration}
            intensity={intensity}
            theme={theme}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const CinematicStageSlide: React.FC<{
  slide: SlideItem;
  duration: number;
  intensity: number;
  theme?: CinematicStageThemeId;
}> = ({slide, duration, intensity, theme = 'amber'}) => {
  const frame = useCurrentFrame();
  const p = clamp01(frame / duration);
  const intro = phase(frame, 0, 10);
  const outro = interpolate(
    frame,
    [Math.max(0, duration - 12), duration],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const palette = CINEMATIC_STAGE_THEMES[theme] ?? CINEMATIC_STAGE_THEMES.amber;

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 24% 30%, ${palette.glowA} 0%, transparent 42%), radial-gradient(circle at 77% 68%, ${palette.glowB} 0%, transparent 45%), ${palette.bg}`,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '80%',
          height: '78%',
          transform: 'translate(-50%, -50%)',
          overflow: 'hidden',
          borderRadius: 22,
          border: '3px solid rgba(255,255,255,0.84)',
          boxShadow: '0 32px 95px rgba(0,0,0,0.60)',
          opacity: intro * outro,
        }}
      >
        <Img
          src={slide.src}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: `${(slide.focus?.x ?? slide.focusX ?? 0.5) * 100}% ${(slide.focus?.y ?? slide.focusY ?? 0.5) * 100}%`,
            transform: `scale(${1.02 + p * 0.07 * intensity})`,
          }}
        />
      </div>

      {slide.caption ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 18,
            transform: 'translateX(-50%)',
            color: 'white',
            fontFamily: 'Arial Narrow, Oswald, Impact, sans-serif',
            fontWeight: 950,
            fontSize: 28,
            letterSpacing: 2,
            textTransform: 'uppercase',
            textShadow: '0 4px 14px rgba(0,0,0,0.74)',
            opacity: intro * outro,
          }}
        >
          {slide.caption}
        </div>
      ) : null}

      <FilmFinish />
    </AbsoluteFill>
  );
};

export type SplitComparisonSlideshowProps = {
  leftImageSrc: string;
  rightImageSrc: string;
  leftLabel?: string;
  rightLabel?: string;
  leftTarget?: EvidenceTarget;
  rightTarget?: EvidenceTarget;
  durationFrames?: number;
  backgroundColor?: string;
  accentColor?: string;
};

export const SplitComparisonSlideshow: React.FC<
  SplitComparisonSlideshowProps
> = ({
  leftImageSrc,
  rightImageSrc,
  leftLabel = 'LEFT IMAGE',
  rightLabel = 'RIGHT IMAGE',
  leftTarget,
  rightTarget,
  durationFrames = 150,
  backgroundColor = '#2A0B0B',
  accentColor = '#F04C56',
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();

  const leftIn = phase(frame, 0, 24);
  const rightIn = phase(frame, 18, 44);
  const dividerIn = phase(frame, 36, 58);
  const markersIn = phase(frame, 56, 82);
  const outro = interpolate(
    frame,
    [Math.max(0, durationFrames - 12), durationFrames],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const stageTop = height * 0.18;
  const stageHeight = height * 0.69;
  const paneWidth = width * 0.43;
  const leftX = width * 0.055;
  const rightX = width * 0.515;

  const marker = (target: EvidenceTarget | undefined, paneX: number) => {
    if (!target) return null;
    const markerWidth = (target.width ?? 0.18) * paneWidth;
    const markerHeight = (target.height ?? 0.18) * stageHeight;
    const x = paneX + target.x * paneWidth - markerWidth / 2;
    const y = stageTop + target.y * stageHeight - markerHeight / 2;

    return (
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: markerWidth,
          height: markerHeight,
          border: `5px solid ${accentColor}`,
          borderRadius: '50%',
          opacity: markersIn * outro,
          boxShadow: `0 0 0 2px rgba(0,0,0,0.45), 0 0 22px ${accentColor}`,
        }}
      />
    );
  };

  return (
    <AbsoluteFill style={{backgroundColor, overflow: 'hidden', opacity: outro}}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 25% 35%, rgba(180,42,54,0.34) 0%, transparent 42%), radial-gradient(circle at 78% 68%, rgba(84,18,36,0.34) 0%, transparent 46%)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: leftX,
          top: stageTop,
          width: paneWidth,
          height: stageHeight,
          overflow: 'hidden',
          transform: `translateX(${(1 - leftIn) * -170}px)`,
          opacity: leftIn,
          boxShadow: '0 28px 78px rgba(0,0,0,0.48)',
        }}
      >
        <Img src={leftImageSrc} style={{width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.04)'}} />
      </div>

      <div
        style={{
          position: 'absolute',
          left: rightX,
          top: stageTop,
          width: paneWidth,
          height: stageHeight,
          overflow: 'hidden',
          transform: `translateX(${(1 - rightIn) * 170}px)`,
          opacity: rightIn,
          boxShadow: '0 28px 78px rgba(0,0,0,0.48)',
        }}
      >
        <Img src={rightImageSrc} style={{width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.04)'}} />
      </div>

      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: stageTop - 18,
          width: 4,
          height: stageHeight + 36,
          transform: 'translateX(-50%)',
          backgroundColor: 'white',
          opacity: dividerIn,
          boxShadow: '0 0 20px rgba(255,255,255,0.28)',
        }}
      />

      <div style={{position: 'absolute', left: leftX, top: 60, color: 'white', fontFamily: 'Inter, Arial, sans-serif', fontWeight: 900, fontSize: 24, letterSpacing: 1.6, textTransform: 'uppercase', opacity: leftIn}}>
        {leftLabel}
      </div>
      <div style={{position: 'absolute', right: width * 0.055, top: 60, color: 'white', fontFamily: 'Inter, Arial, sans-serif', fontWeight: 900, fontSize: 24, letterSpacing: 1.6, textTransform: 'uppercase', opacity: rightIn}}>
        {rightLabel}
      </div>

      {marker(leftTarget, leftX)}
      {marker(rightTarget, rightX)}
      <FilmFinish />
    </AbsoluteFill>
  );
};

export type RevealQuestionProps = {
  primaryText?: string;
  question?: string;
  secondaryText?: string;
  subtext?: string;
  durationFrames?: number;
  accentColor?: string;
  backgroundImage?: string;
  imageSrc?: string;
  imageOnly?: boolean;
  soundVolume?: number;
};

export const RevealQuestion: React.FC<RevealQuestionProps> = ({
  primaryText,
  question,
  durationFrames = 105,
  backgroundImage,
  imageSrc,
  imageOnly = false,
  soundVolume = 0.16,
}) => (
  <QuestionBelowImage
    backgroundImage={backgroundImage}
    imageSrc={imageSrc}
    question={question || primaryText}
    durationFrames={durationFrames}
    soundVolume={imageOnly ? 0 : soundVolume}
    imageOnly={imageOnly}
    showCursor={!imageOnly}
  />
);

export type GlitchCutTransitionProps = {
  from?: React.ReactNode;
  to?: React.ReactNode;
  fromImageSrc?: string;
  toImageSrc?: string;
  durationFrames?: number;
  intensity?: number;
};

export const GlitchCutTransition: React.FC<GlitchCutTransitionProps> = ({
  from,
  to,
  fromImageSrc,
  toImageSrc,
  durationFrames = 18,
  intensity = 0.65,
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const progress = Math.min(frame / durationFrames, 1);
  const showTo = progress > 0.45;
  const shake = Math.sin(frame * 1.8) * 12 * intensity;
  const rgbSplit = interpolate(progress, [0, 0.5, 1], [0, 10 * intensity, 0]);
  const flashOpacity = interpolate(progress, [0.2, 0.45, 0.65], [0, 0.35, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const before = from ?? (fromImageSrc ? <Img src={fromImageSrc} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : null);
  const after = to ?? (toImageSrc ? <Img src={toImageSrc} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : null);
  const active = showTo ? after : before;

  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: 'black'}}>
      <AbsoluteFill style={{transform: `translateX(${shake}px)`, filter: `contrast(${1 + intensity * 0.25}) saturate(1.1)`}}>
        {active}
      </AbsoluteFill>
      <AbsoluteFill style={{opacity: interpolate(progress, [0, 0.45, 1], [0, 0.35, 0]), mixBlendMode: 'screen', transform: `translateX(${rgbSplit}px)`, filter: 'sepia(1) saturate(4) hue-rotate(160deg)'}}>
        {active}
      </AbsoluteFill>
      <AbsoluteFill style={{opacity: interpolate(progress, [0, 0.45, 1], [0, 0.25, 0]), mixBlendMode: 'screen', transform: `translateX(${-rgbSplit}px)`, filter: 'sepia(1) saturate(4) hue-rotate(300deg)'}}>
        {active}
      </AbsoluteFill>

      {Array.from({length: 9}).map((_, index) => {
        const top = (height / 9) * index;
        const sliceHeight = height / 9;
        const offset = Math.sin(frame * 2.7 + index * 9.2) * 35 * intensity * (progress < 0.9 ? 1 : 0);
        const opacity = interpolate(progress, [0.1, 0.5, 0.9], [0, 0.55, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        return (
          <div key={index} style={{position: 'absolute', left: 0, top, width, height: sliceHeight, overflow: 'hidden', opacity, transform: `translateX(${offset}px)`}}>
            <div style={{position: 'absolute', left: 0, top: -top, width, height}}>{active}</div>
          </div>
        );
      })}

      <AbsoluteFill style={{opacity: interpolate(progress, [0, 0.5, 1], [0, 0.18, 0]), backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 1px, transparent 1px, transparent 3px)', mixBlendMode: 'screen'}} />
      <AbsoluteFill style={{backgroundColor: 'white', opacity: flashOpacity}} />
    </AbsoluteFill>
  );
};

export type RedGridArchiveBackgroundProps = {
  mainImage?: string;
  sideImages?: string[];
  title?: string;
  subtitle?: string;
  durationFrames?: number;
  gridColor?: string;
  backgroundColor?: string;
  gridOpacity?: number;
  mainImageScale?: number;
};

export const RedGridArchiveBackground: React.FC<
  RedGridArchiveBackgroundProps
> = ({
  mainImage,
  sideImages = [],
  title = 'FIELD INVESTIGATION',
  subtitle = 'Main image used in the red-grid layout',
  durationFrames = 120,
  gridColor = '#B23A3A',
  backgroundColor = '#4B0F12',
  gridOpacity = 0.45,
  mainImageScale = 0.82,
}) => {
  const frame = useCurrentFrame();
  const progress = Math.min(frame / durationFrames, 1);
  const gridMove = progress * 24;
  const mainScale = mainImageScale + progress * 0.025;

  return (
    <AbsoluteFill style={{backgroundColor, overflow: 'hidden'}}>
      <AbsoluteFill style={{background: 'radial-gradient(circle at center, rgba(140,30,35,0.65) 0%, rgba(40,5,8,0.95) 75%)'}} />
      <AbsoluteFill
        style={{
          opacity: gridOpacity,
          backgroundImage: `linear-gradient(${gridColor} 2px, transparent 2px), linear-gradient(90deg, ${gridColor} 2px, transparent 2px)`,
          backgroundSize: '74px 74px',
          transform: `translate(${gridMove}px, ${gridMove * 0.4}px)`,
        }}
      />

      {sideImages[0] ? (
        <div style={{position: 'absolute', left: 80, top: 140, width: 280, height: 600, overflow: 'hidden', opacity: 0.30, filter: 'blur(1px) saturate(0.75)', transform: 'rotate(-2deg)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)'}}>
          <Img src={sideImages[0]} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        </div>
      ) : null}

      {sideImages[1] ? (
        <div style={{position: 'absolute', right: 80, top: 140, width: 280, height: 600, overflow: 'hidden', opacity: 0.30, filter: 'blur(1px) saturate(0.75)', transform: 'rotate(2deg)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)'}}>
          <Img src={sideImages[1]} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        </div>
      ) : null}

      {mainImage ? (
        <div style={{position: 'absolute', left: '50%', top: '48%', width: 780, height: 520, transform: `translate(-50%, -50%) scale(${mainScale})`, overflow: 'hidden', backgroundColor: 'black', border: '8px solid rgba(255,255,255,0.88)', boxShadow: '0 28px 80px rgba(0,0,0,0.65)'}}>
          <Img src={mainImage} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        </div>
      ) : null}

      <div style={{position: 'absolute', left: '50%', bottom: 64, transform: 'translateX(-50%)', textAlign: 'center', color: 'white'}}>
        <div style={{fontFamily: 'Arial Narrow, Oswald, Impact, sans-serif', fontWeight: 950, fontSize: 42, letterSpacing: 2, textTransform: 'uppercase'}}>{title}</div>
        <div style={{marginTop: 7, fontFamily: 'Inter, Arial, sans-serif', fontWeight: 650, fontSize: 18, color: 'rgba(255,255,255,0.68)'}}>{subtitle}</div>
      </div>
      <FilmFinish />
    </AbsoluteFill>
  );
};

export type SelectedPresetId =
  | '01_classic_blue_white_lower_third'
  | '02_secondary_blue_lower_third'
  | '03_simple_text_overlay'
  | '04_glass_gallery_slideshow'
  | '05_archive_ribbon_slideshow'
  | '06_cinematic_stage_slideshow'
  | '07_split_comparison_slideshow'
  | '08_reveal_question'
  | '09_glitch_cut_transition'
  | '10_red_grid_archive_background';

export type SelectedTimelineEvent = {
  id: string;
  presetId: SelectedPresetId;
  startFrame: number;
  durationFrames: number;
  props: Record<string, unknown>;
  layer?: number;
  tags?: string[];
};

export const selectedPresetRegistry: Record<SelectedPresetId, React.ComponentType<any>> = {
  '01_classic_blue_white_lower_third': ClassicBlueWhiteLowerThird,
  '02_secondary_blue_lower_third': SecondaryBlueLowerThird,
  '03_simple_text_overlay': SimpleTextOverlay,
  '04_glass_gallery_slideshow': GlassGallerySlideshow,
  '05_archive_ribbon_slideshow': ArchiveRibbonSlideshow,
  '06_cinematic_stage_slideshow': CinematicStageSlideshow,
  '07_split_comparison_slideshow': SplitComparisonSlideshow,
  '08_reveal_question': RevealQuestion,
  '09_glitch_cut_transition': GlitchCutTransition,
  '10_red_grid_archive_background': RedGridArchiveBackground,
};

export const SELECTED_PRESET_ORDER = [
  {order: 1, id: '01_classic_blue_white_lower_third', name: 'Classic Blue/White Lower Third', category: 'Lower third'},
  {order: 2, id: '02_secondary_blue_lower_third', name: 'Secondary Blue Lower Third', category: 'Lower third'},
  {order: 3, id: '03_simple_text_overlay', name: 'Simple Text Overlay', category: 'Text'},
  {order: 4, id: '04_glass_gallery_slideshow', name: 'Glass Gallery Slideshow', category: 'Slideshow'},
  {order: 5, id: '05_archive_ribbon_slideshow', name: 'Archive Ribbon Slideshow', category: 'Slideshow'},
  {order: 6, id: '06_cinematic_stage_slideshow', name: 'Cinematic Stage Slideshow', category: 'Slideshow'},
  {order: 7, id: '07_split_comparison_slideshow', name: 'Split Comparison Slideshow', category: 'Comparison'},
  {order: 8, id: '08_reveal_question', name: 'Reveal Question', category: 'Text'},
  {order: 9, id: '09_glitch_cut_transition', name: 'Glitch Cut Transition', category: 'Transition'},
  {order: 10, id: '10_red_grid_archive_background', name: 'Red Grid Archive Background', category: 'Background'},
] as const;

/** Normalize focus so both `{focus:{x,y}}` and `{focusX,focusY}` work. */
export function normalizeFocusInput(
  input: {focus?: FocusPoint; focusX?: number; focusY?: number} | null | undefined
): FocusPoint {
  const x = input?.focus?.x ?? input?.focusX;
  const y = input?.focus?.y ?? input?.focusY;
  return {
    x: typeof x === 'number' && Number.isFinite(x) ? clamp01(x) : 0.5,
    y: typeof y === 'number' && Number.isFinite(y) ? clamp01(y) : 0.5,
  };
}

function isValidCoord(n: unknown): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

function normalizeSlideProps(slide: Record<string, unknown>): Record<string, unknown> {
  const focus = normalizeFocusInput(slide as {focus?: FocusPoint; focusX?: number; focusY?: number});
  return {
    ...slide,
    focus,
    focusX: focus.x,
    focusY: focus.y,
    // Never show debug/reference preset names in production
    showPresetLabel: false,
  };
}

/** Normalize event props before render (focus shapes, strip debug labels). */
export function normalizeSelectedEventProps(
  presetId: SelectedPresetId,
  props: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = {...props, showPresetLabel: false};

  if (Array.isArray(next.slides)) {
    next.slides = (next.slides as Record<string, unknown>[]).map(normalizeSlideProps);
  }

  if (presetId === '08_reveal_question') {
    if (!next.question && next.primaryText) next.question = next.primaryText;
    if (!next.primaryText && next.question) next.primaryText = next.question;
    if (!next.subtext && next.secondaryText) next.subtext = next.secondaryText;
    if (!next.secondaryText && next.subtext) next.secondaryText = next.subtext;
  }

  return next;
}

export const validateSelectedEvent = (event: SelectedTimelineEvent) => {
  const errors: string[] = [];
  if (!event.id) errors.push('Missing event.id');
  if (!selectedPresetRegistry[event.presetId]) {
    errors.push(`Unsupported presetId: ${event.presetId}`);
    return errors;
  }
  if (!Number.isFinite(event.startFrame) || event.startFrame < 0) {
    errors.push('startFrame must be a non-negative number');
  }
  if (!Number.isFinite(event.durationFrames) || event.durationFrames <= 0) {
    errors.push('durationFrames must be greater than zero (negative/zero duration invalid)');
  }

  const p = event.props || {};

  switch (event.presetId) {
    case '01_classic_blue_white_lower_third':
    case '02_secondary_blue_lower_third':
      if (!String(p.primaryText || '').trim()) errors.push('Missing primaryText');
      break;
    case '03_simple_text_overlay':
      if (!String(p.text || '').trim()) errors.push('Missing text');
      break;
    case '04_glass_gallery_slideshow':
    case '05_archive_ribbon_slideshow':
    case '06_cinematic_stage_slideshow': {
      const slides = p.slides as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(slides) || slides.length === 0) errors.push('Missing slides images');
      else {
        slides.forEach((s, i) => {
          if (!String(s.src || '').trim()) errors.push(`slides[${i}] missing image src`);
          const fx = s.focusX ?? (s.focus as FocusPoint | undefined)?.x;
          const fy = s.focusY ?? (s.focus as FocusPoint | undefined)?.y;
          if (fx !== undefined && !isValidCoord(fx)) errors.push(`slides[${i}] invalid focusX`);
          if (fy !== undefined && !isValidCoord(fy)) errors.push(`slides[${i}] invalid focusY`);
        });
      }
      break;
    }
    case '07_split_comparison_slideshow':
      if (!String(p.leftImageSrc || '').trim()) errors.push('Missing leftImageSrc');
      if (!String(p.rightImageSrc || '').trim()) errors.push('Missing rightImageSrc');
      for (const key of ['leftTarget', 'rightTarget'] as const) {
        const t = p[key] as EvidenceTarget | undefined;
        if (t) {
          if (!isValidCoord(t.x) || !isValidCoord(t.y)) errors.push(`Invalid ${key} coordinates`);
          if (t.width !== undefined && !isValidCoord(t.width)) errors.push(`Invalid ${key}.width`);
          if (t.height !== undefined && !isValidCoord(t.height)) errors.push(`Invalid ${key}.height`);
        }
      }
      break;
    case '08_reveal_question':
      if (!String(p.question || p.primaryText || '').trim()) errors.push('Missing question/primaryText');
      break;
    case '09_glitch_cut_transition':
      if (!p.from && !p.fromImageSrc) errors.push('Missing from/fromImageSrc');
      if (!p.to && !p.toImageSrc) errors.push('Missing to/toImageSrc');
      break;
    case '10_red_grid_archive_background':
      if (!String(p.mainImage || '').trim()) errors.push('Missing mainImage');
      if (!String(p.title || '').trim()) errors.push('Missing title');
      break;
    default:
      break;
  }

  return errors;
};

export const SelectedTimelineRenderer: React.FC<{
  events: SelectedTimelineEvent[];
}> = ({events}) => {
  const sorted = [...events].sort(
    (a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.startFrame - b.startFrame,
  );

  return (
    <AbsoluteFill style={{backgroundColor: 'transparent'}}>
      {sorted.map((event) => {
        const Component = selectedPresetRegistry[event.presetId];
        if (!Component) return null;
        const props = normalizeSelectedEventProps(event.presetId, event.props || {});
        return (
          <Sequence
            key={event.id}
            from={event.startFrame}
            durationInFrames={event.durationFrames}
            layout="none"
          >
            <Component {...props} durationFrames={event.durationFrames} showPresetLabel={false} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
