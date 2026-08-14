/**
 * Collect Royal Context Assets (max 200 SearchAPI queries, ContactBox vision gate).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/collect-royal-context.ts
 *   ROYAL_CONTEXT_CATEGORY="Documents & Letters" npx tsx --env-file=.env scripts/collect-royal-context.ts
 */
import {
  collectAllRoyalContextAssets,
  collectRoyalContextCategory,
} from "../server/library/collectRoyalContext.js";
import { assertRoyalContextSearchBudget } from "../server/library/royalContextQueries.js";
import { r2Configured } from "../server/library/r2.js";

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured — set R2_* in .env");
  const budget = assertRoyalContextSearchBudget();
  console.log(`[royal-context] search budget: ${budget.total} queries`, budget.byCategory);

  const category = process.env.ROYAL_CONTEXT_CATEGORY?.trim();
  const categorySlug = process.env.ROYAL_CONTEXT_CATEGORY_SLUG?.trim();

  if (category || categorySlug) {
    const result = await collectRoyalContextCategory({
      categoryName: category || undefined,
      categorySlug: categorySlug || undefined,
      onProgress: console.log,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const results = await collectAllRoyalContextAssets({ onProgress: console.log });
  console.log(
    JSON.stringify(
      {
        categories: results.length,
        saved: results.reduce((n, r) => n + r.saved, 0),
        visionRejected: results.reduce((n, r) => n + r.visionRejected, 0),
        searchesRun: results.reduce((n, r) => n + r.searchesRun, 0),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
