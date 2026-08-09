import crypto from "node:crypto";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { config, optionalEnv } from "../config.js";

function renderStorageSecret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.APP_PASSWORD?.trim() ||
    "documentary-render-storage-development"
  );
}

function signRelativePath(relativePath: string): string {
  return crypto
    .createHmac("sha256", renderStorageSecret())
    .update(relativePath)
    .digest("hex");
}

function relativeStoragePath(filePath: string): string | undefined {
  const root = path.resolve(config.storagePath);
  const resolved = path.resolve(filePath);
  const relative = path.relative(root, resolved).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) return undefined;
  return relative;
}

export function storageRenderUrl(filePath?: string): string | undefined {
  if (!filePath || /^https?:\/\//i.test(filePath)) return undefined;
  const relative = relativeStoragePath(filePath);
  const publicBase = optionalEnv("PUBLIC_APP_URL")?.replace(/\/$/, "");
  if (!relative || !publicBase) return undefined;
  const token = signRelativePath(relative);
  return `${publicBase}/api/render-storage?path=${encodeURIComponent(relative)}&token=${token}`;
}

export function registerPublicRenderStorageRoute(app: Express): void {
  app.get("/api/render-storage", (req: Request, res: Response) => {
    const relative = String(req.query.path || "").replace(/\\/g, "/");
    const token = String(req.query.token || "");
    const expected = signRelativePath(relative);
    if (
      !relative ||
      relative.startsWith("../") ||
      path.isAbsolute(relative) ||
      token.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    ) {
      return res.status(403).json({ error: "Invalid render storage token" });
    }
    const absolute = path.resolve(config.storagePath, relative);
    const root = path.resolve(config.storagePath);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      return res.status(403).json({ error: "Invalid render storage path" });
    }
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(absolute, (error) => {
      if (error && !res.headersSent) {
        const statusCode = (error as Error & { statusCode?: number }).statusCode;
        res.status(statusCode || 404).json({ error: "Render media not found" });
      }
    });
  });
}
