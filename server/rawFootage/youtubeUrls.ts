const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export function extractYoutubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!YT_HOSTS.has(host)) return null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = parsed.pathname.replace(/^\//, "").split("/")[0];
    return id && /^[\w-]{6,}$/.test(id) ? id : null;
  }

  const v = parsed.searchParams.get("v");
  if (v && /^[\w-]{6,}$/.test(v)) return v;

  const parts = parsed.pathname.split("/").filter(Boolean);
  const embedIdx = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "live");
  if (embedIdx >= 0 && parts[embedIdx + 1] && /^[\w-]{6,}$/.test(parts[embedIdx + 1])) {
    return parts[embedIdx + 1];
  }
  return null;
}

export function normalizeYoutubeWatchUrl(url: string): string | null {
  const id = extractYoutubeVideoId(url);
  if (!id) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * Parse up to 3 YouTube URLs from form JSON, comma text, or string[].
 */
export function parseUserYoutubeRawUrls(raw: unknown, max = 3): { urls: string[]; error?: string } {
  let list: string[] = [];
  if (Array.isArray(raw)) {
    list = raw.map((x) => String(x || "").trim()).filter(Boolean);
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { urls: [] };
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        list = parsed.map((x) => String(x || "").trim()).filter(Boolean);
      } else {
        list = trimmed.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      }
    } catch {
      list = trimmed.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    }
  } else if (raw == null || raw === "") {
    return { urls: [] };
  } else {
    return { urls: [], error: "userYoutubeRawUrls must be a JSON array or string" };
  }

  if (list.length > max) {
    return { urls: [], error: `At most ${max} YouTube links are allowed` };
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const normalized = normalizeYoutubeWatchUrl(item);
    if (!normalized) {
      return { urls: [], error: `Invalid YouTube URL: ${item}` };
    }
    const id = extractYoutubeVideoId(normalized)!;
    if (seen.has(id)) continue;
    seen.add(id);
    urls.push(normalized);
  }
  return { urls };
}
