/**
 * Local Remotion timeline for "The Promise William Refused".
 * Uses Whisper-aligned beat timings from Railway + exact line→visual map.
 */
import fs from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const JOB_ID = "e29df1e6-4136-4280-ade1-ace221d367ef";
const BASE = "https://royal-videos-production.up.railway.app";
const COOKIE = fs.readFileSync("/tmp/rv-cookies.txt", "utf8");
const ROOT = "/workspace/storage/william-promise";
const MEDIA_DIR = path.join(ROOT, "media");
const PUBLIC_MEDIA = "/workspace/remotion/public/william-promise/media";
const FPS = 30;

type LineVisual = { line: string; visual: string };

const LINE_MAP: LineVisual[] = [
  { line: "Prince William has drawn a private royal boundary.", visual: "Prince William" },
  { line: "It now reaches directly into Queen Camilla's future.", visual: "Queen Camilla" },
  { line: "Charles wanted protection lasting beyond his own reign.", visual: "King Charles" },
  { line: "William refused to promise that future in advance.", visual: "Prince William" },
  {
    line: "The disagreement stayed quiet, but became constitutionally significant.",
    visual: "Buckingham Palace",
  },
  { line: "One king can reward loyalty during his lifetime.", visual: "King Charles" },
  { line: "He cannot completely command the reign after him.", visual: "Prince William" },
  { line: "That limit placed William at the center immediately.", visual: "Prince William" },
  {
    line: "Camilla had already crossed several major royal milestones.",
    visual: "Queen Camilla",
  },
  {
    line: "But this proposal reached beyond another ceremonial honour.",
    visual: "Royal honours ceremony",
  },
  { line: "It concerned what survived after Charles was gone.", visual: "King Charles" },
  {
    line: "And who would control the monarchy after succession.",
    visual: "Prince William",
  },
  {
    line: "William also carried another history into that decision.",
    visual: "Young Prince William",
  },
  {
    line: "His mother's memory remained inseparable from Camilla's rise.",
    visual: "Princess Diana",
  },
  {
    line: "Catherine's future royal position mattered just as deeply.",
    visual: "Princess Catherine",
  },
  {
    line: "Charles saw recognition for Camilla's decades of service.",
    visual: "Queen Camilla",
  },
  {
    line: "William saw permanent conditions attached to his inheritance.",
    visual: "Prince William",
  },
  {
    line: "Neither man needed a public confrontation to prevail.",
    visual: "King Charles",
  },
  {
    line: "Only one man controlled what happened after succession.",
    visual: "Prince William",
  },
  {
    line: "And William refused to surrender that future authority.",
    visual: "Prince William",
  },
  { line: "THE PROMISE WILLIAM REFUSED", visual: "Title Card" },
  {
    line: "The proposal concerned Camilla's position if she survived King Charles after his death.",
    visual: "Queen Camilla",
  },
  {
    line: "Palace advisers examined how her ceremonial importance might continue beyond his reign.",
    visual: "Buckingham Palace",
  },
  {
    line: "Charles wanted decades of Camilla's royal service recognised after his own lifetime.",
    visual: "King Charles",
  },
  {
    line: "That required more than another medal, order, or temporary ceremonial appointment alone.",
    visual: "Royal medal ceremony",
  },
  {
    line: "The developing arrangement included expanded precedence within the future royal household structure.",
    visual: "Royal Family ceremony",
  },
  {
    line: "It also considered protections surrounding Camilla's position as a widowed queen consort.",
    visual: "Queen Camilla",
  },
  {
    line: "The most sensitive scenario emerged if Camilla outlived Charles after the succession.",
    visual: "Queen Camilla",
  },
  {
    line: "Those protections mattered because succession would transfer royal authority directly to William.",
    visual: "Prince William",
  },
  {
    line: "Once William became sovereign, his household would operate under his own authority.",
    visual: "Prince William",
  },
];

const VISUAL_SLUGS: Record<string, string[]> = {
  "Prince William": ["prince-william"],
  "Queen Camilla": ["queen-camilla"],
  "King Charles": ["king-charles"],
  "Buckingham Palace": ["topic-buckingham-palace", "ctx-royal-estates", "topic-palace-exterior"],
  "Royal honours ceremony": [
    "topic-westminster-abbey",
    "topic-st-george-s-chapel",
    "topic-extra-charles-camilla-formal-court",
    "topic-extra-senior-royals-formal-group",
  ],
  "Royal medal ceremony": [
    "topic-st-george-s-chapel",
    "topic-westminster-abbey",
    "topic-extra-charles-camilla-formal-court",
  ],
  "Royal Family ceremony": [
    "topic-extra-senior-royals-formal-group",
    "topic-extra-charles-camilla-formal-court",
    "topic-windsor-castle",
  ],
  "Young Prince William": ["prince-william"],
  "Princess Diana": ["princess-diana"],
  "Princess Catherine": ["princess-catherine"],
  "Title Card": ["prince-william", "king-charles", "queen-camilla"],
};

type Asset = {
  assetId: string;
  r2Key: string;
  mediaType: string;
  title?: string;
  description?: string;
  categories?: string[];
  category?: string;
  personSlug?: string;
  shot?: string;
  width?: number;
  height?: number;
};

type TimedWord = { text: string; start: number; end: number; norm: string };

function cookieHeader(): string {
  for (const line of COOKIE.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length >= 7 && parts[5] === "dvf_session") {
      return `dvf_session=${parts[6].trim()}`;
    }
  }
  // Fallback: HttpOnly_ host lines still have name in field 5
  const m = COOKIE.match(/\tdvf_session\t([^\s]+)/);
  if (m) return `dvf_session=${m[1].trim()}`;
  throw new Error("dvf_session cookie not found — re-login");
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}']+/gu, "");
}

function tokenize(s: string): string[] {
  return s.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function loadCatalog(slug: string): Asset[] {
  const p = path.join(ROOT, `catalog-${slug}.json`);
  if (!fs.existsSync(p)) return [];
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  return (d.assets || []) as Asset[];
}

function buildWordTimeline(beats: Array<{ startTime: number; endTime: number; narrationText: string }>): TimedWord[] {
  const words: TimedWord[] = [];
  for (const b of beats) {
    const toks = tokenize(b.narrationText);
    if (!toks.length) continue;
    const span = Math.max(0.05, b.endTime - b.startTime);
    const slot = span / toks.length;
    toks.forEach((t, i) => {
      const start = b.startTime + slot * i;
      const end = b.startTime + slot * (i + 1);
      words.push({ text: t, start, end, norm: norm(t) });
    });
  }
  return words;
}

function alignLines(words: TimedWord[], lines: LineVisual[], totalDur: number) {
  let wi = 0;
  const timed: Array<LineVisual & { start: number; end: number; wordCount: number }> = [];
  for (let li = 0; li < lines.length; li++) {
    const want = tokenize(lines[li].line).map(norm).filter(Boolean);
    if (!want.length) continue;
    let start = -1;
    let end = -1;
    let matched = 0;
    const startWi = wi;
    while (wi < words.length && matched < want.length) {
      if (words[wi].norm === want[matched] || tokensLoose(words[wi].norm, want[matched])) {
        if (start < 0) start = words[wi].start;
        end = words[wi].end;
        matched++;
        wi++;
      } else if (matched === 0) {
        wi++;
      } else {
        // skip whisper insertion
        wi++;
        if (wi - startWi > want.length + 8) break;
      }
    }
    if (start < 0) {
      const prevEnd = timed.length ? timed[timed.length - 1].end : 0;
      start = prevEnd;
      end = Math.min(totalDur, prevEnd + Math.max(1.5, want.length * 0.35));
    }
    timed.push({ ...lines[li], start, end: Math.max(start + 0.4, end), wordCount: want.length });
  }
  // stitch gaps / overlaps
  for (let i = 0; i < timed.length; i++) {
    if (i === 0) timed[i].start = 0;
    else timed[i].start = timed[i - 1].end;
    if (i === timed.length - 1) timed[i].end = totalDur;
  }
  return timed;
}

function tokensLoose(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  // apostrophe / curly quote variants
  if (a.replace(/'/g, "") === b.replace(/'/g, "")) return true;
  return false;
}

function scoreAsset(a: Asset, visual: string, preferVideo: boolean): number {
  let s = 0;
  const desc = `${a.title || ""} ${a.description || ""} ${(a.categories || []).join(" ")} ${a.category || ""}`.toLowerCase();
  const shot = String(a.shot || "").toLowerCase();
  const isVideo = a.mediaType === "trusted_clip" || a.mediaType === "raw_footage";
  if (preferVideo && isVideo) s += 40;
  if (!preferVideo && a.mediaType === "image") s += 40;
  // Prefer raw footage for clip slots (user: 30% raw clips)
  if (preferVideo && a.mediaType === "raw_footage") s += 35;
  if (preferVideo && a.mediaType === "trusted_clip") s += 8;
  if (!preferVideo && a.mediaType === "trusted_clip") s += 5;

  // FULL visuals — prefer wide / full_body / medium; reject half-face close-ups
  if (shot === "wide" || shot === "full_body") s += 55;
  else if (shot === "medium") s += 28;
  else if (shot === "close_up" || shot === "closeup" || shot === "extreme_close_up") s -= 80;
  if ((a.categories || []).includes("portrait") || a.category === "portrait") s -= 45;
  if (/close[- ]?up|headshot|tight crop|half.?face|face only|profile portrait/.test(desc)) s -= 50;
  if (/full[- ]?body|wide shot|establishing|walking|standing|procession|balcony|outdoors|ceremony/.test(desc)) s += 20;
  // Prefer people-together / event frames over isolated face crops
  if ((a.categories || []).includes("together") || /together|beside|with /.test(desc)) s += 18;
  if ((a.categories || []).includes("event") || (a.categories || []).includes("formal")) s += 10;

  if ((a.categories || []).includes("iconic-ok")) s += 10;
  if ((a.categories || []).includes("image-clean-ok")) s += 8;
  if ((a.categories || []).includes("quality-excellent")) s += 12;
  if (a.width && a.height && a.width >= 1200) s += 8;
  // Prefer landscape-ish frames (more of the scene)
  if (a.width && a.height && a.width / a.height >= 1.2) s += 12;
  if (a.width && a.height && a.width / a.height < 0.85) s -= 15; // tall crop / face-y

  if (visual === "Young Prince William") {
    if (/young prince william/.test(desc)) s += 80;
    if (/young|childhood|teen|boyhood|199[0-7]|schoolboy|ski/.test(desc)) s += 40;
    if (/greeting children|with (his |their )?children|with catherine and/.test(desc)) s -= 35;
    if (/wedding|202[0-9]|coronation|bald|beard/.test(desc)) s -= 25;
  }
  if (visual.includes("ceremony") || visual.includes("honours") || visual.includes("medal")) {
    if (/ceremony|formal|abbey|chapel|order|medal|court|coronation|procession/.test(desc)) s += 25;
    if (shot === "wide" || shot === "full_body") s += 20;
  }
  if (visual === "Buckingham Palace") {
    if (/buckingham|palace exterior|facade/.test(desc)) s += 30;
    if (shot === "wide") s += 25;
  }
  if (visual === "Title Card") {
    if (/formal|group|together|family/.test(desc)) s += 20;
    if (shot === "wide" || shot === "full_body") s += 25;
  }
  return s;
}

/** Hard-filter: drop close-up / portrait when any fuller shot exists in the pool. */
function preferFullFrame(pool: Asset[]): Asset[] {
  const fuller = pool.filter((a) => {
    const shot = String(a.shot || "").toLowerCase();
    if (shot === "close_up" || shot === "closeup" || shot === "extreme_close_up") return false;
    if ((a.categories || []).includes("portrait") && shot !== "wide" && shot !== "full_body" && shot !== "medium") {
      return false;
    }
    return true;
  });
  return fuller.length ? fuller : pool;
}

/** Subjects that have raw_footage in the royal library. */
const CLIP_FRIENDLY = new Set([
  "Prince William",
  "Queen Camilla",
  "King Charles",
  "Princess Diana",
  "Princess Catherine",
  "Young Prince William",
]);

/**
 * Place ~30% raw clips, with ≥2 clip visuals in every 20s window.
 * Window rule wins when it needs more slots than the 30% budget.
 */
function chooseVideoSlots(
  timed: Array<LineVisual & { start: number; end: number }>
): Set<number> {
  const totalDur = timed.length ? timed[timed.length - 1].end : 0;
  const eligible = timed
    .map((t, i) => ({
      i,
      mid: (t.start + t.end) / 2,
      dur: t.end - t.start,
      visual: t.visual,
      score: t.end - t.start + (CLIP_FRIENDLY.has(t.visual) ? 5 : 0),
    }))
    .filter((x) => x.visual !== "Title Card" && CLIP_FRIENDLY.has(x.visual));

  const videoSlots = new Set<number>();
  const WINDOW = 20;
  const PER_WINDOW = 2;
  const windows = Math.max(1, Math.ceil(totalDur / WINDOW));

  for (let w = 0; w < windows; w++) {
    const wStart = w * WINDOW;
    const wEnd = Math.min(totalDur + 0.001, (w + 1) * WINDOW);
    const inWin = eligible
      .filter((x) => x.mid >= wStart && x.mid < wEnd && !videoSlots.has(x.i))
      .sort((a, b) => b.score - a.score);
    // Spread picks across the window (first + last among top candidates) when possible
    const picks: typeof inWin = [];
    if (inWin.length <= PER_WINDOW) {
      picks.push(...inWin);
    } else {
      // take highest score, then the farthest mid from it, etc.
      const remaining = [...inWin];
      while (picks.length < PER_WINDOW && remaining.length) {
        if (picks.length === 0) {
          picks.push(remaining.shift()!);
          continue;
        }
        const anchor = picks[0].mid;
        remaining.sort(
          (a, b) => Math.abs(b.mid - anchor) - Math.abs(a.mid - anchor) || b.score - a.score
        );
        picks.push(remaining.shift()!);
        remaining.sort((a, b) => b.score - a.score);
      }
    }
    for (const p of picks.slice(0, PER_WINDOW)) videoSlots.add(p.i);
  }

  // Also honor ~30% overall: if windows under-filled total vs 30%, add more globally
  const nonTitle = timed.filter((t) => t.visual !== "Title Card").length;
  const pctTarget = Math.max(videoSlots.size, Math.round(nonTitle * 0.3));
  if (videoSlots.size < pctTarget) {
    const extra = eligible
      .filter((x) => !videoSlots.has(x.i))
      .sort((a, b) => b.score - a.score);
    for (const e of extra) {
      if (videoSlots.size >= pctTarget) break;
      videoSlots.add(e.i);
    }
  }
  return videoSlots;
}

function pickAssets(timed: Array<LineVisual & { start: number; end: number }>) {
  const used = new Set<string>();
  const catalogCache = new Map<string, Asset[]>();
  const getAll = (visual: string): Asset[] => {
    const slugs = VISUAL_SLUGS[visual] || [];
    const out: Asset[] = [];
    for (const slug of slugs) {
      if (!catalogCache.has(slug)) catalogCache.set(slug, loadCatalog(slug));
      out.push(...(catalogCache.get(slug) || []));
    }
    return out;
  };

  const videoSlots = chooseVideoSlots(timed);

  const picks: Array<{
    lineIndex: number;
    visual: string;
    asset: Asset | null;
    preferVideo: boolean;
    kind: "image" | "video" | "title";
    mediaType?: string;
  }> = [];

  for (let i = 0; i < timed.length; i++) {
    const visual = timed[i].visual;
    if (visual === "Title Card") {
      picks.push({ lineIndex: i, visual, asset: null, preferVideo: false, kind: "title" });
      continue;
    }
    const preferVideo = videoSlots.has(i);
    const pool = getAll(visual).filter((a) => a.r2Key && !used.has(a.assetId || a.r2Key));

    let mediaPool = preferFullFrame(
      pool.filter((a) => {
        if (!preferVideo) return a.mediaType === "image";
        return a.mediaType === "raw_footage";
      })
    );

    let candidates = mediaPool
      .map((a) => ({ a, score: scoreAsset(a, visual, preferVideo) }))
      .sort((x, y) => y.score - x.score);

    // Clip slot fallback: trusted_clip if no raw available for this subject
    if (preferVideo && !candidates.length) {
      candidates = preferFullFrame(
        pool.filter((a) => a.mediaType === "trusted_clip" || a.mediaType === "raw_footage")
      )
        .map((a) => ({ a, score: scoreAsset(a, visual, true) }))
        .sort((x, y) => y.score - x.score);
    }

    let chosen = candidates[0]?.a;
    if (!chosen) {
      const fallback = preferFullFrame(pool)
        .map((a) => ({ a, score: scoreAsset(a, visual, !preferVideo) }))
        .sort((x, y) => y.score - x.score);
      chosen = fallback[0]?.a;
    }
    if (chosen) used.add(chosen.assetId || chosen.r2Key);
    const isVid =
      Boolean(chosen) &&
      (chosen!.mediaType === "trusted_clip" || chosen!.mediaType === "raw_footage");
    picks.push({
      lineIndex: i,
      visual,
      asset: chosen || null,
      preferVideo,
      kind: isVid ? "video" : "image",
      mediaType: chosen?.mediaType,
    });
  }
  return picks;
}

async function downloadAsset(asset: Asset, destName: string, force = false): Promise<string> {
  fs.mkdirSync(PUBLIC_MEDIA, { recursive: true });
  const dest = path.join(PUBLIC_MEDIA, destName);
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest;
  const url = `${BASE}/api/media-library/asset?key=${encodeURIComponent(asset.r2Key)}`;
  const res = await fetch(url, { headers: { Cookie: cookieHeader() } });
  if (!res.ok || !res.body) throw new Error(`download failed ${asset.r2Key}: ${res.status}`);
  const file = createWriteStream(dest);
  await pipeline(Readable.fromWeb(res.body as never), file);
  return dest;
}

function extFor(asset: Asset): string {
  const k = asset.r2Key.toLowerCase();
  if (k.endsWith(".mp4")) return ".mp4";
  if (k.endsWith(".webm")) return ".webm";
  if (k.endsWith(".png")) return ".png";
  if (k.endsWith(".webp")) return ".webp";
  return ".jpg";
}

async function main() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_MEDIA, { recursive: true });

  const beatsDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "beats.json"), "utf8"));
  const beats = beatsDoc.beats as Array<{ startTime: number; endTime: number; narrationText: string }>;
  const totalDur = Number(beatsDoc.targetDurationSec || 108.8);
  const words = buildWordTimeline(beats);
  const timed = alignLines(words, LINE_MAP, totalDur);
  const picks = pickAssets(timed);

  // Download media — HTTP URLs for Remotion (local static server on :8765)
  const MEDIA_BASE = "http://127.0.0.1:8765";
  const CACHE_BUST = `v=${Date.now()}`;
  const scenes: Array<Record<string, unknown>> = [];
  let imgCount = 0;
  let vidCount = 0;
  let rawCount = 0;
  let trustedCount = 0;

  for (let i = 0; i < timed.length; i++) {
    const t = timed[i];
    const p = picks[i];
    const sceneId = `line-${String(i + 1).padStart(2, "0")}`;
    if (p.kind === "title" || !p.asset) {
      const titleCandidates = loadCatalog("topic-extra-senior-royals-formal-group")
        .concat(loadCatalog("king-charles"))
        .filter((a) => a.mediaType === "image");
      const ta = titleCandidates.find((a) => a.r2Key) || null;
      let imageUrl: string | undefined;
      if (ta) {
        const name = `${sceneId}-title${extFor(ta)}`;
        await downloadAsset(ta, name, true);
        imageUrl = `${MEDIA_BASE}/william-promise/media/${name}?${CACHE_BUST}`;
        imgCount++;
      }
      scenes.push({
        sceneId,
        startTime: t.start,
        endTime: t.end,
        duration: t.end - t.start,
        imageUrl,
        cameraMotion: "zoom_in",
        cameraIntensity: 0.04,
        _visual: t.visual,
        _line: t.line,
        _titleOverlay: true,
      });
      continue;
    }

    const name = `${sceneId}-${p.kind}${extFor(p.asset)}`;
    await downloadAsset(p.asset, name, true);
    const fileUrl = `${MEDIA_BASE}/william-promise/media/${name}?${CACHE_BUST}`;

    if (p.kind === "video") {
      vidCount++;
      if (p.mediaType === "raw_footage") rawCount++;
      if (p.mediaType === "trusted_clip") trustedCount++;
      scenes.push({
        sceneId,
        startTime: t.start,
        endTime: t.end,
        duration: t.end - t.start,
        videoUrl: fileUrl,
        videoStartSeconds: 0,
        cameraMotion: "none",
        _visual: t.visual,
        _line: t.line,
        _assetId: p.asset.assetId,
        _r2Key: p.asset.r2Key,
        _mediaType: p.mediaType,
      });
    } else {
      imgCount++;
      scenes.push({
        sceneId,
        startTime: t.start,
        endTime: t.end,
        duration: t.end - t.start,
        imageUrl: fileUrl,
        cameraMotion: i % 2 === 0 ? "zoom_in" : "zoom_out",
        cameraIntensity: 0.055,
        _visual: t.visual,
        _line: t.line,
        _assetId: p.asset.assetId,
        _r2Key: p.asset.r2Key,
        _mediaType: p.mediaType,
      });
    }
  }

  // Sparse soft film-burn cut overlays (bundled under remotion/public)
  const burnCycle = [
    "overlays/transitions/soft-film-burn.mp4",
    "overlays/transitions/light-film-burn.mp4",
    "overlays/transitions/film-burn.mp4",
  ];
  const glitchEvents: Array<Record<string, unknown>> = [];
  // Keep VO clean — skip burn SFX overlays for this local preview render.
  void burnCycle;

  // Title card: classic purple lower third with the chapter line
  const titleScene = timed.findIndex((t) => t.visual === "Title Card");
  const effectEvents =
    titleScene >= 0
      ? [
          {
            id: "title-lt",
            presetId: "29_classic_purple_white_lower_third",
            startFrame: Math.round(timed[titleScene].start * FPS),
            durationFrames: Math.max(
              36,
              Math.round((timed[titleScene].end - timed[titleScene].start) * FPS)
            ),
            layer: 20,
            props: {
              primaryText: "THE PROMISE WILLIAM REFUSED",
              secondaryText: "William · Charles · Camilla",
            },
          },
        ]
      : [];

  const props = {
    scenes: scenes.map(
      ({ _visual, _line, _assetId, _r2Key, _titleOverlay, _mediaType, ...rest }) => rest
    ),
    effectEvents,
    sfxEvents: [],
    musicEvents: [],
    glitchEvents,
    fps: FPS,
    voiceoverUrl: `${MEDIA_BASE}/william-promise/voiceover.mp3?${CACHE_BUST}`,
    voiceoverVolume: 1,
    bodyStartOffsetSec: 0,
    cinematicIntro: { enabled: false },
  };

  // Validate 2 clips per 20s window
  const windows: Array<{ start: number; end: number; clips: number; indices: number[] }> = [];
  for (let w = 0; w * 20 < totalDur; w++) {
    const wStart = w * 20;
    const wEnd = Math.min(totalDur, (w + 1) * 20);
    const indices: number[] = [];
    timed.forEach((t, i) => {
      const mid = (t.start + t.end) / 2;
      if (mid >= wStart && mid < wEnd && picks[i].kind === "video") indices.push(i + 1);
    });
    windows.push({ start: wStart, end: wEnd, clips: indices.length, indices });
  }

  const meta = {
    jobId: JOB_ID,
    timingSource: beatsDoc.timingSource,
    voiceAlignmentSource: beatsDoc.voiceAlignmentSource,
    totalDur,
    lineCount: timed.length,
    imageCount: imgCount,
    videoCount: vidCount,
    rawFootageCount: rawCount,
    trustedClipCount: trustedCount,
    imagePct: Math.round((imgCount / (imgCount + vidCount)) * 100),
    videoPct: Math.round((vidCount / (imgCount + vidCount)) * 100),
    rawPctOfAll: Math.round((rawCount / (imgCount + vidCount)) * 100),
    windows20s: windows,
    timed: timed.map((t, i) => ({
      i: i + 1,
      start: Number(t.start.toFixed(3)),
      end: Number(t.end.toFixed(3)),
      visual: t.visual,
      line: t.line,
      media: picks[i].kind,
      mediaType: picks[i].mediaType || picks[i].kind,
      shot: picks[i].asset?.shot || null,
      assetId: picks[i].asset?.assetId || null,
      r2Key: picks[i].asset?.r2Key || null,
      title: picks[i].asset?.title || null,
    })),
  };

  fs.writeFileSync(path.join(ROOT, "props.json"), JSON.stringify(props, null, 2));
  fs.writeFileSync(path.join(ROOT, "meta.json"), JSON.stringify(meta, null, 2));
  fs.writeFileSync(
    path.join(ROOT, "scenes-annotated.json"),
    JSON.stringify(scenes, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        lines: timed.length,
        images: imgCount,
        videos: vidCount,
        rawFootage: rawCount,
        trustedClips: trustedCount,
        imagePct: meta.imagePct,
        videoPct: meta.videoPct,
        rawPctOfAll: meta.rawPctOfAll,
        windows20s: windows,
        props: path.join(ROOT, "props.json"),
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
