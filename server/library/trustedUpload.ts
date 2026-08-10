/**
 * Upload person video packs into the Royal library as trusted_clip assets.
 * Media Library UI merges these with raw_footage under a single "raw clips" label.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { r2GetJson, r2PutJson, r2PutObject } from "./r2.js";
import type { LibraryAsset, NicheLibraryIndex, PersonLibraryIndex, RootLibraryIndex } from "./types.js";
import { countLibraryAssets, slugify } from "./types.js";

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

function personIndexKey(nicheSlug: string, personSlug: string): string {
  return `library/${nicheSlug}/${personSlug}/index.json`;
}

function run(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return {
    ok: res.status === 0,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
}

function ffprobeDuration(filePath: string): number | undefined {
  const res = run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  if (!res.ok) return undefined;
  const n = Number(String(res.stdout).trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function makeThumb(videoPath: string, outJpg: string): boolean {
  const res = run("ffmpeg", [
    "-y",
    "-ss",
    "0.4",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    outJpg,
  ]);
  return res.ok && fs.existsSync(outJpg) && fs.statSync(outJpg).size > 500;
}

function guessPersonFromName(name: string, fallbackPerson?: string): string {
  const cleaned = name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (fallbackPerson) return fallbackPerson;
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

async function persistIndexes(params: {
  niche: string;
  nicheSlug: string;
  person: string;
  personSlug: string;
  assets: LibraryAsset[];
  group?: string;
}): Promise<PersonLibraryIndex> {
  const { niche, nicheSlug, person, personSlug, assets, group } = params;
  const counts = countLibraryAssets(assets);
  const personIndex: PersonLibraryIndex = {
    niche,
    nicheSlug,
    person,
    personSlug,
    group,
    updatedAt: new Date().toISOString(),
    counts,
    assets: assets.sort((a, b) => a.assetId.localeCompare(b.assetId)),
  };
  await r2PutJson(personIndexKey(nicheSlug, personSlug), personIndex);

  const nicheIdx =
    (await r2GetJson<NicheLibraryIndex>(`library/${nicheSlug}/index.json`)) ||
    ({ niche, nicheSlug, updatedAt: "", people: [] } satisfies NicheLibraryIndex);
  const peopleMap = new Map(nicheIdx.people.map((p) => [p.personSlug, p]));
  peopleMap.set(personSlug, {
    person,
    personSlug,
    images: counts.images,
    raw_footage: counts.raw_footage,
    trusted_clips: counts.trusted_clips,
    raw_clips: counts.raw_clips,
    group: group || peopleMap.get(personSlug)?.group,
  });
  const nicheOut: NicheLibraryIndex = {
    niche,
    nicheSlug,
    updatedAt: new Date().toISOString(),
    people: [...peopleMap.values()].sort((a, b) => a.person.localeCompare(b.person)),
  };
  await r2PutJson(`library/${nicheSlug}/index.json`, nicheOut);

  const root =
    (await r2GetJson<RootLibraryIndex>("library/index.json")) ||
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
  await r2PutJson("library/index.json", {
    updatedAt: new Date().toISOString(),
    niches: [...nicheMap.values()].sort((a, b) => a.niche.localeCompare(b.niche)),
  });

  return personIndex;
}

async function ingestVideoFile(params: {
  niche: string;
  nicheSlug: string;
  person: string;
  personSlug: string;
  filePath: string;
  originalName: string;
  existing: PersonLibraryIndex;
}): Promise<{ added: number; assetId?: string }> {
  const { niche, nicheSlug, person, personSlug, filePath, originalName, existing } = params;
  const buf = fs.readFileSync(filePath);
  if (buf.byteLength < 10_000) return { added: 0 };
  const contentHash = crypto.createHash("sha256").update(buf).digest("hex");
  if (existing.assets.some((a) => a.contentHash === contentHash)) return { added: 0 };

  const ext = path.extname(originalName || filePath).toLowerCase() || ".mp4";
  const nextNum =
    Math.max(
      0,
      ...existing.assets.filter((a) => a.mediaType === "trusted_clip").map((a) => a.number),
      0
    ) + 1;
  const assetId = `${nicheSlug}-${personSlug}-trusted-${String(nextNum).padStart(4, "0")}`;
  const r2Key = `library/${nicheSlug}/${personSlug}/trusted/${assetId}${ext === ".mov" ? ".mov" : ext === ".webm" ? ".webm" : ".mp4"}`;
  const thumbKey = `library/${nicheSlug}/${personSlug}/trusted/${assetId}.jpg`;

  await r2PutObject({
    key: r2Key,
    body: buf,
    contentType:
      ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : "video/mp4",
    metadata: { person: personSlug, mediaType: "trusted_clip" },
  });

  const tmpThumb = path.join(os.tmpdir(), `${assetId}-${process.pid}.jpg`);
  let thumbOk = false;
  try {
    thumbOk = makeThumb(filePath, tmpThumb);
    if (thumbOk) {
      await r2PutObject({
        key: thumbKey,
        body: fs.readFileSync(tmpThumb),
        contentType: "image/jpeg",
      });
    }
  } finally {
    try {
      fs.unlinkSync(tmpThumb);
    } catch {
      /* ignore */
    }
  }

  const duration = ffprobeDuration(filePath);
  const asset: LibraryAsset = {
    assetId,
    number: nextNum,
    niche,
    nicheSlug,
    person,
    personSlug,
    group: existing.group || "People",
    mediaType: "trusted_clip",
    category: "trusted",
    categories: ["trusted", "trusted_clips"],
    r2Key,
    thumbKey: thumbOk ? thumbKey : undefined,
    contentHash,
    title: `${person} raw clip #${nextNum} · ${path.basename(originalName || filePath)}`,
    description: `${person} raw clip ${nextNum}`,
    duration,
    sourceUrl: `upload:${slugify(path.basename(originalName || filePath))}`,
    createdAt: new Date().toISOString(),
  };
  existing.assets.push(asset);
  return { added: 1, assetId };
}

function listVideosRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (VIDEO_EXT.has(path.extname(ent.name).toLowerCase())) out.push(full);
    }
  };
  walk(dir);
  return out;
}

export async function uploadTrustedClipsForPerson(params: {
  niche: string;
  nicheSlug: string;
  person: string;
  personSlug: string;
  files: Array<{ path: string; originalname: string }>;
}): Promise<{ person: string; added: number; results: Array<{ file: string; added: number; error?: string }> }> {
  const { niche, nicheSlug, person, personSlug, files } = params;
  const existing =
    (await r2GetJson<PersonLibraryIndex>(personIndexKey(nicheSlug, personSlug))) ||
    ({
      niche,
      nicheSlug,
      person,
      personSlug,
      group: "People",
      updatedAt: new Date().toISOString(),
      counts: countLibraryAssets([]),
      assets: [],
    } satisfies PersonLibraryIndex);

  const results: Array<{ file: string; added: number; error?: string }> = [];
  let added = 0;

  for (const file of files) {
    const lower = file.originalname.toLowerCase();
    try {
      if (lower.endsWith(".zip")) {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "royal-raw-zip-"));
        try {
          const unzip = run("unzip", ["-qq", "-o", file.path, "-d", tmpDir]);
          if (!unzip.ok) throw new Error(unzip.stderr.slice(0, 200) || "unzip failed");
          const videos = listVideosRecursive(tmpDir);
          let zipAdded = 0;
          for (const video of videos) {
            const r = await ingestVideoFile({
              niche,
              nicheSlug,
              person,
              personSlug,
              filePath: video,
              originalName: path.basename(video),
              existing,
            });
            zipAdded += r.added;
          }
          added += zipAdded;
          results.push({ file: file.originalname, added: zipAdded });
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } else if (VIDEO_EXT.has(path.extname(lower))) {
        const r = await ingestVideoFile({
          niche,
          nicheSlug,
          person,
          personSlug,
          filePath: file.path,
          originalName: file.originalname,
          existing,
        });
        added += r.added;
        results.push({ file: file.originalname, added: r.added });
      } else {
        results.push({ file: file.originalname, added: 0, error: "unsupported file type" });
      }
    } catch (err) {
      results.push({
        file: file.originalname,
        added: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await persistIndexes({
    niche,
    nicheSlug,
    person,
    personSlug,
    assets: existing.assets,
    group: existing.group,
  });

  return { person, added, results };
}

/** Bulk zip packs — zip basename / top folder names the person. */
export async function uploadTrustedZipBulk(params: {
  niche?: string;
  files: Array<{ path: string; originalname: string }>;
}): Promise<{ results: Array<{ file: string; person?: string; added?: number; error?: string }> }> {
  const niche = params.niche || "Royal Family";
  const nicheSlug = slugify(niche);
  const results: Array<{ file: string; person?: string; added?: number; error?: string }> = [];

  for (const file of params.files) {
    try {
      if (!file.originalname.toLowerCase().endsWith(".zip")) {
        results.push({ file: file.originalname, error: "expected .zip" });
        continue;
      }
      const person = guessPersonFromName(file.originalname);
      const personSlug = slugify(person);
      const one = await uploadTrustedClipsForPerson({
        niche,
        nicheSlug,
        person,
        personSlug,
        files: [file],
      });
      results.push({ file: file.originalname, person, added: one.added });
    } catch (err) {
      results.push({
        file: file.originalname,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { results };
}

export async function bulkDeleteRawClips(params: {
  nicheSlug: string;
  personSlug: string;
  assetIds: string[];
}): Promise<{ deleted: number }> {
  const idx = await r2GetJson<PersonLibraryIndex>(
    personIndexKey(params.nicheSlug, params.personSlug)
  );
  if (!idx) throw new Error("Person not found");
  const remove = new Set(params.assetIds);
  const before = idx.assets.length;
  idx.assets = idx.assets.filter(
    (a) => !(remove.has(a.assetId) && (a.mediaType === "raw_footage" || a.mediaType === "trusted_clip"))
  );
  const deleted = before - idx.assets.length;
  await persistIndexes({
    niche: idx.niche,
    nicheSlug: idx.nicheSlug,
    person: idx.person,
    personSlug: idx.personSlug,
    assets: idx.assets,
    group: idx.group,
  });
  return { deleted };
}
