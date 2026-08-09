import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  formatTime,
  patchTimeline,
  searchEditorLibrary,
  swapTimelineVisual,
  type EffectPresetOption,
  type LibrarySearchHit,
  type TimelineApprovedAsset,
  type TimelineEffectEvent,
  type TimelineMusicEvent,
  type TimelineSfxEvent,
} from "../lib/api";
import {
  assembleTimelineModel,
  effectsAtPlayhead,
  isVideoMediaUrl,
  sceneAtPlayhead,
} from "../lib/assembleTimelineModel";
import type { Scene } from "../lib/types";
import { SourceBadge, WarningBadge } from "./Badges";
import { MultiTrackTimeline } from "./MultiTrackTimeline";
import { TimelinePreview } from "./TimelinePreview";

type TrackFilter = "all" | "media" | "text" | "audio" | "effects";

function shortPreset(id: string): string {
  return id.replace(/^\d+_/, "").replace(/_/g, " ").slice(0, 22);
}

function shortSfx(id: string): string {
  return id.replace(/_/g, " ");
}

function intentLabel(scene: Scene): string {
  return (
    scene.selectionIntent ||
    scene.mainPerson ||
    scene.specificPlace ||
    scene.pairOrGroup?.join(" & ") ||
    scene.beatType ||
    "—"
  );
}

function focusEditorChat() {
  const dock = document.getElementById("timeline-chat-dock");
  dock?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  dock?.classList.add("chat-focus-pulse");
  window.setTimeout(() => dock?.classList.remove("chat-focus-pulse"), 1200);
  const input = document.getElementById("editor-chat-input") as HTMLTextAreaElement | null;
  window.setTimeout(() => input?.focus(), 180);
}

const railTools: Array<{
  id: TrackFilter | "ai" | "history";
  label: string;
  title: string;
  icon: ReactNode;
}> = [
  {
    id: "text",
    label: "T",
    title: "Text / captions",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 7V5h16v2M12 5v14M9 19h6" />
      </svg>
    ),
  },
  {
    id: "audio",
    label: "Audio",
    title: "Audio tracks",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
      </svg>
    ),
  },
  {
    id: "media",
    label: "Media",
    title: "Video / media",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "ai",
    label: "AI",
    title: "AI Knowledge Editor",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l1.2 3.8L17 7l-3.8 1.2L12 12l-1.2-3.8L7 7l3.8-1.2L12 2z" />
        <path d="M19 13l.8 2.4L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.6L19 13z" opacity="0.85" />
        <path d="M6 14l.7 2L9 17l-2.3.7L6 20l-.7-2.3L3 17l2.3-.9L6 14z" opacity="0.7" />
      </svg>
    ),
  },
  {
    id: "effects",
    label: "FX",
    title: "Transitions / effects",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6z" />
      </svg>
    ),
  },
  {
    id: "history",
    label: "Hist",
    title: "History (view all tracks)",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
];

export function AssembledTimelineEditor({
  jobId,
  scenes,
  setScenes,
  effectPresets,
  locked,
  musicEvents = [],
  sfxEvents = [],
  effectEvents = [],
  approvedAssets = [],
  voiceoverUrl,
  voiceoverDurationSec,
  durationSec,
  selectedId,
  setSelectedId,
  busy,
  setBusy,
  setError,
  setMsg,
  onReload,
  onFocusChat,
}: {
  jobId: string;
  scenes: Scene[];
  setScenes: (scenes: Scene[]) => void;
  effectPresets: EffectPresetOption[];
  locked: boolean;
  musicEvents?: TimelineMusicEvent[];
  sfxEvents?: TimelineSfxEvent[];
  effectEvents?: TimelineEffectEvent[];
  approvedAssets?: TimelineApprovedAsset[];
  voiceoverUrl?: string;
  voiceoverDurationSec?: number;
  durationSec?: number;
  selectedId: string;
  setSelectedId: (id: string) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string) => void;
  setMsg: (v: string) => void;
  onReload: () => Promise<void>;
  onFocusChat?: () => void;
}) {
  const model = useMemo(
    () =>
      assembleTimelineModel({
        scenes,
        musicEvents,
        sfxEvents,
        effectEvents,
        voiceoverUrl,
        voiceoverDurationSec,
        durationSec,
      }),
    [scenes, musicEvents, sfxEvents, effectEvents, voiceoverUrl, voiceoverDurationSec, durationSec]
  );

  const selected = scenes.find((s) => s.sceneId === selectedId) || scenes[0];
  const [playhead, setPlayhead] = useState(() => selected?.startTime || 0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(42);
  const [trackFilter, setTrackFilter] = useState<TrackFilter>("all");
  const [inspectorTab, setInspectorTab] = useState<"scene" | "assets">("scene");
  const [assetFilter, setAssetFilter] = useState<"used" | "all">("used");
  const [notes, setNotes] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryHits, setLibraryHits] = useState<LibrarySearchHit[]>([]);
  const voRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTs = useRef<number | null>(null);
  const playheadRef = useRef(playhead);

  const usedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of scenes) {
      const id = s.approvedVisualId || s.selectedVisualId;
      if (id) ids.add(id);
    }
    return ids;
  }, [scenes]);

  const usedAssets = useMemo(() => {
    const fromLibrary = approvedAssets.filter((a) => usedAssetIds.has(a.approvedVisualId));
    if (fromLibrary.length) return fromLibrary;
    // Fallback: synthesize from scenes when approved library list is empty
    const seen = new Set<string>();
    const out: TimelineApprovedAsset[] = [];
    for (const s of scenes) {
      const id = s.approvedVisualId || s.selectedVisualId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        approvedVisualId: id,
        previewUrl: s.previewUrl,
        source: s.source,
        bestUseCase: s.selectionIntent || s.pickReason,
        matchedPeople: s.mainPerson ? [s.mainPerson] : [],
        matchedPlaces: s.specificPlace ? [s.specificPlace] : [],
        usedByScenes: scenes
          .filter((x) => (x.approvedVisualId || x.selectedVisualId) === id)
          .map((x) => x.sceneId),
        reuseCount: scenes.filter((x) => (x.approvedVisualId || x.selectedVisualId) === id).length,
      });
    }
    return out;
  }, [approvedAssets, scenes, usedAssetIds]);

  const collectedAssets = useMemo(() => {
    if (approvedAssets.length) return approvedAssets;
    return usedAssets;
  }, [approvedAssets, usedAssets]);

  const assetBin = assetFilter === "used" ? usedAssets : collectedAssets;

  const selectedAsset = useMemo(() => {
    if (!selected) return null;
    const id = selected.approvedVisualId || selected.selectedVisualId;
    return (
      collectedAssets.find((a) => a.approvedVisualId === id) ||
      usedAssets.find((a) => a.approvedVisualId === id) ||
      null
    );
  }, [selected, collectedAssets, usedAssets]);

  const selectedIndex = Math.max(0, scenes.findIndex((s) => s.sceneId === selected?.sceneId));
  const sceneTags = useMemo(() => {
    if (!selected) return [] as string[];
    const tags: string[] = [];
    if (selected.rawFootageUsed || isVideoMediaUrl(selected.previewUrl)) tags.push("Video");
    else tags.push("Image");
    if (selected.mainPerson) tags.push(selected.mainPerson);
    if (selected.specificPlace) tags.push(selected.specificPlace);
    if (selected.beatType) tags.push(selected.beatType.replace(/_/g, " "));
    if (selected.fromApprovedLibrary) tags.push("Library");
    return tags.slice(0, 6);
  }, [selected]);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  useEffect(() => {
    setNotes(selected?.editorNotes || "");
    setLibraryHits([]);
    setLibraryQuery(selected?.mainPerson || selected?.specificPlace || "");
  }, [selected?.sceneId]);

  useEffect(() => {
    const at = sceneAtPlayhead(scenes, playhead);
    if (at && at.sceneId !== selectedId) {
      setSelectedId(at.sceneId);
    }
  }, [playhead, scenes, selectedId, setSelectedId]);

  const seek = useCallback(
    (sec: number) => {
      const next = Math.min(model.durationSec, Math.max(0, sec));
      setPlayhead(next);
      playheadRef.current = next;
      const vo = voRef.current;
      if (vo && Number.isFinite(next)) {
        try {
          vo.currentTime = next;
        } catch {
          // ignore
        }
      }
    },
    [model.durationSec]
  );

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p);
  }, []);

  useEffect(() => {
    const vo = voRef.current;
    if (!vo) return;
    if (playing) {
      if (Math.abs(vo.currentTime - playheadRef.current) > 0.4) {
        try {
          vo.currentTime = playheadRef.current;
        } catch {
          // ignore
        }
      }
      void vo.play().catch(() => undefined);
    } else {
      vo.pause();
    }
  }, [playing]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTs.current = null;
      return;
    }
    const tick = (ts: number) => {
      if (lastTs.current == null) lastTs.current = ts;
      const dt = (ts - lastTs.current) / 1000;
      lastTs.current = ts;
      let next = playheadRef.current + dt;
      if (next >= model.durationSec) {
        next = model.durationSec;
        setPlayhead(next);
        playheadRef.current = next;
        setPlaying(false);
        return;
      }
      setPlayhead(next);
      playheadRef.current = next;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTs.current = null;
    };
  }, [playing, model.durationSec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seek(playheadRef.current - (e.shiftKey ? 5 : 1));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seek(playheadRef.current + (e.shiftKey ? 5 : 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seek, togglePlay]);

  const previewScene = sceneAtPlayhead(scenes, playhead) || selected;
  const activeEffects = effectsAtPlayhead(model.effectSegments, playhead);
  const currentEffectId = selected?.effects?.[0]?.presetId || "";

  async function applyPatch(patch: Record<string, unknown>, okMsg: string) {
    if (!selected) return;
    if (locked) {
      setError("Timeline is locked. Unlock from Scene Review before editing.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const data = await patchTimeline(jobId, [{ sceneId: selected.sceneId, ...patch }]);
      setScenes(data.scenes || []);
      setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSearchLibrary() {
    if (!libraryQuery.trim()) return;
    setBusy(true);
    setError("");
    try {
      const data = await searchEditorLibrary(jobId, libraryQuery.trim(), 16, {
        person: selected?.mainPerson,
      });
      setLibraryHits(data.assets || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSwap(assetId: string) {
    if (!selected) return;
    if (locked) {
      setError("Timeline is locked. Unlock from Scene Review before editing.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const data = await swapTimelineVisual(jobId, selected.sceneId, assetId);
      if (data.scenes) setScenes(data.scenes);
      else await onReload();
      setMsg(`Replaced visual for ${selected.sceneId}.`);
      setLibraryHits([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onRailClick(id: TrackFilter | "ai" | "history") {
    if (id === "ai") {
      (onFocusChat || focusEditorChat)();
      return;
    }
    if (id === "history") {
      setTrackFilter("all");
      return;
    }
    setTrackFilter((prev) => (prev === id ? "all" : id));
  }

  return (
    <div className="ate">
      {voiceoverUrl && <audio ref={voRef} src={voiceoverUrl} preload="metadata" />}

      <aside className="ate-rail" aria-label="Editor tools">
        {railTools.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ate-rail-btn ${t.id === "ai" ? "ate-rail-ai" : ""} ${
              t.id !== "ai" && t.id !== "history" && trackFilter === t.id ? "active" : ""
            }`}
            onClick={() => onRailClick(t.id)}
            title={t.title}
            aria-label={t.title}
          >
            <span className="ate-rail-icon">{t.icon}</span>
            <span className="ate-rail-label">{t.label}</span>
          </button>
        ))}
      </aside>

      <div className="ate-main">
        <TimelinePreview
          scene={previewScene}
          playhead={playhead}
          durationSec={model.durationSec}
          playing={playing}
          activeEffects={activeEffects}
          onTogglePlay={togglePlay}
          onSeek={seek}
        />

        <MultiTrackTimeline
          model={model}
          playhead={playhead}
          selectedSceneId={selected?.sceneId}
          pixelsPerSecond={pps}
          trackFilter={trackFilter}
          onSeek={seek}
          onSelectScene={setSelectedId}
          onZoom={(delta) => setPps((v) => Math.min(120, Math.max(14, v + delta)))}
          onFit={() => {
            const el = document.querySelector(".ate-tracks-wrap") as HTMLElement | null;
            const avail = el?.clientWidth ? el.clientWidth - 120 : 900;
            const next = Math.min(90, Math.max(16, avail / Math.max(model.durationSec, 1)));
            setPps(next);
          }}
        />
      </div>

      <aside className="ate-inspector">
        <div className="ate-inspector-tabs">
          <button
            type="button"
            className={inspectorTab === "scene" ? "active" : ""}
            onClick={() => setInspectorTab("scene")}
          >
            Scene
          </button>
          <button
            type="button"
            className={inspectorTab === "assets" ? "active" : ""}
            onClick={() => setInspectorTab("assets")}
          >
            Assets
            <em>{collectedAssets.length}</em>
          </button>
        </div>

        {inspectorTab === "assets" ? (
          <div className="ate-asset-bin">
            <div className="ate-asset-bin-head">
              <div>
                <h3 className="ate-inspector-title">Library assets</h3>
                <p className="dim" style={{ margin: 0, fontSize: 12 }}>
                  {usedAssets.length} used in cut · {collectedAssets.length} collected
                </p>
              </div>
              <div className="ate-asset-filters">
                <button
                  type="button"
                  className={assetFilter === "used" ? "active" : ""}
                  onClick={() => setAssetFilter("used")}
                >
                  Used
                </button>
                <button
                  type="button"
                  className={assetFilter === "all" ? "active" : ""}
                  onClick={() => setAssetFilter("all")}
                >
                  All
                </button>
              </div>
            </div>
            <div className="ate-asset-grid">
              {assetBin.map((asset) => {
                const inUse = usedAssetIds.has(asset.approvedVisualId);
                const isCurrent =
                  (selected?.approvedVisualId || selected?.selectedVisualId) === asset.approvedVisualId;
                return (
                  <button
                    key={asset.approvedVisualId}
                    type="button"
                    className={`ate-asset-card ${isCurrent ? "current" : ""} ${inUse ? "used" : ""}`}
                    disabled={busy || locked}
                    title={asset.bestUseCase || asset.approvedVisualId}
                    onClick={() => {
                      if (locked || busy) return;
                      if (inUse) {
                        const scene = scenes.find(
                          (s) => (s.approvedVisualId || s.selectedVisualId) === asset.approvedVisualId
                        );
                        if (scene) {
                          setSelectedId(scene.sceneId);
                          seek(scene.startTime);
                          setInspectorTab("scene");
                        }
                      } else if (selected) {
                        void onSwap(asset.approvedVisualId);
                      }
                    }}
                  >
                    <div className="ate-asset-thumb">
                      {asset.previewUrl ? (
                        isVideoMediaUrl(asset.previewUrl) ? (
                          <video src={asset.previewUrl} muted preload="metadata" />
                        ) : (
                          <img src={asset.previewUrl} alt="" />
                        )
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                    <div className="ate-asset-meta">
                      <strong>
                        {(asset.matchedPeople?.[0] ||
                          asset.matchedPlaces?.[0] ||
                          asset.bestUseCase ||
                          asset.approvedVisualId
                        ).slice(0, 28)}
                      </strong>
                      <span>
                        {inUse ? `Used ×${asset.reuseCount || 1}` : "Collected"}
                        {isCurrent ? " · current" : ""}
                      </span>
                    </div>
                  </button>
                );
              })}
              {!assetBin.length && (
                <div className="dim" style={{ padding: 12 }}>
                  No library assets yet for this job.
                </div>
              )}
            </div>
          </div>
        ) : selected ? (
          <>
            <div className="ate-scene-head">
              <h3 className="ate-inspector-title">
                Scene {selectedIndex + 1} of {scenes.length}
              </h3>
              <div className="btn-row" style={{ marginBottom: 8 }}>
                <SourceBadge source={selected.source} />
                {selected.markForAiRevise && <WarningBadge text="Needs AI revise" />}
              </div>
              <div className="ate-tag-row">
                {sceneTags.map((t) => (
                  <span key={t} className="ate-tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {(selectedAsset || selected.previewUrl) && (
              <div className="ate-used-asset">
                <div className="ate-used-asset-thumb">
                  {(selectedAsset?.previewUrl || selected.previewUrl) &&
                    (isVideoMediaUrl(selectedAsset?.previewUrl || selected.previewUrl) ? (
                      <video
                        src={selectedAsset?.previewUrl || selected.previewUrl}
                        muted
                        preload="metadata"
                      />
                    ) : (
                      <img src={selectedAsset?.previewUrl || selected.previewUrl} alt="" />
                    ))}
                </div>
                <div>
                  <div className="ate-used-label">Asset in this scene</div>
                  <strong>
                    {selected.mainPerson ||
                      selected.specificPlace ||
                      selected.selectedVisualId ||
                      "Visual"}
                  </strong>
                  <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                    {(selected.approvedVisualId || selected.selectedVisualId || "").slice(0, 36)}
                  </div>
                </div>
              </div>
            )}

            <div className="ate-narration-box">
              <label>Narration</label>
              <p>{selected.narrationText || "—"}</p>
            </div>

            <div className="ate-action-grid">
              <button
                type="button"
                className="ate-action"
                disabled={busy || locked}
                onClick={() => setInspectorTab("assets")}
              >
                Change image
              </button>
              <button
                type="button"
                className="ate-action"
                disabled={busy || locked}
                onClick={() =>
                  void applyPatch(
                    { markForAiRevise: true },
                    "Marked for AI revise — use chat to regenerate."
                  )
                }
              >
                Regenerate
              </button>
              <button
                type="button"
                className="ate-action ate-action-primary"
                disabled={busy || locked}
                onClick={() => (onFocusChat || focusEditorChat)()}
              >
                Ask AI editor
              </button>
            </div>

            <div className="kv">
              <div className="kv-row">
                <span>Time</span>
                <span>
                  {formatTime(selected.startTime)}–{formatTime(selected.endTime)}
                </span>
              </div>
              <div className="kv-row">
                <span>Intent</span>
                <span>{intentLabel(selected)}</span>
              </div>
              <div className="kv-row">
                <span>Pick reason</span>
                <span>{selected.pickReason || selected.reasonSelected || "—"}</span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="ate-effect-preset">Effect preset</label>
              <select
                id="ate-effect-preset"
                value={currentEffectId}
                disabled={busy || locked}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) void applyPatch({ clearEffects: true }, "Effects cleared.");
                  else void applyPatch({ effectPresetId: value }, "Effect preset saved.");
                }}
              >
                <option value="">No effect</option>
                {effectPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {(selected.effects?.length || 0) > 0 && (
              <div className="timeline-badge-block">
                {(selected.effects || []).map((e) => (
                  <div key={e.id} className="timeline-meta-card">
                    <span className="badge badge-violet">{shortPreset(e.presetId)}</span>
                    <div className="dim" style={{ marginTop: 4 }}>
                      {e.reason || "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="timeline-badge-block">
              <h3 className="ate-inspector-title" style={{ fontSize: 13 }}>
                SFX
              </h3>
              {(selected.sfx?.length || 0) === 0 ? (
                <div className="dim">No SFX on this scene</div>
              ) : (
                (selected.sfx || []).map((e) => (
                  <div key={e.id} className="timeline-meta-card">
                    <span className="badge badge-info">{shortSfx(e.sfxId)}</span>
                    <div className="dim" style={{ marginTop: 4 }}>
                      {e.reason || "—"}
                    </div>
                  </div>
                ))
              )}
            </div>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={Boolean(selected.markForAiRevise)}
                disabled={busy || locked}
                onChange={(e) =>
                  void applyPatch(
                    { markForAiRevise: e.target.checked },
                    e.target.checked ? "Marked for AI revise." : "Cleared AI revise flag."
                  )
                }
              />
              <span>Needs AI revise</span>
            </label>

            <div className="field">
              <label htmlFor="ate-editor-notes">Editor notes</label>
              <textarea
                id="ate-editor-notes"
                rows={3}
                value={notes}
                disabled={busy || locked}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Hints for revise pass, effect, or SFX…"
              />
            </div>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={busy || locked || notes === (selected.editorNotes || "")}
              onClick={() => void applyPatch({ editorNotes: notes }, "Notes saved.")}
            >
              Save notes
            </button>

            <div className="timeline-replace" style={{ marginTop: 18 }}>
              <h3 className="ate-inspector-title" style={{ fontSize: 13 }}>
                Search & replace
              </h3>
              <div className="btn-row" style={{ marginTop: 8 }}>
                <input
                  className="input"
                  value={libraryQuery}
                  disabled={busy || locked}
                  placeholder="Search library…"
                  onChange={(e) => setLibraryQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onSearchLibrary();
                  }}
                />
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  disabled={busy || locked || !libraryQuery.trim()}
                  onClick={() => void onSearchLibrary()}
                >
                  Search
                </button>
              </div>
              <div className="timeline-library-hits">
                {libraryHits.map((hit) => (
                  <button
                    key={hit.assetId}
                    type="button"
                    className="timeline-library-hit"
                    disabled={busy || locked}
                    onClick={() => void onSwap(hit.assetId)}
                  >
                    <div className="timeline-scene-thumb">
                      {hit.previewUrl ? (
                        isVideoMediaUrl(hit.previewUrl) ? (
                          <video src={hit.previewUrl} muted preload="metadata" />
                        ) : (
                          <img src={hit.previewUrl} alt="" />
                        )
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </div>
                    <div>
                      <strong>{hit.person || hit.category || hit.assetId}</strong>
                      <div className="dim">{hit.mediaType || "asset"}</div>
                      <div className="muted timeline-hit-desc">{hit.description || ""}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <p className="help" style={{ marginTop: 14 }}>
              Space = play/pause · ←/→ scrub · Assets tab shows used + collected library.
            </p>
          </>
        ) : (
          <div className="muted">Select a clip on the timeline</div>
        )}
      </aside>
    </div>
  );
}
