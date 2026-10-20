import { jobDataFile, loadJob, readJson, saveJob, writeJson } from "../../storage.js";
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

function personOfReason(reason: string): string {
  return reason.split(":")[0]?.trim() || "";
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
  const result = await chatJsonVisionStream<{ pass?: boolean; reason?: string; seen?: string }>({
    system: `You check one documentary still. Decide if the required person is actually visible.
Return JSON {"pass": true|false, "seen": "who you see", "reason": "short"}.
pass is true only when at least one required person is clearly in the frame.
Historical figures count only if that historical person is visible, not a modern royal with a similar name.
Do not pass on clothing, palaces, or captions alone.`,
    user: [
      {
        type: "text",
        text: `Required: ${wanted.join(" or ")}. Line: ${scene.narrationText.slice(0, 240)}`,
      },
      { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
    ],
    temperature: 0,
    onDelta: () => undefined,
  });
  return {
    pass: Boolean(result.pass),
    reason: String(result.reason || "").slice(0, 180),
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

export async function visionFixJob(jobId: string): Promise<{ checked: number; kept: number; replaced: number; failed: number }> {
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

  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    const wanted = namedPeople(scene.narrationText);
    if (!wanted.length || !scene.selectedVisualId) continue;
    const current = byId.get(scene.selectedVisualId);
    const currentPerson = current?.person || personOfReason(scene.reasonSelected || "");
    if (current && personMatches(current.person, wanted)) continue;

    const currentUrl = current ? thumbUrl(current) : approved.get(scene.selectedVisualId)?.thumbnail || approved.get(scene.selectedVisualId)?.filePathOrUrl;
    if (!currentUrl || !/^https:\/\//i.test(currentUrl)) continue;

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

    const alternates = assets
      .filter((asset) => personMatches(asset.person, wanted))
      .filter((asset) => asset.assetId !== scene.selectedVisualId)
      .filter((asset) => asset.mediaType === "image" || (asset.duration || 0) + 0.05 >= (scene.duration || 1))
      .filter((asset) => Boolean(thumbUrl(asset)))
      .slice(0, 3);

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
  await writeJson(jobDataFile("royal-v2-soft-approval", jobId), {
    jobId,
    checked,
    kept,
    replaced,
    failed,
    createdAt: new Date().toISOString(),
  });
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  console.log(`[vision-fix] done ${jobId} checked=${checked} kept=${kept} replaced=${replaced} failed=${failed}`);
  return { checked, kept, replaced, failed };
}
