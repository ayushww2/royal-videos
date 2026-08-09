import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  toolName?: string;
};

/**
 * GPT-5.6 Knowledge Editor chatbot (job-scoped).
 * Mount on JobStatus / SceneReview — does not own RunPod UI.
 */
export function EditorChatPanel({
  jobId,
  sceneId,
  onChanged,
  compact = false,
  docked = false,
}: {
  jobId: string;
  sceneId?: string;
  onChanged?: () => void | Promise<void>;
  compact?: boolean;
  /** Sticky full-height dock for editor workspace layouts */
  docked?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toolTrace, setToolTrace] = useState<Array<{ tool: string; result: unknown }>>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  async function loadHistory() {
    const data = await api<{ history: { messages: ChatMessage[] } }>(
      `/api/jobs/${jobId}/editor-chat`
    );
    setMessages(data.history?.messages || []);
  }

  useEffect(() => {
    loadHistory().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [jobId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!input.trim() || busy) return;
    setBusy(true);
    setError("");
    setToolTrace([]);
    const pending = input.trim();
    setInput("");
    setMessages((prev) => [
      ...prev,
      {
        id: `local_${Date.now()}`,
        role: "user",
        content: sceneId ? `[Focused scene: ${sceneId}] ${pending}` : pending,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const data = await api<{
        reply: string;
        history: { messages: ChatMessage[] };
        toolTrace?: Array<{ tool: string; result: unknown }>;
      }>(`/api/jobs/${jobId}/editor-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: pending, sceneId }),
      });
      setMessages(data.history?.messages || []);
      setToolTrace(data.toolTrace || []);
      if (
        (data.toolTrace || []).some((t) =>
          /swap|set_|enqueue|mark_|apply_|custom|revision/.test(t.tool)
        )
      ) {
        await onChanged?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearChat() {
    if (!window.confirm("Clear knowledge editor chat history for this job?")) return;
    await api(`/api/jobs/${jobId}/editor-chat`, { method: "DELETE" });
    setMessages([]);
    setToolTrace([]);
  }

  const visible = messages.filter((m) => m.role === "user" || m.role === "assistant");

  return (
    <div
      className={`card card-pad editor-chat-panel ${compact ? "compact" : ""} ${docked ? "docked" : ""}`}
    >
      <div className="section-head section-head-tight">
        <div>
          <h3>AI Knowledge Editor</h3>
          <span className="dim">
            GPT-5.6 · {sceneId ? `scene ${sceneId}` : "full timeline"}
          </span>
        </div>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => void clearChat()}>
          Clear
        </button>
      </div>

      <div className="ke-messages">
        {!visible.length && (
          <div className="muted">
            Ask to list scenes, search the royal library, swap visuals, apply revision notes, or
            enqueue RunPod render.
          </div>
        )}
        {visible.map((m) => (
          <div key={m.id} className={`ke-bubble ke-${m.role}`}>
            <div className="ke-role">{m.role === "user" ? "You" : "Editor"}</div>
            <div className="ke-text">{m.content}</div>
          </div>
        ))}
        {busy && <div className="muted">Editor working…</div>}
        <div ref={bottomRef} />
      </div>

      {toolTrace.length > 0 && (
        <div className="ke-tools dim">
          Tools: {toolTrace.map((t) => t.tool).join(" → ")}
        </div>
      )}
      {error && <div style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div>}

      <form onSubmit={send} style={{ marginTop: 10 }}>
        <textarea
          id={docked ? "editor-chat-input" : undefined}
          rows={compact ? 2 : 3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Show weak scenes, swap scene 12 with Charles archive, render on RunPod ASAP…"
        />
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !input.trim()}>
            {busy ? "Working…" : "Send"}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={busy}
            onClick={() => setInput("Get job status and render progress")}
          >
            Status
          </button>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={busy}
            onClick={() => setInput("Enqueue RunPod render now")}
          >
            Render ASAP
          </button>
        </div>
      </form>
    </div>
  );
}
