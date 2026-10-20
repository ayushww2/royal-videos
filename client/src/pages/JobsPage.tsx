import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState, StatusBadge } from "../components/Badges";
import { api, formatDate } from "../lib/api";
import { JobRecord, friendlyStatus } from "../lib/types";

function submittedDay(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState("all");

  async function load() {
    const data = await api<{ jobs: JobRecord[] }>("/api/jobs");
    setJobs(data.jobs || []);
  }

  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs) {
      const key = submittedDay(job.createdAt);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [jobs]);

  const visible = day === "all" ? jobs : jobs.filter((job) => submittedDay(job.createdAt) === day);

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
          <div className="field" style={{ maxWidth: 360, marginBottom: 12 }}>
            <label htmlFor="job-day">Submitted on</label>
            <select id="job-day" value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="all">All dates ({jobs.length})</option>
              {days.map(([key, count]) => (
                <option key={key} value={key}>
                  {dayLabel(key)} ({count})
                </option>
              ))}
            </select>
          </div>
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
                {visible.map((j) => (
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
                {!visible.length && (
                  <tr>
                    <td colSpan={8} className="muted">
                      {jobs.length ? "No jobs submitted on this date." : "No jobs yet."}
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
