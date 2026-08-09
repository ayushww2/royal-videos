/**
 * Offline smoke: placement timing + punch-out for editing effects.
 * Run: node scripts/effect-placement-smoke.mjs
 */
import assert from "node:assert/strict";

const FPS = 30;

function punchOutBaseClipsForEffects(baseClips, ranges) {
  if (!ranges.length) return baseClips;
  const out = [];
  for (const clip of baseClips) {
    let segments = [{ start: clip.start, length: clip.length }];
    for (const range of ranges) {
      const next = [];
      for (const seg of segments) {
        const segEnd = seg.start + seg.length;
        const overlapStart = Math.max(seg.start, range.start);
        const overlapEnd = Math.min(segEnd, range.end);
        if (overlapEnd <= overlapStart + 0.05) {
          next.push(seg);
          continue;
        }
        if (overlapStart > seg.start + 0.05) {
          next.push({ start: seg.start, length: overlapStart - seg.start });
        }
        if (segEnd > overlapEnd + 0.05) {
          next.push({ start: overlapEnd, length: segEnd - overlapEnd });
        }
      }
      segments = next;
    }
    for (const seg of segments) {
      if (seg.length < 0.2) continue;
      out.push({ ...clip, start: seg.start, length: seg.length });
    }
  }
  return out;
}

// Simulated beat clock (not cumulative-only)
const scenes = [
  { sceneId: "s1", startTime: 0, duration: 8, endTime: 8 },
  { sceneId: "s2", startTime: 8, duration: 10, endTime: 18 },
  { sceneId: "s3", startTime: 18, duration: 12, endTime: 30 },
  { sceneId: "s4", startTime: 30, duration: 15, endTime: 45 },
];

const baseClips = scenes.map((s) => ({
  asset: { type: "image", src: `https://example.com/${s.sceneId}.jpg` },
  start: s.startTime,
  length: s.duration,
}));

// Effects placed from scene.startTime (planner behavior)
const effects = [
  {
    id: "e-lt",
    presetId: "01_classic_blue_white_lower_third",
    startFrame: Math.round((0 + 0.35) * FPS),
    durationFrames: Math.round(3.2 * FPS),
    replace: false,
  },
  {
    id: "e-cine",
    presetId: "06_cinematic_stage_slideshow",
    startFrame: Math.round(8 * FPS),
    durationFrames: Math.round(7 * FPS),
    replace: true,
  },
  {
    id: "e-glitch",
    presetId: "09_glitch_cut_transition",
    startFrame: Math.round((30 - 0.8) * FPS),
    durationFrames: Math.round(1.2 * FPS),
    replace: true,
  },
];

const replaceRanges = effects
  .filter((e) => e.replace)
  .map((e) => {
    const start = e.startFrame / FPS;
    return { start, end: start + e.durationFrames / FPS };
  });

const punched = punchOutBaseClipsForEffects(baseClips, replaceRanges);

// Lower third must NOT punch base (text overlays on top of visual)
assert.ok(
  punched.some((c) => c.start === 0 && Math.abs(c.length - 8) < 0.01),
  "scene1 base should remain for lower-third overlay"
);

// Cinematic on s2 (8..15) should punch s2 base
const s2Pieces = punched.filter((c) => c.asset.src.includes("s2"));
const s2Covered = s2Pieces.reduce((a, c) => a + c.length, 0);
assert.ok(s2Covered < 10 - 6.5, `s2 base should be mostly punched, got covered=${s2Covered}`);
assert.ok(
  !punched.some((c) => c.start < 15 && c.start + c.length > 9 && c.asset.src.includes("s2") && c.start < 8.1 && c.length > 6),
  "no full s2 base under cinematic"
);

// Glitch near end of s4
const glitchStart = (30 - 0.8);
const underGlitch = punched.some(
  (c) => c.asset.src.includes("s4") && c.start < glitchStart + 0.5 && c.start + c.length > glitchStart + 0.5
);
assert.equal(underGlitch, false, "base should not sit under glitch transition");

// Cadence sanity: effects spaced
const starts = effects.map((e) => e.startFrame / FPS).sort((a, b) => a - b);
for (let i = 1; i < starts.length; i++) {
  // not asserting min gap for text+visual combo; just log
}

console.log(
  JSON.stringify(
    {
      ok: true,
      baseBefore: baseClips.length,
      baseAfterPunch: punched.length,
      replaceRanges,
      punched: punched.map((c) => ({ src: c.asset.src.split("/").pop(), start: c.start, length: c.length })),
      notes: [
        "Lower thirds / text overlays stay on top of base (no punch)",
        "Cinematic / gallery / split / glitch / red-grid punch base for their window",
        "Base clip starts follow scene.startTime (aligned with effect planner)",
      ],
    },
    null,
    2
  )
);
