/**
 * Replace short 4s/5s/6s clips with a longer library clip.
 * Does not change scene text, timing, approvals, lock, or job status.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../../config.js";
import { jobDataFile, loadJob, readJson, writeJson } from "../../storage.js";
import type { ApprovedVisual, TimelineScene } from "../../../shared/visualIntelligence.js";
import type { LibraryAsset } from "../../library/types.js";
import { loadRoyalLibraryAssets, royalAssetUrl } from "./library.js";
import { royalPersonMentions } from "./taxonomy.js";

const execFileAsync = promisify(execFile);

export const SHORT_CLIP_REPAIR_JOBS = new Set([
  "0a238766-bbde-4d65-b5bd-c9ddcc4d0f7f",
  "5e23c709-30c2-49e4-ab03-776818865bbb",
  "c78580e5-a55a-4abc-ae9e-1268b37f66f1",
  "735e3031-79c0-4d1d-aff8-818736c8d7aa",
  "9de66466-9a21-46e4-a22a-b5a82890371a",
  "8817cc65-3afc-4138-88e9-c4988f546a92",
  "0ca290fe-052f-471e-9cbc-a7217cc2f3ed",
  "3f6252a9-0b90-4e36-a0f5-a4fb70d1a0cb",
]);

const STOP = new Set(
  "the a an and or but with from that this those these into over after before about their they them his her she he him was were are is be been being has have had will would can could not just then than its it's for you your our".split(" ")
);
const MALE = new Set(["King Charles", "Prince William", "Prince Harry", "Prince Andrew", "Prince George", "Prince Louis", "Timothy Laurence"]);
const FEMALE = new Set(["Queen Camilla", "Catherine, Princess of Wales", "Princess Diana", "Princess Anne", "Meghan, Duchess of Sussex", "Princess Charlotte", "Princess Beatrice", "Princess Eugenie", "Sarah Ferguson", "Sophie, Duchess of Edinburgh"]);

const MAX_USES = 3;
const MIN_GAP = 51;
const DURATION_SLACK = 0.05;

export type RepairClip = {
  assetId: string;
  fileKey: string;
  duration: number;
  person: string;
  title: string;
  description: string;
  category: string;
  categories: string[];
  filePathOrUrl: string;
  thumbnail?: string;
};

export type RepairScene = {
  sceneId: string;
  duration: number;
  narrationText: string;
  isClip: boolean;
  fileKey?: string;
};

export function lengthBucket(seconds: number): "3s" | "4s" | "5s" | "6s" | "7s+" {
  const n = Math.round(seconds);
  if (n <= 3) return "3s";
  if (n === 4) return "4s";
  if (n === 5) return "5s";
  if (n === 6) return "6s";
  return "7s+";
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function peopleForScene(text: string, recent: string[]): string[] {
  const named = royalPersonMentions(text).map((mention) => mention.person);
  if (named.length) return [...new Set(named)];
  const lower = text.toLowerCase();
  const lastFemale = [...recent].reverse().find((person) => FEMALE.has(person));
  const lastMale = [...recent].reverse().find((person) => MALE.has(person));
  if (/\bhis wife\b/.test(lower) && lastMale) {
    if (/charles/.test(lastMale.toLowerCase())) return ["Queen Camilla"];
    if (/william/.test(lastMale.toLowerCase())) return ["Catherine, Princess of Wales"];
  }
  if (/\bher husband\b/.test(lower) && lastFemale) {
    if (/camilla/.test(lastFemale.toLowerCase())) return ["King Charles"];
    if (/catherine|kate/.test(lastFemale.toLowerCase())) return ["Prince William"];
  }
  if (/\b(she|her|hers)\b/.test(lower) && lastFemale) return [lastFemale];
  if (/\b(he|his|him)\b/.test(lower) && lastMale) return [lastMale];
  if (/\b(they|their|them)\b/.test(lower) && recent.length) return recent.slice(-2);
  return recent.slice(-1);
}

function scoreClip(clip: RepairClip, people: string[], words: string[]): number {
  const hay = [clip.person, clip.title, clip.description, clip.category, ...clip.categories]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;
  const peopleHit = people.filter((person) => hay.includes(person.toLowerCase().split(",")[0]));
  if (people.length && peopleHit.length) score += 8 + peopleHit.length;
  else if (people.length) score -= 4;
  for (const word of words) if (hay.includes(word)) score += 1;
  return score;
}

function gapOk(uses: number[], index: number): boolean {
  if (uses.length >= MAX_USES) return false;
  return uses.every((prior) => Math.abs(index - prior) >= MIN_GAP);
}

export function planShortClipReplacements(scenes: RepairScene[], clips: RepairClip[]): {
  replacements: Array<{ index: number; sceneId: string; assetId: string; fileKey: string; duration: number; person: string }>;
  unchanged: Array<{ sceneId: string; reason: string }>;
  affected: number;
} {
  const byFile = new Map<string, RepairClip[]>();
  for (const clip of clips) {
    if (!(clip.duration + DURATION_SLACK >= 0)) continue;
    const list = byFile.get(clip.fileKey) || [];
    list.push(clip);
    byFile.set(clip.fileKey, list);
  }
  const uses = new Map<string, number[]>();
  scenes.forEach((scene, index) => {
    if (!scene.isClip || !scene.fileKey) return;
    const list = uses.get(scene.fileKey) || [];
    list.push(index);
    uses.set(scene.fileKey, list);
  });

  const recent: string[] = [];
  const replacements = [];
  const unchanged = [];
  let affected = 0;

  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    const namedNow = royalPersonMentions(scene.narrationText).map((mention) => mention.person);
    const people = peopleForScene(scene.narrationText, recent);
    for (const person of namedNow) {
      if (!recent.includes(person)) recent.push(person);
      else {
        recent.splice(recent.indexOf(person), 1);
        recent.push(person);
      }
    }
    const bucket = lengthBucket(scene.duration);
    const targetBucket = bucket === "4s" || bucket === "5s" || bucket === "6s";
    if (!scene.isClip || !targetBucket || !scene.fileKey) continue;
    const durs = (byFile.get(scene.fileKey) || []).map((clip) => clip.duration);
    if (!durs.length) continue;
    const usable = Math.max(...durs);
    if (!(usable + DURATION_SLACK < scene.duration)) continue;
    affected += 1;
    const own = uses.get(scene.fileKey || "") || [];
    uses.set(
      scene.fileKey || "",
      own.filter((item) => item !== index)
    );
    const words = tokens(scene.narrationText);
    const pool = clips
      .filter((clip) => clip.fileKey !== scene.fileKey)
      .filter((clip) => clip.duration + DURATION_SLACK >= scene.duration)
      .filter((clip) => gapOk(uses.get(clip.fileKey) || [], index))
      .map((clip) => ({ clip, score: scoreClip(clip, people, words) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.clip.duration - a.clip.duration);
    const chosen = pool[0]?.clip;
    if (!chosen) {
      const back = uses.get(scene.fileKey || "") || [];
      back.push(index);
      uses.set(scene.fileKey || "", back);
      unchanged.push({
        sceneId: scene.sceneId,
        reason: "No other library clip is long enough, matches the subject, and stays within 3 uses and 51 scenes apart",
      });
      continue;
    }
    const nextUses = uses.get(chosen.fileKey) || [];
    nextUses.push(index);
    uses.set(chosen.fileKey, nextUses);
    replacements.push({
      index,
      sceneId: scene.sceneId,
      assetId: chosen.assetId,
      fileKey: chosen.fileKey,
      duration: chosen.duration,
      person: chosen.person,
    });
  }

  return { replacements, unchanged, affected };
}

function isVideoUrl(url?: string): boolean {
  return !!url && /\.(mp4|webm|mov|mkv|m4v)(?:[?&#]|$)/i.test(url);
}

function fileKeyFromUrl(url?: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url, "https://local.invalid");
    return decodeURIComponent(parsed.pathname).replace(/^\//, "");
  } catch {
    return url.split("?")[0];
  }
}

async function probeDuration(url: string, cache: Map<string, number>): Promise<number | undefined> {
  if (cache.has(url)) return cache.get(url);
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", url],
      { timeout: 25000 }
    );
    const value = Number(String(stdout).trim());
    if (!Number.isFinite(value) || value <= 0) return undefined;
    cache.set(url, value);
    return value;
  } catch {
    return undefined;
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function blankScores(): ApprovedVisual["confidenceScores"] {
  return {
    entityMatch: 70,
    sceneMatch: 60,
    topicRelevance: 60,
    eventPlaceYearRelevance: 40,
    visualQuality: 70,
    cropSafety16x9: 70,
    sourceReliability: 70,
    wrongEntityRisk: 15,
    watermarkTextRisk: 10,
    reusePotential: 40,
  };
}

export async function repairShortClips(jobId: string, options: { apply: boolean }) {
  if (!SHORT_CLIP_REPAIR_JOBS.has(jobId)) throw new Error("Job is outside the short-clip repair set");
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");
  const statusBefore = job.status;
  const lockBefore = job.timelineLock?.locked === true;
  const assignmentPath = jobDataFile("visual-intelligence-final-assignment", jobId);
  const royalPath = jobDataFile("royal-v2-final-assignment", jobId);
  const libraryPath = jobDataFile("visual-intelligence-approved-library", jobId);
  const assignment = (await readJson<{ scenes?: TimelineScene[] } & Record<string, unknown>>(assignmentPath)) || {};
  const scenes = assignment.scenes || [];
  if (!scenes.length) throw new Error("No scenes");
  const approvedDoc = (await readJson<{ approved?: ApprovedVisual[] } & Record<string, unknown>>(libraryPath)) || {};
  const approved = approvedDoc.approved || [];
  const approvedById = new Map(approved.map((visual) => [visual.approvedVisualId, visual]));
  const assets = (await loadRoyalLibraryAssets()).filter(
    (asset) => asset.mediaType === "raw_footage" || asset.mediaType === "trusted_clip"
  );
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const cache = new Map<string, number>();

  const sceneUrls = scenes.map((scene) => {
    const visual = approvedById.get(scene.approvedVisualId || scene.selectedVisualId);
    const asset = assetById.get(scene.approvedVisualId || scene.selectedVisualId || "");
    const url = visual?.filePathOrUrl || (asset ? royalAssetUrl(asset) : "");
    return url;
  });
  await mapPool(sceneUrls, 8, async (url) => {
    if (isVideoUrl(url)) await probeDuration(url, cache);
  });

  const clipAssets: RepairClip[] = [];
  await mapPool(assets, 8, async (asset) => {
    const url = royalAssetUrl(asset);
    const duration = await probeDuration(url, cache);
    if (!duration) return;
    clipAssets.push({
      assetId: asset.assetId,
      fileKey: asset.r2Key,
      duration,
      person: asset.person,
      title: asset.title || "",
      description: asset.description || "",
      category: asset.category || "",
      categories: asset.categories || [],
      filePathOrUrl: url,
      thumbnail: asset.thumbKey ? royalAssetUrl({ ...asset, r2Key: asset.thumbKey }) : undefined,
    });
  });
  const durationByKey = new Map<string, number>();
  for (const clip of clipAssets) durationByKey.set(clip.fileKey, Math.max(durationByKey.get(clip.fileKey) || 0, clip.duration));

  const repairScenes: RepairScene[] = scenes.map((scene, index) => {
    const visual = approvedById.get(scene.approvedVisualId || scene.selectedVisualId);
    const asset = assetById.get(scene.selectedVisualId || scene.approvedVisualId || "");
    const url = sceneUrls[index];
    const fileKey = asset?.r2Key || fileKeyFromUrl(url);
    const isClip = scene.source === "raw_footage" || asset?.mediaType === "raw_footage" || asset?.mediaType === "trusted_clip" || isVideoUrl(url);
    if (fileKey && cache.has(url) && !durationByKey.has(fileKey)) durationByKey.set(fileKey, cache.get(url)!);
    return {
      sceneId: scene.sceneId,
      duration: scene.duration || Math.max(0, scene.endTime - scene.startTime),
      narrationText: scene.narrationText || "",
      isClip,
      fileKey: isClip ? fileKey : undefined,
    };
  });
  const clipsForPlan = clipAssets.map((clip) => ({ ...clip, duration: durationByKey.get(clip.fileKey) || clip.duration }));
  for (const scene of repairScenes) {
    if (!scene.fileKey || clipsForPlan.some((clip) => clip.fileKey === scene.fileKey)) continue;
    const url = sceneUrls[repairScenes.indexOf(scene)];
    const duration = cache.get(url);
    if (!duration) continue;
    clipsForPlan.push({
      assetId: scene.fileKey,
      fileKey: scene.fileKey,
      duration,
      person: "",
      title: "",
      description: "",
      category: "",
      categories: [],
      filePathOrUrl: url,
    });
  }

  const plan = planShortClipReplacements(repairScenes, clipsForPlan);
  if (!options.apply) {
    return {
      ok: true,
      apply: false,
      jobId,
      status: statusBefore,
      locked: lockBefore,
      affected: plan.affected,
      replaced: plan.replacements.length,
      unchanged: plan.unchanged,
      replacements: plan.replacements.map((item) => ({
        sceneId: item.sceneId,
        assetId: item.assetId,
        clipSeconds: Number(item.duration.toFixed(2)),
        person: item.person,
      })),
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(config.dataPath, "backups", "short-clip-repair", stamp, jobId);
  await fs.mkdir(backupDir, { recursive: true });
  for (const filePath of [assignmentPath, royalPath, libraryPath, path.join(config.storagePath, "jobs", jobId, "job.json")]) {
    try {
      await fs.copyFile(filePath, path.join(backupDir, path.basename(filePath)));
    } catch {
      /* missing royal copy is ok */
    }
  }

  const chosenById = new Map(clipAssets.map((clip) => [clip.assetId, clip]));
  const replaceIds = new Map(plan.replacements.map((item) => [item.sceneId, item]));
  const nextScenes = scenes.map((scene) => {
    const next = replaceIds.get(scene.sceneId);
    if (!next) return scene;
    const clip = chosenById.get(next.assetId);
    if (!clip) return scene;
    return {
      ...scene,
      selectedVisualId: clip.assetId,
      approvedVisualId: clip.assetId,
      source: "raw_footage" as const,
      reasonSelected: `${clip.person}: ${clip.title || clip.description || "library clip"}`,
    };
  });
  await writeJson(assignmentPath, { ...assignment, scenes: nextScenes });
  const royal = await readJson<Record<string, unknown>>(royalPath);
  if (royal && Array.isArray(royal.scenes)) {
    const royalScenes = (royal.scenes as TimelineScene[]).map((scene) => {
      const updated = nextScenes.find((item) => item.sceneId === scene.sceneId);
      if (!updated || !replaceIds.has(scene.sceneId)) return scene;
      return {
        ...scene,
        selectedVisualId: updated.selectedVisualId,
        approvedVisualId: updated.approvedVisualId,
        source: updated.source,
        reasonSelected: updated.reasonSelected,
      };
    });
    await writeJson(royalPath, { ...royal, scenes: royalScenes });
  }
  const extras: ApprovedVisual[] = [];
  for (const item of plan.replacements) {
    const clip = chosenById.get(item.assetId);
    if (!clip || approvedById.has(clip.assetId)) continue;
    extras.push({
      approvedVisualId: clip.assetId,
      source: "raw_footage",
      filePathOrUrl: clip.filePathOrUrl,
      thumbnail: clip.thumbnail,
      matchedPeople: [clip.person],
      matchedCompanies: [],
      matchedPlaces: [],
      matchedEvents: [],
      matchedDocuments: [],
      matchedObjects: [],
      allowedBeatIds: [],
      bestUseCase: clip.title || clip.description || clip.person,
      confidenceScores: blankScores(),
      reuseLimit: 3,
      durationRecommendation: clip.duration,
      warnings: [],
      candidateId: clip.assetId,
      libraryAssetId: clip.assetId,
      mediaType: "raw_footage",
    });
    approvedById.set(clip.assetId, extras[extras.length - 1]);
  }
  if (extras.length) {
    await writeJson(libraryPath, { ...approvedDoc, approved: [...approved, ...extras] });
  }
  const jobAfter = await loadJob(jobId);
  return {
    ok: true,
    apply: true,
    jobId,
    statusBefore,
    statusAfter: jobAfter?.status,
    lockedBefore: lockBefore,
    lockedAfter: jobAfter?.timelineLock?.locked === true,
    backupDir,
    affected: plan.affected,
    replaced: plan.replacements.length,
    unchanged: plan.unchanged,
    replacements: plan.replacements.map((item) => ({
      sceneId: item.sceneId,
      assetId: item.assetId,
      clipSeconds: Number(item.duration.toFixed(2)),
      person: item.person,
    })),
  };
}
