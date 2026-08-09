/**
 * Audit + rebuild missing image entries from R2 object keys, then merge niches.
 */
import { r2Configured, r2GetJson, r2ListPrefix, r2PutJson } from "../server/library/r2.js";
import type { LibraryAsset, PersonLibraryIndex } from "../server/library/types.js";

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured");
  const keys = await r2ListPrefix("library/");
  const indexes = keys.filter((k) => k.endsWith("/index.json"));
  const imageKeys = keys.filter((k) => /\/images\//.test(k) && !k.endsWith(".json"));
  const rawMp4 = keys.filter((k) => /\/raw\//.test(k) && k.endsWith(".mp4"));

  console.log(JSON.stringify({
    indexCount: indexes.length,
    indexes,
    imageFiles: imageKeys.length,
    rawMp4: rawMp4.length,
    imagesByPrefix: Object.fromEntries(
      ["royal-v1", "royal-family"].map((slug) => [
        slug,
        imageKeys.filter((k) => k.startsWith(`library/${slug}/`)).length,
      ])
    ),
    rawByPrefix: Object.fromEntries(
      ["royal-v1", "royal-family"].map((slug) => [
        slug,
        rawMp4.filter((k) => k.startsWith(`library/${slug}/`)).length,
      ])
    ),
  }, null, 2));

  // Sample a few person indexes for image counts
  for (const key of indexes.filter((k) => k.includes("/royal-v1/") || k.includes("/royal-family/"))) {
    if (key.endsWith("royal-v1/index.json") || key.endsWith("royal-family/index.json") || key === "library/index.json") continue;
    const idx = await r2GetJson<PersonLibraryIndex>(key);
    if (!idx) continue;
    const imgs = (idx.assets || []).filter((a) => a.mediaType === "image").length;
    const raw = (idx.assets || []).filter((a) => a.mediaType === "raw_footage").length;
    if (imgs || raw) console.log(`${key} images=${imgs} raw=${raw}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
