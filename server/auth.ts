import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "dvf_session";
const AUTH_SECRET = process.env.AUTH_SECRET?.trim() || "documentary-video-factory-auth";

type AuthAccount = { username: string; password: string };

function buildAuthAccounts(): AuthAccount[] {
  const defaultPassword = process.env.APP_PASSWORD?.trim() || "awmedia123";
  const byName = new Map<string, string>();

  const rawUsers = process.env.APP_USERNAME?.trim();
  if (rawUsers) {
    for (const part of rawUsers.split(",")) {
      const username = part.trim().toLowerCase();
      if (username) byName.set(username, defaultPassword);
    }
  } else {
    byName.set("ayush", defaultPassword);
  }

  // Manager login — always on unless explicitly disabled (even when APP_USERNAME is a single non-ayush user).
  const adrianDisabled =
    process.env.ADRIAN_LOGIN === "0" ||
    process.env.ADRIAN_LOGIN === "false" ||
    process.env.ADRIAN_LOGIN === "off";
  if (!adrianDisabled) {
    const adrianUser = (process.env.ADRIAN_USERNAME?.trim() || "adrian").toLowerCase();
    const adrianPassword = process.env.ADRIAN_PASSWORD?.trim() || defaultPassword;
    byName.set(adrianUser, adrianPassword);
  }

  if (!byName.has("ayush")) {
    byName.set("ayush", defaultPassword);
  }

  const extra = process.env.APP_LOGINS?.trim();
  if (extra) {
    for (const entry of extra.split(",")) {
      const colon = entry.indexOf(":");
      if (colon <= 0) continue;
      const username = entry.slice(0, colon).trim().toLowerCase();
      const password = entry.slice(colon + 1);
      if (username && password) byName.set(username, password);
    }
  }

  return [...byName.entries()].map(([username, password]) => ({ username, password }));
}

const AUTH_ACCOUNTS = buildAuthAccounts();

function sessionTokenFor(username: string, password: string): string {
  return createHmac("sha256", AUTH_SECRET).update(`${username}:${password}`).digest("hex");
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

export function getSessionUsername(req: Request): string | null {
  const token = parseCookie(req, COOKIE_NAME);
  if (!token) return null;
  for (const account of AUTH_ACCOUNTS) {
    if (safeEqual(token, sessionTokenFor(account.username, account.password))) {
      return account.username;
    }
  }
  return null;
}

export function isAuthenticated(req: Request): boolean {
  return getSessionUsername(req) !== null;
}

export function validateCredentials(username: string, password: string): boolean {
  const user = username.trim().toLowerCase();
  const account = AUTH_ACCOUNTS.find((a) => safeEqual(a.username, user));
  if (!account) return false;
  return safeEqual(password, account.password);
}

export function setSessionCookie(res: Response, username: string): void {
  const canonical = username.trim().toLowerCase();
  const account = AUTH_ACCOUNTS.find((a) => safeEqual(a.username, canonical));
  if (!account) return;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(sessionTokenFor(account.username, account.password))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`
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
