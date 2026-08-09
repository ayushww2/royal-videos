# AW Selected Documentary Visual Pack

This package contains the exact selected effects from the reference screenshots, in a fixed numbered order.

## Main imports

```tsx
import {
  SelectedTimelineRenderer,
  selectedPresetRegistry,
  SELECTED_PRESET_ORDER,
} from './src/selected';
```

## Reusable at scale

The code for each effect exists once. Your software can create as many timeline events as needed.

```ts
{
  id: 'lower-third-034',
  presetId: '01_classic_blue_white_lower_third',
  startFrame: 18420,
  durationFrames: 90,
  layer: 20,
  props: {
    primaryText: 'WOODS HOLE INSTITUTION',
    secondaryText: 'MASSACHUSETTS'
  }
}
```

Then render the whole generated timeline:

```tsx
<SelectedTimelineRenderer events={generatedTimeline} />
```

## Important input difference

The clean slideshow presets use slide focus like this:

```ts
focus: {x: 0.52, y: 0.45}
```

The original suite slideshow presets use:

```ts
focusX: 0.52,
focusY: 0.45
```

Your timeline planner should normalize inputs before creating events.

## Recommended scale for a 20–30 minute video

- Classic lower third: 20–40 uses
- Secondary lower third: 5–12 uses
- Simple text: 5–15 uses
- Glass gallery: 4–10 sequences
- Archive ribbon: 2–6 sequences
- Cinematic stage: 3–8 sequences
- Split comparison: 3–15 sequences
- Reveal question: 2–5 uses
- Glitch transition: 2–6 uses
- Red grid archive: 1–4 uses

These are starting ranges, not hard limits.

## On-demand RunPod renders

For production Remotion renders without leaving a pod Running 24/7, see **[RUNPOD.md](../RUNPOD.md)**.

- Network volume persists Remotion deps under `/workspace`
- Railway starts the pod when a job is queued, worker stops it when idle
- Billing = compute only while Running (+ small volume storage fee)

