import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "dvf_session";
const USERNAME = process.env.APP_USERNAME?.trim() || "ayush";
const PASSWORD = process.env.APP_PASSWORD?.trim() || "awmedia123";
const AUTH_SECRET = process.env.AUTH_SECRET?.trim() || "documentary-video-factory-auth";

function sessionToken(): string {
  return createHmac("sha256", AUTH_SECRET).update(`${USERNAME}:${PASSWORD}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function parseCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return undefined;
}

export function isAuthenticated(req: Request): boolean {
  const token = parseCookie(req, COOKIE_NAME);
  if (!token) return false;
  return safeEqual(token, sessionToken());
}

export function validateCredentials(username: string, password: string): boolean {
  return safeEqual(username, USERNAME) && safeEqual(password, PASSWORD);
}

export function setSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(sessionToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`
  );
}

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

const PUBLIC_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/health",
]);

/** Paths handled by RunPod worker auth (registered before requireAuth). */
function isRunpodWorkerPath(pathname: string): boolean {
  return pathname === "/api/render-queue" || pathname.startsWith("/api/render-queue/");
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (isRunpodWorkerPath(req.path)) return next();
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    (req.path.startsWith("/media/jobs/") || req.path.startsWith("/media/renders/"))
  ) {
    return next();
  }
  if (!req.path.startsWith("/api") && !req.path.startsWith("/media")) return next();
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: "Unauthorized" });
}
