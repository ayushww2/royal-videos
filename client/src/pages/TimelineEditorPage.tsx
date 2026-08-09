import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { AssembledTimelineEditor } from "../components/AssembledTimelineEditor";
import { ErrorState, LoadingState } from "../components/Badges";
import { EditorChatPanel } from "../components/EditorChatPanel";
import {
  enqueueJobRender,
  fetchJobRenderStatus,
  fetchTimeline,
  getJobPlayableUrl,
  type EffectPresetOption,
  type TimelineEffectEvent,
  type TimelineMusicEvent,
  type TimelineSfxEvent,
} from "../lib/api";
import { JobRecord, Scene } from "../lib/types";

function focusEditorChat() {
  const dock = document.getElementById("timeline-chat-dock");
  dock?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  dock?.classList.add("chat-focus-pulse");
  window.setTimeout(() => dock?.classList.remove("chat-focus-pulse"), 1200);
  const input = document.getElementById("editor-chat-input") as HTMLTextAreaElement | null;
  window.setTimeout(() => input?.focus(), 180);
}

export function TimelineEditorPage() {
  const { jobId } = useParams();
  const [searchParams] = useSearchParams();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [effectPresets, setEffectPresets] = useState<EffectPresetOption[]>([]);
  const [musicEvents, setMusicEvents] = useState<TimelineMusicEvent[]>([]);
  const [sfxEvents, setSfxEvents] = useState<TimelineSfxEvent[]>([]);
  const [effectEvents, setEffectEvents] = useState<TimelineEffectEvent[]>([]);
  const [approvedAssets, setApprovedAssets] = useState<
    import("../lib/api").TimelineApprovedAsset[]
  >([]);
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | undefined>();
  const [durationSec, setDurationSec] = useState<number | undefined>();
  const [selectedId, setSelectedId] = useState("");
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [rendering, setRendering] = useState(false);
  const [playableUrl, setPlayableUrl] = useState<string | undefined>();

  async function load() {
    if (!jobId) return;
    const data = await fetchTimeline(jobId);
    setJob(data.job);
    setScenes(data.scenes || []);
    setEffectPresets(data.effectPresets || []);
    setMusicEvents(data.musicEvents || []);
    setSfxEvents(data.sfxEvents || []);
    setEffectEvents(data.effectEvents || []);
    setApprovedAssets(data.approvedAssets || []);
    setVoiceoverUrl(data.voiceoverUrl);
    setDurationSec(data.durationSec);
    setLocked(Boolean(data.locked));
    const fromQuery = searchParams.get("scene") || "";
    const hasQueryScene = Boolean(fromQuery && data.scenes?.some((s) => s.sceneId === fromQuery));
    setSelectedId((prev) => prev || (hasQueryScene ? fromQuery : "") || data.scenes?.[0]?.sceneId || "");
    try {
      const rs = await fetchJobRenderStatus(jobId);
      setPlayableUrl(getJobPlayableUrl(data.job, rs));
    } catch {
      setPlayableUrl(getJobPlayableUrl(data.job, null));
    }
  }

  async function renderOnRunpod() {
    if (!jobId) return;
    setRendering(true);
    setError("");
    setMsg("");
    try {
      await enqueueJobRender(jobId, { force: false });
      setMsg("RunPod render queued.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  }

  useEffect(() => {
    load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) {
    return (
      <AppShell title="Timeline Editor">
        <LoadingState label="Loading assembled timeline..." />
      </AppShell>
    );
  }

  const renderBusy =
    job?.status === "render_queued" ||
    job?.status === "rendering" ||
    job?.render?.status === "queued" ||
    job?.render?.status === "rendering";

  const selected = scenes.find((s) => s.sceneId === selectedId) || scenes[0];

  return (
    <AppShell
      title="Timeline Editor"
      breadcrumbs={job ? `Jobs / ${job.title} / Timeline` : "Timeline Editor"}
      job={job}
      contentClassName="content-tool content-ate"
    >
      <div className="vidrush-editor assembled-timeline">
        <header className="vr-topbar">
          <div className="vr-topbar-main">
            <div className="vr-brand-dot" aria-hidden />
            <div>
              <h1 className="vr-title">{job?.title || "Assembled timeline"}</h1>
              <p className="vr-meta">
                Assembled edit · {scenes.length} scenes
                {locked ? " · locked" : ""}
                {musicEvents.length ? ` · ${musicEvents.length} music` : ""}
                {sfxEvents.length ? ` · ${sfxEvents.length} sfx` : ""}
                {effectEvents.length ? ` · ${effectEvents.length} fx` : ""}
              </p>
            </div>
          </div>
          <div className="vr-topbar-actions">
            <Link className="vr-ghost-btn" to={`/jobs/${jobId}`}>
              Status
            </Link>
            <Link className="vr-ghost-btn" to={`/jobs/${jobId}/scenes`}>
              Scenes
            </Link>
            {playableUrl ? (
              <a className="vr-ghost-btn" href={playableUrl} target="_blank" rel="noreferrer">
                Final play
              </a>
            ) : null}
            <button
              className="vr-render-btn"
              type="button"
              disabled={rendering || renderBusy || !job}
              onClick={() => void renderOnRunpod()}
            >
              {rendering || renderBusy ? "Rendering…" : "Render Video"}
            </button>
          </div>
        </header>

        {error && <ErrorState message={error} />}
        {msg && (
          <div className="inline-toast success" role="status">
            {msg}
          </div>
        )}
        {locked && (
          <div className="vr-lock-banner">
            Timeline locked — edits disabled. Unlock from Scene Review to change assignments.
          </div>
        )}

        {!scenes.length ? (
          <div className="state-box">
            No timeline scenes yet — wait for visual assignment to finish.
            <div style={{ marginTop: 12 }}>
              <Link to={`/jobs/${jobId}`}>Back to status</Link>
            </div>
          </div>
        ) : (
          jobId && (
            <AssembledTimelineEditor
              jobId={jobId}
              scenes={scenes}
              setScenes={setScenes}
              effectPresets={effectPresets}
              locked={locked}
              musicEvents={musicEvents}
              sfxEvents={sfxEvents}
              effectEvents={effectEvents}
              approvedAssets={approvedAssets}
              voiceoverUrl={voiceoverUrl}
              voiceoverDurationSec={job?.voiceoverDurationSec}
              durationSec={durationSec}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              setMsg={setMsg}
              onReload={load}
              onFocusChat={focusEditorChat}
            />
          )
        )}

        {jobId && (
          <div id="timeline-chat-dock" className="timeline-chat-dock">
            <EditorChatPanel
              jobId={jobId}
              sceneId={selected?.sceneId}
              compact
              docked
              onChanged={async () => {
                await load();
              }}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
