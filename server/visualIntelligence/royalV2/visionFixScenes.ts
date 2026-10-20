import { jobDataFile, listJobs, loadJob, readJson, saveJob, writeJson } from "../../storage.js";
import { chatJsonVisionStream } from "../../openaiClient.js";
import type { LibraryAsset } from "../../library/types.js";
import type { ApprovedVisual, TimelineScene } from "../../../shared/visualIntelligence.js";
import { loadRoyalLibraryAssets, royalAssetUrl } from "./library.js";

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
  return PEOPLE.filter((person) => person.pattern.test(text)).map((person) => person.label);
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

async function judgeImage(scene: TimelineScene, imageUrl: string, wanted: string[]): Promise<Verdict> {
  const result = await chatJsonVisionStream<{ pass?: boolean; reason?: string; seen?: string; action?: string }>({
    system: `You see one current frame only. Use the narration line as the overall context.
Decide whether the intended person is actually visible. If the line names no person, decide whether this frame shows the action or subject of the line.
Return JSON {"pass": true|false, "seen": "who or what is in the frame", "reason": "short", "action": "keep"|"replace"}.
pass is true only when the intended person is clearly visible, or when no person is named and the frame matches the line.
A historical person passes only if that historical person is visible, not a modern royal with a similar name.
Do not pass on clothing, palaces, or captions alone. action is keep when pass is true, otherwise replace.`,
    user: [
      {
        type: "text",
        text: wanted.length
          ? `Intended person: ${wanted.join(" or ")}. Line: ${scene.narrationText.slice(0, 280)}`
          : `No named person. Judge the line itself. Line: ${scene.narrationText.slice(0, 280)}`,
      },
      { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
    ],
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
      mode: "all-scenes-first-frame",
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

  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    const wanted = namedPeople(scene.narrationText);
    if (!scene.selectedVisualId) {
      failed += 1;
      continue;
    }
    const current = byId.get(scene.selectedVisualId);

    const currentUrl = current ? thumbUrl(current) : approved.get(scene.selectedVisualId)?.thumbnail || approved.get(scene.selectedVisualId)?.filePathOrUrl;
    if (!currentUrl || !/^https:\/\//i.test(currentUrl)) {
      failed += 1;
      continue;
    }

    checked += 1;
    let verdict: Verdict;
    try {
      verdict = await judgeImage(scene, currentUrl, wanted);
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

    const alternates = wanted.length ? assets
      .filter((asset) => personMatches(asset.person, wanted))
      .filter((asset) => asset.assetId !== scene.selectedVisualId)
      .filter((asset) => asset.mediaType === "image" || (asset.duration || 0) + 0.05 >= (scene.duration || 1))
      .filter((asset) => Boolean(thumbUrl(asset)))
      .slice(0, 3) : [];

    let swapped = false;
    for (const asset of alternates) {
      const url = thumbUrl(asset);
      if (!url) continue;
      try {
        const next = await judgeImage(scene, url, wanted);
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
  const queue: string[] = [];
  for (const job of pending) {
    const report = await readJson<{ mode?: string; complete?: boolean }>(
      jobDataFile("royal-v2-soft-approval", job.jobId)
    );
    const done = report?.mode === "all-scenes-first-frame" && report.complete === true;
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
