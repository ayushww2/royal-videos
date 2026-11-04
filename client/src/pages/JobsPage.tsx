import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState, StatusBadge } from "../components/Badges";
import { api, formatDate } from "../lib/api";
import { JobRecord, friendlyStatus } from "../lib/types";

type JobTab = "past" | "ready" | "done" | "finalized";

function submittedDay(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayOptionLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatVo(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

function watchUrl(job: JobRecord): string {
  return job.render?.outputUrl || job.render?.shotstackUrl || "";
}

/** Done is a finished render that was marked delivered. Finalized is the lock. Ready is scene review. Past is everything still in the pipeline. */
export function jobTab(job: JobRecord): JobTab {
  if (job.render?.status === "completed" && job.render.delivered === true) return "done";
  if (job.status === "finalized" || job.timelineLock?.locked) return "finalized";
  if (job.status === "scene_review_ready" || job.status === "ready_for_scene_review") return "ready";
  return "past";
}

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState("all");
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");
  const [params] = useSearchParams();
  const requested = params.get("tab");
  const tab: JobTab =
    requested === "past" || requested === "done" || requested === "finalized" || requested === "ready"
      ? requested
      : "ready";

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

  const visible = useMemo(() => {
    const filtered = jobs.filter((job) => jobTab(job) === tab && (day === "all" || submittedDay(job.createdAt) === day));
    return [...filtered].sort((a, b) => {
      const byTime = a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId);
      return sort === "oldest" ? byTime : -byTime;
    });
  }, [jobs, tab, day, sort]);

  const numbers = useMemo(() => {
    const ordered = [...visible].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId)
    );
    return new Map(ordered.map((job, index) => [job.jobId, index + 1]));
  }, [visible]);

  async function remove(jobId: string) {
    if (!confirm("Delete this job? Reports can be kept on disk.")) return;
    try {
      await api(`/api/jobs/${jobId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function moveBack(jobId: string) {
    try {
      await api(`/api/jobs/${jobId}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivered: false }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function copyLink(job: JobRecord) {
    const url = watchUrl(job);
    if (!url) {
      setError("This job has no watch link yet.");
      return;
    }
    const absolute = /^https?:\/\//i.test(url) ? url : `${window.location.origin}${url}`;
    await navigator.clipboard.writeText(absolute);
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
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field" style={{ maxWidth: 220, marginBottom: 12 }}>
              <label htmlFor="job-sort">Sort</label>
              <select id="job-sort" value={sort} onChange={(e) => setSort(e.target.value === "newest" ? "newest" : "oldest")}>
                <option value="oldest">Oldest first</option>
                <option value="newest">Newest first</option>
              </select>
            </div>
            <div className="field" style={{ maxWidth: 360, marginBottom: 12 }}>
              <label htmlFor="job-day">Date</label>
              <select id="job-day" value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="all">All dates ({jobs.length})</option>
                {days.map(([key, count]) => (
                  <option key={key} value={key}>
                    {dayOptionLabel(key)} ({count})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Title</th>
                  <th>Style</th>
                  <th>Status</th>
                  <th>Scenes</th>
                  <th>VO</th>
                  <th>Warnings</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((j) => {
                  const href = watchUrl(j);
                  return (
                    <tr key={j.jobId}>
                      <td>#{numbers.get(j.jobId) ?? "—"}</td>
                      <td>{j.title}</td>
                      <td className="muted">{j.niche}</td>
                      <td>
                        <StatusBadge status={j.status} label={friendlyStatus(j.status)} />
                      </td>
                      <td>
                        {j.scenesFilled ?? "—"} / {j.sceneTotal ?? j.stats?.finalScenes ?? "—"} filled
                      </td>
                      <td className="dim">{formatVo(j.voiceoverDurationSec)}</td>
                      <td>
                        {(j.stats?.wrongEntityWarnings || 0) + (j.stats?.repeatedVisualWarnings || 0) || 0}
                      </td>
                      <td className="dim">{formatDate(j.createdAt)}</td>
                      <td className="dim">{formatDate(j.updatedAt)}</td>
                      <td>
                        <div className="btn-row">
                          {tab === "done" && (
                            <>
                              {href ? (
                                <a className="btn btn-secondary btn-sm" href={href} target="_blank" rel="noreferrer">
                                  Watch
                                </a>
                              ) : (
                                <button className="btn btn-secondary btn-sm" type="button" disabled>
                                  Watch
                                </button>
                              )}
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => copyLink(j)}>
                                Copy link
                              </button>
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => moveBack(j.jobId)}>
                                Move back
                              </button>
                            </>
                          )}
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
                  );
                })}
                {!visible.length && (
                  <tr>
                    <td colSpan={10} className="muted">
                      {jobs.length ? "No jobs in this tab." : "No jobs yet."}
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
