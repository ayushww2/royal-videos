import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState } from "../components/Badges";
import {
  api,
  formatTime,
  isVideoMediaUrl,
  searchEditorLibrary,
  searchEditorGoogle,
  setSceneVisualFromUrl,
  swapTimelineVisual,
  type GoogleImageHit,
  type LibrarySearchHit,
} from "../lib/api";
import type { JobRecord, Scene } from "../lib/types";

type ReviewFilter = "all" | "review" | "approved" | "clips" | "images" | "fix" | "doubt" | "specific";
type InspectorMode = "inspect" | "replace";

function sceneIsVideo(scene: Scene): boolean {
  return Boolean(
    scene.rawFootageUsed ||
      ["raw_footage", "trusted_clip", "user_youtube_raw"].includes(scene.source) ||
      isVideoMediaUrl(scene.previewUrl)
  );
}

function sceneSubject(scene: Scene): string {
  return (
    scene.mainPerson ||
    scene.pairOrGroup?.join(" & ") ||
    scene.specificPlace ||
    scene.viewerShouldSee ||
    "Royal context"
  );
}

function approvalLabel(value?: string): string {
  if (value === "approved") return "Approved";
  if (value === "rejected") return "Needs work";
  return "Review";
}

function searchSeed(scene?: Scene): string {
  if (!scene) return "";
  return [
    scene.mainPerson,
    scene.pairOrGroup?.join(" "),
    scene.specificPlace,
    scene.contextType,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function SceneMedia({
  scene,
  eager = false,
  controls = false,
}: {
  scene: Scene;
  eager?: boolean;
  controls?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [canLoad, setCanLoad] = useState(eager);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (eager) {
      setCanLoad(true);
      return;
    }
    const node = hostRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setCanLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setCanLoad(true);
        observer.disconnect();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, scene.previewUrl]);

  const video = sceneIsVideo(scene);
  const unavailable = !scene.previewUrl || failed;

  return (
    <div
      ref={hostRef}
      className={`review-media ${video ? "is-video" : "is-image"} ${
        unavailable ? "is-unavailable" : ""
      }`}
    >
      {unavailable ? (
        <div className="review-media-empty">
          <span aria-hidden="true">□</span>
          <strong>Preview unavailable</strong>
          <small>Replace this visual before approval</small>
        </div>
      ) : canLoad && video ? (
        <video
          key={scene.previewUrl}
          src={scene.previewUrl}
          controls={controls}
          muted={!controls}
          playsInline
          preload={eager ? "auto" : "metadata"}
          onLoadedMetadata={(event) => {
            if (!controls && event.currentTarget.duration > 0.08) {
              event.currentTarget.currentTime = 0.05;
            }
          }}
          onError={() => setFailed(true)}
        />
      ) : canLoad ? (
        <img
          src={scene.previewUrl}
          alt={`Visual for ${scene.narrationText}`}
          loading={eager ? "eager" : "lazy"}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="review-media-loading">Loading preview…</div>
      )}
      {!unavailable && <span className="review-media-kind">{video ? "Clip" : "Image"}</span>}
    </div>
  );
}

export function SceneReviewWorkspace() {
  const { jobId } = useParams();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [approvals, setApprovals] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("inspect");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busySceneId, setBusySceneId] = useState("");
  const [searching, setSearching] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryHits, setLibraryHits] = useState<LibrarySearchHit[]>([]);
  const [googleHits, setGoogleHits] = useState<GoogleImageHit[]>([]);
  const [replaceSource, setReplaceSource] = useState<"library" | "google">("library");
  const [libraryKind, setLibraryKind] = useState<"all" | "raw_footage" | "image">("all");

  async function load() {
    const data = await api<{
      job: JobRecord;
      scenes: Scene[];
      approvals: Record<string, string>;
    }>(`/api/jobs/${jobId}/scenes`);
    setJob(data.job);
    setScenes(data.scenes || []);
    setApprovals(data.approvals || {});
  }

  useEffect(() => {
    load()
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [jobId]);

  const selected = scenes.find((scene) => scene.sceneId === selectedId);
  const selectedIndex = selected
    ? scenes.findIndex((scene) => scene.sceneId === selected.sceneId)
    : -1;

  useEffect(() => {
    setLibraryQuery(searchSeed(selected));
    setLibraryHits([]);
    setGoogleHits([]);
  }, [selected?.sceneId]);

  const counts = useMemo(() => {
    let approved = 0;
    let rejected = 0;
    let clips = 0;
    for (const scene of scenes) {
      if (approvals[scene.sceneId] === "approved") approved += 1;
      if (approvals[scene.sceneId] === "rejected") rejected += 1;
      if (sceneIsVideo(scene)) clips += 1;
    }
    return {
      approved,
      rejected,
      clips,
      images: scenes.length - clips,
      remaining: Math.max(0, scenes.length - approved),
      fix: scenes.filter((scene) => scene.humanReview === "fix").length,
      doubt: scenes.filter((scene) => scene.humanReview === "doubt").length,
      specific: scenes.filter((scene) => scene.humanReview === "specific").length,
    };
  }, [scenes, approvals]);

  const filtered = useMemo(
    () =>
      scenes.filter((scene) => {
        const approval = approvals[scene.sceneId] || "pending";
        if (filter === "review") {
          return (
            approval !== "approved" ||
            scene.needsBetterVisual ||
            !scene.previewUrl ||
            (scene.warnings || []).length > 0
          );
        }
        if (filter === "approved") return approval === "approved";
        if (filter === "clips") return sceneIsVideo(scene);
        if (filter === "images") return !sceneIsVideo(scene);
        if (filter === "fix") return scene.humanReview === "fix";
        if (filter === "doubt") return scene.humanReview === "doubt";
        if (filter === "specific") return scene.humanReview === "specific";
        return true;
      }),
    [scenes, approvals, filter]
  );

  function inspect(scene: Scene, mode: InspectorMode = "inspect") {
    setSelectedId(scene.sceneId);
    setInspectorMode(mode);
    setError("");
    setMessage("");
  }

  function closeInspector() {
    setSelectedId("");
    setInspectorMode("inspect");
    setLibraryHits([]);
    setGoogleHits([]);
  }

  function moveSelection(direction: -1 | 1) {
    if (selectedIndex < 0) return;
    const next = scenes[selectedIndex + direction];
    if (next) inspect(next);
  }

  async function reviewScene(
    sceneId: string,
    action: "approve" | "reject" | "mark-needs-better",
    goNext = false
  ) {
    setBusySceneId(sceneId);
    setError("");
    setMessage("");
    try {
      const data = await api<{
        approvals?: Record<string, string>;
        message?: string;
      }>(`/api/jobs/${jobId}/scenes/${sceneId}/${action}`, { method: "POST" });
      if (data.approvals) setApprovals(data.approvals);
      if (data.message) setMessage(data.message);
      if (goNext) {
        const index = scenes.findIndex((scene) => scene.sceneId === sceneId);
        const next = scenes[index + 1];
        if (next) inspect(next);
        else closeInspector();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusySceneId("");
    }
  }

  async function runLibrarySearch() {
    if (!selected || !libraryQuery.trim()) return;
    setSearching(true);
    setError("");
    try {
      if (replaceSource === "google") {
        const data = await searchEditorGoogle(jobId || "", libraryQuery.trim(), 8);
        setGoogleHits(data.hits || []);
        setLibraryHits([]);
      } else {
        const data = await searchEditorLibrary(jobId || "", libraryQuery.trim(), 24, {
          mediaType: libraryKind === "all" ? undefined : libraryKind,
        });
        setLibraryHits(data.assets || []);
        setGoogleHits([]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSearching(false);
    }
  }

  async function chooseGoogle(hit: GoogleImageHit) {
    if (!selected || !jobId) return;
    setBusySceneId(selected.sceneId);
    setError("");
    try {
      await setSceneVisualFromUrl(jobId, selected.sceneId, {
        url: hit.url,
        thumbnail: hit.thumbnail,
        title: hit.title,
        personName: selected.mainPerson || hit.title,
      });
      await load();
      setInspectorMode("inspect");
      setLibraryHits([]);
      setGoogleHits([]);
      setMessage(`Scene ${selectedIndex + 1} visual replaced from Google.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusySceneId("");
    }
  }

  async function chooseVisual(assetId: string) {
    if (!selected || !jobId) return;
    setBusySceneId(selected.sceneId);
    setError("");
    try {
      await swapTimelineVisual(jobId, selected.sceneId, assetId);
      await load();
      setInspectorMode("inspect");
      setLibraryHits([]);
      setMessage(`Scene ${selectedIndex + 1} visual replaced.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusySceneId("");
    }
  }

  async function lockRoyalTimeline() {
    if (!jobId || !window.confirm("Approve every scene and lock this timeline for rendering?")) {
      return;
    }
    setError("");
    try {
      await api(`/api/jobs/${jobId}/approve-all`, { method: "POST" });
      await api(`/api/royal-v2/jobs/${jobId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockedBy: "manager" }),
      });
      setMessage("Every scene is approved. This job is finalized and locked.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function unlockRoyalTimeline() {
    if (!jobId || !window.confirm("Unlock this timeline so scenes can be changed?")) return;
    setError("");
    try {
      await api(`/api/royal-v2/jobs/${jobId}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, unlockedBy: "manager" }),
      });
      setMessage("Timeline unlocked.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (loading) {
    return (
      <AppShell title="Scene Review">
        <LoadingState label="Loading scenes…" />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Scene Review"
      breadcrumbs={job ? `${job.title} / Visual approval` : "Visual approval"}
      job={job}
      contentClassName="content-tool"
      actions={
        (job?.niche === "Royal v2" || job?.niche === "Royal v3") ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {error ? (
              <span style={{ color: "#fecaca", fontSize: 13, maxWidth: 420 }}>{error}</span>
            ) : null}
            {job.timelineLock?.locked ? (
              <button className="btn btn-secondary btn-sm" type="button" onClick={unlockRoyalTimeline}>
                Unlock timeline
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" type="button" onClick={lockRoyalTimeline}>
                Approve all & lock
              </button>
            )}
          </span>
        ) : undefined
      }
    >
      <div className="review-workspace">
        {error && <ErrorState message={error} />}
        {message && <div className="review-toast">{message}</div>}

        {!scenes.length ? (
          <div className="state-box">
            No scenes are ready yet.
            <div style={{ marginTop: 12 }}>
              <Link to={`/jobs/${jobId}`}>Return to job status</Link>
            </div>
          </div>
        ) : (
          <>
            <section className="review-summary" aria-label="Review progress">
              <div className="review-progress-copy">
                <span className="review-eyebrow">Visual approval</span>
                <strong>
                  {counts.approved} of {scenes.length} scenes approved
                </strong>
                <span>{counts.remaining} remaining</span>
              </div>
              <div className="review-progress-track" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.round((counts.approved / Math.max(1, scenes.length)) * 100)}%`,
                  }}
                />
              </div>
              <div className="review-summary-counts">
                <span>
                  <strong>{counts.clips}</strong> clips
                </span>
                <span>
                  <strong>{counts.images}</strong> images
                </span>
                {counts.rejected > 0 && (
                  <span className="is-warning">
                    <strong>{counts.rejected}</strong> need work
                  </span>
                )}
              </div>
            </section>

            <nav className="review-filterbar" aria-label="Scene filters">
              {(
                [
                  ["all", `All ${scenes.length}`],
                  ["review", `To review ${counts.remaining}`],
                  ["approved", `Approved ${counts.approved}`],
                  ["clips", `Clips ${counts.clips}`],
                  ["images", `Images ${counts.images}`],
                  ["fix", `To be fixed ${counts.fix}`],
                  ["doubt", `Doubt ${counts.doubt}`],
                  ["specific", `Specific ${counts.specific}`],
                ] as Array<[ReviewFilter, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={filter === id ? "active" : ""}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </nav>

            <main className="review-scene-grid">
              {filtered.map((scene) => {
                const number = scenes.indexOf(scene) + 1;
                const approval = approvals[scene.sceneId] || "pending";
                const needsAttention =
                  approval === "rejected" ||
                  scene.needsBetterVisual ||
                  !scene.previewUrl ||
                  (scene.warnings || []).length > 0;
                return (
                  <article
                    key={scene.sceneId}
                    className={`review-scene-card is-${approval} ${
                      needsAttention ? "needs-attention" : ""
                    }`}
                    onClick={() => inspect(scene)}
                  >
                    <header className="review-scene-header">
                      <span className="review-scene-number">Scene {String(number).padStart(3, "0")}</span>
                      <span className={`review-status is-${approval}`}>
                        {approvalLabel(approval)}
                      </span>
                    </header>

                    <p className="review-scene-line">{scene.narrationText || "No narration line"}</p>

                    <SceneMedia scene={scene} />

                    <div className="review-scene-meta">
                      <strong>{sceneSubject(scene)}</strong>
                      <span>
                        {formatTime(scene.startTime)}–{formatTime(scene.endTime)} ·{" "}
                        {scene.duration.toFixed(1)}s
                      </span>
                    </div>

                    <footer className="review-scene-actions">
                      <button
                        type="button"
                        className="review-action approve"
                        disabled={busySceneId === scene.sceneId}
                        onClick={(event) => {
                          event.stopPropagation();
                          void reviewScene(scene.sceneId, "approve");
                        }}
                      >
                        ✓ Approve
                      </button>
                      <button
                        type="button"
                        className="review-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          inspect(scene, "replace");
                        }}
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        className="review-action flag"
                        disabled={busySceneId === scene.sceneId}
                        onClick={(event) => {
                          event.stopPropagation();
                          void reviewScene(scene.sceneId, "mark-needs-better");
                        }}
                      >
                        Needs work
                      </button>
                    </footer>
                  </article>
                );
              })}
            </main>

            {!filtered.length && (
              <div className="review-empty-filter">No scenes match this filter.</div>
            )}
          </>
        )}
      </div>

      {selected && (
        <div
          className="review-inspector-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeInspector();
          }}
        >
          <section
            className="review-inspector"
            role="dialog"
            aria-modal="true"
            aria-label={`Scene ${selectedIndex + 1}`}
          >
            <header className="review-inspector-header">
              <div>
                <span className="review-eyebrow">
                  Scene {String(selectedIndex + 1).padStart(3, "0")} of {scenes.length}
                </span>
                <h2>{selected.narrationText || "No narration line"}</h2>
              </div>
              <button className="review-close" type="button" onClick={closeInspector} aria-label="Close">
                ×
              </button>
            </header>

            {inspectorMode === "inspect" ? (
              <div className="review-inspector-body">
                <SceneMedia scene={selected} eager controls={sceneIsVideo(selected)} />
                <aside className="review-inspector-info">
                  <div className="review-subject">
                    <span>Visual should show</span>
                    <strong>{sceneSubject(selected)}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Timing</dt>
                      <dd>
                        {formatTime(selected.startTime)}–{formatTime(selected.endTime)} ·{" "}
                        {selected.duration.toFixed(1)}s
                      </dd>
                    </div>
                    <div>
                      <dt>Media</dt>
                      <dd>{sceneIsVideo(selected) ? "Video clip" : "Image"}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{approvalLabel(approvals[selected.sceneId])}</dd>
                    </div>
                  </dl>
                  {(selected.warnings || []).length > 0 && (
                    <div className="review-warning">
                      Check this scene: {selected.warnings![0]}
                    </div>
                  )}
                  <div className="review-inspector-actions">
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={busySceneId === selected.sceneId}
                      onClick={() => void reviewScene(selected.sceneId, "approve", true)}
                    >
                      Approve & next
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => setInspectorMode("replace")}
                    >
                      Replace visual
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={busySceneId === selected.sceneId}
                      onClick={() => void reviewScene(selected.sceneId, "mark-needs-better", true)}
                    >
                      Needs work
                    </button>
                  </div>
                </aside>
              </div>
            ) : (
              <div className="review-replace">
                <div className="review-kindbar">
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => setInspectorMode("inspect")}
                  >
                    Back
                  </button>
                  <button
                    className={`btn ${replaceSource === "library" ? "btn-primary" : "btn-secondary"}`}
                    type="button"
                    onClick={() => {
                      setReplaceSource("library");
                      setLibraryHits([]);
                      setGoogleHits([]);
                    }}
                  >
                    Library
                  </button>
                  <button
                    className={`btn ${replaceSource === "google" ? "btn-primary" : "btn-secondary"}`}
                    type="button"
                    onClick={() => {
                      setReplaceSource("google");
                      setLibraryHits([]);
                      setGoogleHits([]);
                    }}
                  >
                    Google
                  </button>
                  {replaceSource === "library" &&
                    (
                      [
                        ["all", "All"],
                        ["raw_footage", "Clips"],
                        ["image", "Images"],
                      ] as Array<["all" | "raw_footage" | "image", string]>
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        className={`btn ${libraryKind === id ? "btn-primary" : "btn-secondary"}`}
                        type="button"
                        onClick={() => setLibraryKind(id)}
                      >
                        {label}
                      </button>
                    ))}
                </div>
                <div className="review-searchbar">
                  <input
                    value={libraryQuery}
                    onChange={(event) => setLibraryQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void runLibrarySearch();
                    }}
                    placeholder={replaceSource === "google" ? "Search Google Images" : "Search the Royal library"}
                    autoFocus
                  />
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={searching || !libraryQuery.trim()}
                    onClick={() => void runLibrarySearch()}
                  >
                    {searching ? "Searching…" : "Search"}
                  </button>
                </div>
                <p className="review-search-help">
                  {replaceSource === "google"
                    ? "Search Google Images, then select one to put it on this scene."
                    : "Search your library. Use Clips or Images to stay in that category."}
                </p>
                <div className="review-library-grid">
                  {replaceSource === "library" &&
                    libraryHits.map((asset) => (
                    <button
                      key={asset.assetId}
                      type="button"
                      className="review-library-result"
                      disabled={busySceneId === selected.sceneId}
                      onClick={() => void chooseVisual(asset.assetId)}
                    >
                      <div className="review-library-thumb">
                        {asset.previewUrl ? (
                          asset.mediaType === "raw_footage" ||
                          asset.mediaType === "trusted_clip" ||
                          isVideoMediaUrl(asset.previewUrl) ? (
                            <video src={asset.previewUrl} muted playsInline preload="metadata" />
                          ) : (
                            <img src={asset.previewUrl} alt="" loading="lazy" />
                          )
                        ) : (
                          <span>No preview</span>
                        )}
                      </div>
                      <strong>{asset.person || asset.category || "Royal library visual"}</strong>
                      <small>{asset.description || asset.mediaType || "Library asset"}</small>
                    </button>
                  ))}
                  {replaceSource === "google" &&
                    googleHits.map((hit) => (
                      <button
                        key={hit.url}
                        type="button"
                        className="review-library-result"
                        disabled={busySceneId === selected.sceneId}
                        onClick={() => void chooseGoogle(hit)}
                      >
                        <div className="review-library-thumb">
                          {hit.thumbnail || hit.url ? (
                            <img src={hit.thumbnail || hit.url} alt="" loading="lazy" />
                          ) : (
                            <span>No preview</span>
                          )}
                        </div>
                        <strong>Google</strong>
                        <small>{hit.title || hit.source || "Image"}</small>
                      </button>
                    ))}
                  {!searching && replaceSource === "library" && libraryHits.length === 0 && (
                    <div className="review-library-empty">
                      Search the library to see clips and images.
                    </div>
                  )}
                  {!searching && replaceSource === "google" && googleHits.length === 0 && (
                    <div className="review-library-empty">
                      Search Google to see image results.
                    </div>
                  )}
                </div>
              </div>
            )}

            {inspectorMode === "inspect" && (
              <footer className="review-inspector-nav">
                <button
                  type="button"
                  disabled={selectedIndex <= 0}
                  onClick={() => moveSelection(-1)}
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  disabled={selectedIndex >= scenes.length - 1}
                  onClick={() => moveSelection(1)}
                >
                  Next →
                </button>
              </footer>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
