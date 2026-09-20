import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState, StatusBadge } from "../components/Badges";
import { api, formatDate } from "../lib/api";
import { isRoyalJobNiche } from "../lib/royal";
import { JobRecord, friendlyStatus } from "../lib/types";

export function RenderQueuePage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ jobs: JobRecord[] }>("/api/jobs")
      .then((d) =>
        setJobs(
          (d.jobs || []).filter(
            (j) =>
              isRoyalJobNiche(j.niche) &&
              ([
                "ready_for_scene_review",
                "scene_review_ready",
                "approved",
                "render_queued",
                "rendering",
                "completed",
                "failed",
              ].includes(j.status) ||
                j.render?.status === "completed" ||
                j.render?.status === "queued" ||
                j.render?.status === "rendering")
          )
        )
      )
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell title="Render Queue" breadcrumbs="Royal Videos / Render Queue">
      {error && <ErrorState message={error} />}
      {loading ? (
        <LoadingState />
      ) : (
        <div className="card card-pad">
          <table className="data">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Render</th>
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
                  <td className="muted">{j.render?.status || "idle"}</td>
                  <td className="dim">{formatDate(j.updatedAt)}</td>
                  <td>
                    <Link className="btn btn-secondary btn-sm" to={`/jobs/${j.jobId}/render`}>
                      Open render
                    </Link>
                  </td>
                </tr>
              ))}
              {!jobs.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    No royal jobs in render queue yet.
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
