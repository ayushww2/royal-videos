import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState, StatusBadge } from "../components/Badges";
import { api, formatDate } from "../lib/api";
import { JobRecord, friendlyStatus } from "../lib/types";

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const data = await api<{ jobs: JobRecord[] }>("/api/jobs");
    setJobs(data.jobs || []);
  }

  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function remove(jobId: string) {
    if (!confirm("Delete this job? Reports can be kept on disk.")) return;
    try {
      await api(`/api/jobs/${jobId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <AppShell
      title="Jobs"
      breadcrumbs="Documentary Video Factory / Jobs"
      actions={
        <Link className="btn btn-primary" to="/new">
          New Job
        </Link>
      }
    >
      {error && <ErrorState message={error} />}
      {loading ? (
        <LoadingState />
      ) : (
        <div className="card card-pad">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Style</th>
                  <th>Status</th>
                  <th>Scenes</th>
                  <th>Warnings</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.jobId}>
                    <td>{j.title}</td>
                    <td className="muted">{j.niche}</td>
                    <td>
                      <StatusBadge status={j.status} label={friendlyStatus(j.status)} />
                    </td>
                    <td>{j.stats?.finalScenes ?? "—"}</td>
                    <td>
                      {(j.stats?.wrongEntityWarnings || 0) + (j.stats?.repeatedVisualWarnings || 0) || 0}
                    </td>
                    <td className="dim">{formatDate(j.createdAt)}</td>
                    <td className="dim">{formatDate(j.updatedAt)}</td>
                    <td>
                      <div className="btn-row">
                        <Link className="btn btn-secondary btn-sm" to={`/jobs/${j.jobId}`}>
                          Open
                        </Link>
                        <Link className="btn btn-secondary btn-sm" to={`/jobs/${j.jobId}/scenes`}>
                          Scene Review
                        </Link>
                        <Link className="btn btn-secondary btn-sm" to={`/jobs/${j.jobId}/render`}>
                          Render
                        </Link>
                        <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(j.jobId)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!jobs.length && (
                  <tr>
                    <td colSpan={8} className="muted">
                      No jobs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
