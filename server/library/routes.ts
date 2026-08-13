import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import { r2Configured, r2GetObjectBuffer } from "./r2.js";
import {
  collectPersonImages,
  loadNicheLibrary,
  loadPersonLibrary,
  loadRootLibrary,
} from "./collectImages.js";
import {
  describeAllRoyalPeople,
  describeRoyalPerson,
  ROYAL_PEOPLE,
} from "./describeRoyal.js";
import { scanAllRoyalPeople, scanRoyalPerson } from "./scanRoyal.js";
import {
  bulkDeleteRawClips,
  uploadTrustedClipsForPerson,
  uploadTrustedZipBulk,
} from "./trustedUpload.js";
import { countLibraryAssets, isRawClipMediaType, slugify } from "./types.js";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(os.tmpdir(), "royal-library-uploads");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024, files: 40 },
});

function contentTypeForKey(key: string, provided?: string): string {
  const lower = key.toLowerCase();
  return (
    provided ||
    (lower.endsWith(".mp4")
      ? "video/mp4"
      : lower.endsWith(".webm")
        ? "video/webm"
        : lower.endsWith(".mov")
          ? "video/quicktime"
          : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
            ? "image/jpeg"
            : lower.endsWith(".png")
              ? "image/png"
              : lower.endsWith(".webp")
                ? "image/webp"
                : "application/octet-stream")
  );
}

function renderMediaSecret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.APP_PASSWORD?.trim() ||
    "documentary-render-media-development"
  );
}

export function signLibraryRenderKey(key: string): string {
  return crypto.createHmac("sha256", renderMediaSecret()).update(key).digest("hex");
}

export function validLibraryRenderToken(key: string, token: string): boolean {
  const expected = signLibraryRenderKey(key);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function enrichPersonCounts<T extends { assets?: Parameters<typeof countLibraryAssets>[0]; counts?: any }>(
  person: T
): T {
  if (!person?.assets) return person;
  const counts = countLibraryAssets(person.assets);
  return { ...person, counts: { ...(person.counts || {}), ...counts } };
}

function enrichNichePeople<T extends { people?: Array<any> }>(niche: T): T {
  if (!niche?.people) return niche;
  return {
    ...niche,
    people: niche.people.map((p) => {
      const raw = Number(p.raw_footage || 0);
      const trusted = Number(p.trusted_clips || 0);
      const rawClips = Number(p.raw_clips ?? raw + trusted);
      return { ...p, raw_footage: raw, trusted_clips: trusted, raw_clips: rawClips };
    }),
  };
}

function enrichRoot<T extends { niches?: Array<any> }>(root: T): T {
  if (!root?.niches) return root;
  return {
    ...root,
    niches: root.niches.map((n) => {
      const raw = Number(n.raw_footage || 0);
      const trusted = Number(n.trusted_clips || 0);
      return {
        ...n,
        raw_footage: raw,
        trusted_clips: trusted,
        raw_clips: Number(n.raw_clips ?? raw + trusted),
      };
    }),
  };
}

function cleanupFiles(files: Array<{ path: string }> | undefined): void {
  for (const f of files || []) {
    try {
      fs.unlinkSync(f.path);
    } catch {
      /* ignore */
    }
  }
}

export function registerPublicLibraryRenderRoute(app: Express): void {
  app.get("/api/media-library/render-asset", async (req: Request, res: Response) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const key = String(req.query.key || "");
      const token = String(req.query.token || "");
      const allowed = key.startsWith("library/") || key.startsWith("renders/");
      if (!allowed || !validLibraryRenderToken(key, token)) {
        return res.status(403).json({ error: "Invalid render media token" });
      }
      const obj = await r2GetObjectBuffer(key);
      res.setHeader("Content-Type", contentTypeForKey(key, obj.contentType));
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("Content-Length", String(obj.body.length));
      res.send(obj.body);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

export function registerLibraryRoutes(app: Express): void {
  app.get("/api/media-library/asset", async (req: Request, res: Response) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const key = String(req.query.key || "");
      if (!key.startsWith("library/")) return res.status(400).json({ error: "Invalid key" });
      const obj = await r2GetObjectBuffer(key);
      res.setHeader("Content-Type", contentTypeForKey(key, obj.contentType));
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(obj.body.length));
      res.send(obj.body);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/media-library/collect", async (req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const niche = String(req.body?.niche || "Royal Family");
      const person = String(req.body?.person || "");
      const targetCount = Number(req.body?.targetCount || 200);
      if (!person) return res.status(400).json({ error: "person required" });
      res.json({ ok: true, started: true, niche, person, targetCount });
      void collectPersonImages({
        niche,
        person,
        targetCount,
      }).catch((err) => console.error("[library] collect failed", err));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/media-library/collect-royal-bulk", async (req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const addCount = Math.max(50, Math.min(600, Number(req.body?.addCount || 400)));
      const people: string[] =
        Array.isArray(req.body?.people) && req.body.people.length
          ? req.body.people.map(String)
          : [...ROYAL_PEOPLE];
      res.json({ ok: true, started: true, people: people.length, addCount });
      void (async () => {
        for (const person of people) {
          try {
            const existing = await loadPersonLibrary("royal-family", slugify(person));
            const cur = existing?.counts?.images || 0;
            const targetCount = Math.min(800, cur + addCount);
            console.log(`[library] bulk collect ${person}: ${cur} -> ${targetCount}`);
            await collectPersonImages({
              niche: "Royal Family",
              person,
              targetCount,
            });
          } catch (err) {
            console.error(`[library] bulk collect failed ${person}`, err);
          }
        }
        console.log("[library] bulk collect finished");
      })();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/media-library/scan-royal", async (req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const person = String(req.body?.person || "").trim();
      const all = Boolean(req.body?.all);
      const dryRun = Boolean(req.body?.dryRun);
      const people = Array.isArray(req.body?.people) ? req.body.people.map(String) : undefined;
      if (!all && !person && !people?.length) {
        return res.status(400).json({ error: "person required (or all:true)" });
      }
      res.json({ ok: true, started: true, person: person || null, all, dryRun });
      void (async () => {
        try {
          if (all || people?.length) {
            await scanAllRoyalPeople({ dryRun, people, onProgress: (m) => console.log(m) });
          } else {
            await scanRoyalPerson({ person, dryRun, onProgress: (m) => console.log(m) });
          }
        } catch (err) {
          console.error("[library] scan-royal failed", err);
        }
      })();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/media-library/describe-royal", async (req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const person = String(req.body?.person || "").trim();
      const all = Boolean(req.body?.all);
      const force = Boolean(req.body?.force);
      const limit = Number(req.body?.limit || 0);
      if (!all && !person) return res.status(400).json({ error: "person required (or all:true)" });
      res.json({ ok: true, started: true, person: person || null, all, force, limit });
      void (async () => {
        try {
          if (all) {
            await describeAllRoyalPeople({ force, limitPerPerson: limit || undefined });
          } else {
            await describeRoyalPerson({ person, force, limit: limit || undefined });
          }
        } catch (err) {
          console.error("[library] describe-royal failed", err);
        }
      })();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Upload zip packs → raw clips (stored as trusted_clip, shown as raw clips). */
  app.post("/api/media-library/trusted/bulk", upload.array("files", 40), async (req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const files = (req.files as Array<{ path: string; originalname: string }> | undefined) || [];
      if (!files.length) return res.status(400).json({ error: "No files uploaded" });
      const niche = String(req.body?.niche || "Royal Family");
      const result = await uploadTrustedZipBulk({
        niche,
        files: files.map((f) => ({ path: f.path, originalname: f.originalname })),
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      cleanupFiles(req.files as Array<{ path: string }> | undefined);
    }
  });

  app.post(
    "/api/media-library/:nicheSlug/:personSlug/trusted",
    upload.array("files", 40),
    async (req, res) => {
      try {
        if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
        const files = (req.files as Array<{ path: string; originalname: string }> | undefined) || [];
        if (!files.length) return res.status(400).json({ error: "No files uploaded" });
        const nicheSlug = req.params.nicheSlug;
        const personSlug = req.params.personSlug;
        const existing = await loadPersonLibrary(nicheSlug, personSlug);
        const person = String(req.body?.person || existing?.person || personSlug);
        const niche = existing?.niche || "Royal Family";
        const result = await uploadTrustedClipsForPerson({
          niche,
          nicheSlug,
          person,
          personSlug,
          files: files.map((f) => ({ path: f.path, originalname: f.originalname })),
        });
        res.json({ ok: true, ...result });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        cleanupFiles(req.files as Array<{ path: string }> | undefined);
      }
    }
  );

  app.post("/api/media-library/:nicheSlug/:personSlug/raw/bulk-delete", async (req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const assetIds = Array.isArray(req.body?.assetIds) ? req.body.assetIds.map(String) : [];
      if (!assetIds.length) return res.status(400).json({ error: "assetIds required" });
      const result = await bulkDeleteRawClips({
        nicheSlug: req.params.nicheSlug,
        personSlug: req.params.personSlug,
        assetIds,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/media-library", async (_req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const root = await loadRootLibrary();
      res.json(enrichRoot(root));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/media-library/:nicheSlug", async (req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const niche = await loadNicheLibrary(req.params.nicheSlug);
      if (!niche) return res.status(404).json({ error: "Niche not found" });
      res.json(enrichNichePeople(niche));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/media-library/:nicheSlug/:personSlug", async (req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const person = await loadPersonLibrary(req.params.nicheSlug, req.params.personSlug);
      if (!person) return res.status(404).json({ error: "Person not found" });
      const mediaType = String(req.query.mediaType || "all");
      const category = String(req.query.category || "all");
      let assets = person.assets;
      if (mediaType === "image") {
        assets = assets.filter((a) => a.mediaType === "image");
      } else if (
        mediaType === "raw_footage" ||
        mediaType === "raw_clips" ||
        mediaType === "trusted_clip"
      ) {
        // One "raw clips" bucket: raw_footage + trusted_clip
        assets = assets.filter((a) => isRawClipMediaType(a.mediaType));
      }
      if (category !== "all") {
        assets = assets.filter(
          (a) => a.category === category || a.categories.includes(category as never)
        );
      }
      const enriched = enrichPersonCounts(person);
      res.json({
        ...enriched,
        assets,
        filter: { mediaType, category },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
