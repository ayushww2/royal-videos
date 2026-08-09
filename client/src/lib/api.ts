import type { JobRecord, Scene } from "./types";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, credentials: "include" });
  if (res.status === 401 && !url.includes("/api/auth/")) {
    const { clearAuthCache } = await import("./auth");
    clearAuthCache();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.assign("/login");
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export type EffectPresetOption = { id: string; label: string };

export type LibrarySearchHit = {
  assetId: string;
  person?: string;
  mediaType?: string;
  category?: string;
  description?: string;
  previewUrl?: string;
};

export type TimelineScenePatch = {
  sceneId: string;
  markForAiRevise?: boolean;
  editorNotes?: string;
  effectPresetId?: string | "" | null;
  clearEffects?: boolean;
};

export type TimelineMusicEvent = {
  id: string;
  musicId: string;
  startTime: number;
  durationSec: number;
  volume?: number;
  reason?: string;
  role?: string;
};

export type TimelineSfxEvent = {
  id: string;
  sfxId: string;
  startTime: number;
  durationSec: number;
  sceneId?: string;
  reason?: string;
};

export type TimelineEffectEvent = {
  id: string;
  presetId: string;
  startTime: number;
  durationSec: number;
  sceneId?: string;
  reason?: string;
};

export type TimelineApprovedAsset = {
  approvedVisualId: string;
  previewUrl?: string;
  source?: string;
  bestUseCase?: string;
  matchedPeople?: string[];
  matchedPlaces?: string[];
  usedByScenes?: string[];
  reuseCount?: number;
};

export type TimelinePayload = {
  job: JobRecord;
  scenes: Scene[];
  effectPresets: EffectPresetOption[];
  locked: boolean;
  musicEvents?: TimelineMusicEvent[];
  sfxEvents?: TimelineSfxEvent[];
  effectEvents?: TimelineEffectEvent[];
  voiceoverUrl?: string;
  durationSec?: number;
  approvedAssets?: TimelineApprovedAsset[];
};

export function formatTimecode(sec: number): string {
  const total = Math.max(0, sec);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const frames = Math.floor((total % 1) * 30);
  return `${m}:${String(s).padStart(2, "0")}.${String(frames).padStart(2, "0")}`;
}

export function isVideoMediaUrl(url?: string): boolean {
  return Boolean(url && /\.(mp4|webm|mov)(\?|$)/i.test(url));
}

export function fetchTimeline(jobId: string) {
  return api<TimelinePayload>(`/api/jobs/${jobId}/timeline`);
}

export function patchTimeline(jobId: string, patches: TimelineScenePatch[]) {
  return api<TimelinePayload & { ok: boolean; updated: number }>(`/api/jobs/${jobId}/timeline`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patches }),
  });
}

export function swapTimelineVisual(jobId: string, sceneId: string, assetId: string) {
  return api<{ ok: boolean; scene: Scene; scenes?: Scene[] }>(
    `/api/jobs/${jobId}/timeline/swap-visual`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId, assetId }),
    }
  );
}

export function searchEditorLibrary(
  jobId: string,
  query: string,
  limit = 16,
  opts?: { person?: string; mediaType?: "image" | "raw_footage" }
) {
  const params = new URLSearchParams({
    q: query.trim(),
    limit: String(limit),
  });
  if (opts?.person?.trim()) params.set("person", opts.person.trim());
  if (opts?.mediaType) params.set("mediaType", opts.mediaType);
  return api<{ count: number; assets: LibrarySearchHit[] }>(
    `/api/jobs/${jobId}/editor/library-search?${params.toString()}`
  );
}

export function fetchEffectPresets() {
  return api<{ presets: EffectPresetOption[] }>("/api/knowledge-editor/effect-presets");
}

/** Live RunPod / render status for a job (poll this while rendering). */
export type JobRenderStatus = {
  jobId: string;
  status: string;
  progressPercent: number;
  render: JobRecord["render"];
  playableUrl?: string;
  localPath?: string;
  r2Key?: string;
  rendererConfigured?: string;
  runpodReady?: boolean;
  runpodServerlessReady?: boolean;
  runpodMode?: "serverless" | "pod";
  setupError?: string | null;
};

export type EnqueueRenderResult = {
  ok?: boolean;
  started?: boolean;
  queued?: boolean;
  renderer?: string;
  podId?: string;
  runId?: string;
  mode?: "serverless" | "pod";
  outputKey?: string;
  outputPath?: string;
  shotstackUrl?: string;
};

/** Prefer R2/public URL, then Shotstack URL, then local /media path. */
export function getJobPlayableUrl(job?: JobRecord | null, status?: JobRenderStatus | null): string | undefined {
  return (
    status?.playableUrl ||
    job?.render?.outputUrl ||
    job?.render?.shotstackUrl ||
    (job?.render?.outputKey ? `/media/${job.render.outputKey}` : undefined)
  );
}

export function fetchJobRenderStatus(jobId: string): Promise<JobRenderStatus> {
  return api<JobRenderStatus>(`/api/jobs/${jobId}/render-status`);
}

/** Enqueue final render (RunPod when RENDERER=runpod / RUNPOD_RENDER=1). */
export function enqueueJobRender(jobId: string, opts?: { force?: boolean }): Promise<EnqueueRenderResult> {
  return api<EnqueueRenderResult>(`/api/jobs/${jobId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force: Boolean(opts?.force) }),
  });
}

export function patchJobCustomInstructions(
  jobId: string,
  customEditInstructions: string
): Promise<{ ok: boolean; job: JobRecord }> {
  return api<{ ok: boolean; job: JobRecord }>(`/api/jobs/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customEditInstructions }),
  });
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateDurationSec(text: string): number {
  return wordCount(text) / 2.5;
}

export function sourceShort(source: string): string {
  switch (source) {
    case "raw_footage":
    case "user_youtube_raw":
      return "Raw";
    case "brave_image":
      return "Brave";
    case "google_image":
      return "Google";
    case "pexels_clip":
    case "pexels_image":
      return "Pexels";
    case "pixabay_clip":
    case "pixabay_image":
      return "Pixabay";
    case "uploaded_asset":
      return "Uploaded";
    case "fallback_card":
      return "Fallback";
    case "cached_approved":
      return "Royal Library";
    default:
      return source;
  }
}
