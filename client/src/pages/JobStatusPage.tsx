import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState, StatusBadge } from "../components/Badges";
import { ProgressSteps, pipelinePercent } from "../components/ProgressSteps";
import {
  api,
  enqueueJobRender,
  fetchJobRenderStatus,
  fetchTimeline,
  getJobPlayableUrl,
  patchJobCustomInstructions,
  type JobRenderStatus,
} from "../lib/api";
import { JobRecord, Scene, friendlyStatus } from "../lib/types";
import { EditorChatPanel } from "../components/EditorChatPanel";
import { RoyalAssistantPanel } from "../components/RoyalAssistantPanel";
import { TimelineStrip } from "../components/TimelineStrip";

export function JobStatusPage() {
  const { jobId } = useParams();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [renderStatus, setRenderStatus] = useState<JobRenderStatus | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [stripSelectedId, setStripSelectedId] = useState("");
  const [reports, setReports] = useState<
    Array<{ key: string; label: string; available: boolean; url: string | null }>
  >([]);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [msg, setMsg] = useState("");
  const [showPipeline, setShowPipeline] = useState(false);
  const instructionsInit = useRef(false);
  const instructionsDirty = useRef(false);

  useEffect(() => {
    let alive = true;
    instructionsInit.current = false;
    instructionsDirty.current = false;

    async function load() {
      try {
        const data = await api<{ job: JobRecord }>(`/api/jobs/${jobId}`);
        if (!alive) return;
        setJob(data.job);
        if (!instructionsInit.current) {
          setCustomInstructions(data.job.customEditInstructions || "");
          instructionsInit.current = true;
        } else if (!instructionsDirty.current) {
          setCustomInstructions(data.job.customEditInstructions || "");
        }
        const rep = await api<{ reports: typeof reports }>(`/api/jobs/${jobId}/reports`);
        if (alive) setReports(rep.reports || []);
        const rs = await fetchJobRenderStatus(jobId!);
        if (alive) setRenderStatus(rs);
        try {
          const tl = await fetchTimeline(jobId!);
          if (alive) {
            setScenes(tl.scenes || []);
            setStripSelectedId((prev) => prev || tl.scenes?.[0]?.sceneId || "");
          }
        } catch {
          /* timeline optional until assignment finishes */
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [jobId]);

  async function retryPipeline() {
    if (!jobId) return;
    setRetrying(true);
    setError("");
    try {
      const data = await api<{ job: JobRecord }>(`/api/jobs/${jobId}/retry`, { method: "POST" });
      setJob(data.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }

  async function saveInstructions() {
    if (!jobId) return;
    setSavingInstructions(true);
    setError("");
    setMsg("");
    try {
      const data = await patchJobCustomInstructions(jobId, customInstructions);
      setJob(data.job);
      instructionsDirty.current = false;
      setMsg("Custom edit instructions saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingInstructions(false);
    }
  }

  async function renderOnRunpod(force = false) {
    if (!jobId) return;
    setRendering(true);
    setError("");
    setMsg("");
    try {
      if (renderStatus?.setupError && renderStatus.rendererConfigured === "runpod") {
        throw new Error(renderStatus.setupError);
      }
      const data = await enqueueJobRender(jobId, { force });
      setMsg(
        data.podId
          ? `RunPod render queued (pod ${data.podId}). Progress updates below.`
          : data.queued
            ? "Render queued."
            : "Render started."
      );
      setRenderStatus(await fetchJobRenderStatus(jobId));
      const refreshed = await api<{ job: JobRecord }>(`/api/jobs/${jobId}`);
      setJob(refreshed.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  }

  if (error && !job) {
    return (
      <AppShell title="Job Status">
        <ErrorState message={error} />
      </AppShell>
    );
  }
  if (!job) {
    return (
      <AppShell title="Job Status">
        <LoadingState label="Loading job..." />
      </AppShell>
    );
  }

  const pct =
    job.niche === "Royal v2"
      ? job.progressPercent ?? 0
      : pipelinePercent(job.status, job.lastSuccessfulStatus);
  const ready = ["ready_for_scene_review", "scene_review_ready", "approved", "completed"].includes(
    job.status
  );
  const renderBusy =
    job.status === "render_queued" ||
    job.status === "rendering" ||
    job.render?.status === "queued" ||
    job.render?.status === "rendering";
  const playableUrl = getJobPlayableUrl(job, renderStatus);
  const renderPct =
    renderStatus?.progressPercent ??
    job.render?.progressPercent ??
    (renderBusy ? job.progressPercent ?? 0 : 0);
  const renderComplete = job.render?.status === "completed" || job.status === "completed";

  return (
    <AppShell
      title="Editor"
      breadcrumbs={`Jobs / ${job.title}`}
      job={job}
      contentClassName="content-tool"
      actions={
        ready ? (
          <Link className="btn btn-primary btn-sm" to={`/jobs/${job.jobId}/scenes`}>
            Scene Review
          </Link>
        ) : job.status === "failed" ? (
          <button className="btn btn-primary btn-sm" type="button" disabled={retrying} onClick={retryPipeline}>
            {retrying ? "Retrying..." : "Retry pipeline"}
          </button>
        ) : undefined
      }
    >
      <div className="job-action-bar sticky-bar">
        <div className="job-action-bar-main">
          <StatusBadge status={job.status} label={friendlyStatus(job.status)} />
          <span className="dim job-action-meta">
            {pct}% · {job.niche}
          </span>
        </div>
        <div className="btn-row job-action-btns">
          <button
            className="btn btn-primary btn-sm"
            type="button"
            disabled={rendering || renderBusy || !ready}
            onClick={() => void renderOnRunpod(false)}
          >
            {rendering || renderBusy ? "Rendering…" : "Render RunPod"}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={rendering || renderBusy || !ready}
            onClick={() => void renderOnRunpod(true)}
          >
            Force
          </button>
          <Link className="btn btn-secondary btn-sm" to={`/jobs/${job.jobId}/timeline`}>
            Timeline
          </Link>
          <Link className="btn btn-secondary btn-sm" to={`/jobs/${job.jobId}/scenes`}>
            Scenes
          </Link>
          {playableUrl && (
            <a className="btn btn-secondary btn-sm" href={playableUrl} target="_blank" rel="noreferrer">
              Play
            </a>
          )}
        </div>
      </div>

      {msg && (
        <div className="inline-toast success" role="status">
          {msg}
        </div>
      )}
      {(job.error || error) && <ErrorState message={job.error || error} />}

      <div className="job-workspace">
        <div className="job-workspace-main">
          <div className="card card-pad-sm job-player-card">
            <div className="section-head section-head-tight">
              <div>
                <h3>{job.title}</h3>
                <p className="help mono" style={{ margin: "2px 0 0" }}>
                  {job.jobId}
                </p>
              </div>
              <Link className="btn btn-secondary btn-sm" to={`/jobs/${job.jobId}/render`}>
                Render page
              </Link>
            </div>

            {playableUrl && renderComplete ? (
              <video
                key={playableUrl}
                controls
                src={playableUrl}
                className="job-player-video"
              />
            ) : (
              <div className="job-player-placeholder">
                <span className="dim">
                  {renderBusy
                    ? `Rendering… ${renderPct}%`
                    : ready
                      ? "No playable output yet — render on RunPod"
                      : "Pipeline still running — render when ready"}
                </span>
              </div>
            )}

            <div className="job-render-meta">
              {renderStatus?.setupError && (
                <p className="help" style={{ color: "var(--warning)", margin: "0 0 6px" }}>
                  Setup: {renderStatus.setupError}
                </p>
              )}
              {!renderStatus?.runpodReady && renderStatus?.rendererConfigured !== "runpod" && (
                <p className="help" style={{ margin: "0 0 6px" }}>
                  Renderer: <strong>{renderStatus?.rendererConfigured || "—"}</strong>. Set{" "}
                  <span className="mono">RENDERER=runpod</span> to enqueue on RunPod.
                </p>
              )}
              <p className="help" style={{ margin: 0 }}>
                Render: {job.render?.status || "idle"}
                {renderStatus?.runpodMode ? ` · ${renderStatus.runpodMode}` : ""}
                {job.render?.runpodRunId ? ` · run ${job.render.runpodRunId}` : ""}
                {job.render?.runpodPodId ? ` · pod ${job.render.runpodPodId}` : ""}
                {job.render?.message ? ` · ${job.render.message}` : ""}
              </p>
              {(renderBusy || renderComplete || job.render?.status === "failed") && (
                <div style={{ marginTop: 8 }}>
                  <div className="help" style={{ marginBottom: 4 }}>
                    Render {renderPct}%
                  </div>
                  <div className="progress-bar progress-bar-sm">
                    <span style={{ width: `${renderPct}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card card-pad-sm">
            <div className="section-head section-head-tight">
              <h3 className="card-title" style={{ margin: 0 }}>
                Custom edit instructions
              </h3>
            </div>
            <p className="help" style={{ margin: "0 0 8px" }}>
              Director notes for Royal v2 planning — applied on the next plan/revise pass.
            </p>
            <textarea
              rows={3}
              value={customInstructions}
              onChange={(e) => {
                setCustomInstructions(e.target.value);
                instructionsDirty.current = true;
              }}
              placeholder="e.g. Prefer raw footage for arrivals; keep lower thirds sparse…"
            />
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              style={{ marginTop: 8 }}
              disabled={savingInstructions}
              onClick={() => void saveInstructions()}
            >
              {savingInstructions ? "Saving…" : "Save instructions"}
            </button>
          </div>

          {scenes.length > 0 ? (
            <div className="job-timeline-block">
              <TimelineStrip
                scenes={scenes}
                selectedId={stripSelectedId}
                onSelect={setStripSelectedId}
                headerExtra={
                  <Link
                    className="btn btn-secondary btn-sm"
                    to={
                      stripSelectedId
                        ? `/jobs/${job.jobId}/timeline?scene=${encodeURIComponent(stripSelectedId)}`
                        : `/jobs/${job.jobId}/timeline`
                    }
                  >
                    Open full timeline
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="card card-pad-sm">
              <div className="section-head section-head-tight">
                <h3 className="card-title" style={{ margin: 0 }}>
                  Timeline
                </h3>
                <Link className="btn btn-secondary btn-sm" to={`/jobs/${job.jobId}/timeline`}>
                  Open timeline
                </Link>
              </div>
              <p className="help" style={{ margin: 0 }}>
                Scenes appear here after visual assignment finishes.
              </p>
            </div>
          )}

          <div className="job-secondary-row">
            <div className="card card-pad-sm">
              <div className="section-head section-head-tight">
                <h3 className="card-title" style={{ margin: 0 }}>
                  Quick links
                </h3>
              </div>
              <div className="btn-row">
                <Link className="btn btn-secondary btn-sm" to={`/jobs/${job.jobId}/scenes`}>
                  Scenes
                </Link>
                <Link className="btn btn-secondary btn-sm" to={`/jobs/${job.jobId}/library`}>
                  Visual Library
                </Link>
                <Link className="btn btn-secondary btn-sm" to={`/jobs/${job.jobId}/timeline`}>
                  Timeline
                </Link>
                <Link className="btn btn-secondary btn-sm" to={`/jobs/${job.jobId}/render`}>
                  Render
                </Link>
              </div>
              {reports.length > 0 && (
                <div className="btn-row" style={{ marginTop: 10 }}>
                  {reports.map((r) =>
                    r.available && r.url ? (
                      <a
                        key={r.key}
                        className="btn btn-secondary btn-sm"
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.label}
                      </a>
                    ) : (
                      <span key={r.key} className="badge badge-neutral">
                        {r.label}
                      </span>
                    )
                  )}
                </div>
              )}
            </div>

            <div className="card card-pad-sm">
              <button
                type="button"
                className="job-disclosure"
                onClick={() => setShowPipeline((v) => !v)}
              >
                <span>Pipeline · {pct}%</span>
                <span className="dim">{showPipeline ? "Hide" : "Show"}</span>
              </button>
              {showPipeline && (
                <div style={{ marginTop: 10 }}>
                  {job.status === "failed" && (
                    <div className="btn-row" style={{ marginBottom: 10 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        disabled={retrying}
                        onClick={retryPipeline}
                      >
                        {retrying ? "Retrying..." : "Retry from checkpoint"}
                      </button>
                    </div>
                  )}
                  <div className="progress-bar progress-bar-sm" style={{ marginBottom: 10 }}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <ProgressSteps
                    status={job.status}
                    lastSuccessfulStatus={job.lastSuccessfulStatus}
                    niche={job.niche}
                  />
                  <pre
                    className="mono"
                    style={{
                      margin: "12px 0 0",
                      whiteSpace: "pre-wrap",
                      color: "var(--text-muted)",
                      maxHeight: 160,
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(job.stats || { message: "Stats appear after analysis" }, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {job.niche === "Royal v2" && (
            <div className="job-assistant-slot">
              <RoyalAssistantPanel jobId={job.jobId} />
            </div>
          )}
        </div>

        <aside className="job-workspace-chat">
          <EditorChatPanel
            jobId={job.jobId}
            docked
            onChanged={async () => {
              const data = await api<{ job: JobRecord }>(`/api/jobs/${jobId}`);
              setJob(data.job);
              try {
                const rs = await fetchJobRenderStatus(jobId!);
                setRenderStatus(rs);
              } catch {
                /* render status optional */
              }
              try {
                const tl = await fetchTimeline(jobId!);
                setScenes(tl.scenes || []);
              } catch {
                /* optional */
              }
            }}
          />
        </aside>
      </div>
    </AppShell>
  );
}
