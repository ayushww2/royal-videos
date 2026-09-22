/**
 * ContactBox vision classification for Royal Family media library (images + raw clips).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/classify-royal-library.ts
 *   ROYAL_CLASSIFY_PERSON="King Charles" npx tsx --env-file=.env scripts/classify-royal-library.ts
 *   ROYAL_CLASSIFY_LIMIT=40 npx tsx --env-file=.env scripts/classify-royal-library.ts
 */
import {
  classifyAllRoyalPeople,
  classifyRoyalPerson,
} from "../server/library/classifyRoyal.js";
import { ROYAL_PEOPLE } from "../server/library/describeRoyal.js";
import { r2Configured } from "../server/library/r2.js";

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured — set R2_* in .env");
  const person = process.env.ROYAL_CLASSIFY_PERSON?.trim();
  const force = process.env.ROYAL_CLASSIFY_FORCE === "1";
  const limit = Math.max(0, Number(process.env.ROYAL_CLASSIFY_LIMIT || 0));
  const workers = Math.max(0, Number(process.env.ROYAL_CLASSIFY_WORKERS || 0));
  const batchConcurrency = Math.max(0, Number(process.env.ROYAL_CLASSIFY_BATCH_CONCURRENCY || 0));

  if (person) {
    const result = await classifyRoyalPerson({
      person,
      force,
      limit: limit || undefined,
      batchConcurrency: batchConcurrency || undefined,
      onProgress: console.log,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`[royal-classify] classifying ${ROYAL_PEOPLE.length} people (images + raw clips)`);
  const results = await classifyAllRoyalPeople({
    force,
    limitPerPerson: limit || undefined,
    workers: workers || undefined,
    batchConcurrency: batchConcurrency || undefined,
    onProgress: console.log,
  });
  console.log(
    JSON.stringify(
      {
        people: results.length,
        classified: results.reduce((n, r) => n + r.classified, 0),
        skipped: results.reduce((n, r) => n + r.skipped, 0),
        failed: results.reduce((n, r) => n + r.failed, 0),
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
