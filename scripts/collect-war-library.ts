/**
 * Collect War v1 image library via Google Images (SearchAPI).
 *
 * Budget: 100 topics × 10 queries = 1000 searches
 * Target: ~7–8k images (up to 8 kept per query) with fast title/tag descriptions
 *
 * Usage:
 *   npx tsx --env-file=.env --env-file=.env.library scripts/collect-war-library.ts
 *   WAR_CONCURRENCY=12 WAR_PER_QUERY=8 npx tsx --env-file=.env --env-file=.env.library scripts/collect-war-library.ts
 *   WAR_LIMIT_TOPICS=2 npx tsx ...   # smoke test first 2 topics
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  WAR_TOPICS,
  collectWarTopic,
  listWarQueryCatalog,
  rebuildWarNicheIndex,
  warBudget,
} from "../server/library/collectWar.js";
import { ROOT_DIR } from "../server/config.js";
import { r2Configured } from "../server/library/r2.js";

if (!r2Configured()) {
  console.error("R2 is not configured (need R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT)");
  process.exit(1);
}

const budget = warBudget();
const CONCURRENCY = Math.max(1, Number(process.env.WAR_CONCURRENCY || 20));
const PER_QUERY = Math.max(1, Math.min(24, Number(process.env.WAR_PER_QUERY || 16)));
const LIMIT = Math.max(0, Number(process.env.WAR_LIMIT_TOPICS || 0));
const DUMP_ONLY = process.env.WAR_DUMP_QUERIES === "1";

const topics = LIMIT > 0 ? WAR_TOPICS.slice(0, LIMIT) : [...WAR_TOPICS];

const catalogPath = path.join(ROOT_DIR, "storage", "war-query-catalog.json");
fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
fs.writeFileSync(
  catalogPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      budget,
      topics: listWarQueryCatalog(),
    },
    null,
    2
  )
);
console.log(`[war] wrote query catalog → ${catalogPath}`);
console.log(
  `[war] topics=${budget.topics} searches=${budget.searches} unique≈${budget.uniqueQueries} perQueryKeep=${PER_QUERY} concurrency=${CONCURRENCY}`
);

if (DUMP_ONLY) {
  console.log("[war] WAR_DUMP_QUERIES=1 — exiting without collection");
  process.exit(0);
}

const queue = [...topics];
const results: Array<{ group: string; topic: string; images: number; error?: string }> = [];

async function worker(id: number): Promise<void> {
  while (queue.length) {
    const topic = queue.shift();
    if (!topic) return;
    console.log(`[w${id}] start ${topic.group} / ${topic.topic}`);
    try {
      const idx = await collectWarTopic({
        topic,
        perQueryKeep: PER_QUERY,
        onProgress: (m) => console.log(`[w${id}] ${m}`),
      });
      results.push({ group: topic.group, topic: topic.topic, images: idx.counts.images });
      console.log(`[w${id}] done ${topic.topic}: ${idx.counts.images}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[w${id}] fail ${topic.topic}`, msg);
      results.push({ group: topic.group, topic: topic.topic, images: 0, error: msg });
    }
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
await rebuildWarNicheIndex();
const elapsedMin = ((Date.now() - started) / 60000).toFixed(1);
const totalImages = results.reduce((n, r) => n + r.images, 0);

const summary = {
  ok: true,
  elapsedMin,
  budget,
  perQueryKeep: PER_QUERY,
  concurrency: CONCURRENCY,
  topicsAttempted: results.length,
  totalImages,
  byGroup: Object.fromEntries(
    [...new Set(results.map((r) => r.group))].map((g) => [
      g,
      {
        topics: results.filter((r) => r.group === g).length,
        images: results.filter((r) => r.group === g).reduce((n, r) => n + r.images, 0),
        errors: results.filter((r) => r.group === g && r.error).length,
      },
    ])
  ),
  results: results.sort((a, b) => a.group.localeCompare(b.group) || a.topic.localeCompare(b.topic)),
};

const summaryPath = path.join(ROOT_DIR, "storage", "war-collect-summary.json");
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`[war] summary → ${summaryPath}`);
