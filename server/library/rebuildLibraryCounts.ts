import type {
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "./types.js";
import { countLibraryAssets } from "./types.js";
import { r2GetJson, r2PutJson } from "./r2.js";
import { loadNicheLibrary, loadPersonLibrary, loadRootLibrary } from "./collectImages.js";
import { clearRoyalLibraryCache } from "../visualIntelligence/royalV2/library.js";

function personIndexKey(nicheSlug: string, personSlug: string): string {
  return `library/${nicheSlug}/${personSlug}/index.json`;
}

function nicheIndexKey(nicheSlug: string): string {
  return `library/${nicheSlug}/index.json`;
}

function rootIndexKey(): string {
  return `library/index.json`;
}

export type NichePersonCounts = NicheLibraryIndex["people"][number];

/** Counts from the person index asset list (source of truth). Does not delete anything. */
export function nichePersonRowFromIndex(
  row: NichePersonCounts,
  personIndex: PersonLibraryIndex
): NichePersonCounts {
  const counts = countLibraryAssets(personIndex.assets);
  return {
    ...row,
    person: personIndex.person || row.person,
    personSlug: personIndex.personSlug || row.personSlug,
    group: row.group ?? personIndex.group,
    images: counts.images,
    raw_footage: counts.raw_footage,
    trusted_clips: counts.trusted_clips,
    raw_clips: counts.raw_clips,
  };
}

export async function liveNichePeopleCounts(niche: NicheLibraryIndex): Promise<NicheLibraryIndex["people"]> {
  const out: NicheLibraryIndex["people"] = [];
  for (const row of niche.people) {
    const idx = await loadPersonLibrary(niche.nicheSlug, row.personSlug);
    if (!idx?.assets) {
      out.push(row);
      continue;
    }
    out.push(nichePersonRowFromIndex(row, idx));
  }
  return out.sort((a, b) => a.person.localeCompare(b.person));
}

export function aggregateNicheTotals(people: NicheLibraryIndex["people"]) {
  return {
    peopleCount: people.length,
    images: people.reduce((n, p) => n + (p.images || 0), 0),
    raw_footage: people.reduce((n, p) => n + (p.raw_footage || 0), 0),
    trusted_clips: people.reduce((n, p) => n + (p.trusted_clips || 0), 0),
    raw_clips: people.reduce(
      (n, p) => n + (p.raw_clips ?? (p.raw_footage || 0) + (p.trusted_clips || 0)),
      0
    ),
  };
}

/** Refresh niche + root index JSON from person indexes (no asset deletes). */
export async function rebuildNicheLibraryCounts(nicheSlug: string): Promise<NicheLibraryIndex> {
  const niche = await loadNicheLibrary(nicheSlug);
  if (!niche) throw new Error(`Niche not found: ${nicheSlug}`);

  const people = await liveNichePeopleCounts(niche);

  for (const row of people) {
    const idx = await loadPersonLibrary(nicheSlug, row.personSlug);
    if (!idx) continue;
    const counts = countLibraryAssets(idx.assets);
    const fixed: PersonLibraryIndex = {
      ...idx,
      counts,
      updatedAt: new Date().toISOString(),
    };
    await r2PutJson(personIndexKey(nicheSlug, row.personSlug), fixed);
  }

  const nicheOut: NicheLibraryIndex = {
    ...niche,
    updatedAt: new Date().toISOString(),
    people,
  };
  await r2PutJson(nicheIndexKey(nicheSlug), nicheOut);

  const root = await loadRootLibrary();
  const totals = aggregateNicheTotals(people);
  const nicheMap = new Map(root.niches.map((n) => [n.nicheSlug, n]));
  nicheMap.set(nicheSlug, {
    niche: niche.niche,
    nicheSlug,
    ...totals,
  });
  const rootOut: RootLibraryIndex = {
    updatedAt: new Date().toISOString(),
    niches: [...nicheMap.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  };
  await r2PutJson(rootIndexKey(), rootOut);
  clearRoyalLibraryCache();

  return nicheOut;
}

export async function liveRootNicheSummaries(root: RootLibraryIndex): Promise<RootLibraryIndex["niches"]> {
  const niches = await Promise.all(
    root.niches.map(async (summary) => {
      const niche = await loadNicheLibrary(summary.nicheSlug);
      if (!niche) return summary;
      const people = await liveNichePeopleCounts(niche);
      return { ...summary, ...aggregateNicheTotals(people), niche: niche.niche };
    })
  );
  return niches.sort((a, b) => a.niche.localeCompare(b.niche));
}
