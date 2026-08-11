import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState, StatusBadge } from "../components/Badges";
import { api, formatDate } from "../lib/api";
import { isRoyalJobNiche } from "../lib/royal";
import { JobRecord, friendlyStatus } from "../lib/types";

export function DashboardPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ jobs: JobRecord[] }>("/api/jobs")
      .then((d) => setJobs((d.jobs || []).filter((j) => isRoyalJobNiche(j.niche))))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    return {
      total: jobs.length,
      processing: jobs.filter((j) =>
        [
          "uploaded",
          "analyzing_full_script",
          "creating_visual_beats",
          "creating_query_packs",
          "collecting_visual_candidates",
          "judging_candidates",
          "building_approved_visual_library",
          "assembling_timeline",
          "queued",
          "script_analysis",
          "beat_breakdown",
          "library_candidate_collection",
          "visual_assignment",
          "repetition_audit",
          "weak_scene_repair",
          "effect_planning",
          "render_queued",
          "rendering",
        ].includes(j.status)
      ).length,
      ready: jobs.filter((j) =>
        ["ready_for_scene_review", "scene_review_ready", "approved"].includes(j.status)
      ).length,
      completed: jobs.filter((j) => j.status === "completed" || j.render?.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
    };
  }, [jobs]);

  return (
    <AppShell
      title="Dashboard"
      breadcrumbs="Royal Videos / Dashboard"
      actions={
        <Link className="btn btn-primary" to="/new">
          New Job
        </Link>
      }
    >
      {error && <ErrorState message={error} />}
      {loading && <LoadingState />}
      {!loading && !error && (
        <div className="page-grid">
          <div className="stats-grid">
            {[
              ["Total royal jobs", stats.total],
              ["Jobs processing", stats.processing],
              ["Ready for review", stats.ready],
              ["Completed renders", stats.completed],
              ["Failed jobs", stats.failed],
            ].map(([label, value]) => (
              <div className="card card-pad stat-card" key={String(label)}>
                <div className="label">{label}</div>
                <div className="value">{value}</div>
              </div>
            ))}
          </div>

          <div className="card card-pad">
            <div className="section-head">
              <h3>Recent royal jobs</h3>
              <Link to="/jobs">View all</Link>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Style</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Scenes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.slice(0, 8).map((j) => (
                    <tr key={j.jobId}>
                      <td>{j.title}</td>
                      <td className="muted">{j.niche}</td>
                      <td>
                        <StatusBadge status={j.status} label={friendlyStatus(j.status)} />
                      </td>
                      <td className="dim">{formatDate(j.createdAt)}</td>
                      <td>{j.stats?.finalScenes ?? "—"}</td>
                      <td>
                        <Link className="btn btn-secondary btn-sm" to={`/jobs/${j.jobId}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {!jobs.length && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No royal jobs yet. Create a job to start.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
