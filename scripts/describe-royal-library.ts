/**
 * AI vision-describe Royal Family media library stills.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/describe-royal-library.ts
 *   ROYAL_VISION_PERSON="King Charles" npx tsx --env-file=.env scripts/describe-royal-library.ts
 *   ROYAL_VISION_LIMIT=40 npx tsx --env-file=.env scripts/describe-royal-library.ts
 */
import {
  describeAllRoyalPeople,
  describeRoyalPerson,
  ROYAL_PEOPLE,
} from "../server/library/describeRoyal.js";
import { r2Configured } from "../server/library/r2.js";

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured — set R2_* in .env");
  const person = process.env.ROYAL_VISION_PERSON?.trim();
  const force = process.env.ROYAL_VISION_FORCE === "1";
  const limit = Math.max(0, Number(process.env.ROYAL_VISION_LIMIT || 0));

  if (person) {
    const result = await describeRoyalPerson({
      person,
      force,
      limit: limit || undefined,
      onProgress: console.log,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`[royal-vision] describing ${ROYAL_PEOPLE.length} people`);
  const results = await describeAllRoyalPeople({
    force,
    limitPerPerson: limit || undefined,
    onProgress: console.log,
  });
  console.log(
    JSON.stringify(
      {
        people: results.length,
        described: results.reduce((n, r) => n + r.described, 0),
        wrongPerson: results.reduce((n, r) => n + r.wrongPerson, 0),
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
