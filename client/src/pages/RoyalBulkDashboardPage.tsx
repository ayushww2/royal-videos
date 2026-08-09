import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState, StatusBadge } from "../components/Badges";
import { RoyalAssistantPanel } from "../components/RoyalAssistantPanel";
import { api, formatTime } from "../lib/api";
import { friendlyStatus, JobRecord } from "../lib/types";

interface ManagerSummary {
  totalScenes: number;
  averageSceneDuration: number;
  exactPersonScenes: number;
  exactPlaceScenes: number;
  rawFootagePercent: number;
  lowConfidenceScenes: number;
  repeatedVisualWarnings: number;
  softApprovalFails?: number;
  softApprovalUnsure?: number;
  softApprovalChecked?: number;
  renderReady: boolean;
}

interface BulkJob extends JobRecord {
  managerSummary?: ManagerSummary | null;
}

interface Batch {
  batchId: string;
  name: string;
  status: string;
  concurrency: number;
  createdAt: string;
  jobs: BulkJob[];
}

export function RoyalBulkDashboardPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assistantJob, setAssistantJob] = useState("");
  const [name, setName] = useState("");
  const [queue, setQueue] = useState({ queued: 0, running: 0, concurrency: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [batchData, jobData] = await Promise.all([
      api<{ batches: Batch[]; queue: typeof queue }>("/api/royal-v2/batches"),
      api<{ jobs: JobRecord[] }>("/api/jobs"),
    ]);
    setBatches(batchData.batches || []);
    setQueue(batchData.queue);
    setJobs((jobData.jobs || []).filter((job) => job.niche === "Royal v2"));
  }

  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    const timer = window.setInterval(() => void load().catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const batchedIds = useMemo(
    () => new Set(batches.flatMap((batch) => batch.jobs.map((job) => job.jobId))),
    [batches]
  );
  const available = jobs.filter((job) => !batchedIds.has(job.jobId));

  async function createBatch() {
    if (!selected.size) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/royal-v2/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || `Royal batch (${selected.size})`, jobIds: [...selected] }),
      });
      setSelected(new Set());
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Royal v2 Bulk"
      breadcrumbs="Documentary Video Factory / Royal v2 Bulk"
      actions={<Link className="btn btn-primary" to="/new">New Royal v2 Job</Link>}
    >
      {error && <ErrorState message={error} />}
      {loading && <LoadingState />}
      {!loading && (
        <div className="page-grid">
          <div className="stats-grid">
            {[
              ["Batches", batches.length],
              ["Queued jobs", queue.queued],
              ["Workers active", `${queue.running}/${queue.concurrency}`],
              ["Royal jobs", jobs.length],
            ].map(([label, value]) => (
              <div className="card card-pad stat-card" key={String(label)}>
                <div className="label">{label}</div>
                <div className="value">{value}</div>
              </div>
            ))}
          </div>

          <div className="card card-pad">
            <div className="section-head">
              <h3>Create batch from Royal v2 jobs</h3>
              <span className="dim">Select 5, 10, 20, or up to 50 jobs</span>
            </div>
            <div className="field">
              <label>Batch name</label>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekly Royal batch" />
            </div>
            <div className="bulk-job-picker">
              {available.map((job) => (
                <label key={job.jobId}>
                  <input
                    type="checkbox"
                    checked={selected.has(job.jobId)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(job.jobId);
                      else next.delete(job.jobId);
                      setSelected(next);
                    }}
                  />
                  <span>{job.title}</span>
                  <span className="dim">{friendlyStatus(job.status)}</span>
                </label>
              ))}
              {!available.length && <div className="muted">Create Royal v2 jobs first, then group them here.</div>}
            </div>
            <button className="btn btn-primary" type="button" disabled={busy || !selected.size} onClick={createBatch}>
              {busy ? "Creating..." : `Create Batch (${selected.size})`}
            </button>
          </div>

          {batches.map((batch) => (
            <div className="card card-pad" key={batch.batchId}>
              <div className="section-head">
                <div>
                  <h3>{batch.name}</h3>
                  <span className="dim">{batch.batchId} · {batch.status} · concurrency {batch.concurrency}</span>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Stage</th>
                      <th>Progress</th>
                      <th>Duration</th>
                      <th>Scenes</th>
                      <th>Weak / Repeat / Soft fail</th>
                      <th>Raw</th>
                      <th>Exact person/place</th>
                      <th>GPT / Cost</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.jobs.map((job) => {
                      const summary = job.managerSummary;
                      return (
                        <tr key={job.jobId}>
                          <td>{job.title}</td>
                          <td><StatusBadge status={job.status} label={friendlyStatus(job.status)} /></td>
                          <td>{job.progressPercent ?? 0}%</td>
                          <td>{formatTime(job.voiceoverDurationSec || 0)}</td>
                          <td>{summary?.totalScenes ?? job.stats?.finalScenes ?? "—"}</td>
                          <td>
                            {summary
                              ? `${summary.lowConfidenceScenes} / ${summary.repeatedVisualWarnings} / ${summary.softApprovalFails ?? 0}`
                              : "—"}
                          </td>
                          <td>{summary ? `${summary.rawFootagePercent}%` : "—"}</td>
                          <td>{summary ? `${summary.exactPersonScenes} / ${summary.exactPlaceScenes}` : "—"}</td>
                          <td>{job.gptCallsUsed ?? 0} / ${job.estimatedCostUsd?.toFixed(2) ?? "0.00"}</td>
                          <td>
                            <div className="btn-row">
                              <Link className="btn btn-secondary btn-sm" to={`/jobs/${job.jobId}/scenes`}>Review</Link>
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAssistantJob(job.jobId)}>
                                Assistant
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {assistantJob && (
            <RoyalAssistantPanel jobId={assistantJob} onChanged={load} />
          )}
        </div>
      )}
    </AppShell>
  );
}

