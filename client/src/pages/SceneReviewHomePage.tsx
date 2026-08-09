import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState, StatusBadge } from "../components/Badges";
import { api, formatDate } from "../lib/api";
import { JobRecord, friendlyStatus } from "../lib/types";

export function SceneReviewHomePage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ jobs: JobRecord[] }>("/api/jobs")
      .then((d) =>
        setJobs(
          (d.jobs || []).filter((j) =>
            ["ready_for_scene_review", "scene_review_ready", "approved", "completed", "render_queued", "rendering"].includes(j.status)
          )
        )
      )
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell title="Scene Review" breadcrumbs="Documentary Video Factory / Scene Review">
      {error && <ErrorState message={error} />}
      {loading ? (
        <LoadingState />
      ) : (
        <div className="card card-pad">
          <p className="help" style={{ marginTop: 0 }}>
            Select a job that is ready for scene review.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Scenes</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.jobId}>
                  <td>{j.title}</td>
                  <td>
                    <StatusBadge status={j.status} label={friendlyStatus(j.status)} />
                  </td>
                  <td>{j.stats?.finalScenes ?? "—"}</td>
                  <td className="dim">{formatDate(j.updatedAt)}</td>
                  <td>
                    <div className="btn-row">
                      <Link className="btn btn-primary btn-sm" to={`/jobs/${j.jobId}/scenes`}>
                        Scene Review
                      </Link>
                      <Link className="btn btn-secondary btn-sm" to={`/jobs/${j.jobId}/timeline`}>
                        Timeline
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {!jobs.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    No jobs ready for review yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
