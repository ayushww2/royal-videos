/**
 * Generate one royal press-style still.
 * Usage:
 *   npx tsx scripts/generate-royal-footage-still.ts
 *   npx tsx scripts/generate-royal-footage-still.ts --person "Prince William" --place "Windsor Castle"
 */
import fs from "node:fs/promises";
import {
  generateRoyalFootageStill,
  royalFootageRecipe,
  royalFootageReportPath,
} from "../server/visualIntelligence/royalV2/footageStills.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

const recipe = royalFootageRecipe();
console.log(
  `model=${recipe.modelId} aspect=${recipe.aspectRatio} resolution=${recipe.resolution} quality=${recipe.quality}`
);

const result = await generateRoyalFootageStill({
  person: arg("person"),
  place: arg("place"),
  action: arg("action"),
  prompt: arg("prompt"),
});

const report = {
  ...result,
  image: {
    ...result.image,
  },
  createdAt: new Date().toISOString(),
};
await fs.writeFile(royalFootageReportPath(result.image.outputPath), JSON.stringify(report, null, 2));

console.log(`generation=${result.image.generationId}`);
console.log(`file=${result.image.outputPath}`);
console.log(`preview=${result.image.previewUrl}`);
console.log(`mime=${result.image.contentMimeType}`);
console.log(`prompt=${result.prompt}`);
