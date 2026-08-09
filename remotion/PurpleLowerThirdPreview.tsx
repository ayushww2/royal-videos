import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {ClassicPurpleWhiteLowerThird} from './selected/SelectedVisualPack';

const HOLD_FRAMES = 108; // 3.6s @ 30fps — same cadence as Mystery v3 LT clip

/**
 * Purple classic lower third preview — 3 words, white type, same slide animation.
 */
export const PurpleLowerThirdPreview: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    <Img
      src={staticFile('demo/statue.png')}
      style={{width: '100%', height: '100%', objectFit: 'cover'}}
    />
    <ClassicPurpleWhiteLowerThird
      primaryText="HIDDEN ROYAL SECRET"
      durationFrames={HOLD_FRAMES}
      position="bottom_left"
    />
  </AbsoluteFill>
);

export const PURPLE_LOWER_THIRD_PREVIEW_FRAMES = HOLD_FRAMES;
