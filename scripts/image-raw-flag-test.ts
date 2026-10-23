import assert from "node:assert/strict";
import { mediaKind, rawFootageFlagForVisual } from "../server/visualIntelligence/mediaKind.js";
import { imageScenesFlaggedAsRaw } from "../server/visualIntelligence/repairImageRawFlags.js";
import type { TimelineScene } from "../shared/visualIntelligence.js";

assert.equal(rawFootageFlagForVisual({ source: "google_image", mediaType: "image", url: "https://x/a.jpg" }), false);
assert.equal(rawFootageFlagForVisual({ source: "raw_footage", url: "https://x/a.mp4" }), true);
assert.equal(mediaKind({ source: "google_image", url: "https://cdn.example/photo?w=1" }), "image");
assert.equal(mediaKind({ source: "raw_footage", mediaType: "raw_footage", url: "https://x/still.jpg" }), "image");

const scenes = [
  { sceneId: "scene-1", rawFootageUsed: true, source: "google_image", selectedVisualId: "av-safe-1" },
  { sceneId: "scene-2", rawFootageUsed: true, source: "raw_footage", selectedVisualId: "clip-1" },
  { sceneId: "scene-3", rawFootageUsed: false, source: "google_image", selectedVisualId: "av-safe-2" },
] as TimelineScene[];
const library = new Map([
  ["av-safe-1", { approvedVisualId: "av-safe-1", source: "google_image", filePathOrUrl: "https://x/a.jpg", mediaType: "image" }],
  ["clip-1", { approvedVisualId: "clip-1", source: "raw_footage", filePathOrUrl: "https://x/a.mp4", mediaType: "raw_footage" }],
  ["av-safe-2", { approvedVisualId: "av-safe-2", source: "google_image", filePathOrUrl: "https://x/b.jpg", mediaType: "image" }],
] as never);
assert.deepEqual(imageScenesFlaggedAsRaw(scenes, library), ["scene-1"]);
console.log("image-raw-flag-test ok");
