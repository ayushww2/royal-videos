import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ConfidenceBadge, ErrorState, LoadingState, SourceBadge, WarningBadge } from "../components/Badges";
import { api, formatTime } from "../lib/api";
import { JobRecord, Scene } from "../lib/types";
import { EditorChatPanel } from "../components/EditorChatPanel";
import { RoyalAssistantPanel } from "../components/RoyalAssistantPanel";

type Filter =
  | "all"
  | "needs"
  | "low_editor"
  | "weak_title"
  | "weak_narration"
  | "text_heavy"
  | "crop"
  | "needs_better"
  | "wrong"
  | "repeated"
  | "raw"
  | "approved"
  | "rejected"
  | "watermark"
  | "altered"
  | "with_effects"
  | "lower_thirds"
  | "slideshows"
  | "reveals"
  | "glitch"
  | "effect_spacing";

function matchLabel(s: Scene): string {
  switch (s.matchType) {
    case "exact_match":
      return "Exact Match";
    case "strong_match":
      return "Strong Match";
    case "good_context":
      return "Good Context";
    case "related_context":
      return "Related Context";
    case "needs_better_visual":
      return "Needs Better Visual";
    default:
      return s.needsBetterVisual ? "Needs Better Visual" : "Match";
  }
}

export function SceneReviewPage() {
  const { jobId } = useParams();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [approvals, setApprovals] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const initializedRoyalFilter = useRef(false);

  async function load() {
    const data = await api<{ job: JobRecord; scenes: Scene[]; approvals: Record<string, string> }>(
      `/api/jobs/${jobId}/scenes`
    );
    setJob(data.job);
    setScenes(data.scenes || []);
    setApprovals(data.approvals || {});
    const firstFlagged = data.scenes?.find(
      (scene) =>
        scene.needsBetterVisual ||
        scene.confidence < 0.7 ||
        scene.repeatDistanceWarning ||
        (scene.warnings || []).length > 0
    );
    setSelectedId((prev) => prev || firstFlagged?.sceneId || data.scenes?.[0]?.sceneId || "");
    if (data.job.niche === "Royal v2" && !initializedRoyalFilter.current) {
      setFilter("needs");
      initializedRoyalFilter.current = true;
    }
  }

  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [jobId]);

  const filtered = useMemo(() => {
    return scenes.filter((s) => {
      const ap = approvals[s.sceneId] || "pending";
      const editor = s.confidenceScores?.visualEditorScore ?? s.confidence * 100;
      const title = s.confidenceScores?.titleSupportScore ?? 100;
      const narr = s.confidenceScores?.narrationMatchScore ?? 100;
      const horiz = s.confidenceScores?.horizontalUsability ?? s.confidenceScores?.cropSafety16x9 ?? 100;

      if (filter === "needs") return ap !== "approved" || s.needsBetterVisual || editor < 70;
      if (filter === "low_editor") return editor < 70;
      if (filter === "weak_title") return title < 70;
      if (filter === "weak_narration") return narr < 70;
      if (filter === "text_heavy") return !!s.isTextHeavy || s.warnings?.some((w) => w.includes("text-heavy"));
      if (filter === "crop") return horiz < 75 || s.warnings?.some((w) => w.includes("crop"));
      if (filter === "needs_better") return !!s.needsBetterVisual || s.matchType === "needs_better_visual";
      if (filter === "wrong") {
        return s.warnings?.some((w) => w.includes("wrong"));
      }
      if (filter === "repeated") return !!s.repeatDistanceWarning || s.warnings?.includes("repeated too close");
      if (filter === "raw")
        return s.source === "raw_footage" || s.source === "user_youtube_raw" || !!s.rawFootageUsed;
      if (filter === "approved") return ap === "approved";
      if (filter === "rejected") return ap === "rejected";
      if (filter === "watermark") {
        return (
          s.warnings?.some((w) => w.includes("watermark")) ||
          (s.confidenceScores?.watermarkRisk ?? s.confidenceScores?.watermarkTextRisk ?? 0) > 15
        );
      }
      if (filter === "altered") {
        return s.warnings?.some((w) => w.includes("altered text") || w.includes("baked"));
      }
      if (filter === "with_effects") return (s.effects?.length || 0) > 0;
      if (filter === "lower_thirds") {
        return s.effects?.some((e) => e.presetId.startsWith("01_") || e.presetId.startsWith("02_"));
      }
      if (filter === "slideshows") {
        return s.effects?.some((e) =>
          ["04_", "05_", "06_", "07_", "10_"].some((p) => e.presetId.startsWith(p))
        );
      }
      if (filter === "reveals") return s.effects?.some((e) => e.presetId.startsWith("08_"));
      if (filter === "glitch") return s.effects?.some((e) => e.presetId.startsWith("09_"));
      if (filter === "effect_spacing") {
        return s.warnings?.some((w) => w.toLowerCase().includes("effect") || w.includes("spacing"));
      }
      return true;
    });
  }, [scenes, approvals, filter]);

  const selected = scenes.find((s) => s.sceneId === selectedId) || filtered[0] || scenes[0];

  async function act(action: string, body?: object) {
    if (!selected) return;
    setMsg("");
    setError("");
    const url =
      action === "use-source"
        ? `/api/jobs/${jobId}/scenes/${selected.sceneId}/use-source`
        : `/api/jobs/${jobId}/scenes/${selected.sceneId}/${action}`;
    try {
      const data = await api<{ ok?: boolean; message?: string; approvals?: Record<string, string> }>(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (data.message) setMsg(data.message);
      if (data.approvals) setApprovals(data.approvals);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function lockRoyalTimeline() {
    if (!jobId || !window.confirm("Approve every scene and lock this Royal v2 timeline for rendering?")) return;
    setError("");
    try {
      await api(`/api/jobs/${jobId}/approve-all`, { method: "POST" });
      await api(`/api/royal-v2/jobs/${jobId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockedBy: "manager" }),
      });
      setMsg("Royal v2 timeline approved and locked.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function unlockRoyalTimeline() {
    if (!jobId || !window.confirm("Unlocking allows scene changes and requires another full approval. Continue?")) return;
    try {
      await api(`/api/royal-v2/jobs/${jobId}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, unlockedBy: "manager" }),
      });
      setMsg("Timeline unlocked.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return (
      <AppShell title="Scene Review">
        <LoadingState label="Loading scenes..." />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Scene Review"
      breadcrumbs={job ? `Jobs / ${job.title} / Scene Review` : "Scene Review"}
      job={job}
      contentClassName="content-tool"
      actions={
        <div className="btn-row">
          {job?.niche === "Royal v2" && (
            job.timelineLock?.locked ? (
              <button className="btn btn-secondary btn-sm" type="button" onClick={unlockRoyalTimeline}>Unlock Timeline</button>
            ) : (
              <button className="btn btn-primary btn-sm" type="button" onClick={lockRoyalTimeline}>Approve All & Lock</button>
            )
          )}
          <Link className="btn btn-secondary btn-sm" to={`/jobs/${jobId}`}>
            Status
          </Link>
          <Link className="btn btn-secondary btn-sm" to={`/jobs/${jobId}/timeline`}>
            Timeline
          </Link>
          <Link className="btn btn-primary btn-sm" to={`/jobs/${jobId}/render`}>
            Render
          </Link>
        </div>
      }
    >
      {error && <ErrorState message={error} />}
      {msg && <div className="card card-pad" style={{ marginBottom: 12, color: "var(--success)" }}>{msg}</div>}

      {!scenes.length ? (
        <div className="state-box">
          No scenes yet — wait for the pipeline to finish assembling the timeline.
          <div style={{ marginTop: 12 }}>
            <Link to={`/jobs/${jobId}`}>Back to status</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="filters">
            {(
              [
                ["all", "All scenes"],
                ["needs", "Needs human review"],
                ["low_editor", "Low editor score"],
                ["weak_title", "Weak title support"],
                ["weak_narration", "Weak narration match"],
                ["text_heavy", "Text-heavy visuals"],
                ["crop", "Crop risk"],
                ["needs_better", "Needs Better Visual"],
                ["wrong", "Wrong context"],
                ["repeated", "Repeated visual"],
                ["raw", "Raw footage"],
                ["watermark", "Possible watermark"],
                ["altered", "Possible altered text"],
                ["with_effects", "Scenes with effects"],
                ["lower_thirds", "Lower thirds"],
                ["slideshows", "Slideshows"],
                ["reveals", "Reveal questions"],
                ["glitch", "Glitch transitions"],
                ["effect_spacing", "Effect spacing warning"],
                ["approved", "Approved"],
                ["rejected", "Rejected"],
              ] as Array<[Filter, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`filter-chip ${filter === id ? "active" : ""}`}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="scene-board">
            <div className="card card-pad scene-list">
              {filtered.map((s, i) => {
                const ap = approvals[s.sceneId] || "pending";
                return (
                  <button
                    key={s.sceneId}
                    type="button"
                    className={`scene-item ${selected?.sceneId === s.sceneId ? "active" : ""}`}
                    onClick={() => setSelectedId(s.sceneId)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>Scene {scenes.indexOf(s) + 1}</strong>
                      <span className="dim">{formatTime(s.startTime)}</span>
                    </div>
                    <div className="btn-row" style={{ marginTop: 8 }}>
                      <SourceBadge source={s.source} />
                      <ConfidenceBadge value={s.confidence} />
                      {s.beatType === "exact_person" && s.matchType === "exact_match" && <WarningBadge text="Exact Person Match" />}
                      {s.beatType === "exact_place" && s.matchType === "exact_match" && <WarningBadge text="Exact Place Match" />}
                      {s.rawFootageUsed && <WarningBadge text="Raw Clip" />}
                      {s.warnings?.length > 0 && <WarningBadge text="!" />}
                    </div>
                    <div className="dim" style={{ marginTop: 6, fontSize: 11 }}>
                      {matchLabel(s)} · {ap}
                      {s.fromApprovedLibrary ? " · library" : ""}
                    </div>
                    <div className="muted" style={{ marginTop: 4, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.mainPerson || s.specificPlace || s.narrationText || "—"}
                    </div>
                    <span className="dim" style={{ display: "none" }}>{i}</span>
                  </button>
                );
              })}
              {!filtered.length && <div className="muted">No scenes match this filter.</div>}
            </div>

            <div className="card card-pad preview-stage">
              {selected && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div>
                      <strong>{selected.sceneId}</strong>
                      <div className="help">
                        {formatTime(selected.startTime)} – {formatTime(selected.endTime)} · {selected.duration.toFixed(1)}s · {matchLabel(selected)}
                      </div>
                    </div>
                    <div className="btn-row">
                      <SourceBadge source={selected.source} />
                      <ConfidenceBadge value={selected.confidence} />
                    </div>
                  </div>
                  <div className="preview-frame">
                    {!selected.previewUrl ? (
                      <div className="fallback-card">Needs Better Visual · no preview</div>
                    ) : selected.previewUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                      <video src={selected.previewUrl} controls style={{ width: "100%", height: "100%" }} />
                    ) : (
                      <img src={selected.previewUrl} alt={selected.sceneId} />
                    )}
                  </div>
                  <p className="muted" style={{ margin: "8px 0 0" }}>
                    <strong>On screen:</strong>{" "}
                    {selected.mainPerson ||
                      selected.specificPlace ||
                      selected.pairOrGroup?.join(" & ") ||
                      "—"}
                  </p>
                  <p className="muted" style={{ margin: "6px 0 0" }}>{selected.narrationText}</p>
                </>
              )}
            </div>

            <div className="card card-pad detail-panel">
              {selected && (
                <>
                  <h3 className="card-title">Editor judgment</h3>
                  <div className="kv">
                    <div className="kv-row"><span>Match type</span><span>{matchLabel(selected)}</span></div>
                    <div className="kv-row"><span>Source</span><span>{selected.source}</span></div>
                    <div className="kv-row"><span>Beat type</span><span>{selected.beatType || "—"}</span></div>
                    <div className="kv-row"><span>Main person</span><span>{selected.mainPerson || "—"}</span></div>
                    <div className="kv-row"><span>Pair / group</span><span>{selected.pairOrGroup?.join(", ") || "—"}</span></div>
                    <div className="kv-row"><span>Specific place</span><span>{selected.specificPlace || "—"}</span></div>
                    <div className="kv-row"><span>Context</span><span>{selected.contextType || "—"}</span></div>
                    <div className="kv-row"><span>Library</span><span>{selected.fromApprovedLibrary ? "Approved visual library" : "Check report"}</span></div>
                    <div className="kv-row"><span>Why title</span><span>{selected.whyThisMatchesTitle || "—"}</span></div>
                    <div className="kv-row"><span>Why narration</span><span>{selected.whyThisMatchesNarration || "—"}</span></div>
                    <div className="kv-row"><span>Why appropriate</span><span>{selected.whyThisIsAppropriate || selected.reasonSelected}</span></div>
                    <div className="kv-row"><span>What is missing</span><span>{selected.whatIsMissing || "—"}</span></div>
                    <div className="kv-row"><span>Editor score</span><span>{selected.confidenceScores?.visualEditorScore ?? Math.round(selected.confidence * 100)}</span></div>
                    <div className="kv-row"><span>Title support</span><span>{selected.confidenceScores?.titleSupportScore ?? "—"}</span></div>
                    <div className="kv-row"><span>Narration match</span><span>{selected.confidenceScores?.narrationMatchScore ?? "—"}</span></div>
                    <div className="kv-row"><span>Horizontal</span><span>{selected.confidenceScores?.horizontalUsability ?? selected.confidenceScores?.cropSafety16x9 ?? "—"}</span></div>
                    <div className="kv-row"><span>Needs better</span><span>{selected.needsBetterVisual ? "yes" : "no"}</span></div>
                    <div className="kv-row"><span>Text-heavy</span><span>{selected.isTextHeavy ? "yes" : "no"}</span></div>
                    <div className="kv-row"><span>Identity confidence</span><span>{selected.identityConfidence ?? "—"}</span></div>
                    <div className="kv-row"><span>Place confidence</span><span>{selected.placeConfidence ?? "—"}</span></div>
                    <div className="kv-row"><span>Uses in video</span><span>{selected.assetUsageCountVideo ?? "—"}</span></div>
                    <div className="kv-row"><span>Uses this minute</span><span>{selected.assetUsageCountCurrentMinute ?? "—"}</span></div>
                    <div className="kv-row"><span>Raw alternative</span><span>{selected.rawFootageAvailable ? "available" : "—"}</span></div>
                    <div className="kv-row"><span>Approval</span><span>{approvals[selected.sceneId] || "pending"}</span></div>
                  </div>
                  {(selected.effects?.length || 0) > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <h3 className="card-title" style={{ fontSize: 14 }}>Editing effects</h3>
                      {selected.effects!.map((e) => (
                        <div key={e.id} className="card card-pad" style={{ marginBottom: 8, padding: 10 }}>
                          <div className="mono" style={{ fontSize: 12 }}>{e.presetId}</div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{e.reason || "—"}</div>
                          <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                            {e.durationFrames}f · Remotion preset → Shotstack
                            {e.renderable === false
                              ? " · Will not appear in final render"
                              : e.simplified
                                ? " · Shotstack simplified version"
                                : " · renderable"}
                            {e.blocksSubtitles ? " · may block subtitles" : ""}
                          </div>
                          {e.renderReason && (
                            <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{e.renderReason}</div>
                          )}
                          {e.renderWarning && (
                            <div style={{ marginTop: 6 }}><WarningBadge text={e.renderWarning} /></div>
                          )}
                          {e.renderable === false && (
                            <div style={{ marginTop: 6 }}><WarningBadge text="Will not appear in final render" /></div>
                          )}
                          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
                            props: {JSON.stringify(
                              Object.fromEntries(
                                Object.entries(e.props || {}).filter(([k]) => !k.startsWith("_"))
                              )
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {selected.warnings?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      {selected.warnings.map((w) => (
                        <div key={w} style={{ marginBottom: 6 }}>
                          <WarningBadge text={w} />
                        </div>
                      ))}
                    </div>
                  )}
                  {selected.confidenceScores && (
                    <pre className="mono" style={{ whiteSpace: "pre-wrap", color: "var(--text-muted)" }}>
                      {JSON.stringify(selected.confidenceScores, null, 2)}
                    </pre>
                  )}
                  <div className="btn-row" style={{ marginTop: 12 }}>
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => act("approve")}>Approve</button>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => act("reject")}>Reject</button>
                    {job?.niche !== "Royal v2" && (
                      <>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => act("find-better")}>Find Better Visual</button>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => act("use-source", { prefer: "raw" })}>Use Raw Footage</button>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => act("use-source", { prefer: "image" })}>Use Image Instead</button>
                      </>
                    )}
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => act("mark-needs-better")}>Mark Needs Better</button>
                  </div>
                </>
              )}
            </div>
          </div>
          {jobId && (
            <div style={{ marginTop: 16 }}>
              <EditorChatPanel
                jobId={jobId}
                sceneId={selected?.sceneId}
                compact
                onChanged={load}
              />
            </div>
          )}
          {job?.niche === "Royal v2" && (
            <div style={{ marginTop: 16 }}>
              <RoyalAssistantPanel
                jobId={jobId}
                sceneId={selected?.sceneId}
                onChanged={load}
              />
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
