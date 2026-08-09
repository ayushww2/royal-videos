import { FormEvent, useState } from "react";
import { api } from "../lib/api";

interface AssistantAction {
  action: string;
  target: string;
  reason: string;
  before: unknown;
  after: unknown;
  requiresConfirmation: boolean;
  applied?: boolean;
}

interface Alternative {
  assetId?: string;
  person?: string;
  mediaType?: string;
  category?: string;
  description?: string;
  previewUrl?: string;
  scores?: Record<string, number>;
}

export function RoyalAssistantPanel({
  jobId,
  sceneId,
  onChanged,
  compact = false,
}: {
  jobId?: string;
  sceneId?: string;
  onChanged?: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [action, setAction] = useState<AssistantAction | null>(null);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);

  async function send(payload?: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      if (!jobId) {
        const data = await api<{ assets: Alternative[] }>(
          `/api/royal-v2/library/search?q=${encodeURIComponent(message)}&limit=20`
        );
        setAlternatives(data.assets || []);
        setReply(`Found ${data.assets?.length || 0} Royal Media Library assets.`);
        setAction(null);
        return;
      }
      const data = await api<{
        action: AssistantAction;
        message: string;
        alternatives?: Alternative[];
      }>(`/api/royal-v2/jobs/${jobId}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || { message, sceneId }),
      });
      setReply(data.message);
      setAction(data.action);
      setAlternatives(data.alternatives || []);
      if (data.action?.applied) await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    void send();
  }

  const confirm = (assetId?: string) => {
    if (!action) return;
    void send({
      action: assetId ? "replace_visual" : action.action,
      sceneId,
      assetId,
      message,
      confirmed: true,
    });
  };

  return (
    <div className={`card card-pad royal-assistant ${compact ? "compact" : ""}`}>
      <div className="section-head">
        <h3>Royal v2 Assistant</h3>
        <span className="dim">{jobId ? (sceneId ? `Scene ${sceneId}` : "Current job") : "Royal library"}</span>
      </div>
      <form onSubmit={submit}>
        <textarea
          rows={compact ? 2 : 3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={
            jobId
              ? "Ask: fix repeated visuals, use more raw footage, explain this choice..."
              : "Search people, places, or royal context..."
          }
        />
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={busy || !message.trim()} type="submit">
            {busy ? "Working..." : "Ask Assistant"}
          </button>
          {action?.requiresConfirmation && !action.applied && (
            <button className="btn btn-secondary btn-sm" disabled={busy} type="button" onClick={() => confirm()}>
              Confirm action
            </button>
          )}
        </div>
      </form>
      {error && <div style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div>}
      {reply && <div className="muted" style={{ marginTop: 10 }}>{reply}</div>}
      {action && (
        <div className="dim" style={{ marginTop: 6 }}>
          {action.action} · {action.applied ? "applied" : action.requiresConfirmation ? "confirmation required" : "read only"}
        </div>
      )}
      {alternatives.length > 0 && (
        <div className="assistant-alternatives">
          {alternatives.slice(0, compact ? 4 : 10).map((item, index) => (
            <div className="assistant-alternative" key={item.assetId || index}>
              {item.previewUrl && (
                item.mediaType === "raw_footage" ? (
                  <video src={item.previewUrl} muted preload="metadata" />
                ) : (
                  <img src={item.previewUrl} alt={item.person || "Royal alternative"} />
                )
              )}
              <div>
                <strong>{item.person || item.assetId || "Alternative"}</strong>
                <div className="dim">{item.mediaType} · {item.category}</div>
                {jobId && sceneId && item.assetId && (
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => confirm(item.assetId)}>
                    Replace with this
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

