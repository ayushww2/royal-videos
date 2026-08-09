import {staticFile} from 'remotion';
import type {SelectedTimelineEvent} from '../selected';

export const selectedTimeline: SelectedTimelineEvent[] = [
  {
    id: 'lower-third-001',
    presetId: '01_classic_blue_white_lower_third',
    startFrame: 300,
    durationFrames: 90,
    layer: 20,
    props: {
      primaryText: 'DR. ROBERT HAYES',
      secondaryText: 'MARINE ARCHAEOLOGIST',
    },
  },
  {
    id: 'simple-text-001',
    presetId: '03_simple_text_overlay',
    startFrame: 900,
    durationFrames: 90,
    layer: 20,
    props: {
      text: 'FIELD INVESTIGATION',
      secondaryText: 'The restricted search area',
      position: 'center',
      accentColor: '#74B7FF',
    },
  },
  {
    id: 'glass-gallery-001',
    presetId: '04_glass_gallery_slideshow',
    startFrame: 1200,
    durationFrames: 300,
    layer: 5,
    props: {
      slides: [
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
      ],
      durationPerSlide: 105,
      transitionFrames: 20,
      intensity: 0.72,
      showPresetLabel: false,
    },
  },
  {
    id: 'question-001',
    presetId: '08_reveal_question',
    startFrame: 1800,
    durationFrames: 105,
    layer: 15,
    props: {
      question: 'WHO CLOSED THE AREA?',
      primaryText: 'WHO CLOSED THE AREA?',
      secondaryText: 'And what were they trying to hide?',
      backgroundImage: staticFile('demo/roadblock.png'),
    },
  },
];
