/**
 * Vision prune for Royal Family still libraries (400+ images by default).
 *
 *   npx tsx scripts/prune-royal-sole-portraits.ts --dry-run
 *   npx tsx scripts/prune-royal-sole-portraits.ts --execute
 */
import dotenv from "dotenv";
import path from "node:path";
import { ROOT_DIR } from "../server/config.js";
import { runRoyalSolePortraitPrune } from "../server/library/pruneSolePortraits.js";
import { r2Configured } from "../server/library/r2.js";

dotenv.config();
dotenv.config({ path: path.join(ROOT_DIR, ".env.library"), override: false });

function parseArgs() {
  const argv = process.argv.slice(2);
  const execute = argv.includes("--execute") && !argv.includes("--dry-run");
  const minImages = Number(
    argv.find((a) => a.startsWith("--min-images="))?.split("=")[1] ||
      (argv.includes("--min-images") ? argv[argv.indexOf("--min-images") + 1] : "400")
  );
  const personSlug =
    argv.find((a) => a.startsWith("--person="))?.split("=")[1] ||
    (argv.includes("--person") ? argv[argv.indexOf("--person") + 1] : "");
  const limit = Number(
    argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ||
      (argv.includes("--limit") ? argv[argv.indexOf("--limit") + 1] : "0")
  );
  return {
    execute,
    minImages: Number.isFinite(minImages) ? minImages : 400,
    personSlug: personSlug?.trim() || undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  };
}

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured");
  const args = parseArgs();
  console.log(`[prune] mode=${args.execute ? "EXECUTE" : "DRY-RUN"} minImages=${args.minImages}`);
  const summary = await runRoyalSolePortraitPrune(args);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
