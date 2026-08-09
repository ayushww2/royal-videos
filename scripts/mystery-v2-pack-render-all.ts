/**
 * Render every Mystery Documentary Pack v2 preset on Shotstack stage.
 *
 * npx tsx scripts/mystery-v2-pack-render-all.ts
 */
import path from "node:path";
import dotenv from "dotenv";
import { writeJson } from "../server/storage.js";
import { config } from "../server/config.js";
import { loadAllMysteryPackTemplates } from "../server/visualIntelligence/mysteryV2/packLoader.js";
import { renderAllMysteryPackPresets } from "../server/visualIntelligence/mysteryV2/packRender.js";

dotenv.config();

async function main() {
  if (!process.env.SHOTSTACK_API_KEY?.trim()) {
    throw new Error("SHOTSTACK_API_KEY missing");
  }

  const loaded = loadAllMysteryPackTemplates();
  console.log(`Loaded ${loaded.length} pack templates`);
  for (const { meta } of loaded) {
    console.log(` - ${meta.id} (${meta.kind}, ${meta.durationSec}s)`);
  }

  const saveDir = path.join(config.storagePath, "previews", "mystery-v2-pack");
  const results = await renderAllMysteryPackPresets({ saveDir });
  const summaryPath = path.join(saveDir, "render-summary.json");
  await writeJson(summaryPath, {
    renderedAt: new Date().toISOString(),
    endpoint: process.env.SHOTSTACK_API_URL || "https://api.shotstack.io/edit/stage/render",
    results,
  });

  const failed = results.filter((r) => r.status !== "done");
  console.log(`\nSummary → ${summaryPath}`);
  console.log(`OK: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    for (const f of failed) {
      console.error(`FAIL ${f.presetId}: ${f.error || f.status}`);
    }
    process.exit(1);
  }
  for (const r of results) {
    console.log(`${r.presetId}: ${r.url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
