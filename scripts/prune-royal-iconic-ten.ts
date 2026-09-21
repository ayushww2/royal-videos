/**
 * Vision prune for 10 high-profile royals: max 5 solo portraits each; keep iconic group/action shots.
 *
 *   npx tsx scripts/prune-royal-iconic-ten.ts --dry-run
 *   npx tsx scripts/prune-royal-iconic-ten.ts --execute
 */
import dotenv from "dotenv";
import path from "node:path";
import { ROOT_DIR } from "../server/config.js";
import {
  ROYAL_ICONIC_PRUNE_TEN,
  runRoyalSolePortraitPrune,
} from "../server/library/pruneSolePortraits.js";
import { r2Configured } from "../server/library/r2.js";

dotenv.config();
dotenv.config({ path: path.join(ROOT_DIR, "contactbox.env"), override: false });
dotenv.config({ path: path.join(ROOT_DIR, ".env.library"), override: false });

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured");
  const execute = process.argv.includes("--execute") && !process.argv.includes("--dry-run");
  console.log(
    `[prune-iconic-ten] mode=${execute ? "EXECUTE" : "DRY-RUN"} people=${ROYAL_ICONIC_PRUNE_TEN.length} maxSolo=5`
  );
  const summary = await runRoyalSolePortraitPrune({
    execute,
    minImages: 0,
    personSlugs: [...ROYAL_ICONIC_PRUNE_TEN],
    maxSoloPortraits: 5,
  });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
