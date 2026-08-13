import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState } from "../components/Badges";
import { api } from "../lib/api";

export function SettingsPage() {
  const [health, setHealth] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/health")
      .then(setHealth)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <AppShell title="Settings" breadcrumbs="Royal Videos / Settings">
      {error && <ErrorState message={error} />}
      {!health && !error && <LoadingState />}
      {health && (
        <div className="page-grid" style={{ maxWidth: 720 }}>
          <div className="card card-pad">
            <h3 className="card-title">API configuration</h3>
            <div className="kv">
              <div className="kv-row">
                <span>Status</span>
                <span>{health.ok ? "Ready" : "Missing keys"}</span>
              </div>
              <div className="kv-row">
                <span>Model</span>
                <span className="mono">{health.model}</span>
              </div>
              <div className="kv-row">
                <span>Shotstack</span>
                <span>{health.shotstackConfigured ? "Configured (stage)" : "Missing SHOTSTACK_API_KEY"}</span>
              </div>
              <div className="kv-row">
                <span>Pexels</span>
                <span>{health.pexelsConfigured ? "Configured" : "Missing PEXELS_API_KEY"}</span>
              </div>
              <div className="kv-row">
                <span>Pixabay</span>
                <span>{health.pixabayConfigured ? "Configured" : "Missing PIXABAY_API_KEY"}</span>
              </div>
              <div className="kv-row">
                <span>Renderer</span>
                <span className="mono">{health.renderer || "shotstack"}</span>
              </div>
              <div className="kv-row">
                <span>Persistent volume</span>
                <span>{health.persistentVolume ? "Yes (/data)" : "No — jobs may wipe on redeploy"}</span>
              </div>
              {!health.ok && (
                <div className="kv-row">
                  <span>Missing</span>
                  <span style={{ color: "var(--danger)" }}>{(health.missing || []).join(", ")}</span>
                </div>
              )}
            </div>
            <p className="help">
              Set `OPENAI_API_KEY` and `SEARCHAPI_API_KEY` in Railway Variables or local `.env`. OpenAI uses ContactBoxTools (`OPENAI_BASE_URL`) with model `gpt-5.5`. Image search uses Google Images via SearchAPI.
            </p>
            {health.shotstackNote && <p className="help">{health.shotstackNote}</p>}
          </div>
          <div className="card card-pad">
            <h3 className="card-title">Storage</h3>
            <div className="kv">
              <div className="kv-row">
                <span>STORAGE_PATH</span>
                <span className="mono">{health.storagePath}</span>
              </div>
              <div className="kv-row">
                <span>DATA_PATH</span>
                <span className="mono">{health.dataPath}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
