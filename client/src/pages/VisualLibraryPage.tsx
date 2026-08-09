import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ConfidenceBadge, ErrorState, LoadingState, SourceBadge, WarningBadge } from "../components/Badges";
import { api } from "../lib/api";
import { ApprovedVisual, JobRecord } from "../lib/types";

export function VisualLibraryPage() {
  const { jobId } = useParams();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [items, setItems] = useState<ApprovedVisual[]>([]);
  const [selected, setSelected] = useState<ApprovedVisual | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ job: JobRecord; approved: ApprovedVisual[] }>(`/api/jobs/${jobId}/library`)
      .then((d) => {
        setJob(d.job);
        setItems(d.approved || []);
        setSelected(d.approved?.[0] || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [jobId]);

  return (
    <AppShell
      title="Approved Visual Library"
      breadcrumbs={job ? `Jobs / ${job.title} / Library` : "Library"}
      job={job}
      actions={
        <Link className="btn btn-secondary" to={`/jobs/${jobId}/scenes`}>
          Scene Review
        </Link>
      }
    >
      {error && <ErrorState message={error} />}
      {loading && <LoadingState />}
      {!loading && !items.length && (
        <div className="state-box">Visual library not built yet.</div>
      )}
      {!loading && items.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr", gap: 14 }}>
          <div className="library-grid">
            {items.map((v) => (
              <button
                key={v.approvedVisualId}
                type="button"
                className={`library-card ${selected?.approvedVisualId === v.approvedVisualId ? "active" : ""}`}
                onClick={() => setSelected(v)}
              >
                <div className="library-thumb">
                  {v.previewUrl ? <img src={v.previewUrl} alt="" /> : <span className="dim">No thumb</span>}
                </div>
                <div className="library-meta">
                  <div className="btn-row" style={{ marginBottom: 6 }}>
                    <SourceBadge source={v.source} />
                    <ConfidenceBadge value={(v.confidenceScores?.entityMatch || 0) / 100} />
                  </div>
                  <div>{v.bestUseCase}</div>
                  <div className="dim" style={{ marginTop: 4 }}>
                    beats {v.allowedBeatIds?.length || 0} · reuse {v.reuseCount || 0}
                  </div>
                  {v.warnings?.slice(0, 1).map((w) => (
                    <div key={w} style={{ marginTop: 6 }}>
                      <WarningBadge text={w} />
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>
          <div className="card card-pad">
            {selected ? (
              <>
                <h3 className="card-title">{selected.approvedVisualId}</h3>
                <div className="kv">
                  <div className="kv-row"><span>Source</span><span>{selected.source}</span></div>
                  <div className="kv-row"><span>Path/URL</span><span className="mono">{selected.filePathOrUrl}</span></div>
                  <div className="kv-row"><span>Query pack</span><span className="mono">{selected.queryPackId || "—"}</span></div>
                  <div className="kv-row"><span>People</span><span>{selected.matchedPeople?.join(", ") || "—"}</span></div>
                  <div className="kv-row"><span>Places</span><span>{selected.matchedPlaces?.join(", ") || "—"}</span></div>
                  <div className="kv-row"><span>Events</span><span>{selected.matchedEvents?.join(", ") || "—"}</span></div>
                  <div className="kv-row"><span>Documents</span><span>{selected.matchedDocuments?.join(", ") || "—"}</span></div>
                  <div className="kv-row"><span>Used by</span><span>{selected.usedByScenes?.join(", ") || "—"}</span></div>
                </div>
                <pre className="mono" style={{ whiteSpace: "pre-wrap", color: "var(--text-muted)" }}>
                  {JSON.stringify(selected.confidenceScores, null, 2)}
                </pre>
              </>
            ) : (
              <div className="muted">Select a visual</div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
