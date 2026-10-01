import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { jobDataFile, loadJob, readJson, writeJson } from "../storage.js";
import { config } from "../config.js";
import type { ApprovedVisual, JobRecord, TimelineScene } from "../../shared/visualIntelligence.js";
import type { LibraryAsset } from "../library/types.js";
import {
  loadRoyalLibraryAssets,
  royalAssetPreviewUrl,
  royalAssetUrl,
  searchRoyalLibrary,
} from "./royalV2/library.js";
import type { EffectTimelineEvent, SelectedPresetId } from "./effectPlanner.js";
import { runFinalQA } from "./finalQA.js";
import type { RoyalSfxEvent } from "./royalV2/sfxPlanner.js";
import type { RoyalMusicEvent } from "./royalV2/musicPlanner.js";

const EFFECT_FPS = 30;

export type TimelineMusicEvent = {
  id: string;
  musicId: string;
  startTime: number;
  durationSec: number;
  volume?: number;
  reason?: string;
  role?: string;
};

export type TimelineSfxEvent = {
  id: string;
  sfxId: string;
  startTime: number;
  durationSec: number;
  sceneId?: string;
  reason?: string;
};

export type TimelineEffectEvent = {
  id: string;
  presetId: string;
  startTime: number;
  durationSec: number;
  sceneId?: string;
  reason?: string;
};

function toEditorMediaUrl(filePathOrUrl?: string): string | undefined {
  if (!filePathOrUrl) return undefined;
  if (/^https?:\/\//i.test(filePathOrUrl)) return filePathOrUrl;
  if (filePathOrUrl.startsWith("/media/")) return filePathOrUrl;
  const normalized = path.resolve(filePathOrUrl);
  const storageRoot = path.resolve(config.storagePath);
  if (normalized === storageRoot || normalized.startsWith(`${storageRoot}${path.sep}`)) {
    const rel = normalized.slice(storageRoot.length).replace(/\\/g, "/").replace(/^\//, "");
    return rel ? `/media/${rel}` : undefined;
  }
  // Common deploy layout: /data/storage/... already under storage root alias
  const m = filePathOrUrl.replace(/\\/g, "/").match(/(?:^|\/)(?:storage\/)?(jobs\/.+)$/i);
  if (m?.[1]) return `/media/${m[1]}`;
  return undefined;
}

function effectEventsFromScenes(scenes: TimelineScene[]): TimelineEffectEvent[] {
  const out: TimelineEffectEvent[] = [];
  for (const scene of scenes) {
    for (const fx of scene.effects || []) {
      const startFrame = Number(fx.startFrame);
      const durationFrames = Number(fx.durationFrames);
      const startTime = Number.isFinite(startFrame) ? startFrame / EFFECT_FPS : scene.startTime;
      const durationSec = Number.isFinite(durationFrames)
        ? Math.max(0.2, durationFrames / EFFECT_FPS)
        : Math.max(0.2, scene.duration || 1);
      out.push({
        id: String(fx.id || `${scene.sceneId}-fx`),
        presetId: String(fx.presetId || "effect"),
        startTime,
        durationSec,
        sceneId: scene.sceneId,
        reason: fx.reason != null ? String(fx.reason) : undefined,
      });
    }
  }
  return out;
}

function normalizeEffectTimeline(
  events: EffectTimelineEvent[] | undefined,
  scenes: TimelineScene[]
): TimelineEffectEvent[] {
  if (events?.length) {
    return events.map((ev) => ({
      id: ev.id,
      presetId: ev.presetId,
      startTime: (ev.startFrame || 0) / EFFECT_FPS,
      durationSec: Math.max(0.2, (ev.durationFrames || EFFECT_FPS) / EFFECT_FPS),
      sceneId: ev.sceneId,
      reason: ev.reason,
    }));
  }
  return effectEventsFromScenes(scenes);
}

export const EFFECT_PRESET_OPTIONS: Array<{ id: SelectedPresetId; label: string }> = [
  { id: "01_classic_blue_white_lower_third", label: "Classic lower third" },
  { id: "02_secondary_blue_lower_third", label: "Secondary lower third" },
  { id: "03_simple_text_overlay", label: "Simple text overlay" },
  { id: "04_glass_gallery_slideshow", label: "Glass gallery" },
  { id: "05_archive_ribbon_slideshow", label: "Archive ribbon" },
  { id: "06_cinematic_stage_slideshow", label: "Cinematic stage" },
  { id: "07_split_comparison_slideshow", label: "Split comparison" },
  { id: "08_reveal_question", label: "Reveal question" },
  { id: "09_glitch_cut_transition", label: "Glitch cut" },
  { id: "10_red_grid_archive_background", label: "Red grid archive" },
  { id: "15_quote_only", label: "Quote only" },
  { id: "21_royal_archive_slideshow", label: "Royal archive" },
  { id: "24_soft_glass_focus_slideshow", label: "Soft glass focus" },
  { id: "25_clean_zoom_frame_slideshow", label: "Clean zoom frame" },
  { id: "26_minimal_blur_backdrop_slideshow", label: "Minimal blur backdrop" },
  { id: "27_editorial_soft_pan_slideshow", label: "Editorial soft pan" },
  { id: "28_crystal_stage_slideshow", label: "Crystal stage" },
  { id: "29_classic_purple_white_lower_third", label: "Purple lower third" },
];

export type TimelineEditorScene = TimelineScene & {
  previewUrl?: string;
  fromApprovedLibrary?: boolean;
  sfx?: Array<{ id: string; sfxId: string; reason?: string; startTime?: number }>;
};

export async function loadTimelineScenes(jobId: string): Promise<TimelineScene[]> {
  const primary = await readJson<{ scenes: TimelineScene[] }>(
    jobDataFile("visual-intelligence-final-assignment", jobId)
  );
  if (primary?.scenes?.length) return primary.scenes;
  const royal = await readJson<{ scenes: TimelineScene[] }>(
    jobDataFile("royal-v2-final-assignment", jobId)
  );
  return royal?.scenes || [];
}

async function loadSfxByScene(
  jobId: string
): Promise<Map<string, Array<{ id: string; sfxId: string; reason?: string; startTime?: number }>>> {
  const plan = await readJson<{ events?: RoyalSfxEvent[] }>(jobDataFile("royal-v2-sfx-plan", jobId));
  const byScene = new Map<
    string,
    Array<{ id: string; sfxId: string; reason?: string; startTime?: number }>
  >();
  for (const event of plan?.events || []) {
    if (!event.sceneId) continue;
    const list = byScene.get(event.sceneId) || [];
    list.push({
      id: event.id,
      sfxId: event.sfxId,
      reason: event.reason,
      startTime: event.startTime,
    });
    byScene.set(event.sceneId, list);
  }
  return byScene;
}

function previewFromApproved(visual?: ApprovedVisual): string | undefined {
  if (!visual) return undefined;
  const url = visual.thumbnail || visual.filePathOrUrl;
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url) || url.startsWith("/")) return url;
  return undefined;
}

export type TimelineApprovedAsset = {
  approvedVisualId: string;
  previewUrl?: string;
  source?: string;
  bestUseCase?: string;
  matchedPeople?: string[];
  matchedPlaces?: string[];
  usedByScenes?: string[];
  reuseCount?: number;
};

export async function loadTimelineForEditor(jobId: string): Promise<{
  job: JobRecord;
  scenes: TimelineEditorScene[];
  effectPresets: typeof EFFECT_PRESET_OPTIONS;
  locked: boolean;
  musicEvents: TimelineMusicEvent[];
  sfxEvents: TimelineSfxEvent[];
  effectEvents: TimelineEffectEvent[];
  voiceoverUrl?: string;
  durationSec: number;
  /** Job approved visual library — all assets collected for this cut */
  approvedAssets: TimelineApprovedAsset[];
}> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");
  const scenes = await loadTimelineScenes(jobId);
  const libraryReport = await readJson<{ approved: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", jobId)
  );
  const libraryById = new Map((libraryReport?.approved || []).map((v) => [v.approvedVisualId, v]));
  const sfxByScene = await loadSfxByScene(jobId);
  const sfxPlan = await readJson<{ events?: RoyalSfxEvent[] }>(jobDataFile("royal-v2-sfx-plan", jobId));
  const musicPlan = await readJson<{ events?: RoyalMusicEvent[] }>(
    jobDataFile("royal-v2-music-plan", jobId)
  );
  const effectTimeline = await readJson<{ events?: EffectTimelineEvent[] }>(
    jobDataFile("effect-timeline", jobId)
  );
  const assignmentAudio = await readJson<{
    sfxEvents?: RoyalSfxEvent[];
    musicEvents?: RoyalMusicEvent[];
  }>(jobDataFile("royal-v2-final-assignment", jobId));

  let royalById = new Map<string, LibraryAsset>();
  if (job.niche === "Royal v2") {
    try {
      const assets = await loadRoyalLibraryAssets();
      royalById = new Map(assets.map((a) => [a.assetId, a]));
    } catch {
      // Preview fallback optional when library unavailable
    }
  }

  const enriched: TimelineEditorScene[] = scenes.map((scene) => {
    const visual = libraryById.get(scene.approvedVisualId || scene.selectedVisualId);
    const royal = royalById.get(scene.approvedVisualId || scene.selectedVisualId);
    return {
      ...scene,
      previewUrl: previewFromApproved(visual) || (royal ? royalAssetPreviewUrl(royal) : undefined),
      fromApprovedLibrary: Boolean(scene.approvedVisualId && !scene.fallbackUsed),
      sfx: sfxByScene.get(scene.sceneId) || [],
    };
  });

  const sfxEvents: TimelineSfxEvent[] = (sfxPlan?.events || assignmentAudio?.sfxEvents || []).map(
    (ev) => ({
      id: ev.id,
      sfxId: ev.sfxId,
      startTime: Number(ev.startTime) || 0,
      durationSec: Math.max(0.15, Number(ev.durationSec) || 0.4),
      sceneId: ev.sceneId,
      reason: ev.reason,
    })
  );

  const musicEvents: TimelineMusicEvent[] = (
    musicPlan?.events || assignmentAudio?.musicEvents || []
  ).map((ev) => ({
    id: ev.id,
    musicId: ev.musicId,
    startTime: Number(ev.startTime) || 0,
    durationSec: Math.max(0.5, Number(ev.durationSec) || 1),
    volume: ev.volume,
    reason: ev.reason,
    role: ev.role,
  }));

  const effectEvents = normalizeEffectTimeline(effectTimeline?.events, scenes);
  const sceneEnd = enriched.reduce((m, s) => Math.max(m, s.endTime || 0), 0);
  const audioEnd = Math.max(
    ...musicEvents.map((e) => e.startTime + e.durationSec),
    ...sfxEvents.map((e) => e.startTime + e.durationSec),
    0
  );
  const durationSec = Math.max(
    sceneEnd,
    audioEnd,
    Number(job.voiceoverDurationSec) || 0,
    1
  );

  const usedCount = new Map<string, number>();
  const usedBy = new Map<string, string[]>();
  for (const scene of enriched) {
    const id = scene.approvedVisualId || scene.selectedVisualId;
    if (!id) continue;
    usedCount.set(id, (usedCount.get(id) || 0) + 1);
    const list = usedBy.get(id) || [];
    list.push(scene.sceneId);
    usedBy.set(id, list);
  }

  const approvedAssets: TimelineApprovedAsset[] = (libraryReport?.approved || []).map((v) => ({
    approvedVisualId: v.approvedVisualId,
    previewUrl: previewFromApproved(v),
    source: v.source,
    bestUseCase: v.bestUseCase,
    matchedPeople: v.matchedPeople,
    matchedPlaces: v.matchedPlaces,
    usedByScenes: usedBy.get(v.approvedVisualId) || v.usedByScenes,
    reuseCount: usedCount.get(v.approvedVisualId) || v.reuseCount || 0,
  }));

  return {
    job,
    scenes: enriched,
    effectPresets: EFFECT_PRESET_OPTIONS,
    locked: Boolean(job.timelineLock?.locked),
    musicEvents,
    sfxEvents,
    effectEvents,
    voiceoverUrl: toEditorMediaUrl(job.voiceoverPath),
    durationSec,
    approvedAssets,
  };
}

async function persistScenes(jobId: string, scenes: TimelineScene[]): Promise<void> {
  await writeJson(jobDataFile("visual-intelligence-final-assignment", jobId), { jobId, scenes });
  await writeJson(jobDataFile("royal-v2-final-assignment", jobId), { jobId, scenes });
  await runFinalQA(jobId, scenes);
}

export type ScenePatch = {
  sceneId: string;
  markForAiRevise?: boolean;
  editorNotes?: string;
  effectPresetId?: SelectedPresetId | "" | null;
  clearEffects?: boolean;
};

export async function patchTimelineScenes(
  jobId: string,
  patches: ScenePatch[]
): Promise<{ scenes: TimelineScene[]; updated: number }> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");
  if (job.timelineLock?.locked) {
    throw new Error("Timeline is locked. Unlock before editing scenes.");
  }
  const scenes = await loadTimelineScenes(jobId);
  if (!scenes.length) throw new Error("No timeline scenes yet");
  const byId = new Map(scenes.map((s) => [s.sceneId, s]));
  let updated = 0;
  for (const patch of patches) {
    const scene = byId.get(patch.sceneId);
    if (!scene) continue;
    if (patch.markForAiRevise !== undefined) scene.markForAiRevise = patch.markForAiRevise;
    if (patch.editorNotes !== undefined) scene.editorNotes = patch.editorNotes;
    if (patch.clearEffects) {
      scene.effects = [];
    } else if (patch.effectPresetId) {
      const presetId = patch.effectPresetId;
      const startFrame = Math.max(0, Math.round(scene.startTime * 30));
      const durationFrames = Math.max(15, Math.round(scene.duration * 30));
      scene.effects = [
        {
          id: `manual-${scene.sceneId}-${presetId}`,
          presetId,
          reason: scene.editorNotes || "Manual timeline editor preset",
          durationFrames,
          startFrame,
          props: { _source: "timeline_editor" },
          tags: ["manual", "timeline_editor"],
          renderProvider: "remotion",
          renderable: true,
        },
      ];
    }
    updated += 1;
  }
  const next = scenes.map((s) => byId.get(s.sceneId) || s);
  await persistScenes(jobId, next);
  return { scenes: next, updated };
}

export async function swapSceneVisual(params: {
  jobId: string;
  sceneId: string;
  assetId: string;
}): Promise<{ scene: TimelineScene; approved: ApprovedVisual }> {
  const job = await loadJob(params.jobId);
  if (!job) throw new Error("Job not found");
  if (job.timelineLock?.locked) {
    throw new Error("Timeline is locked. Unlock before swapping visuals.");
  }
  const scenes = await loadTimelineScenes(params.jobId);
  const scene = scenes.find((s) => s.sceneId === params.sceneId);
  if (!scene) throw new Error(`Scene not found: ${params.sceneId}`);

  const assets = await loadRoyalLibraryAssets();
  const asset = assets.find((a) => a.assetId === params.assetId);
  if (!asset) throw new Error(`Library asset not found: ${params.assetId}`);

  const libraryReport = await readJson<{ approved: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", params.jobId)
  );
  const approved = libraryReport?.approved || [];
  const clip = asset.mediaType === "raw_footage" || asset.mediaType === "trusted_clip";
  const fileUrl = royalAssetUrl(asset);
  const thumbUrl = royalAssetUrl({ ...asset, r2Key: asset.thumbKey || asset.r2Key });
  const replacementScene: TimelineScene = {
    ...scene,
    selectedVisualId: asset.assetId,
    approvedVisualId: asset.assetId,
    alternativeAssetIds: [],
    source: clip ? "raw_footage" : "cached_approved",
    rawFootageUsed: clip,
    needsBetterVisual: false,
    mainPerson: asset.person,
    viewerShouldSee: asset.description || asset.person,
    reasonSelected: `Editor replaced this scene with ${asset.person}. ${asset.description || asset.title || ""}`.trim(),
    editorNotes: asset.description || scene.editorNotes,
  };
  const replacementApproved: ApprovedVisual = {
    approvedVisualId: asset.assetId,
    source: clip ? "raw_footage" : "cached_approved",
    filePathOrUrl: fileUrl,
    thumbnail: thumbUrl,
    matchedPeople: [asset.person].filter(Boolean),
    matchedCompanies: [],
    matchedPlaces: [],
    matchedEvents: [],
    matchedDocuments: [],
    matchedObjects: [],
    allowedBeatIds: [scene.beatId],
    bestUseCase: asset.description || asset.title || asset.person,
    confidenceScores: {
      entityMatch: 80,
      sceneMatch: 80,
      topicRelevance: 80,
      eventPlaceYearRelevance: 70,
      visualQuality: 80,
      cropSafety16x9: 80,
      sourceReliability: 80,
      wrongEntityRisk: 10,
      watermarkTextRisk: 10,
      reusePotential: 40,
    },
    reuseLimit: 2,
    durationRecommendation: asset.duration,
    warnings: [],
    candidateId: asset.assetId,
    libraryAssetId: asset.assetId,
    mediaType: clip ? "raw_footage" : "image",
  };

  const nextScenes = scenes.map((s) => (s.sceneId === params.sceneId ? replacementScene : s));
  const nextApproved = [
    ...approved.filter((v) => v.approvedVisualId !== replacementApproved.approvedVisualId),
    replacementApproved,
  ];
  await writeJson(jobDataFile("visual-intelligence-approved-library", params.jobId), {
    jobId: params.jobId,
    approved: nextApproved,
    source: "timeline editor / knowledge editor swap",
    updatedAt: new Date().toISOString(),
  });
  await persistScenes(params.jobId, nextScenes);
  return { scene: replacementScene, approved: replacementApproved };
}

export async function applyWebStill(params: {
  jobId: string;
  sceneId: string;
  imageUrl: string;
  title?: string;
}): Promise<{ scene: TimelineScene; approved: ApprovedVisual }> {
  const job = await loadJob(params.jobId);
  if (!job) throw new Error("Job not found");
  if (job.timelineLock?.locked) throw new Error("Timeline is locked. Unlock before swapping visuals.");
  const imageUrl = String(params.imageUrl || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error("Image URL is not valid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Image URL is not valid");

  const scenes = await loadTimelineScenes(params.jobId);
  const scene = scenes.find((s) => s.sceneId === params.sceneId);
  if (!scene) throw new Error(`Scene not found: ${params.sceneId}`);

  const response = await fetch(imageUrl, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*,*/*" },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Could not download that image (${response.status})`);
  const type = response.headers.get("content-type") || "";
  if (!type.startsWith("image/")) throw new Error("That result is not an image file");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000 || bytes.length > 15_000_000) throw new Error("That image is empty or too large");
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const assetId = `web-${randomUUID()}`;
  const relative = path.join("jobs", params.jobId, "web-stills", `${assetId}.${ext}`);
  const absolute = path.join(config.storagePath, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, bytes);

  const title = String(params.title || "Google image").slice(0, 180);
  const replacementScene: TimelineScene = {
    ...scene,
    selectedVisualId: assetId,
    approvedVisualId: assetId,
    alternativeAssetIds: [],
    source: "google_image",
    rawFootageUsed: false,
    needsBetterVisual: false,
    viewerShouldSee: title,
    reasonSelected: `Editor chose a Google image. ${title}`,
    editorNotes: title,
  };
  const replacementApproved: ApprovedVisual = {
    approvedVisualId: assetId,
    source: "google_image",
    filePathOrUrl: absolute,
    thumbnail: absolute,
    matchedPeople: [],
    matchedCompanies: [],
    matchedPlaces: [],
    matchedEvents: [],
    matchedDocuments: [],
    matchedObjects: [],
    allowedBeatIds: [scene.beatId],
    bestUseCase: title,
    confidenceScores: {
      entityMatch: 70,
      sceneMatch: 70,
      topicRelevance: 70,
      eventPlaceYearRelevance: 60,
      visualQuality: 70,
      cropSafety16x9: 70,
      sourceReliability: 60,
      wrongEntityRisk: 20,
      watermarkTextRisk: 20,
      reusePotential: 10,
    },
    reuseLimit: 1,
    warnings: ["Downloaded from Google Images"],
    candidateId: assetId,
    mediaType: "image",
  };
  const libraryReport = await readJson<{ approved: ApprovedVisual[] }>(
    jobDataFile("visual-intelligence-approved-library", params.jobId)
  );
  const approved = libraryReport?.approved || [];
  await writeJson(jobDataFile("visual-intelligence-approved-library", params.jobId), {
    jobId: params.jobId,
    approved: [...approved.filter((v) => v.approvedVisualId !== assetId), replacementApproved],
    source: "timeline editor google still",
    updatedAt: new Date().toISOString(),
  });
  await persistScenes(params.jobId, scenes.map((s) => (s.sceneId === params.sceneId ? replacementScene : s)));
  return { scene: replacementScene, approved: replacementApproved };
}

export async function searchLibraryForEditor(query: string, limit = 20): Promise<LibraryAsset[]> {
  return searchRoyalLibrary(query, { limit });
}
