import crypto from "node:crypto";
import { getSearchApiKey } from "../config.js";
import { r2GetJson, r2ListPrefix, r2PutJson, r2PutObject } from "./r2.js";
import type {
  LibraryAsset,
  LibraryCategory,
  NicheLibraryIndex,
  PersonLibraryIndex,
  RootLibraryIndex,
} from "./types.js";
import { countLibraryAssets, slugify } from "./types.js";

const BAD_HOSTS = [
  "gettyimages",
  "alamy",
  "shutterstock",
  "istockphoto",
  "dreamstime",
  "depositphotos",
  "123rf",
  "adobe.stock",
  "ytimg.com",
  "fbsbx",
  "lookaside",
];

const BAD_TITLE = [
  "meme",
  "thumbnail",
  "clickbait",
  "watermark",
  "stock photo",
  "vector",
  "cartoon",
  "ai generated",
];

interface GoogleImageItem {
  title?: string;
  original?: { link?: string; width?: number; height?: number };
  thumbnail?: string;
  source?: { name?: string; link?: string };
}

function personSearchNames(person: string): string[] {
  const p = person.toLowerCase();
  // Diana's Spencer family — must run before King Charles / Sarah Ferguson / Diana generics
  if (p.includes("frances") || p.includes("shand") || (p.includes("kydd") && !p.includes("parker")))
    return [
      "Frances Shand Kydd",
      "Frances Ruth Roche",
      "Diana mother Frances Shand Kydd",
      "Princess Diana mother Frances",
    ];
  if (p.includes("mccorquodale") || (p.includes("sarah") && p.includes("lady") && !p.includes("ferguson")))
    return [
      "Lady Sarah McCorquodale",
      "Sarah McCorquodale",
      "Diana sister Sarah Spencer",
      "Lady Sarah Spencer McCorquodale",
    ];
  if (p.includes("fellowes") || (p.includes("jane") && p.includes("lady")))
    return [
      "Lady Jane Fellowes",
      "Jane Fellowes",
      "Diana sister Jane Spencer",
      "Lady Jane Spencer Fellowes",
    ];
  if (
    (p.includes("spencer") && (p.includes("charles") || p.includes("earl"))) ||
    p === "charles spencer" ||
    p.includes("earl spencer")
  )
    return [
      "Charles Spencer",
      "Earl Spencer",
      "Charles Spencer 9th Earl Spencer",
      "Diana brother Charles Spencer",
    ];

  if (p.includes("harry")) return ["Prince Harry", "Harry Duke of Sussex", "Prince Harry Sussex"];
  if (p.includes("catherine") || p.includes("kate"))
    return ["Princess Catherine", "Catherine Princess of Wales", "Kate Middleton"];
  if (p.includes("camilla")) return ["Queen Camilla", "Camilla Queen Consort", "Camilla Parker Bowles"];
  if (p.includes("anne") && !p.includes("timothy")) return ["Princess Anne", "Anne Princess Royal", "Princess Royal Anne"];
  if (p.includes("william") && !p.includes("george")) return ["Prince William", "William Prince of Wales", "Duke of Cambridge William"];
  if (p.includes("meghan")) return ["Meghan Markle", "Meghan Duchess of Sussex", "Meghan Sussex"];
  if (p.includes("charles") && !p.includes("parker") && !p.includes("charlotte") && !p.includes("spencer"))
    return ["King Charles III", "King Charles", "Charles III"];
  if (p.includes("george")) return ["Prince George", "Prince George of Wales", "George Cambridge"];
  if (p.includes("charlotte")) return ["Princess Charlotte", "Princess Charlotte of Wales", "Charlotte Cambridge"];
  if (p.includes("louis")) return ["Prince Louis", "Prince Louis of Wales", "Louis Cambridge"];
  if (p.includes("andrew")) return ["Prince Andrew", "Andrew Duke of York", "Prince Andrew York"];
  if (p.includes("eugenie") || p.includes("eugine")) return ["Princess Eugenie", "Eugenie of York", "Princess Eugenie Jack Brooksbank"];
  if (p.includes("beatrice")) return ["Princess Beatrice", "Beatrice of York", "Princess Beatrice Edoardo Mapelli"];
  if (p.includes("zara")) return ["Zara Tindall", "Zara Phillips", "Zara Tindall royal"];
  if (p.includes("sophie")) return ["Sophie Duchess of Edinburgh", "Sophie Countess of Wessex", "Sophie Rhys-Jones"];
  if (p.includes("edward") && !p.includes("andrew")) return ["Prince Edward", "Edward Duke of Edinburgh", "Earl of Wessex Edward"];
  if (p.includes("ferguson") || (p.includes("sarah") && !p.includes("mccorquodale")))
    return ["Sarah Ferguson", "Sarah Duchess of York", "Fergie Duchess of York"];
  if (p.includes("diana")) return ["Princess Diana", "Diana Princess of Wales", "Lady Diana Spencer"];
  if (p.includes("timothy") || p.includes("laurence")) return ["Timothy Laurence", "Vice Admiral Timothy Laurence", "Sir Timothy Laurence"];
  if (p.includes("tom parker") || (p.includes("parker") && p.includes("bowles") && p.includes("tom")))
    return ["Tom Parker Bowles", "Tom Parker-Bowles", "Thomas Parker Bowles"];
  if (p.includes("laura")) return ["Laura Lopes", "Laura Parker Bowles", "Laura Lopes Camilla"];
  return [person];
}

function personTitleHints(person: string): RegExp {
  const p = person.toLowerCase();
  if (p.includes("frances") || p.includes("shand") || (p.includes("kydd") && !p.includes("parker")))
    return /\b(frances|shand.?kydd|ruth roche|diana'?s? mother|mother of (princess )?diana)\b/i;
  if (p.includes("mccorquodale") || (p.includes("sarah") && p.includes("lady") && !p.includes("ferguson")))
    return /\b(mccorquodale|lady sarah|sarah spencer|diana'?s? (elder )?sister|spencer sister)\b/i;
  if (p.includes("fellowes") || (p.includes("jane") && p.includes("lady")))
    return /\b(fellowes|lady jane|jane spencer|diana'?s? (middle )?sister|spencer sister)\b/i;
  if (
    (p.includes("spencer") && (p.includes("charles") || p.includes("earl"))) ||
    p === "charles spencer" ||
    p.includes("earl spencer")
  )
    return /\b(charles spencer|earl spencer|viscount althorp|9th earl|althorp|diana'?s? brother|brother of (princess )?diana)\b/i;

  if (p.includes("harry")) return /\b(harry|sussex)\b/i;
  if (p.includes("catherine") || p.includes("kate")) return /\b(catherine|kate|middleton|wales)\b/i;
  if (p.includes("camilla")) return /\b(camilla|consort)\b/i;
  if (p.includes("anne") && !p.includes("timothy")) return /\b(anne|princess royal)\b/i;
  if (p.includes("william") && !p.includes("george")) return /\b(william|wales|cambridge)\b/i;
  if (p.includes("meghan")) return /\b(meghan|markle|sussex)\b/i;
  if (p.includes("charles") && !p.includes("parker") && !p.includes("charlotte") && !p.includes("spencer"))
    return /\b(charles|king charles)\b/i;
  if (p.includes("george")) return /\b(george)\b/i;
  if (p.includes("charlotte")) return /\b(charlotte)\b/i;
  if (p.includes("louis")) return /\b(louis)\b/i;
  if (p.includes("andrew")) return /\b(andrew|york)\b/i;
  if (p.includes("eugenie") || p.includes("eugine")) return /\b(eugenie)\b/i;
  if (p.includes("beatrice")) return /\b(beatrice)\b/i;
  if (p.includes("zara")) return /\b(zara|tindall|phillips)\b/i;
  if (p.includes("sophie")) return /\b(sophie|edinburgh|wessex)\b/i;
  if (p.includes("edward") && !p.includes("andrew")) return /\b(edward|edinburgh|wessex)\b/i;
  if (p.includes("ferguson") || (p.includes("sarah") && !p.includes("mccorquodale")))
    return /\b(sarah|ferguson|fergie)\b/i;
  if (p.includes("diana")) return /\b(diana|spencer)\b/i;
  if (p.includes("timothy") || p.includes("laurence")) return /\b(timothy|laurence)\b/i;
  if (p.includes("tom parker") || (p.includes("parker") && p.includes("bowles"))) return /\b(tom|parker.?bowles)\b/i;
  if (p.includes("laura")) return /\b(laura|lopes|parker.?bowles)\b/i;
  return new RegExp(person.split(/\s+/).filter((w) => w.length > 2).join("|"), "i");
}

function buildCategoryQueries(person: string): Array<{ category: LibraryCategory; query: string }> {
  const names = personSearchNames(person);
  const a = names[0];
  const b = names[1] || names[0];
  const c = names[2] || names[0];
  const queries: Array<{ category: LibraryCategory; query: string }> = [
    { category: "serious", query: `${a} serious official portrait landscape photo` },
    { category: "smiling", query: `${a} smiling public event photo` },
    { category: "laughing", query: `${a} laughing candid photo` },
    { category: "formal", query: `${a} formal ceremony landscape photo` },
    { category: "wave", query: `${a} waving to crowd photo` },
    { category: "speech", query: `${a} speech podium photo` },
    { category: "event", query: `${a} royal engagement outdoor photo` },
    { category: "portrait", query: `${a} wide landscape photograph` },
    { category: "sad", query: `${a} solemn quiet moment photo` },
    { category: "with_family", query: `${a} royal family group photo` },
    { category: "other", query: `${b} documentary photograph horizontal` },
    { category: "event", query: `${b} visit crowd landscape photo` },
    { category: "smiling", query: `${b} walkabout smiling photo` },
    { category: "formal", query: `${a} red carpet formal photo landscape` },
    { category: "portrait", query: `${a} outdoor garden photo landscape` },
    { category: "serious", query: `${b} official appearance photo horizontal` },
  ];

  const contexts = [
    { category: "event", suffix: "public appearance wide photo" },
    { category: "formal", suffix: "state banquet ceremony photo landscape" },
    { category: "speech", suffix: "speaking at event photo horizontal" },
    { category: "with_family", suffix: "with royal family balcony photo" },
    { category: "portrait", suffix: "close up portrait documentary photo" },
    { category: "smiling", suffix: "smiling crowd walkabout photo" },
    { category: "serious", suffix: "serious expression official event photo" },
    { category: "wave", suffix: "waving balcony crowd photo" },
    { category: "other", suffix: "news photograph landscape no watermark" },
  ];
  for (const name of [a, b, c]) {
    for (const ctx of contexts) {
      queries.push({ category: ctx.category, query: `${name} ${ctx.suffix}` });
    }
  }

  const years = [
    "2025",
    "2024",
    "2023",
    "2022",
    "2021",
    "2020",
    "2019",
    "2018",
    "2017",
    "2016",
    "2015",
    "2014",
    "2013",
    "2012",
    "2011",
    "2010",
  ];
  for (const year of years) {
    queries.push(
      { category: "event", query: `${a} royal event ${year} photo landscape` },
      { category: "formal", query: `${a} ceremony ${year} photo horizontal` },
      { category: "smiling", query: `${a} smiling ${year} photo landscape` },
      { category: "portrait", query: `${a} ${year} photograph horizontal` },
      { category: "other", query: `${b} ${year} news photo landscape` }
    );
  }

  const venues = [
    "Buckingham Palace",
    "Windsor Castle",
    "Westminster Abbey",
    "Balmoral",
    "Sandringham",
    "Trooping the Colour",
    "Commonwealth",
    "state visit",
    "remembrance",
    "garden party",
    "walkabout",
    "carriage procession",
    "balcony appearance",
    "church service",
    "hospital visit",
    "school visit",
  ];
  for (const venue of venues) {
    queries.push(
      { category: "event", query: `${a} ${venue} photo landscape` },
      { category: "formal", query: `${b} ${venue} photograph horizontal` }
    );
  }

  // Person-specific extras
  if (/harry|meghan/i.test(person)) {
    queries.push(
      { category: "with_family", query: `${a} and Meghan together photo` },
      { category: "event", query: `${a} Invictus Games photo landscape` },
      { category: "other", query: `${a} California photo landscape` }
    );
  }
  if (/catherine|kate/i.test(person)) {
    queries.push(
      { category: "with_william", query: `${a} and Prince William together photo` },
      { category: "with_family", query: `${a} with children George Charlotte photo` },
      { category: "formal", query: `${a} Trooping the Colour photo` }
    );
  }
  if (/camilla/i.test(person)) {
    queries.push(
      { category: "with_camilla", query: `Queen Camilla and King Charles together photo` },
      { category: "formal", query: `Queen Camilla coronation photo landscape` },
      { category: "event", query: `Queen Camilla royal engagement photo` }
    );
  }
  if (/anne/i.test(person)) {
    queries.push(
      { category: "military", query: `Princess Anne military uniform parade photo` },
      { category: "event", query: `Princess Anne horse event photo landscape` },
      { category: "formal", query: `Princess Royal official duty photo` }
    );
  }
  if (/william/i.test(person) && !/george/i.test(person)) {
    queries.push(
      { category: "with_william", query: `Prince William and Catherine together photo` },
      { category: "military", query: `Prince William military uniform photo` },
      { category: "with_family", query: `Prince William with children photo` }
    );
  }
  if (/diana/i.test(person) && !/frances|shand|mccorquodale|fellowes|earl spencer|charles spencer/i.test(person)) {
    queries.push(
      { category: "formal", query: `Princess Diana elegant gown photo landscape` },
      { category: "with_family", query: `Princess Diana with William Harry photo` },
      { category: "event", query: `Princess Diana charity visit photo landscape` },
      { category: "portrait", query: `Princess Diana iconic photograph horizontal` },
      { category: "sad", query: `Princess Diana emotional moment photo` },
      { category: "smiling", query: `Princess Diana smiling crowd photo` },
      { category: "other", query: `Lady Diana Spencer documentary photo landscape` }
    );
  }
  if (/frances|shand.?kydd/i.test(person)) {
    queries.push(
      { category: "portrait", query: `Frances Shand Kydd portrait photograph horizontal` },
      { category: "with_family", query: `Frances Shand Kydd with Princess Diana photo` },
      { category: "event", query: `Frances Shand Kydd Diana mother photo landscape` },
      { category: "formal", query: `Frances Ruth Roche Shand Kydd formal photo` },
      { category: "sad", query: `Frances Shand Kydd funeral memorial photo` },
      { category: "other", query: `Diana mother Frances Shand Kydd documentary photo` }
    );
  }
  if (/mccorquodale/i.test(person)) {
    queries.push(
      { category: "portrait", query: `Lady Sarah McCorquodale portrait photo horizontal` },
      { category: "with_family", query: `Lady Sarah McCorquodale Diana sister photo` },
      { category: "event", query: `Sarah McCorquodale royal funeral photo landscape` },
      { category: "formal", query: `Lady Sarah Spencer McCorquodale formal photo` },
      { category: "other", query: `Diana sister Sarah McCorquodale documentary photograph` }
    );
  }
  if (/fellowes/i.test(person)) {
    queries.push(
      { category: "portrait", query: `Lady Jane Fellowes portrait photo horizontal` },
      { category: "with_family", query: `Lady Jane Fellowes Diana sister photo` },
      { category: "event", query: `Jane Fellowes royal funeral photo landscape` },
      { category: "formal", query: `Lady Jane Spencer Fellowes formal photo` },
      { category: "other", query: `Diana sister Jane Fellowes documentary photograph` }
    );
  }
  if (/charles spencer|earl spencer/i.test(person)) {
    queries.push(
      { category: "portrait", query: `Charles Spencer Earl Spencer portrait photo horizontal` },
      { category: "speech", query: `Earl Spencer funeral speech Diana photo` },
      { category: "with_family", query: `Charles Spencer Diana brother Althorp photo` },
      { category: "event", query: `Earl Spencer Althorp House photo landscape` },
      { category: "formal", query: `Charles Spencer 9th Earl Spencer formal photo` },
      { category: "other", query: `Diana brother Charles Spencer documentary photograph` }
    );
  }
  if (/george|charlotte|louis/i.test(person)) {
    queries.push(
      { category: "with_family", query: `${a} royal family balcony photo` },
      { category: "event", query: `${a} Trooping the Colour photo` },
      { category: "smiling", query: `${a} smiling school photo landscape` }
    );
  }
  if (/eugenie|beatrice|zara|sophie|ferguson|timothy|laura|tom parker/i.test(person)) {
    queries.push(
      { category: "event", query: `${a} royal wedding guest photo landscape` },
      { category: "formal", query: `${a} formal royal event photo` },
      { category: "portrait", query: `${b} portrait photograph horizontal` }
    );
  }
  return queries;
}

function imageDescription(person: string, category: LibraryCategory, item: GoogleImageItem, query: string): string {
  const title = (item.title || "").replace(/\s+/g, " ").trim();
  const source = item.source?.name ? ` from ${item.source.name}` : "";
  const categoryText = String(category).replace(/_/g, " ");
  const titlePart = title ? ` Title: ${title.slice(0, 140)}.` : "";
  return `${person} ${categoryText} image${source}, collected for documentary B-roll and visual matching.${titlePart} Query: ${query}`;
}

async function googleImageSearch(query: string, num = 20, page = 1): Promise<GoogleImageItem[]> {
  const key = getSearchApiKey();
  const url = new URL("https://www.searchapi.io/api/v1/search");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");
  url.searchParams.set("safe", "active");
  url.searchParams.set("size", "large");
  url.searchParams.set("aspect_ratio", "wide");
  if (page > 1) url.searchParams.set("page", String(page));

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SearchAPI ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { images?: GoogleImageItem[]; images_results?: GoogleImageItem[] };
  return (data.images || data.images_results || []).slice(0, num);
}

function looksClean(item: GoogleImageItem, person: string): { ok: boolean; reason?: string } {
  const link = item.original?.link || "";
  const title = (item.title || "").toLowerCase();
  const page = (item.source?.link || "").toLowerCase();
  const hay = `${link} ${title} ${page}`.toLowerCase();

  if (!link || !/^https?:\/\//i.test(link)) return { ok: false, reason: "no url" };
  if (BAD_HOSTS.some((h) => hay.includes(h))) return { ok: false, reason: "watermark host" };
  if (BAD_TITLE.some((t) => title.includes(t))) return { ok: false, reason: "bad title" };
  if (/\b(lorem|stock vector|clipart)\b/i.test(title)) return { ok: false, reason: "graphic" };
  // Reject obvious non-person landscape / travel stock that SearchAPI sometimes mixes in
  if (
    /\b(yosemite|bushkill|cathedral rocks|national park|fstoppers|waterfall|mountain range|coast path expands)\b/i.test(
      title
    ) &&
    !personTitleHints(person).test(title)
  ) {
    return { ok: false, reason: "landscape stock" };
  }

  const w = item.original?.width || 0;
  const h = item.original?.height || 0;
  if (w && h) {
    if (w < 900 || h < 500) return { ok: false, reason: "too small" };
    if (w / h < 1.25) return { ok: false, reason: "not landscape" };
    if (w / h > 2.6) return { ok: false, reason: "too ultra-wide" };
  }
  if (title.length > 10 && !personTitleHints(person).test(title)) {
    // Require person hint in informative titles — avoids landscape/stock bleed
    if (title.length > 18) return { ok: false, reason: "title missing person" };
    if (
      /\b(trump|obama|biden|elton john|beyonce|taylor swift|landscape photography|national park)\b/i.test(
        title
      )
    ) {
      return { ok: false, reason: "wrong subject" };
    }
  }
  return { ok: true };
}

async function downloadImage(url: string): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DocumentaryVideoFactory/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 40_000 || ab.byteLength > 12_000_000) return null;
    return { buf: Buffer.from(ab), contentType };
  } catch {
    return null;
  }
}

function personIndexKey(nicheSlug: string, personSlug: string): string {
  return `library/${nicheSlug}/${personSlug}/index.json`;
}

function nicheIndexKey(nicheSlug: string): string {
  return `library/${nicheSlug}/index.json`;
}

function rootIndexKey(): string {
  return `library/index.json`;
}

function buildPersonIndex(
  niche: string,
  nicheSlug: string,
  person: string,
  personSlug: string,
  assets: LibraryAsset[]
): PersonLibraryIndex {
  return {
    niche,
    nicheSlug,
    person,
    personSlug,
    updatedAt: new Date().toISOString(),
    counts: countLibraryAssets(assets),
    assets: assets.sort((a, b) => a.number - b.number || a.assetId.localeCompare(b.assetId)),
  };
}

async function persistPersonLibraryIndexes(personIndex: PersonLibraryIndex): Promise<void> {
  const { niche, nicheSlug, person, personSlug } = personIndex;

  // Preserve images / raw / trusted clips added in parallel that this process didn't load.
  const live = await r2GetJson<PersonLibraryIndex>(personIndexKey(nicheSlug, personSlug));
  const mergeById = (local: LibraryAsset[], remote: LibraryAsset[]) => {
    const map = new Map<string, LibraryAsset>();
    for (const a of remote) map.set(a.assetId, a);
    for (const a of local) map.set(a.assetId, a);
    return [...map.values()].sort((a, b) => a.number - b.number || a.assetId.localeCompare(b.assetId));
  };

  const mergedImages = mergeById(
    personIndex.assets.filter((a) => a.mediaType === "image"),
    (live?.assets || []).filter((a) => a.mediaType === "image")
  );
  const mergedRawFootage = mergeById(
    personIndex.assets.filter((a) => a.mediaType === "raw_footage"),
    (live?.assets || []).filter((a) => a.mediaType === "raw_footage")
  );
  const mergedTrusted = mergeById(
    personIndex.assets.filter((a) => a.mediaType === "trusted_clip"),
    (live?.assets || []).filter((a) => a.mediaType === "trusted_clip")
  );
  // Keep any other future media types from live index
  const known = new Set(["image", "raw_footage", "trusted_clip"]);
  const otherLive = (live?.assets || []).filter((a) => !known.has(a.mediaType));
  const assets = [...mergedImages, ...mergedRawFootage, ...mergedTrusted, ...otherLive];
  const counts = countLibraryAssets(assets);
  const mergedIndex: PersonLibraryIndex = {
    ...personIndex,
    updatedAt: new Date().toISOString(),
    counts,
    assets: assets.sort((a, b) => a.assetId.localeCompare(b.assetId)),
  };

  await r2PutJson(personIndexKey(nicheSlug, personSlug), mergedIndex);

  const nicheIdx =
    (await r2GetJson<NicheLibraryIndex>(nicheIndexKey(nicheSlug))) ||
    ({
      niche,
      nicheSlug,
      updatedAt: "",
      people: [],
    } satisfies NicheLibraryIndex);

  const peopleMap = new Map(nicheIdx.people.map((p) => [p.personSlug, p]));
  peopleMap.set(personSlug, {
    person,
    personSlug,
    images: counts.images,
    raw_footage: counts.raw_footage,
    trusted_clips: counts.trusted_clips,
    raw_clips: counts.raw_clips,
  });
  const nicheOut: NicheLibraryIndex = {
    niche,
    nicheSlug,
    updatedAt: new Date().toISOString(),
    people: [...peopleMap.values()].sort((a, b) => a.person.localeCompare(b.person)),
  };
  await r2PutJson(nicheIndexKey(nicheSlug), nicheOut);

  const root =
    (await r2GetJson<RootLibraryIndex>(rootIndexKey())) ||
    ({ updatedAt: "", niches: [] } satisfies RootLibraryIndex);
  const nicheMap = new Map(root.niches.map((n) => [n.nicheSlug, n]));
  nicheMap.set(nicheSlug, {
    niche,
    nicheSlug,
    peopleCount: nicheOut.people.length,
    images: nicheOut.people.reduce((n, p) => n + p.images, 0),
    raw_footage: nicheOut.people.reduce((n, p) => n + (p.raw_footage || 0), 0),
    trusted_clips: nicheOut.people.reduce((n, p) => n + (p.trusted_clips || 0), 0),
    raw_clips: nicheOut.people.reduce(
      (n, p) => n + (p.raw_clips ?? (p.raw_footage || 0) + (p.trusted_clips || 0)),
      0
    ),
  });
  await r2PutJson(rootIndexKey(), {
    updatedAt: new Date().toISOString(),
    niches: [...nicheMap.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  } satisfies RootLibraryIndex);

  const images = mergedIndex.assets.filter((a) => a.mediaType === "image");
  await r2PutJson(`library/${nicheSlug}/${personSlug}/manifest.json`, {
    person,
    personSlug,
    niche,
    nicheSlug,
    imageCount: mergedIndex.counts.images,
    assets: images.map((a) => ({
      assetId: a.assetId,
      number: a.number,
      category: a.category,
      r2Key: a.r2Key,
      width: a.width,
      height: a.height,
    })),
  });
}

/** Recover images uploaded to R2 but missing from person index (e.g. mid-run kill). */
export async function salvagePersonImagesFromR2(params: {
  niche: string;
  person: string;
  onProgress?: (msg: string) => void;
}): Promise<PersonLibraryIndex> {
  const niche = params.niche;
  const person = params.person;
  const nicheSlug = slugify(niche);
  const personSlug = slugify(person);
  const log = params.onProgress || console.log;

  const existing =
    (await r2GetJson<PersonLibraryIndex>(personIndexKey(nicheSlug, personSlug))) ||
    ({
      niche,
      nicheSlug,
      person,
      personSlug,
      updatedAt: new Date().toISOString(),
      counts: countLibraryAssets([]),
      assets: [],
    } satisfies PersonLibraryIndex);

  const assets = [...existing.assets];
  const knownKeys = new Set(assets.map((a) => a.r2Key));
  const keys = await r2ListPrefix(`library/${nicheSlug}/${personSlug}/images/`);
  let added = 0;
  for (const key of keys) {
    if (knownKeys.has(key)) continue;
    const base = key.split("/").pop() || "";
    const m = base.match(/-img-(\d+)\.(jpe?g|png|webp)$/i);
    if (!m) continue;
    const number = Number(m[1]);
    const assetId = base.replace(/\.(jpe?g|png|webp)$/i, "");
    assets.push({
      assetId,
      number,
      niche,
      nicheSlug,
      person,
      personSlug,
      mediaType: "image",
      category: "other",
      categories: ["other"],
      r2Key: key,
      description: `${person} library image ${String(number).padStart(4, "0")} (recovered from R2).`,
      createdAt: new Date().toISOString(),
    });
    knownKeys.add(key);
    added += 1;
  }

  const personIndex = buildPersonIndex(niche, nicheSlug, person, personSlug, assets);
  await persistPersonLibraryIndexes(personIndex);
  log(`[library] salvage ${person}: +${added} recovered, total images=${personIndex.counts.images}`);
  return personIndex;
}

export async function collectPersonImages(params: {
  niche: string;
  person: string;
  targetCount?: number;
  onProgress?: (msg: string) => void;
}): Promise<PersonLibraryIndex> {
  const niche = params.niche;
  const person = params.person;
  const nicheSlug = slugify(niche);
  const personSlug = slugify(person);
  const target = params.targetCount ?? 200;
  const log = params.onProgress || console.log;
  const flushEvery = 25;

  const existing =
    (await r2GetJson<PersonLibraryIndex>(personIndexKey(nicheSlug, personSlug))) ||
    ({
      niche,
      nicheSlug,
      person,
      personSlug,
      updatedAt: new Date().toISOString(),
      counts: countLibraryAssets([]),
      assets: [],
    } satisfies PersonLibraryIndex);

  const seenUrls = new Set(
    existing.assets.filter((a) => a.mediaType === "image").map((a) => a.sourceUrl).filter(Boolean) as string[]
  );
  const seenHashes = new Set(
    existing.assets.filter((a) => a.mediaType === "image").map((a) => a.contentHash).filter(Boolean) as string[]
  );
  const assets = [...existing.assets];
  let nextNum =
    Math.max(0, ...assets.filter((a) => a.mediaType === "image").map((a) => a.number), 0) + 1;
  let sinceFlush = 0;

  const categoryQueries = buildCategoryQueries(person);
  const pagesPerQuery = Math.max(1, Math.min(5, Number(process.env.ROYAL_COLLECT_PAGES || 3)));
  for (const { category, query } of categoryQueries) {
    if (assets.filter((a) => a.mediaType === "image").length >= target) break;
    for (let page = 1; page <= pagesPerQuery; page++) {
      if (assets.filter((a) => a.mediaType === "image").length >= target) break;
      log(`[library] ${person}: ${query} (page ${page})`);
      let results: GoogleImageItem[] = [];
      try {
        results = await googleImageSearch(query, 22, page);
      } catch (err) {
        log(`[library] search failed: ${err instanceof Error ? err.message : err}`);
        break;
      }
      if (!results.length) break;

      for (const item of results) {
        if (assets.filter((a) => a.mediaType === "image").length >= target) break;
        const check = looksClean(item, person);
        if (!check.ok) continue;
        const url = item.original!.link!;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        const downloaded = await downloadImage(url);
        if (!downloaded) continue;
        const contentHash = crypto.createHash("sha256").update(downloaded.buf).digest("hex");
        if (seenHashes.has(contentHash)) continue;
        seenHashes.add(contentHash);

        const ext =
          downloaded.contentType.includes("png")
            ? "png"
            : downloaded.contentType.includes("webp")
              ? "webp"
              : "jpg";
        const assetId = `${nicheSlug}-${personSlug}-img-${String(nextNum).padStart(4, "0")}`;
        const r2Key = `library/${nicheSlug}/${personSlug}/images/${assetId}.${ext}`;

        await r2PutObject({
          key: r2Key,
          body: downloaded.buf,
          contentType: downloaded.contentType,
          metadata: {
            person: personSlug,
            category,
            number: String(nextNum),
          },
        });

        const asset: LibraryAsset = {
          assetId,
          number: nextNum,
          niche,
          nicheSlug,
          person,
          personSlug,
          mediaType: "image",
          category,
          categories: [category],
          r2Key,
          width: item.original?.width,
          height: item.original?.height,
          sourceUrl: url,
          sourcePageUrl: item.source?.link,
          contentHash,
          queryUsed: query,
          title: item.title,
          description: imageDescription(person, category, item, query),
          createdAt: new Date().toISOString(),
        };
        assets.push(asset);
        nextNum += 1;
        sinceFlush += 1;
        const imageTotal = assets.filter((a) => a.mediaType === "image").length;
        log(`[library] saved ${assetId} (${category}) total=${imageTotal}`);
        if (sinceFlush >= flushEvery) {
          await persistPersonLibraryIndexes(buildPersonIndex(niche, nicheSlug, person, personSlug, assets));
          sinceFlush = 0;
          log(`[library] flushed index ${person} at ${imageTotal}`);
        }
      }
    }
  }

  const personIndex = buildPersonIndex(niche, nicheSlug, person, personSlug, assets);
  await persistPersonLibraryIndexes(personIndex);
  return personIndex;
}

function pairCategory(otherPerson: string): LibraryCategory {
  const slug = slugify(otherPerson).replace(/-/g, "_");
  return `with_${slug}`;
}

function pairSearchQueries(personA: string, personB: string): string[] {
  const aNames = personSearchNames(personA);
  const bNames = personSearchNames(personB);
  const a = aNames[0];
  const b = bNames[0];
  const a2 = aNames[1] || a;
  const b2 = bNames[1] || b;
  return [
    `${a} and ${b} together photo landscape`,
    `${a} with ${b} meeting photo landscape`,
    `${a} and ${b} side by side royal event photo`,
    `${b} and ${a} together candid photo horizontal`,
    `${a} ${b} walkabout together photo landscape`,
    `${a2} and ${b2} together official photo landscape`,
    `${a} greeting ${b} photo landscape`,
    `${a} and ${b} formal ceremony together photo`,
  ];
}

/**
 * Add together/pair images for two royals into BOTH libraries.
 * Never removes existing images or raw footage (merge-safe persist).
 */
export async function collectTogetherPairImages(params: {
  niche: string;
  personA: string;
  personB: string;
  targetEach?: number;
  onProgress?: (msg: string) => void;
}): Promise<{ personA: number; personB: number; addedA: number; addedB: number }> {
  const niche = params.niche;
  const nicheSlug = slugify(niche);
  const personA = params.personA;
  const personB = params.personB;
  const targetEach = params.targetEach ?? 60;
  const log = params.onProgress || console.log;

  async function ensurePerson(person: string) {
    const personSlug = slugify(person);
    const existing =
      (await r2GetJson<PersonLibraryIndex>(personIndexKey(nicheSlug, personSlug))) ||
      ({
        niche,
        nicheSlug,
        person,
        personSlug,
        updatedAt: new Date().toISOString(),
        counts: countLibraryAssets([]),
        assets: [],
      } satisfies PersonLibraryIndex);
    return { person, personSlug, existing };
  }

  const sideA = await ensurePerson(personA);
  const sideB = await ensurePerson(personB);
  const catA = pairCategory(personB);
  const catB = pairCategory(personA);

  const countPair = (idx: PersonLibraryIndex, cat: string) =>
    idx.assets.filter((a) => a.mediaType === "image" && (a.category === cat || a.categories?.includes(cat))).length;

  let haveA = countPair(sideA.existing, catA);
  let haveB = countPair(sideB.existing, catB);
  if (haveA >= targetEach && haveB >= targetEach) {
    log(`[pair] ${personA} + ${personB}: already have ${haveA}/${haveB}, skip`);
    return {
      personA: sideA.existing.counts.images,
      personB: sideB.existing.counts.images,
      addedA: 0,
      addedB: 0,
    };
  }

  const assetsA = [...sideA.existing.assets];
  const assetsB = [...sideB.existing.assets];
  const seenUrls = new Set(
    [...assetsA, ...assetsB]
      .filter((a) => a.mediaType === "image")
      .map((a) => a.sourceUrl)
      .filter(Boolean) as string[]
  );
  const seenHashes = new Set(
    [...assetsA, ...assetsB]
      .filter((a) => a.mediaType === "image")
      .map((a) => a.contentHash)
      .filter(Boolean) as string[]
  );

  let nextA = Math.max(0, ...assetsA.filter((a) => a.mediaType === "image").map((a) => a.number), 0) + 1;
  let nextB = Math.max(0, ...assetsB.filter((a) => a.mediaType === "image").map((a) => a.number), 0) + 1;
  let addedA = 0;
  let addedB = 0;

  const queries = pairSearchQueries(personA, personB);
  for (const query of queries) {
    if (haveA >= targetEach && haveB >= targetEach) break;
    log(`[pair] ${personA} + ${personB}: ${query}`);
    let results: GoogleImageItem[] = [];
    try {
      results = await googleImageSearch(query, 24);
    } catch (err) {
      log(`[pair] search failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    for (const item of results) {
      if (haveA >= targetEach && haveB >= targetEach) break;
      const checkA = looksClean(item, personA);
      const checkB = looksClean(item, personB);
      // Strict: must be clean landscape AND title should name both people (together shot).
      if (!checkA.ok || !checkB.ok) continue;
      const title = (item.title || "").trim();
      const hay = `${title} ${item.source?.name || ""} ${item.source?.link || ""}`;
      if (!personTitleHints(personA).test(hay) || !personTitleHints(personB).test(hay)) {
        continue;
      }
      // Reject group-crowd noise when title clearly stacks many unrelated names
      if (/\b(trump|obama|biden|elton john|celebrity|meme)\b/i.test(title)) continue;

      const url = item.original?.link;
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);

      const downloaded = await downloadImage(url);
      if (!downloaded) continue;
      const contentHash = crypto.createHash("sha256").update(downloaded.buf).digest("hex");
      if (seenHashes.has(contentHash)) continue;
      seenHashes.add(contentHash);

      const ext =
        downloaded.contentType.includes("png")
          ? "png"
          : downloaded.contentType.includes("webp")
            ? "webp"
            : "jpg";

      const putFor = async (
        person: string,
        personSlug: string,
        category: LibraryCategory,
        assets: LibraryAsset[],
        nextNum: number
      ) => {
        const assetId = `${nicheSlug}-${personSlug}-img-${String(nextNum).padStart(4, "0")}`;
        const r2Key = `library/${nicheSlug}/${personSlug}/images/${assetId}.${ext}`;
        await r2PutObject({
          key: r2Key,
          body: downloaded.buf,
          contentType: downloaded.contentType,
          metadata: { person: personSlug, category, number: String(nextNum), pair: "1" },
        });
        assets.push({
          assetId,
          number: nextNum,
          niche,
          nicheSlug,
          person,
          personSlug,
          mediaType: "image",
          category,
          categories: [category, "together"],
          r2Key,
          width: item.original?.width,
          height: item.original?.height,
          sourceUrl: url,
          sourcePageUrl: item.source?.link,
          contentHash,
          queryUsed: query,
          title,
          description: `${person} meeting/together with pair partner (${category}) — both named in source. ${title.slice(0, 120)} Query: ${query}`,
          createdAt: new Date().toISOString(),
        });
        return nextNum + 1;
      };

      if (haveA < targetEach) {
        nextA = await putFor(personA, sideA.personSlug, catA, assetsA, nextA);
        addedA += 1;
        haveA += 1;
        log(`[pair] saved ${personA} ${catA} totalPair=${haveA}`);
      }
      if (haveB < targetEach) {
        nextB = await putFor(personB, sideB.personSlug, catB, assetsB, nextB);
        addedB += 1;
        haveB += 1;
        log(`[pair] saved ${personB} ${catB} totalPair=${haveB}`);
      }

      // Flush often so kills don't lose pair images; raw is merge-preserved on persist.
      if ((addedA + addedB) % 10 === 0) {
        await persistPersonLibraryIndexes(buildPersonIndex(niche, nicheSlug, personA, sideA.personSlug, assetsA));
        await persistPersonLibraryIndexes(buildPersonIndex(niche, nicheSlug, personB, sideB.personSlug, assetsB));
      }
    }
  }

  await persistPersonLibraryIndexes(buildPersonIndex(niche, nicheSlug, personA, sideA.personSlug, assetsA));
  await persistPersonLibraryIndexes(buildPersonIndex(niche, nicheSlug, personB, sideB.personSlug, assetsB));
  log(`[pair-done] ${personA}+${personB} addedA=${addedA} addedB=${addedB} pairA=${haveA} pairB=${haveB}`);
  return {
    personA: assetsA.filter((a) => a.mediaType === "image").length,
    personB: assetsB.filter((a) => a.mediaType === "image").length,
    addedA,
    addedB,
  };
}

export async function loadRootLibrary(): Promise<RootLibraryIndex> {
  return (
    (await r2GetJson<RootLibraryIndex>(rootIndexKey())) || {
      updatedAt: new Date().toISOString(),
      niches: [],
    }
  );
}

export async function loadNicheLibrary(nicheSlug: string): Promise<NicheLibraryIndex | null> {
  return r2GetJson<NicheLibraryIndex>(nicheIndexKey(nicheSlug));
}

export async function loadPersonLibrary(
  nicheSlug: string,
  personSlug: string
): Promise<PersonLibraryIndex | null> {
  return r2GetJson<PersonLibraryIndex>(personIndexKey(nicheSlug, personSlug));
}
