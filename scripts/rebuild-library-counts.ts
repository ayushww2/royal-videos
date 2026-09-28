/**
 * Re-sync niche + root index counts from person index asset lists (no deletes).
 *
 *   npx tsx scripts/rebuild-library-counts.ts royal-family
 */
import dotenv from "dotenv";
import path from "node:path";
import { ROOT_DIR } from "../server/config.js";
import { r2Configured } from "../server/library/r2.js";
import { rebuildNicheLibraryCounts } from "../server/library/rebuildLibraryCounts.js";

dotenv.config();
dotenv.config({ path: path.join(ROOT_DIR, "contactbox.env"), override: false });
dotenv.config({ path: path.join(ROOT_DIR, ".env.library"), override: false });

async function main() {
  const nicheSlug = process.argv[2]?.trim() || "royal-family";
  if (!r2Configured()) throw new Error("R2 not configured");
  const out = await rebuildNicheLibraryCounts(nicheSlug);
  console.log(`[rebuild-counts] ${nicheSlug}: ${out.people.length} people updated`);
  for (const p of out.people.slice(0, 5)) {
    console.log(
      `  ${p.personSlug}: ${p.images} images, ${p.raw_clips ?? 0} raw clips (raw=${p.raw_footage} trusted=${p.trusted_clips})`
    );
  }
  if (out.people.length > 5) console.log(`  ... and ${out.people.length - 5} more`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
