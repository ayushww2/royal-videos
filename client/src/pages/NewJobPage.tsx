import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState } from "../components/Badges";

const MAX_JOBS = 20;

type Draft = {
  id: string;
  title: string;
  script: File | null;
  voiceover: File | null;
};

function emptyDraft(): Draft {
  return { id: crypto.randomUUID(), title: "", script: null, voiceover: null };
}

export function NewJobPage() {
  const nav = useNavigate();
  const [jobs, setJobs] = useState<Draft[]>([emptyDraft(), emptyDraft()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  function update(id: string, patch: Partial<Draft>) {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ready = jobs.filter((job) => job.script && job.voiceover);
    if (!ready.length) {
      setError("Each job needs a Word script and a voiceover.");
      return;
    }
    const incomplete = jobs.some((job) => (job.script || job.voiceover || job.title.trim()) && !(job.script && job.voiceover));
    if (incomplete) {
      setError("Finish every started job: title, Word script, and voiceover.");
      return;
    }
    setBusy(true);
    setError("");
    const created: string[] = [];
    try {
      for (let i = 0; i < ready.length; i++) {
        const job = ready[i];
        setProgress(`Creating job ${i + 1} of ${ready.length}`);
        const fd = new FormData();
        fd.set("title", job.title.trim() || "Untitled Documentary");
        fd.set("niche", "Royal v3");
        fd.set("voiceoverMode", "upload");
        fd.set("scriptFile", job.script!);
        fd.set("voiceover", job.voiceover!);
        const res = await fetch("/api/jobs", { method: "POST", body: fd, credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Job ${i + 1} failed`);
        created.push(data.job.jobId);
      }
      nav(created.length === 1 ? `/jobs/${created[0]}` : "/jobs");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <AppShell title="New Job" breadcrumbs="Documentary Video Factory / New Job">
      <p className="help" style={{ marginBottom: 16 }}>
        Each job is one Word script and one voiceover. You can submit up to 20 at a time. Each non-empty script line becomes one landscape scene. Style is Royal v3.
      </p>
      {error && <ErrorState message={error} />}
      <form onSubmit={onSubmit}>
        {jobs.map((job, index) => (
          <div className="card card-pad" key={job.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 className="card-title" style={{ margin: 0 }}>Job {index + 1}</h3>
              <button
                className="btn"
                type="button"
                disabled={jobs.length === 1 || busy}
                onClick={() => setJobs((current) => current.filter((item) => item.id !== job.id))}
              >
                Remove
              </button>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>Job title</label>
              <input
                value={job.title}
                onChange={(e) => update(job.id, { title: e.target.value })}
                placeholder="Job title"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label className="card card-pad" style={{ cursor: "pointer", textAlign: "center" }}>
                <strong>Upload .docx script</strong>
                <p className="help">One visual per line. Empty lines are skipped.</p>
                <input
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  hidden
                  onChange={(e) => update(job.id, { script: e.target.files?.[0] || null })}
                />
                {job.script && <p className="help">{job.script.name}</p>}
              </label>
              <label className="card card-pad" style={{ cursor: "pointer", textAlign: "center" }}>
                <strong>Upload voiceover</strong>
                <p className="help">MP3 or WAV. The original is stored; timing uses a compressed copy.</p>
                <input
                  type="file"
                  accept="audio/mpeg,audio/wav,.mp3,.wav"
                  hidden
                  onChange={(e) => update(job.id, { voiceover: e.target.files?.[0] || null })}
                />
                {job.voiceover && <p className="help">{job.voiceover.name}</p>}
              </label>
            </div>
          </div>
        ))}
        <div className="card card-pad" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            className="btn"
            type="button"
            disabled={busy || jobs.length >= MAX_JOBS}
            onClick={() => setJobs((current) => [...current, emptyDraft()])}
          >
            Add another job ({jobs.length}/{MAX_JOBS})
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? progress || "Creating jobs" : `Create ${jobs.filter((job) => job.script && job.voiceover).length || jobs.length} jobs`}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
