import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState, StatusBadge } from "../components/Badges";
import { api, formatTime } from "../lib/api";
import { JobRecord } from "../lib/types";

interface RenderInfo {
  job: JobRecord;
  approvedScenesCount: number;
  rejectedScenesCount: number;
  totalScenes: number;
  warningsCount: number;
  durationEstimate: number;
  needsAttention: number;
  checklist: Record<string, boolean>;
  blockedReasons: string[];
  canRender: boolean;
  qa: any;
  render: JobRecord["render"];
}

export function RenderPage() {
  const { jobId } = useParams();
  const [info, setInfo] = useState<RenderInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api<RenderInfo>(`/api/jobs/${jobId}/render-info`);
    setInfo(data);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    const t = setInterval(() => {
      load().catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [jobId]);

  async function renderNow() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/jobs/${jobId}/render`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!info && !error) {
    return (
      <AppShell title="Render">
        <LoadingState />
      </AppShell>
    );
  }

  const checklistLabels: Record<string, string> = {
    allScenesHaveVisuals: "All scenes have visuals",
    noCriticalWrongEntity: "No critical wrong entity warning",
    noMissingApprovedVisual: "No missing approved visual",
    sceneReviewReady: "Scene Review ready",
    sceneReviewApproved: "Scene Review approved",
    finalTimelineSaved: "Final timeline saved",
    libraryBuilt: "Visual library built",
    qaCanRender: "Final QA passed",
  };

  return (
    <AppShell
      title="Render"
      breadcrumbs={info ? `Jobs / ${info.job.title} / Render` : "Render"}
      job={info?.job}
      actions={
        <Link className="btn btn-secondary" to={`/jobs/${jobId}/scenes`}>
          Scene Review
        </Link>
      }
    >
      {error && <ErrorState message={error} />}
      {info && (
        <div className="page-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="card card-pad">
            <h3 className="card-title">Render summary</h3>
            <div className="stats-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="stat-card"><div className="label">Approved</div><div className="value">{info.approvedScenesCount}</div></div>
              <div className="stat-card"><div className="label">Rejected</div><div className="value">{info.rejectedScenesCount}</div></div>
              <div className="stat-card"><div className="label">Warnings</div><div className="value">{info.warningsCount}</div></div>
              <div className="stat-card"><div className="label">Duration</div><div className="value" style={{ fontSize: 22 }}>{formatTime(info.durationEstimate)}</div></div>
            </div>
            {info.needsAttention > 0 && (
              <p className="help" style={{ color: "var(--warning)", marginTop: 12 }}>
                {info.needsAttention} scenes need attention
              </p>
            )}
            {info.blockedReasons?.map((r) => (
              <p key={r} className="help" style={{ color: "var(--danger)" }}>{r}</p>
            ))}
            <div style={{ marginTop: 16 }}>
              <StatusBadge
                status={
                  info.render?.status === "completed"
                    ? "completed"
                    : info.render?.status === "failed"
                      ? "failed"
                      : info.render?.status === "rendering" || info.render?.status === "queued"
                        ? "rendering"
                        : "uploaded"
                }
                label={info.render?.status || "idle"}
              />
            </div>
            <button
              className="btn btn-primary"
              type="button"
              style={{ marginTop: 16 }}
              disabled={
                busy ||
                !info.canRender ||
                info.render?.status === "queued" ||
                info.render?.status === "rendering"
              }
              onClick={renderNow}
            >
              {busy || info.render?.status === "queued" || info.render?.status === "rendering"
                ? `Rendering… ${info.render?.progressPercent ?? info.job.progressPercent ?? 0}%`
                : "Render on RunPod / MP4"}
            </button>
            {(info.render?.status === "queued" || info.render?.status === "rendering") && (
              <div style={{ marginTop: 12 }}>
                <div className="progress-bar">
                  <span
                    style={{
                      width: `${info.render?.progressPercent ?? info.job.progressPercent ?? 0}%`,
                    }}
                  />
                </div>
                <p className="help" style={{ marginTop: 6 }}>
                  {info.render?.message || info.render?.status}
                  {info.render?.runpodPodId ? ` · pod ${info.render.runpodPodId}` : ""}
                </p>
              </div>
            )}
            {(info.render?.outputUrl || info.render?.shotstackUrl || info.render?.outputKey) &&
              info.render?.status === "completed" && (
                <div style={{ marginTop: 14 }}>
                  <video
                    controls
                    src={
                      info.render.outputUrl ||
                      info.render.shotstackUrl ||
                      `/media/${info.render.outputKey}`
                    }
                    style={{ width: "100%", maxHeight: 320, borderRadius: 10, background: "#000" }}
                  />
                </div>
              )}
          </div>

          <div className="card card-pad">
            <h3 className="card-title">Readiness checklist</h3>
            <div className="checklist">
              {Object.entries(info.checklist || {}).map(([k, ok]) => (
                <div className="check-item" key={k}>
                  <span>{checklistLabels[k] || k}</span>
                  <span className={ok ? "badge badge-success" : "badge badge-danger"}>{ok ? "pass" : "fail"}</span>
                </div>
              ))}
            </div>
            {info.render?.shotstackUrl && (
                <div style={{ marginTop: 12 }}>
                  <p className="help">Shotstack URL</p>
                  <a className="mono" href={info.render.shotstackUrl} target="_blank" rel="noreferrer">
                    {info.render.shotstackUrl}
                  </a>
                  {info.render.shotstackId && (
                    <p className="help">Shotstack ID: {info.render.shotstackId}</p>
                  )}
                </div>
              )}
              {info.render?.outputKey && (
              <div style={{ marginTop: 16 }}>
                <p className="help">outputKey</p>
                <p className="mono">{info.render.outputKey}</p>
                <p className="help">path</p>
                <p className="mono">{info.render.outputPath}</p>
                {info.render.outputKey && (
                  <a className="btn btn-secondary btn-sm" href={`/media/${info.render.outputKey.replace(/^renders\//, "renders/")}`} target="_blank" rel="noreferrer">
                    Preview / download MP4
                  </a>
                )}
                {info.render.shotstackUrl && (
                  <a className="btn btn-primary btn-sm" href={info.render.shotstackUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>
                    Open Shotstack MP4
                  </a>
                )}
                <div style={{ marginTop: 10 }}>
                  <a className="btn btn-secondary btn-sm" href={`/api/jobs/${jobId}/reports/render-audit`} target="_blank" rel="noreferrer">
                    Render audit report
                  </a>
                </div>
              </div>
            )}
            {!info.render?.outputKey && info.render?.shotstackUrl && (
              <div style={{ marginTop: 16 }}>
                <a className="btn btn-primary btn-sm" href={info.render.shotstackUrl} target="_blank" rel="noreferrer">
                  Open Shotstack MP4
                </a>
              </div>
            )}
            {info.qa && (
              <pre className="mono" style={{ marginTop: 16, whiteSpace: "pre-wrap", color: "var(--text-muted)" }}>
                {JSON.stringify(info.qa, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
