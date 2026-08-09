import { chatJson, chatJsonVision } from "../../openaiClient.js";
import { config } from "../../config.js";
import { jobDataFile, writeJson } from "../../storage.js";
import { cheapPipeline, efficientPipeline } from "../pipelineMode.js";
import type {
  ApprovedVisual,
  SoftApprovalReport,
  SoftApprovalStatus,
  SoftSceneApproval,
  TimelineScene,
} from "../../../shared/visualIntelligence.js";

const PERSON_BEAT_TYPES = new Set(["exact_person", "exact_pair_or_group"]);

function envTruthy(name: string, defaultTrue = false): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return defaultTrue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

export function softApprovalEnabled(): boolean {
  // Default on for Royal v2 unless explicitly disabled
  return envTruthy("SOFT_APPROVAL", true);
}

function softApprovalBlockEnabled(): boolean {
  return envTruthy("SOFT_APPROVAL_BLOCK", false);
}

function softApprovalFailRateThreshold(): number {
  return Math.min(1, Math.max(0.05, envNumber("SOFT_APPROVAL_FAIL_RATE", 0.25)));
}

function softApprovalConcurrency(): number {
  return Math.max(1, Math.min(6, Math.round(envNumber("SOFT_APPROVAL_CONCURRENCY", 3))));
}

function softApprovalBatchSize(): number {
  return Math.max(1, Math.min(6, Math.round(envNumber("SOFT_APPROVAL_BATCH_SIZE", 4))));
}

function softApprovalConfidenceThreshold(): number {
  return Math.min(1, Math.max(0.3, envNumber("SOFT_APPROVAL_CONFIDENCE_THRESHOLD", 0.7)));
}

function softApprovalModel(): string {
  return (process.env.SOFT_APPROVAL_MODEL || config.openaiModel || "gpt-5.5").trim();
}

function isPersonBeat(scene: TimelineScene): boolean {
  return PERSON_BEAT_TYPES.has(scene.beatType || "");
}

function intendedPersonLabel(scene: TimelineScene): string {
  if (scene.beatType === "exact_pair_or_group") {
    const pair = (scene.pairOrGroup || []).filter(Boolean);
    if (pair.length) return pair.join(" & ");
    const secondary = (scene.secondaryPeople || []).filter(Boolean);
    if (scene.mainPerson && secondary.length) {
      return [scene.mainPerson, ...secondary].join(" & ");
    }
  }
  return (
    scene.mainPerson ||
    scene.pairOrGroup?.[0] ||
    scene.secondaryPeople?.[0] ||
    "named person from narration"
  );
}

function isBlockedMediaUrl(url?: string): boolean {
  if (!url) return true;
  return (
    /tiktok\.com/i.test(url) ||
    /(?:^|[/.])tiktokcdn\./i.test(url) ||
    /pinterest\./i.test(url) ||
    /pinimg\.com/i.test(url)
  );
}

function isPublicHttpsUrl(url?: string): boolean {
  if (!url || !/^https:\/\//i.test(url)) return false;
  if (isBlockedMediaUrl(url)) return false;
  return true;
}

function isVideoUrl(url?: string): boolean {
  if (!url) return false;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

function pickMediaUrl(visual?: ApprovedVisual): { url?: string; visionOk: boolean } {
  if (!visual) return { visionOk: false };
  const thumb = visual.thumbnail?.trim();
  const main = visual.filePathOrUrl?.trim();
  // Prefer thumbnail for vision (smaller, still frame); avoid feeding video URLs to vision.
  if (isPublicHttpsUrl(thumb) && !isVideoUrl(thumb)) {
    return { url: thumb, visionOk: true };
  }
  if (isPublicHttpsUrl(main) && !isVideoUrl(main)) {
    return { url: main, visionOk: true };
  }
  // Keep a non-vision URL for the report (metadata-only path)
  const fallback = thumb || main;
  if (fallback && !isBlockedMediaUrl(fallback)) {
    return { url: fallback, visionOk: false };
  }
  return { visionOk: false };
}

function hashPick(sceneId: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < sceneId.length; i++) h = (h * 31 + sceneId.charCodeAt(i)) >>> 0;
  return h % 100;
}

/** Which person/pair scenes to soft-check.
 * Default (full): every exact_person / exact_pair_or_group beat.
 * PIPELINE_EFFICIENT (opt-in): weak scenes + ~20% sample only.
 */
export function selectScenesForSoftApproval(scenes: TimelineScene[]): {
  toCheck: TimelineScene[];
  skipped: TimelineScene[];
  mode: SoftApprovalReport["mode"];
} {
  if (!softApprovalEnabled()) {
    return { toCheck: [], skipped: scenes, mode: "disabled" };
  }
  if (cheapPipeline()) {
    return { toCheck: [], skipped: scenes, mode: "cheap_skip" };
  }

  const personScenes = scenes.filter(
    (scene) => isPersonBeat(scene) && Boolean(scene.selectedVisualId)
  );
  const nonPerson = scenes.filter((scene) => !personScenes.includes(scene));

  // Opt-in sample mode only — do not use for quality validation runs.
  if (efficientPipeline()) {
    const threshold = softApprovalConfidenceThreshold();
    const selected: TimelineScene[] = [];
    for (const scene of personScenes) {
      const weak =
        scene.confidence < threshold ||
        Boolean(scene.needsBetterVisual) ||
        (scene.warnings || []).some((w) => /wrong-person|Needs Review/i.test(w));
      const sample = hashPick(scene.sceneId, 17) < 20; // ~20% of person beats
      if (weak || sample) selected.push(scene);
    }
    const selectedIds = new Set(selected.map((s) => s.sceneId));
    return {
      toCheck: selected,
      skipped: [...nonPerson, ...personScenes.filter((s) => !selectedIds.has(s.sceneId))],
      mode: "efficient",
    };
  }

  // Full mode (default): all person/pair beats.
  return { toCheck: personScenes, skipped: nonPerson, mode: "full" };
}

function normalizeStatus(raw: unknown): SoftApprovalStatus {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "pass" || v === "fail" || v === "unsure") return v;
  return "unsure";
}

type JudgeRow = {
  sceneId?: string;
  softApproval?: string;
  reason?: string;
  intendedPerson?: string;
  detectedHint?: string;
};

async function judgeBatchVision(
  items: Array<{
    scene: TimelineScene;
    intendedPerson: string;
    mediaUrl: string;
    labels: string;
  }>
): Promise<Map<string, SoftSceneApproval>> {
  const out = new Map<string, SoftSceneApproval>();
  if (!items.length) return out;

  const system = `You are a documentary editor soft-checking whether the CORRECT person(s) appear in each scene visual.
Compare the intended person(s) / narration intent against what you see in the image (and labels).
Rules:
- pass: intended person(s) clearly appear (or both for pair beats)
- fail: clearly wrong person, or intended person absent when the beat requires them
- unsure: cannot tell from the image / crop / group shot ambiguity
Do NOT reject for quality, crop, or style — only identity match.
Return JSON: { "results": [{ "sceneId", "softApproval": "pass"|"fail"|"unsure", "reason", "intendedPerson", "detectedHint" }] }`;

  const userParts: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: JSON.stringify({
        instruction: "Judge each scene in order. Use the image immediately after each scene block.",
        scenes: items.map((item, index) => ({
          index,
          sceneId: item.scene.sceneId,
          beatType: item.scene.beatType,
          intendedPerson: item.intendedPerson,
          narrationText: (item.scene.narrationText || "").slice(0, 220),
          labels: item.labels,
        })),
      }),
    },
  ];

  for (const item of items) {
    userParts.push({
      type: "text",
      text: `Scene ${item.scene.sceneId} — intended: ${item.intendedPerson}`,
    });
    userParts.push({
      type: "image_url",
      image_url: { url: item.mediaUrl, detail: "low" },
    });
  }

  try {
    const result = await chatJsonVision<{ results?: JudgeRow[] }>({
      system,
      user: userParts,
      model: softApprovalModel(),
      temperature: 0.1,
    });
    for (const item of items) {
      const row =
        result.results?.find((r) => r.sceneId === item.scene.sceneId) ||
        result.results?.[items.indexOf(item)];
      out.set(item.scene.sceneId, {
        softApproval: normalizeStatus(row?.softApproval),
        reason: String(row?.reason || "Vision soft approval").slice(0, 280),
        intendedPerson: String(row?.intendedPerson || item.intendedPerson).slice(0, 120),
        detectedHint: String(row?.detectedHint || "").slice(0, 160),
        mode: "vision",
      });
    }
  } catch (err) {
    console.warn(
      `[softApproval] vision batch failed (${items.length} scenes):`,
      err instanceof Error ? err.message : String(err)
    );
    for (const item of items) {
      out.set(item.scene.sceneId, {
        softApproval: "unsure",
        reason: "Vision API failed — marked unsure",
        intendedPerson: item.intendedPerson,
        detectedHint: "",
        mode: "vision",
      });
    }
  }
  return out;
}

async function judgeBatchText(
  items: Array<{
    scene: TimelineScene;
    intendedPerson: string;
    labels: string;
  }>
): Promise<Map<string, SoftSceneApproval>> {
  const out = new Map<string, SoftSceneApproval>();
  if (!items.length) return out;

  try {
    const result = await chatJson<{ results?: JudgeRow[] }>({
      system: `You are a documentary editor soft-checking person identity using ONLY labels/metadata/captions (no image).
Compare intended person(s) vs asset person/title/description/matchedPeople.
Rules:
- pass: labels clearly name the intended person(s)
- fail: labels clearly name a different person
- unsure: labels missing, generic, or ambiguous
Return JSON: { "results": [{ "sceneId", "softApproval": "pass"|"fail"|"unsure", "reason", "intendedPerson", "detectedHint" }] }`,
      user: JSON.stringify({
        scenes: items.map((item) => ({
          sceneId: item.scene.sceneId,
          beatType: item.scene.beatType,
          intendedPerson: item.intendedPerson,
          narrationText: (item.scene.narrationText || "").slice(0, 220),
          labels: item.labels,
          whyThisMatchesNarration: item.scene.whyThisMatchesNarration,
        })),
      }),
      temperature: 0.1,
    });
    for (const item of items) {
      const row = result.results?.find((r) => r.sceneId === item.scene.sceneId);
      out.set(item.scene.sceneId, {
        softApproval: normalizeStatus(row?.softApproval),
        reason: String(row?.reason || "Text soft approval").slice(0, 280),
        intendedPerson: String(row?.intendedPerson || item.intendedPerson).slice(0, 120),
        detectedHint: String(row?.detectedHint || "").slice(0, 160),
        mode: "text",
      });
    }
  } catch (err) {
    console.warn(
      `[softApproval] text batch failed (${items.length} scenes):`,
      err instanceof Error ? err.message : String(err)
    );
    for (const item of items) {
      out.set(item.scene.sceneId, {
        softApproval: "unsure",
        reason: "Text judge API failed — marked unsure",
        intendedPerson: item.intendedPerson,
        detectedHint: "",
        mode: "text",
      });
    }
  }
  return out;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function applySoftApprovalToScene(scene: TimelineScene, result: SoftSceneApproval): TimelineScene {
  const next: TimelineScene = {
    ...scene,
    softApproval: result.softApproval,
    softApprovalReason: result.reason,
    softApprovalIntendedPerson: result.intendedPerson,
    softApprovalDetectedHint: result.detectedHint,
    softApprovalMode: result.mode,
  };
  const warnings = [...(next.warnings || [])];
  if (result.softApproval === "fail") {
    warnings.push(`Soft approval fail: ${result.reason}`);
    next.needsBetterVisual = true;
    next.assistantSuggestionAvailable = true;
  } else if (result.softApproval === "unsure" && result.mode !== "skipped") {
    warnings.push(`Soft approval unsure: ${result.reason}`);
  }
  next.warnings = [...new Set(warnings)];
  return next;
}

/**
 * Soft AI check that the correct person is shown vs beat/narration intent.
 * Never hard-blocks the pipeline; optional SOFT_APPROVAL_BLOCK only affects auto-approve.
 */
export async function runRoyalV2SoftApproval(params: {
  jobId: string;
  scenes: TimelineScene[];
  library: ApprovedVisual[];
}): Promise<{ scenes: TimelineScene[]; report: SoftApprovalReport; gptCallsUsed: number }> {
  const { jobId, library } = params;
  const visualById = new Map(library.map((v) => [v.approvedVisualId, v]));
  const { toCheck, skipped, mode } = selectScenesForSoftApproval(params.scenes);

  if (mode === "disabled" || mode === "cheap_skip" || !toCheck.length) {
    const report: SoftApprovalReport = {
      jobId,
      createdAt: new Date().toISOString(),
      enabled: mode !== "disabled",
      mode,
      checkedCount: 0,
      skippedCount: params.scenes.length,
      passCount: 0,
      failCount: 0,
      unsureCount: 0,
      failRate: 0,
      blockedAutoApprove: false,
      blockThreshold: softApprovalFailRateThreshold(),
      visionUsed: 0,
      textOnlyUsed: 0,
      scenes: [],
    };
    await writeJson(jobDataFile("royal-v2-soft-approval", jobId), report);
    return { scenes: params.scenes, report, gptCallsUsed: 0 };
  }

  type WorkItem = {
    scene: TimelineScene;
    intendedPerson: string;
    mediaUrl?: string;
    visionOk: boolean;
    labels: string;
  };

  const work: WorkItem[] = toCheck.map((scene) => {
    const visual = visualById.get(scene.approvedVisualId || scene.selectedVisualId || "");
    const media = pickMediaUrl(visual);
    const labels = [
      visual?.matchedPeople?.join(", "),
      visual?.bestUseCase,
      visual?.matchedScriptSubjects?.join(", "),
      scene.whyThisMatchesNarration,
      scene.mainPerson,
      (scene.pairOrGroup || []).join(" & "),
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 400);
    return {
      scene,
      intendedPerson: intendedPersonLabel(scene),
      mediaUrl: media.url,
      visionOk: media.visionOk,
      labels,
    };
  });

  const visionItems = work.filter((w) => w.visionOk && w.mediaUrl);
  const textItems = work.filter((w) => !w.visionOk || !w.mediaUrl);
  const batchSize = softApprovalBatchSize();
  const concurrency = softApprovalConcurrency();
  let gptCallsUsed = 0;
  let visionUsed = 0;
  let textOnlyUsed = 0;

  const judgments = new Map<string, SoftSceneApproval>();

  const visionBatches = chunk(
    visionItems.map((w) => ({
      scene: w.scene,
      intendedPerson: w.intendedPerson,
      mediaUrl: w.mediaUrl!,
      labels: w.labels,
    })),
    batchSize
  );
  const visionResults = await mapPool(visionBatches, concurrency, async (batch) => {
    gptCallsUsed += 1;
    visionUsed += batch.length;
    return judgeBatchVision(batch);
  });
  for (const map of visionResults) {
    for (const [id, result] of map) judgments.set(id, result);
  }

  // Any vision-marked unsure due to API failure can retry as text (one more chance, batched)
  const visionFailedIds = new Set(
    [...judgments.entries()]
      .filter(([, r]) => r.softApproval === "unsure" && /Vision API failed/i.test(r.reason))
      .map(([id]) => id)
  );
  const textRetry = work.filter(
    (w) => textItems.includes(w) || visionFailedIds.has(w.scene.sceneId)
  );
  const textBatches = chunk(
    textRetry.map((w) => ({
      scene: w.scene,
      intendedPerson: w.intendedPerson,
      labels: w.labels,
    })),
    batchSize
  );
  const textResults = await mapPool(textBatches, concurrency, async (batch) => {
    gptCallsUsed += 1;
    textOnlyUsed += batch.length;
    return judgeBatchText(batch);
  });
  for (const map of textResults) {
    for (const [id, result] of map) judgments.set(id, result);
  }

  const sceneMap = new Map(params.scenes.map((s) => [s.sceneId, s]));
  for (const item of work) {
    const result =
      judgments.get(item.scene.sceneId) ||
      ({
        softApproval: "unsure" as const,
        reason: "Soft approval missing result",
        intendedPerson: item.intendedPerson,
        detectedHint: "",
        mode: "skipped" as const,
      } satisfies SoftSceneApproval);
    sceneMap.set(item.scene.sceneId, applySoftApprovalToScene(item.scene, result));
  }

  const scenes = params.scenes.map((s) => sceneMap.get(s.sceneId) || s);
  const checkedRows = work.map((item) => {
    const result = judgments.get(item.scene.sceneId)!;
    return {
      sceneId: item.scene.sceneId,
      beatId: item.scene.beatId,
      beatType: item.scene.beatType,
      confidence: item.scene.confidence,
      mediaUrl: item.mediaUrl,
      softApproval: result.softApproval,
      reason: result.reason,
      intendedPerson: result.intendedPerson,
      detectedHint: result.detectedHint,
      mode: result.mode,
    };
  });

  const passCount = checkedRows.filter((r) => r.softApproval === "pass").length;
  const failCount = checkedRows.filter((r) => r.softApproval === "fail").length;
  const unsureCount = checkedRows.filter((r) => r.softApproval === "unsure").length;
  const checkedCount = checkedRows.length;
  const failRate = checkedCount ? failCount / checkedCount : 0;
  const blockThreshold = softApprovalFailRateThreshold();
  const blockedAutoApprove =
    softApprovalBlockEnabled() && checkedCount > 0 && failRate >= blockThreshold;

  const report: SoftApprovalReport = {
    jobId,
    createdAt: new Date().toISOString(),
    enabled: true,
    mode,
    checkedCount,
    skippedCount: skipped.length,
    passCount,
    failCount,
    unsureCount,
    failRate: Number(failRate.toFixed(3)),
    blockedAutoApprove,
    blockThreshold,
    visionUsed,
    textOnlyUsed,
    scenes: checkedRows,
  };

  await writeJson(jobDataFile("royal-v2-soft-approval", jobId), report);
  console.log(
    `[softApproval] ${jobId}: checked=${checkedCount} pass=${passCount} fail=${failCount} unsure=${unsureCount} vision=${visionUsed} text=${textOnlyUsed} block=${blockedAutoApprove}`
  );

  return { scenes, report, gptCallsUsed };
}

/** Soft-fail scenes are never auto-approved — managers see them in Scene Review. */
export function shouldHoldAutoApproveForSoftFail(
  scene: TimelineScene,
  _report: SoftApprovalReport
): boolean {
  return scene.softApproval === "fail";
}

/** When SOFT_APPROVAL_BLOCK=1 and fail rate is high, also hold unsure scenes. */
export function shouldHoldAutoApproveForSoftUnsure(
  scene: TimelineScene,
  report: SoftApprovalReport
): boolean {
  return report.blockedAutoApprove && scene.softApproval === "unsure";
}
