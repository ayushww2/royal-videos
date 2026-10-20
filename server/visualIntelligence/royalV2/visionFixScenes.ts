import { jobDataFile, listJobs, loadJob, readJson, saveJob, writeJson } from "../../storage.js";
import { chatJsonVisionStream } from "../../openaiClient.js";
import type { LibraryAsset } from "../../library/types.js";
import type { ApprovedVisual, TimelineScene } from "../../../shared/visualIntelligence.js";
import { loadRoyalLibraryAssets, royalAssetUrl } from "./library.js";

const VISION_MODE = "scene-match-gpt-6.1-sol";

const MALE = new Set(["King Charles", "Prince William", "Prince Harry", "Prince Andrew", "Prince George", "Prince Louis", "Prince Edward"]);
const FEMALE = new Set(["Queen Camilla", "Catherine, Princess of Wales", "Princess Diana", "Princess Anne", "Meghan, Duchess of Sussex", "Princess Charlotte", "Princess Beatrice", "Princess Eugenie", "Sarah Ferguson", "Queen Elizabeth"]);

const PEOPLE: Array<{ label: string; pattern: RegExp }> = [
  { label: "King Charles", pattern: /\bcharles\b/i },
  { label: "Queen Camilla", pattern: /\bcamilla\b/i },
  { label: "Prince William", pattern: /\bwilliam\b/i },
  { label: "Catherine, Princess of Wales", pattern: /\b(catherine|kate)\b/i },
  { label: "Prince Harry", pattern: /\bharry\b/i },
  { label: "Meghan, Duchess of Sussex", pattern: /\bmeghan\b/i },
  { label: "Princess Anne", pattern: /\banne\b/i },
  { label: "Princess Diana", pattern: /\bdiana\b/i },
  { label: "Prince George", pattern: /\bgeorge\b/i },
  { label: "Princess Charlotte", pattern: /\bcharlotte\b/i },
  { label: "Prince Louis", pattern: /\blouis\b/i },
  { label: "Prince Andrew", pattern: /\bandrew\b/i },
  { label: "Princess Beatrice", pattern: /\bbeatrice\b/i },
  { label: "Princess Eugenie", pattern: /\beugenie\b/i },
  { label: "Queen Elizabeth", pattern: /\belizabeth\b/i },
  { label: "Sarah Ferguson", pattern: /\b(sarah ferguson|fergie)\b/i },
  { label: "Prince Edward", pattern: /\bedward\b/i },
];

type Verdict = { pass: boolean; reason: string; seen: string };

function namedPeople(text: string): string[] {
  if (/\bqueen mother\b/i.test(text)) return ["Queen Elizabeth The Queen Mother"];
  return PEOPLE.filter((person) => person.pattern.test(text)).map((person) => person.label);
}

/** Who this line is about, using the people named in earlier lines for she, he, and his wife. */
function intendedPeople(text: string, recent: string[]): string[] {
  const named = namedPeople(text);
  if (named.length) return named;
  const lower = text.toLowerCase();
  const lastFemale = [...recent].reverse().find((person) => FEMALE.has(person));
  const lastMale = [...recent].reverse().find((person) => MALE.has(person));
  if (/\bhis wife\b/.test(lower) && lastMale?.includes("Charles")) return ["Queen Camilla"];
  if (/\bhis wife\b/.test(lower) && lastMale?.includes("William")) return ["Catherine, Princess of Wales"];
  if (/\bher husband\b/.test(lower) && lastFemale?.includes("Camilla")) return ["King Charles"];
  if (/\bher husband\b/.test(lower) && lastFemale?.includes("Catherine")) return ["Prince William"];
  if (/\b(she|her|hers)\b/.test(lower) && lastFemale) return [lastFemale];
  if (/\b(he|his|him)\b/.test(lower) && lastMale) return [lastMale];
  if (/\b(they|their|them)\b/.test(lower) && recent.length) return recent.slice(-2);
  return [];
}

function personMatches(assetPerson: string, wanted: string[]): boolean {
  const hay = assetPerson.toLowerCase();
  return wanted.some((person) => {
    const key = person.split(",")[0].toLowerCase();
    return hay.includes(key.split(" ").pop() || key);
  });
}

function thumbUrl(asset: LibraryAsset): string | undefined {
  const key = asset.thumbKey || (asset.mediaType === "image" ? asset.r2Key : undefined);
  if (!key) return undefined;
  return royalAssetUrl({ ...asset, r2Key: key });
}

async function judgeImage(scene: TimelineScene, imageUrl: string, wanted: string[], context: string): Promise<Verdict> {
  const result = await chatJsonVisionStream<{ pass?: boolean; reason?: string; seen?: string; action?: string }>({
    system: `You are the picture editor for one documentary scene. You see one current frame only.
Decide if this frame is the right visual for the spoken line, using the previous line as context.
Return JSON {"pass": true|false, "seen": "what the frame actually shows", "reason": "short", "action": "keep"|"replace"}.
pass is true only when a viewer would accept this frame for this line.
If the line is about a person, that person must be visible. She, he, and his wife mean the person from context, not a different royal.
A historical person passes only if that historical person is visible. Queen Elizabeth The Queen Mother is not Queen Camilla and not a modern group photo.
If the line is about a place, a letter, an order, a year, or an action, the frame must show that, not just any royal.
Do not pass on clothing, a caption, or a generic palace when the line is specific. action is keep when pass is true, otherwise replace.`,
    user: [
      {
        type: "text",
        text: `${wanted.length ? `People this line is about: ${wanted.join(" or ")}.` : "No single named person. Match what the line is about."}\nThis line: ${scene.narrationText.slice(0, 320)}\nPrevious line: ${context.slice(0, 240)}`,
      },
      { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
    ],
    model: "gpt-6.1-sol",
    temperature: 0,
    onDelta: () => undefined,
  });
  const pass = Boolean(result.pass);
  return {
    pass,
    reason: String(result.reason || result.action || "").slice(0, 180),
    seen: String(result.seen || "").slice(0, 80),
  };
}

function blankScores(): ApprovedVisual["confidenceScores"] {
  return {
    entityMatch: 80,
    sceneMatch: 70,
    topicRelevance: 60,
    eventPlaceYearRelevance: 40,
    visualQuality: 70,
    cropSafety16x9: 70,
    sourceReliability: 80,
    wrongEntityRisk: 10,
    watermarkTextRisk: 10,
    reusePotential: 40,
  };
}

const runningVision = new Set<string>();

export async function visionFixJob(jobId: string): Promise<{ checked: number; kept: number; replaced: number; failed: number }> {
  if (runningVision.has(jobId)) {
    return { checked: 0, kept: 0, replaced: 0, failed: 0 };
  }
  runningVision.add(jobId);
  try {
    return await runVisionFixJob(jobId);
  } finally {
    runningVision.delete(jobId);
  }
}

async function runVisionFixJob(jobId: string): Promise<{ checked: number; kept: number; replaced: number; failed: number }> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("Job not found");
  const assignmentPath = jobDataFile("visual-intelligence-final-assignment", jobId);
  const existing = (await readJson<{ scenes?: TimelineScene[] }>(assignmentPath)) || {};
  const scenes = existing.scenes || [];
  const libraryPath = jobDataFile("visual-intelligence-approved-library", jobId);
  const libraryFile = (await readJson<{ approved?: ApprovedVisual[] }>(libraryPath)) || { approved: [] };
  const approved = new Map((libraryFile.approved || []).map((visual) => [visual.approvedVisualId, visual]));
  const assets = await loadRoyalLibraryAssets();
  const byId = new Map(assets.map((asset) => [asset.assetId, asset]));

  let checked = 0;
  let kept = 0;
  let replaced = 0;
  let failed = 0;
  const progressPath = jobDataFile("royal-v2-soft-approval", jobId);
  let complete = false;
  const writeProgress = async () => {
    await writeJson(progressPath, {
      jobId,
      mode: VISION_MODE,
      model: "gpt-6.1-sol",
      total: scenes.length,
      checked,
      kept,
      replaced,
      failed,
      complete,
      createdAt: new Date().toISOString(),
    });
  };

  await writeProgress();

  const recent: string[] = [];
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    const wanted = intendedPeople(scene.narrationText, recent);
    for (const person of namedPeople(scene.narrationText)) {
      if (FEMALE.has(person) || MALE.has(person)) recent.push(person);
    }
    if (!scene.selectedVisualId) {
      failed += 1;
      continue;
    }
    const current = byId.get(scene.selectedVisualId);
    const context = scenes[index - 1]?.narrationText || "";

    const currentUrl = current ? thumbUrl(current) : approved.get(scene.selectedVisualId)?.thumbnail || approved.get(scene.selectedVisualId)?.filePathOrUrl;
    if (!currentUrl || !/^https:\/\//i.test(currentUrl)) {
      failed += 1;
      continue;
    }

    checked += 1;
    let verdict: Verdict;
    try {
      verdict = await judgeImage(scene, currentUrl, wanted, context);
    } catch (error) {
      console.warn(`[vision-fix] ${jobId} ${scene.sceneId} judge failed`, error instanceof Error ? error.message : error);
      failed += 1;
      continue;
    }
    console.log(`[vision-fix] ${jobId} ${scene.sceneId} ${verdict.pass ? "keep" : "fail"} seen=${verdict.seen}`);
    if (verdict.pass) {
      scene.softApproval = "pass";
      scene.softApprovalMode = "vision";
      scene.softApprovalReason = verdict.reason;
      scene.softApprovalDetectedHint = verdict.seen;
      kept += 1;
      continue;
    }

    const lineWords = scene.narrationText.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    const alternates = assets
      .filter((asset) => asset.assetId !== scene.selectedVisualId)
      .filter((asset) => !wanted.length || personMatches(asset.person, wanted))
      .filter((asset) => asset.mediaType === "image" || (asset.duration || 0) + 0.05 >= (scene.duration || 1))
      .filter((asset) => Boolean(thumbUrl(asset)))
      .map((asset) => {
        const hay = `${asset.person} ${asset.title || ""} ${asset.description || ""}`.toLowerCase();
        const words = lineWords.filter((word) => hay.includes(word)).length;
        return { asset, words };
      })
      .sort((a, b) => b.words - a.words)
      .slice(0, 3)
      .map((item) => item.asset);

    let swapped = false;
    for (const asset of alternates) {
      const url = thumbUrl(asset);
      if (!url) continue;
      try {
        const next = await judgeImage(scene, url, wanted, context);
        console.log(`[vision-fix] ${jobId} ${scene.sceneId} alt ${asset.assetId} ${next.pass ? "pass" : "fail"}`);
        if (!next.pass) continue;
        const visual: ApprovedVisual = {
          approvedVisualId: asset.assetId,
          source: asset.mediaType === "image" ? "cached_approved" : "raw_footage",
          filePathOrUrl: royalAssetUrl(asset),
          thumbnail: url,
          matchedPeople: [asset.person],
          matchedCompanies: [],
          matchedPlaces: [],
          matchedEvents: [],
          matchedDocuments: [],
          matchedObjects: [],
          allowedBeatIds: [scene.beatId],
          bestUseCase: asset.title || asset.description || asset.person,
          confidenceScores: blankScores(),
          reuseLimit: 2,
          warnings: [],
          candidateId: asset.assetId,
          libraryAssetId: asset.assetId,
          mediaType: asset.mediaType === "image" ? "image" : "raw_footage",
        };
        approved.set(asset.assetId, visual);
        scene.selectedVisualId = asset.assetId;
        scene.approvedVisualId = asset.assetId;
        scene.source = visual.source;
        scene.reasonSelected = `${asset.person}: ${asset.title || asset.description || "vision replacement"}`;
        scene.softApproval = "pass";
        scene.softApprovalMode = "vision";
        scene.softApprovalReason = next.reason;
        scene.softApprovalDetectedHint = next.seen;
        scene.needsBetterVisual = false;
        swapped = true;
        replaced += 1;
        break;
      } catch (error) {
        console.warn(`[vision-fix] alt failed ${asset.assetId}`, error instanceof Error ? error.message : error);
      }
    }
    if (!swapped) {
      scene.softApproval = "fail";
      scene.softApprovalMode = "vision";
      scene.softApprovalReason = verdict.reason;
      scene.needsBetterVisual = true;
      failed += 1;
    }
    if (checked % 10 === 0) {
      await writeJson(assignmentPath, { ...existing, scenes });
      await writeProgress();
    }
  }

  await writeJson(assignmentPath, { ...existing, scenes });
  const royalPath = jobDataFile("royal-v2-final-assignment", jobId);
  const royal = await readJson<Record<string, unknown>>(royalPath);
  if (royal) await writeJson(royalPath, { ...royal, scenes });
  await writeJson(libraryPath, {
    jobId,
    approved: [...approved.values()],
    source: "Vision fix for wrong-person scenes",
    createdAt: new Date().toISOString(),
  });
  complete = true;
  await writeProgress();
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  console.log(`[vision-fix] done ${jobId} checked=${checked} kept=${kept} replaced=${replaced} failed=${failed}`);
  return { checked, kept, replaced, failed };
}

/** After a restart, finish first-frame checks for review-ready jobs that never completed one. */
export async function resumeVisionPasses(): Promise<void> {
  const jobs = await listJobs();
  const pending = jobs.filter(
    (job) =>
      (job.niche === "Royal v2" || job.niche === "Royal v3") &&
      (job.status === "scene_review_ready" || job.status === "ready_for_scene_review")
  );
  const todayFirst = [
    "85249c5c-7923-4620-8472-6e111d552a4d",
    "a8c96747-6152-438e-991b-dd4563dd67a8",
    "6af41e9d-a353-4bef-8c9f-34cb4d078602",
    "e4932e73-690a-47c7-88bb-de859a8a2cb5",
    "1fa609d6-c37b-429f-b56c-6af530907778",
    "fb5fd567-0950-4a56-985a-ba1a6e3dfb13",
    "38b95238-7915-48fa-9944-9b82f2ab26ec",
    "24c3a2f4-1e6e-4bc0-8138-4b7ba214f7f0",
    "39543c2c-9698-4639-aea0-8945cd764fab",
    "e06fa474-9a32-455d-850a-a1c390faf48d",
  ];
  pending.sort((a, b) => {
    const ai = todayFirst.indexOf(a.jobId);
    const bi = todayFirst.indexOf(b.jobId);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const queue: string[] = [];
  for (const job of pending) {
    const report = await readJson<{ mode?: string; complete?: boolean }>(
      jobDataFile("royal-v2-soft-approval", job.jobId)
    );
    const done = report?.mode === VISION_MODE && report.complete === true;
    if (!done) queue.push(job.jobId);
  }
  console.log(`[vision-fix] resume ${queue.length} jobs`);
  const concurrency = 2;
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const jobId = queue[cursor];
      cursor += 1;
      try {
        await visionFixJob(jobId);
      } catch (error) {
        console.error("[vision-fix] resume failed", jobId, error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
}
