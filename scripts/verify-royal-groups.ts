import { r2GetJson } from "../server/library/r2.js";

const n = await r2GetJson<{
  people: Array<{ person: string; group?: string; images: number; raw_footage: number }>;
}>("library/royal-family/index.json");

const groups: Record<string, Array<{ person: string; images: number; raw: number }>> = {};
for (const p of n?.people || []) {
  const g = p.group || "People";
  (groups[g] ||= []).push({ person: p.person, images: p.images, raw: p.raw_footage });
}
console.log(
  JSON.stringify(
    {
      totals: Object.fromEntries(
        Object.entries(groups).map(([g, arr]) => [
          g,
          { topics: arr.length, images: arr.reduce((s, x) => s + x.images, 0) },
        ])
      ),
      groups,
    },
    null,
    2
  )
);
