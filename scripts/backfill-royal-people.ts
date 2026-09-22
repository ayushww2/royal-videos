/**
 * Backfill people[] on classified Royal library assets (text + vision-only phases).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-royal-people.ts
 *   ROYAL_PEOPLE_PERSON="King Charles" npx tsx --env-file=.env scripts/backfill-royal-people.ts
 */
import { auditRoyalPeopleBackfill, backfillAllRoyalPeople, backfillRoyalPeoplePerson } from "../server/library/backfillRoyalPeople.js";
import { r2Configured } from "../server/library/r2.js";

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured — set R2_* in .env");
  const person = process.env.ROYAL_PEOPLE_PERSON?.trim();
  const force = process.env.ROYAL_PEOPLE_FORCE === "1";
  const workers = Math.max(0, Number(process.env.ROYAL_PEOPLE_WORKERS || 0));
  const auditOnly = process.env.ROYAL_PEOPLE_AUDIT === "1";

  if (auditOnly) {
    console.log(JSON.stringify(await auditRoyalPeopleBackfill(), null, 2));
    return;
  }

  if (person) {
    const result = await backfillRoyalPeoplePerson({ person, force, onProgress: console.log });
    console.log(JSON.stringify(result, null, 2));
    console.log(JSON.stringify(await auditRoyalPeopleBackfill(), null, 2));
    return;
  }

  const results = await backfillAllRoyalPeople({
    force,
    workers: workers || undefined,
    onProgress: console.log,
  });
  console.log(
    JSON.stringify(
      {
        people: results.length,
        textBackfilled: results.reduce((n, r) => n + r.textBackfilled, 0),
        visionBackfilled: results.reduce((n, r) => n + r.visionBackfilled, 0),
        visionFailed: results.reduce((n, r) => n + r.visionFailed, 0),
        primaryOnly: results.reduce((n, r) => n + r.primaryOnly, 0),
        skipped: results.reduce((n, r) => n + r.skipped, 0),
      },
      null,
      2
    )
  );
  console.log(JSON.stringify(await auditRoyalPeopleBackfill(), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
