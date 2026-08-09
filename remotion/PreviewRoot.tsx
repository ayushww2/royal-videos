import React from 'react';
import {Composition} from 'remotion';
import {SelectedPackPreview} from './SelectedPackPreview';

export const PreviewRoot: React.FC = () => (
  <Composition
    id="AWSelectedVisualPackPreview"
    component={SelectedPackPreview}
    durationInFrames={1476}
    fps={30}
    width={1920}
    height={1080}
  />
);
