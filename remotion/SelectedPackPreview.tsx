import React from 'react';
import {AbsoluteFill, Img, Sequence, staticFile} from 'remotion';
import {
  ArchiveRibbonSlideshow,
  CinematicStageSlideshow,
  ClassicBlueWhiteLowerThird,
  GlassGallerySlideshow,
  GlitchCutTransition,
  RedGridArchiveBackground,
  RevealQuestion,
  SecondaryBlueLowerThird,
  SimpleTextOverlay,
  SplitComparisonSlideshow,
} from './selected';

const Background: React.FC<{src: string}> = ({src}) => (
  <AbsoluteFill>
    <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
  </AbsoluteFill>
);

const slides = [
  {
    src: staticFile('demo/roadblock.png'),
    kicker: 'FIELD RECORD',
    caption: 'The road was closed before sunrise.',
    focus: {x: 0.5, y: 0.52},
  },
  {
    src: staticFile('demo/statue.png'),
    kicker: 'DIVE FRAME 04',
    caption: 'A structure emerged beneath the silt.',
    focus: {x: 0.52, y: 0.45},
  },
  {
    src: staticFile('demo/research.png'),
    kicker: 'EXPEDITION LOG',
    caption: 'The team returned with new equipment.',
    focus: {x: 0.5, y: 0.5},
  },
];

export const SelectedPackPreview: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: 'black'}}>
    <Sequence from={0} durationInFrames={105}>
      <Background src={staticFile('demo/roadblock.png')} />
      <ClassicBlueWhiteLowerThird
        primaryText="DR. ROBERT HAYES"
        secondaryText="MARINE ARCHAEOLOGIST"
        durationFrames={105}
      />
    </Sequence>

    <Sequence from={105} durationInFrames={105}>
      <Background src={staticFile('demo/roadblock.png')} />
      <SecondaryBlueLowerThird
        primaryText="THE HIDDEN CHAMBER"
        secondaryText="FIELD INVESTIGATION"
        durationFrames={105}
      />
    </Sequence>

    <Sequence from={210} durationInFrames={105}>
      <Background src={staticFile('demo/roadblock.png')} />
      <SimpleTextOverlay
        text="FIELD INVESTIGATION"
        secondaryText="The restricted search area"
        durationFrames={105}
      />
    </Sequence>

    <Sequence from={315} durationInFrames={240}>
      <GlassGallerySlideshow slides={slides} defaultSlideFrames={95} transitionFrames={18} />
    </Sequence>

    <Sequence from={555} durationInFrames={240}>
      <ArchiveRibbonSlideshow slides={slides} defaultSlideFrames={95} transitionFrames={18} />
    </Sequence>

    <Sequence from={795} durationInFrames={240}>
      <CinematicStageSlideshow slides={slides} defaultSlideFrames={95} transitionFrames={18} />
    </Sequence>

    <Sequence from={1035} durationInFrames={150}>
      <SplitComparisonSlideshow
        leftImageSrc={staticFile('demo/statue.png')}
        rightImageSrc={staticFile('demo/research.png')}
        leftLabel="SUBMERGED DISCOVERY"
        rightLabel="EXPEDITION RECORD"
        leftTarget={{x: 0.53, y: 0.42, width: 0.24, height: 0.28}}
        rightTarget={{x: 0.52, y: 0.38, width: 0.24, height: 0.24}}
      />
    </Sequence>

    <Sequence from={1185} durationInFrames={105}>
      <RevealQuestion
        question="WHO CLOSED THE AREA?"
        subtext="And what were they trying to hide?"
        backgroundImage={staticFile('demo/roadblock.png')}
        durationFrames={105}
      />
    </Sequence>

    <Sequence from={1290} durationInFrames={36}>
      <GlitchCutTransition
        fromImageSrc={staticFile('demo/roadblock.png')}
        toImageSrc={staticFile('demo/statue.png')}
        durationFrames={36}
      />
    </Sequence>

    <Sequence from={1326} durationInFrames={150}>
      <RedGridArchiveBackground
        mainImage={staticFile('demo/statue.png')}
        sideImages={[staticFile('demo/roadblock.png'), staticFile('demo/research.png')]}
        title="FIELD INVESTIGATION"
        subtitle="Archive comparison sequence"
        durationFrames={150}
      />
    </Sequence>
  </AbsoluteFill>
);
