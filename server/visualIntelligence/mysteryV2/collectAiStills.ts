/**
 * Generate Mystery realism stills for AI-planned subjects and upload to R2.
 */
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { r2Configured, r2PutObject, mediaLibraryPublicBase } from "../../library/r2.js";
import { generateMysteryRealismStill } from "./realismGenerate.js";
import { jobDataFile, writeJson } from "../../storage.js";
import type { JobRecord, VisualCandidate } from "../../../shared/visualIntelligence.js";
import type { MysteryAiStillPlan } from "./visualPlan.js";

function publicUrlForKey(key: string): string {
  const base = (mediaLibraryPublicBase() || "https://pub-0ae6bea3eabc4a8db3932d8674ab8c01.r2.dev").replace(
    /\/$/,
    ""
  );
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function collectMysteryAiStills(params: {
  job: JobRecord;
  aiStills: MysteryAiStillPlan[];
  /** Cost cap — raised for 10–12 unique/min on long Mystery v2 films. */
  maxGenerate?: number;
}): Promise<VisualCandidate[]> {
  const maxGenerate = Math.min(60, params.maxGenerate ?? params.aiStills.length);
  const items = [...params.aiStills]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxGenerate);
  const out: VisualCandidate[] = [];
  const report: Array<Record<string, unknown>> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const gen = await generateMysteryRealismStill({
        jobId: params.job.jobId,
        title: params.job.title,
        visualIdea: `${item.subject}: ${item.visualIdea}`,
        intendedUse: item.whyAiNotGoogle,
        preferredStyle: "mystery documentary realism",
        aspectRatio: "16:9",
        realismLevel: "very realistic",
        generateImage: true,
        filename: `mystery-v2-${params.job.jobId.slice(0, 8)}-${item.stillId}.png`,
      });
      if (!gen.image?.outputPath) {
        report.push({ stillId: item.stillId, ok: false, error: "no image path" });
        continue;
      }
      const buf = await fs.readFile(gen.image.outputPath);
      let urlOrPath = gen.image.outputPath;
      if (r2Configured()) {
        const key = `jobs/${params.job.jobId}/ai-stills/${item.stillId}-${crypto
          .createHash("sha1")
          .update(buf)
          .digest("hex")
          .slice(0, 10)}.png`;
        await r2PutObject({ key, body: buf, contentType: "image/png" });
        urlOrPath = publicUrlForKey(key);
      }
      out.push({
        candidateId: `ai-${item.stillId}`,
        source: "uploaded_asset",
        urlOrPath,
        title: `AI realism: ${item.subject}`,
        snippet: `mystery_v2_ai: ${item.whyAiNotGoogle}`,
        detectedVisualType: "image",
        relatedEntities: [item.subject, "ai_realism"],
        relatedBeatIds: item.relatedBeatIds,
        metadata: { mysteryAi: true, subject: item.subject },
      });
      report.push({ stillId: item.stillId, ok: true, urlOrPath, subject: item.subject });
      console.log(
        `[mysteryV2/ai] ${i + 1}/${items.length} ${item.stillId} → ${urlOrPath.slice(0, 80)}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.push({ stillId: item.stillId, ok: false, error: message });
      console.warn(`[mysteryV2/ai] failed ${item.stillId}: ${message}`);
    }
  }

  await writeJson(jobDataFile("mystery-v2-ai-stills", params.job.jobId), {
    jobId: params.job.jobId,
    requested: items.length,
    generated: out.length,
    report,
    createdAt: new Date().toISOString(),
  });
  return out;
}
