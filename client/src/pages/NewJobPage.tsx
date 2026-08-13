import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState } from "../components/Badges";
import { StyleSelectorCard } from "../components/StyleSelectorCard";
import { UploadDropzone } from "../components/UploadDropzone";
import { estimateDurationSec, formatTime, wordCount } from "../lib/api";

type ElevenLabsOptions = {
  voices: Array<{ id: string; name: string; description: string }>;
  models: Array<{ id: string; name: string; description: string }>;
  defaults: { voiceId: string; modelId: string };
  configured: boolean;
};

export function NewJobPage() {
  const nav = useNavigate();
  const [title, setTitle] = useState("");
  const [niche, setNiche] = useState("Royal v2");
  const [script, setScript] = useState("");
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [voiceoverMode, setVoiceoverMode] = useState<"upload" | "elevenlabs">("elevenlabs");
  const [voiceover, setVoiceover] = useState<File[]>([]);
  const [elevenOptions, setElevenOptions] = useState<ElevenLabsOptions | null>(null);
  const [elevenVoiceId, setElevenVoiceId] = useState("pqHfZKP75CvOlQylNhV4");
  const [elevenModelId, setElevenModelId] = useState("eleven_turbo_v2_5");
  const [rawFootage, setRawFootage] = useState<File[]>([]);
  const [youtubeRawUrls, setYoutubeRawUrls] = useState<[string, string, string]>(["", "", ""]);
  const [customEditInstructions, setCustomEditInstructions] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const words = useMemo(() => wordCount(script), [script]);
  const duration = useMemo(() => estimateDurationSec(script), [script]);
  const supportsYoutubeRaw =
    niche === "Celebrity v1" ||
    niche === "Mystery v1" ||
    niche === "Mystery v2" ||
    niche === "Space v1" ||
    niche === "War v1";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/elevenlabs/options", { credentials: "include" })
      .then((r) => r.json())
      .then((data: ElevenLabsOptions) => {
        if (cancelled || !data?.defaults) return;
        setElevenOptions(data);
        setElevenVoiceId(data.defaults.voiceId);
        setElevenModelId(data.defaults.modelId);
      })
      .catch(() => {
        /* keep hardcoded Bill + Turbo defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onScriptFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setScriptFile(file);
    const text = await file.text();
    setScript(text);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setUploadProgress(15);
    const fd = new FormData();
    fd.set("title", title || "Untitled Royal Video");
    fd.set("niche", niche);
    fd.set("script", script);
    fd.set("voiceoverMode", voiceoverMode);
    if (voiceoverMode === "elevenlabs") {
      fd.set("elevenLabsVoiceId", elevenVoiceId);
      fd.set("elevenLabsModelId", elevenModelId);
    }
    if (customEditInstructions.trim()) {
      fd.set("customEditInstructions", customEditInstructions.trim());
    }
    if (scriptFile) fd.set("scriptFile", scriptFile);
    if (voiceoverMode === "upload" && voiceover[0]) fd.set("voiceover", voiceover[0]);
    for (const f of rawFootage) fd.append("rawFootage", f);
    if (supportsYoutubeRaw) {
      const urls = youtubeRawUrls.map((u) => u.trim()).filter(Boolean);
      if (urls.length) fd.set("userYoutubeRawUrls", JSON.stringify(urls));
    }

    try {
      setUploadProgress(voiceoverMode === "elevenlabs" ? 35 : 55);
      const res = await fetch("/api/jobs", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      setUploadProgress(100);
      if (!res.ok) throw new Error(data.error || "Failed to create job");
      nav(`/jobs/${data.job.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      setUploadProgress(0);
    }
  }

  return (
    <AppShell title="New Job" breadcrumbs="Royal Videos / New Job">
      {error && <ErrorState message={error} />}
      <form onSubmit={onSubmit} className="page-grid">
        <div className="card card-pad">
          <h3 className="card-title">Project Info</h3>
          <div className="field">
            <label>Job title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Apollo 11 two-minute test" required />
          </div>
          <div className="field">
            <label>Style</label>
            <StyleSelectorCard value={niche} onChange={setNiche} />
          </div>
        </div>

        <div className="card card-pad">
          <h3 className="card-title">Script</h3>
          <div className="field">
            <label>Full script</label>
            <textarea rows={12} value={script} onChange={(e) => setScript(e.target.value)} placeholder="Paste the full documentary script..." />
          </div>
          <UploadDropzone
            label="Upload .txt script"
            accept=".txt,text/plain"
            note="Optional .txt upload fills the script field"
            onFiles={onScriptFile}
            files={scriptFile ? [scriptFile] : []}
          />
          <p className="help" style={{ marginTop: 12 }}>
            {words} words · estimated duration at 150 WPM: <strong>{formatTime(duration)}</strong>
          </p>
        </div>

        <div className="card card-pad">
          <h3 className="card-title">Voiceover</h3>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Source</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="voiceoverMode"
                  checked={voiceoverMode === "elevenlabs"}
                  onChange={() => setVoiceoverMode("elevenlabs")}
                />
                Generate with ElevenLabs
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="voiceoverMode"
                  checked={voiceoverMode === "upload"}
                  onChange={() => setVoiceoverMode("upload")}
                />
                Upload audio
              </label>
            </div>
          </div>

          {voiceoverMode === "elevenlabs" ? (
            <>
              {elevenOptions && !elevenOptions.configured && (
                <p className="help" style={{ color: "var(--danger, #b91c1c)", marginBottom: 12 }}>
                  ELEVENLABS_API_KEY is not configured on the server.
                </p>
              )}
              <div className="field">
                <label>Voice character</label>
                <select value={elevenVoiceId} onChange={(e) => setElevenVoiceId(e.target.value)}>
                  {(elevenOptions?.voices || [
                    {
                      id: "pqHfZKP75CvOlQylNhV4",
                      name: "Bill (Social Media)",
                      description: "",
                    },
                  ]).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <p className="help" style={{ marginTop: 6 }}>
                  Default: Bill (Social Media) — friendly American documentary narration
                </p>
              </div>
              <div className="field">
                <label>Model</label>
                <select value={elevenModelId} onChange={(e) => setElevenModelId(e.target.value)}>
                  {(elevenOptions?.models || [
                    { id: "eleven_turbo_v2_5", name: "Turbo v2.5", description: "" },
                  ]).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <p className="help" style={{ marginTop: 6 }}>
                  Default: Turbo v2.5 — fast high-quality narration
                </p>
              </div>
            </>
          ) : (
            <UploadDropzone
              label="Drop voiceover audio"
              accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
              note="Accepted: MP3 / WAV / M4A"
              onFiles={(fl) => setVoiceover(fl ? Array.from(fl) : [])}
              files={voiceover}
            />
          )}
        </div>

        <div className="card card-pad">
          <h3 className="card-title">Raw Footage (optional)</h3>
          <p className="help" style={{ marginBottom: 12 }}>
            Upload raw footage. The AI will find useful moments automatically.
          </p>
          <UploadDropzone
            label="Drop raw footage"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            multiple
            note="Accepted: MP4 / MOV / WebM"
            onFiles={(fl) => setRawFootage(fl ? Array.from(fl) : [])}
            files={rawFootage}
          />
          {supportsYoutubeRaw && (
            <div style={{ marginTop: 18 }}>
              <h4 className="card-title" style={{ fontSize: 15, marginBottom: 8 }}>
                Raw footage from our channel
              </h4>
              <p className="help" style={{ marginBottom: 12 }}>
                Paste up to 3 YouTube links from your channel. Cloud ingest cuts 3–5s clips and aims for
                ~20% of the cut; the rest stays images. If analysis finds weak usable footage, that ratio
                drops automatically. Only paste videos you own or have rights to use.
              </p>
              {[0, 1, 2].map((i) => (
                <div className="field" key={i}>
                  <label>YouTube link {i + 1}</label>
                  <input
                    type="url"
                    value={youtubeRawUrls[i]}
                    onChange={(e) => {
                      const next: [string, string, string] = [...youtubeRawUrls];
                      next[i] = e.target.value;
                      setYoutubeRawUrls(next);
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </div>
              ))}
            </div>
          )}
          {uploadProgress > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="progress-bar">
                <span style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="card card-pad">
          <h3 className="card-title">Custom edit instructions (optional)</h3>
          <p className="help" style={{ marginBottom: 10 }}>
            Director notes for the AI knowledge editor and Royal planner — pacing, people priority, effect style, etc.
          </p>
          <div className="field">
            <label>Instructions</label>
            <textarea
              rows={4}
              value={customEditInstructions}
              onChange={(e) => setCustomEditInstructions(e.target.value)}
              placeholder="e.g. Prefer raw footage for arrivals; keep lower thirds sparse; emphasize Charles vs Harry conflict visuals…"
            />
          </div>
        </div>

        <div className="card card-pad">
          <h3 className="card-title">Generate</h3>
          <div className="pipeline-mini">
            <span>Script Analysis</span>
            <span>→ Visual Beats</span>
            <span>→ Candidate Search</span>
            <span>→ Approved Library</span>
            <span>→ Scene Review</span>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || !script.trim()} style={{ marginTop: 16 }}>
            {busy
              ? voiceoverMode === "elevenlabs"
                ? "Generating voiceover..."
                : "Starting pipeline..."
              : "Generate Royal Video"}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
