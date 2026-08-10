/**
 * Additive Google Images collect for all royal people (SearchAPI → R2).
 * Never deletes existing images. target = current + addCount (default +400).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/collect-royal-people.ts
 *   ROYAL_ADD_COUNT=350 ROYAL_COLLECT_PERSON="Prince Edward" npx tsx --env-file=.env scripts/collect-royal-people.ts
 */
import { collectPersonImages } from "../server/library/collectImages.js";
import { loadPersonLibrary } from "../server/library/collectImages.js";
import { r2Configured } from "../server/library/r2.js";
import { ROYAL_PEOPLE } from "../server/library/describeRoyal.js";
import { slugify } from "../server/library/types.js";

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured — set R2_* in .env");
  const addCount = Math.max(50, Math.min(600, Number(process.env.ROYAL_ADD_COUNT || 400)));
  const only = process.env.ROYAL_COLLECT_PERSON?.trim();
  const people = only ? [only] : [...ROYAL_PEOPLE];

  for (const person of people) {
    const existing = await loadPersonLibrary("royal-family", slugify(person));
    const cur = existing?.counts?.images || 0;
    const targetCount = Math.min(800, Math.max(cur + addCount, cur + 300));
    console.log(`=== ${person}: ${cur} -> target ${targetCount} (+${targetCount - cur}) ===`);
    const idx = await collectPersonImages({
      niche: "Royal Family",
      person,
      targetCount,
      onProgress: console.log,
    });
    console.log(`DONE ${person}: images=${idx.counts.images}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
