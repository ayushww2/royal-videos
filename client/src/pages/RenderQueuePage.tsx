import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState, StatusBadge } from "../components/Badges";
import { api, formatDate } from "../lib/api";
import { JobRecord, friendlyStatus } from "../lib/types";

function lockDay(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayHeading(day: string, count: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return `${label}, ${count} ${count === 1 ? "job" : "jobs"}`;
}

export function RenderQueuePage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ jobs: JobRecord[] }>("/api/jobs")
      .then((d) => setJobs((d.jobs || []).filter((job) => job.timelineLock?.locked)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const byDay = new Map<string, JobRecord[]>();
    for (const job of jobs) {
      const key = lockDay(job.timelineLock?.lockedAt) || "unknown";
      const list = byDay.get(key) || [];
      list.push(job);
      byDay.set(key, list);
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, list]) => ({
        day,
        jobs: [...list].sort(
          (a, b) =>
            (a.timelineLock?.lockedAt || "").localeCompare(b.timelineLock?.lockedAt || "") ||
            a.jobId.localeCompare(b.jobId)
        ),
      }));
  }, [jobs]);

  return (
    <AppShell title="Render Queue" breadcrumbs="Documentary Video Factory / Render Queue">
      {error && <ErrorState message={error} />}
      {loading ? (
        <LoadingState />
      ) : (
        <div className="card card-pad">
          {!groups.length && <p className="muted">No approved and locked jobs yet.</p>}
          {groups.map((group) => (
            <section key={group.day} style={{ marginBottom: 20 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{dayHeading(group.day, group.jobs.length)}</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Title</th>
                      <th>Scenes</th>
                      <th>Locked</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.jobs.map((job, index) => (
                      <tr key={job.jobId}>
                        <td>#{index + 1}</td>
                        <td>{job.title}</td>
                        <td>
                          {job.scenesFilled ?? "—"} / {job.sceneTotal ?? job.stats?.finalScenes ?? "—"} filled
                        </td>
                        <td className="dim">{formatDate(job.timelineLock?.lockedAt)}</td>
                        <td>
                          <StatusBadge status={job.status} label={friendlyStatus(job.status)} />
                        </td>
                        <td>
                          <Link className="btn btn-secondary btn-sm" to={`/jobs/${job.jobId}/render`}>
                            Open render
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
