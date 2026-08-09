import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { r2Configured, r2GetObjectBuffer } from "./r2.js";
import {
  collectPersonImages,
  loadNicheLibrary,
  loadPersonLibrary,
  loadRootLibrary,
} from "./collectImages.js";

function contentTypeForKey(key: string, provided?: string): string {
  const lower = key.toLowerCase();
  return (
    provided ||
    (lower.endsWith(".mp4")
      ? "video/mp4"
      : lower.endsWith(".webm")
        ? "video/webm"
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

export function registerPublicLibraryRenderRoute(app: Express): void {
  app.get("/api/media-library/render-asset", async (req: Request, res: Response) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const key = String(req.query.key || "");
      const token = String(req.query.token || "");
      const allowed =
        key.startsWith("library/") || key.startsWith("renders/");
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
  // Static paths MUST be registered before :nicheSlug params
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
      const niche = String(req.body?.niche || "Royal v1");
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

  app.get("/api/media-library", async (_req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const root = await loadRootLibrary();
      res.json(root);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/media-library/:nicheSlug", async (req, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ error: "R2 not configured" });
      const niche = await loadNicheLibrary(req.params.nicheSlug);
      if (!niche) return res.status(404).json({ error: "Niche not found" });
      res.json(niche);
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
      if (mediaType === "image" || mediaType === "raw_footage") {
        assets = assets.filter((a) => a.mediaType === mediaType);
      }
      if (category !== "all") {
        assets = assets.filter((a) => a.category === category || a.categories.includes(category as never));
      }
      res.json({
        ...person,
        assets,
        filter: { mediaType, category },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
