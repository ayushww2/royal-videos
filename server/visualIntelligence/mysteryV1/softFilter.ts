import { jobDataFile, writeJson } from "../../storage.js";
import type { VisualCandidate } from "../../../shared/visualIntelligence.js";
import { isAllowedHorizontalAspect } from "../aspectPolicy.js";
import { assessContentSafety } from "../contentSafety.js";

/** Soft Mystery v1 filter: reject watermark/text + non 16:9/4:3 horizontal. */

const WATERMARK_HOSTS = [
  "gettyimages",
  "alamy",
  "shutterstock",
  "istockphoto",
  "istock",
  "dreamstime",
  "depositphotos",
  "adobestock",
  "stock.adobe",
];

const WATERMARK_KEYWORDS = [
  "watermark",
  "getty",
  "alamy",
  "shutterstock",
  "istock",
  "dreamstime",
  "adobe stock",
  "depositphotos",
  "preview only",
];

const ALTERED_TEXT_HINTS = [
  "youtube thumbnail",
  "maxresdefault",
  "hqdefault",
  "subscribe",
  "clickbait",
  "meme",
  "shocking update",
  "before you watch",
  "top 10",
  "unbelievable",
  "mystery solved",
  "exposed!",
  "what they found",
  "left them speechless",
];

function isYoutubeCdnThumbnail(url: string): boolean {
  return (
    url.includes("ytimg.com") ||
    url.includes("i.ytimg.com") ||
    url.includes("maxresdefault") ||
    url.includes("hqdefault") ||
    url.includes("mqdefault") ||
    url.includes("sddefault")
  );
}

export interface MysteryFilterResult {
  kept: VisualCandidate[];
  rejected: VisualCandidate[];
  rejectedWatermark: number;
  rejectedAlteredText: number;
  rejectedBroken: number;
  rejectedAspect: number;
  rejectedOther: number;
}

export async function mysterySoftFilter(
  jobId: string,
  candidates: VisualCandidate[]
): Promise<MysteryFilterResult> {
  const kept: VisualCandidate[] = [];
  const rejected: VisualCandidate[] = [];
  const seen = new Set<string>();
  let rejectedWatermark = 0;
  let rejectedAlteredText = 0;
  let rejectedBroken = 0;
  let rejectedAspect = 0;
  let rejectedOther = 0;

  for (const c of candidates) {
    const reasons: string[] = [];
    let cat: "watermark" | "altered" | "broken" | "aspect" | "other" | null = null;
    const url = (c.urlOrPath || "").toLowerCase();
    const title = (c.title || "").toLowerCase();
    const page = (c.sourcePageUrl || "").toLowerCase();
    const hay = `${url} ${title} ${page}`;

    if (!c.urlOrPath) {
      reasons.push("broken URL/file");
      cat = "broken";
    }
    const dedupeKey =
      c.source === "raw_footage" || c.source === "user_youtube_raw"
        ? `raw:${c.candidateId}`
        : url;
    if (url && seen.has(dedupeKey)) {
      reasons.push("duplicate");
      if (!cat) cat = "other";
    }

    if (WATERMARK_HOSTS.some((h) => url.includes(h) || page.includes(h))) {
      reasons.push("visible stock watermark source");
      cat = "watermark";
    } else if (WATERMARK_KEYWORDS.some((k) => hay.includes(k))) {
      reasons.push("watermark keyword");
      cat = "watermark";
    }

    if (c.source !== "user_youtube_raw" && isYoutubeCdnThumbnail(url)) {
      reasons.push("YouTube CDN thumbnail with baked-in design risk");
      if (cat !== "watermark") cat = "altered";
    }

    if (ALTERED_TEXT_HINTS.some((k) => title.includes(k))) {
      reasons.push("big altered/baked-in text risk from title");
      if (cat !== "watermark") cat = "altered";
    }

    const safety = assessContentSafety({
      title: c.title,
      url: c.urlOrPath,
      pageUrl: c.sourcePageUrl,
      query: c.queryUsed,
    });
    if (safety.unsafe) {
      reasons.push(...safety.reasons.map((r) => `content_safety: ${r}`));
      if (!cat) cat = "other";
    }

    let isTextHeavy = Boolean(c.isTextHeavy);
    const textHeavyHints = [
      "figure ",
      "fig.",
      "supplementary",
      "schematic diagram",
      "flowchart",
      "infographic",
      "multi-panel",
      "graph of",
      "plot of",
      "table of contents",
    ];
    if (textHeavyHints.some((k) => title.includes(k) || hay.includes(k))) {
      isTextHeavy = true;
    }

    const aspect = isAllowedHorizontalAspect(c.dimensions);
    const isLocalSource =
      c.source === "raw_footage" ||
      c.source === "user_youtube_raw" ||
      c.source === "uploaded_asset";
    if (!aspect.ok) {
      // Local uploads may lack probed dimensions; web images must be 16:9 or 4:3.
      if (!(isLocalSource && aspect.reason?.includes("missing dimensions"))) {
        reasons.push(aspect.reason || "aspect not horizontal 16:9 or 4:3");
        if (!cat) cat = "aspect";
      }
    } else if (c.dimensions) {
      const { width, height } = c.dimensions;
      if (width < 320 || height < 240) {
        reasons.push("extremely low resolution");
        if (!cat) cat = "other";
      }
    }

    if (reasons.length) {
      if (cat === "watermark") rejectedWatermark += 1;
      else if (cat === "altered") rejectedAlteredText += 1;
      else if (cat === "broken") rejectedBroken += 1;
      else if (cat === "aspect") rejectedAspect += 1;
      else rejectedOther += 1;
      rejected.push({ ...c, rejected: true, rejectReason: [...new Set(reasons)].join("; ") });
      continue;
    }

    if (url) seen.add(dedupeKey);
    kept.push({ ...c, isTextHeavy });
  }

  const result: MysteryFilterResult = {
    kept,
    rejected,
    rejectedWatermark,
    rejectedAlteredText,
    rejectedBroken,
    rejectedAspect,
    rejectedOther,
  };

  await writeJson(jobDataFile("mystery-v1-filtered-candidates", jobId), {
    jobId,
    mode: "soft_clean_image_filter",
    policy:
      "Reject watermark/big altered text. Keep only horizontal 16:9 or 4:3 images for GPT judging.",
    aspectPolicy: "horizontal_16x9_or_4x3",
    ...result,
    keptCount: kept.length,
    rejectedCount: rejected.length,
  });

  await writeJson(jobDataFile("visual-intelligence-filtered-candidates", jobId), {
    jobId,
    keptCount: kept.length,
    rejectedCount: rejected.length,
    kept,
    rejected,
    mystery: {
      rejectedWatermark,
      rejectedAlteredText,
      rejectedBroken,
      rejectedAspect,
      rejectedOther,
    },
  });

  return result;
}
