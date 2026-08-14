/**
 * Scan Royal Context Assets with ContactBox vision — remove unusable B-roll.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/scan-royal-context.ts
 *   ROYAL_CONTEXT_DRY_RUN=1 npx tsx --env-file=.env scripts/scan-royal-context.ts
 *   ROYAL_CONTEXT_CATEGORY_SLUG=ctx-documents-letters npx tsx --env-file=.env scripts/scan-royal-context.ts
 */
import { scanAllRoyalContextAssets, scanRoyalContextCategory } from "../server/library/scanRoyalContext.js";
import { r2Configured } from "../server/library/r2.js";

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured — set R2_* in .env");
  const dryRun = Boolean(process.env.ROYAL_CONTEXT_DRY_RUN);
  const category = process.env.ROYAL_CONTEXT_CATEGORY?.trim();
  const categorySlug = process.env.ROYAL_CONTEXT_CATEGORY_SLUG?.trim();

  if (category || categorySlug) {
    const result = await scanRoyalContextCategory({
      categoryName: category || undefined,
      categorySlug: categorySlug || undefined,
      dryRun,
      onProgress: console.log,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const results = await scanAllRoyalContextAssets({ dryRun, onProgress: console.log });
  console.log(
    JSON.stringify(
      {
        categories: results.length,
        examined: results.reduce((n, r) => n + r.examined, 0),
        kept: results.reduce((n, r) => n + r.kept, 0),
        removed: results.reduce((n, r) => n + r.removed, 0),
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
