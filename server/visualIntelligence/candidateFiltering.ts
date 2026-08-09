import { jobDataFile, writeJson } from "../storage.js";
import type { VisualCandidate } from "../../shared/visualIntelligence.js";
import { isAllowedHorizontalAspect } from "./aspectPolicy.js";
import { isRawFootageSource } from "../rawFootage/youtubeRawCandidates.js";
import { assessContentSafety } from "./contentSafety.js";

const BAD_HOST_HINTS = [
  "gettyimages",
  "alamy",
  "shutterstock",
  "istockphoto",
  "dreamstime",
  "depositphotos",
];

const BAD_TITLE_HINTS = [
  "youtube thumbnail",
  "meme",
  "clickbait",
  "stock photo of random",
];

export async function filterCandidates(
  jobId: string,
  candidates: VisualCandidate[]
): Promise<{ kept: VisualCandidate[]; rejected: VisualCandidate[] }> {
  const kept: VisualCandidate[] = [];
  const rejected: VisualCandidate[] = [];
  const seenUrls = new Set<string>();

  for (const c of candidates) {
    const reasons: string[] = [];
    const url = (c.urlOrPath || "").toLowerCase();
    const title = (c.title || "").toLowerCase();
    const page = (c.sourcePageUrl || "").toLowerCase();

    if (!c.urlOrPath) reasons.push("broken URL/file");
    // Raw chunks share a source file path — dedupe by candidateId, not path
    const dedupeKey = isRawFootageSource(c.source) ? `raw:${c.candidateId}` : url;
    if (seenUrls.has(dedupeKey)) reasons.push("duplicate");
    if (BAD_HOST_HINTS.some((h) => url.includes(h) || page.includes(h))) {
      reasons.push("Getty/Alamy/Shutterstock watermark risk");
    }
    // Reject YouTube *thumbnails*, not cloud-ingested user YouTube raw clips
    if (!isRawFootageSource(c.source) && (url.includes("ytimg.com") || title.includes("youtube"))) {
      reasons.push("YouTube thumbnail");
    }
    if (BAD_TITLE_HINTS.some((h) => title.includes(h))) {
      reasons.push("meme/clickbait graphic");
    }

    const safety = assessContentSafety({
      title: c.title,
      url: c.urlOrPath,
      pageUrl: c.sourcePageUrl,
      query: c.queryUsed,
    });
    if (safety.unsafe) {
      reasons.push(...safety.reasons.map((r) => `content_safety: ${r}`));
    }

    const aspect = isAllowedHorizontalAspect(c.dimensions);
    const isLocalSource =
      isRawFootageSource(c.source) || c.source === "uploaded_asset";
    if (!aspect.ok) {
      if (!(isLocalSource && aspect.reason?.includes("missing dimensions"))) {
        reasons.push(aspect.reason || "aspect not horizontal 16:9 or 4:3");
      }
    } else if (c.dimensions) {
      const { width, height } = c.dimensions;
      if (width < 400 || height < 300) reasons.push("too small");
    }

    if (reasons.length) {
      rejected.push({ ...c, rejected: true, rejectReason: reasons.join("; ") });
      continue;
    }
    seenUrls.add(dedupeKey);
    kept.push(c);
  }

  await writeJson(jobDataFile("visual-intelligence-filtered-candidates", jobId), {
    jobId,
    aspectPolicy: "horizontal_16x9_or_4x3",
    keptCount: kept.length,
    rejectedCount: rejected.length,
    kept,
    rejected,
  });

  return { kept, rejected };
}
