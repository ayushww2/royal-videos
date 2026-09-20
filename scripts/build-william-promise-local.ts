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
  const isVideo = a.mediaType === "trusted_clip" || a.mediaType === "raw_footage";
  if (preferVideo && isVideo) s += 40;
  if (!preferVideo && a.mediaType === "image") s += 40;
  if (a.mediaType === "trusted_clip") s += 15;
  if (a.mediaType === "raw_footage") s += 5;
  if ((a.categories || []).includes("iconic-ok")) s += 10;
  if ((a.categories || []).includes("image-clean-ok")) s += 8;
  if ((a.categories || []).includes("quality-excellent")) s += 12;
  if (a.width && a.height && a.width >= 1000) s += 5;
  if (visual === "Young Prince William") {
    if (/young prince william/.test(desc)) s += 80;
    if (/young|childhood|teen|boyhood|199[0-7]|schoolboy/.test(desc)) s += 40;
    if (/greeting children|with (his |their )?children|with catherine and/.test(desc)) s -= 35;
    if (/wedding|202[0-9]|coronation|bald|beard|king charles/.test(desc)) s -= 25;
  }
  if (visual.includes("ceremony") || visual.includes("honours") || visual.includes("medal")) {
    if (/ceremony|formal|abbey|chapel|order|medal|court|coronation|procession/.test(desc)) s += 25;
  }
  if (visual === "Buckingham Palace") {
    if (/buckingham|palace exterior|facade/.test(desc)) s += 30;
  }
  if (visual === "Title Card") {
    if (/serious|portrait|formal/.test(desc)) s += 10;
  }
  return s;
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

  // Target ~30% video among non-title scenes
  const n = timed.filter((t) => t.visual !== "Title Card").length;
  const videoTarget = Math.max(1, Math.round(n * 0.3));
  const videoSlots = new Set<number>();
  // Prefer longer holds + person subjects that have clip libraries
  const clipFriendly = new Set([
    "Prince William",
    "Queen Camilla",
    "King Charles",
    "Princess Diana",
    "Princess Catherine",
    "Young Prince William",
  ]);
  const idxs = timed
    .map((t, i) => ({
      i,
      dur: t.end - t.start,
      visual: t.visual,
      score: (t.end - t.start) + (clipFriendly.has(t.visual) ? 10 : 0),
    }))
    .filter((x) => x.visual !== "Title Card" && clipFriendly.has(x.visual))
    .sort((a, b) => b.score - a.score);
  for (let k = 0; k < videoTarget && k < idxs.length; k++) videoSlots.add(idxs[k].i);

  const picks: Array<{
    lineIndex: number;
    visual: string;
    asset: Asset | null;
    preferVideo: boolean;
    kind: "image" | "video" | "title";
  }> = [];

  for (let i = 0; i < timed.length; i++) {
    const visual = timed[i].visual;
    if (visual === "Title Card") {
      picks.push({ lineIndex: i, visual, asset: null, preferVideo: false, kind: "title" });
      continue;
    }
    const preferVideo = videoSlots.has(i);
    const candidates = getAll(visual)
      .filter((a) => a.r2Key && !used.has(a.assetId || a.r2Key))
      .filter((a) => {
        if (preferVideo) return a.mediaType === "trusted_clip" || a.mediaType === "raw_footage";
        return a.mediaType === "image";
      })
      .map((a) => ({ a, score: scoreAsset(a, visual, preferVideo) }))
      .sort((x, y) => y.score - x.score);

    let chosen = candidates[0]?.a;
    if (!chosen) {
      // fallback opposite media type
      const fallback = getAll(visual)
        .filter((a) => a.r2Key && !used.has(a.assetId || a.r2Key))
        .map((a) => ({ a, score: scoreAsset(a, visual, !preferVideo) }))
        .sort((x, y) => y.score - x.score);
      chosen = fallback[0]?.a;
    }
    if (chosen) used.add(chosen.assetId || chosen.r2Key);
    picks.push({
      lineIndex: i,
      visual,
      asset: chosen || null,
      preferVideo,
      kind: chosen && (chosen.mediaType === "trusted_clip" || chosen.mediaType === "raw_footage")
        ? "video"
        : "image",
    });
  }
  return picks;
}

async function downloadAsset(asset: Asset, destName: string): Promise<string> {
  fs.mkdirSync(PUBLIC_MEDIA, { recursive: true });
  const dest = path.join(PUBLIC_MEDIA, destName);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest;
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

  // Download media
  const scenes: Array<Record<string, unknown>> = [];
  let imgCount = 0;
  let vidCount = 0;

  for (let i = 0; i < timed.length; i++) {
    const t = timed[i];
    const p = picks[i];
    const sceneId = `line-${String(i + 1).padStart(2, "0")}`;
    if (p.kind === "title" || !p.asset) {
      // dark title hold — use a formal still underneath with overlay via effect, or solid via tiny black png
      // Prefer a unique formal group/ceremony still for atmosphere under title text effect
      const titleCandidates = loadCatalog("topic-extra-senior-royals-formal-group")
        .concat(loadCatalog("king-charles"))
        .filter((a) => a.mediaType === "image");
      const ta = titleCandidates.find((a) => a.r2Key) || null;
      let imageUrl: string | undefined;
      if (ta) {
        const name = `${sceneId}-title${extFor(ta)}`;
        await downloadAsset(ta, name);
        imageUrl = `/william-promise/media/${name}`;
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
    await downloadAsset(p.asset, name);
    const publicRel = `william-promise/media/${name}`;
    // Remotion staticFile path via serve — use absolute file URL for local render reliability
    const abs = path.join(PUBLIC_MEDIA, name);
    // Remotion static server serves remotion/public at URL root
    const fileUrl = `/william-promise/media/${name}`;

    if (p.kind === "video") {
      vidCount++;
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
    scenes: scenes.map(({ _visual, _line, _assetId, _r2Key, _titleOverlay, ...rest }) => rest),
    effectEvents,
    sfxEvents: [],
    musicEvents: [],
    glitchEvents,
    fps: FPS,
    voiceoverUrl: "/william-promise/voiceover.mp3",
    voiceoverVolume: 1,
    bodyStartOffsetSec: 0,
    cinematicIntro: { enabled: false },
  };

  const meta = {
    jobId: JOB_ID,
    timingSource: beatsDoc.timingSource,
    voiceAlignmentSource: beatsDoc.voiceAlignmentSource,
    totalDur,
    lineCount: timed.length,
    imageCount: imgCount,
    videoCount: vidCount,
    imagePct: Math.round((imgCount / (imgCount + vidCount)) * 100),
    videoPct: Math.round((vidCount / (imgCount + vidCount)) * 100),
    timed: timed.map((t, i) => ({
      i: i + 1,
      start: Number(t.start.toFixed(3)),
      end: Number(t.end.toFixed(3)),
      visual: t.visual,
      line: t.line,
      media: picks[i].kind,
      assetId: picks[i].asset?.assetId || null,
      r2Key: picks[i].asset?.r2Key || null,
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
        imagePct: meta.imagePct,
        videoPct: meta.videoPct,
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
