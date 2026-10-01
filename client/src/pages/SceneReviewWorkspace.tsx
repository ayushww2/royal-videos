import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState } from "../components/Badges";
import {
  api,
  isVideoMediaUrl,
  searchEditorLibrary,
  swapTimelineVisual,
  type LibrarySearchHit,
} from "../lib/api";
import type { JobRecord, Scene } from "../lib/types";

function formatExactSeconds(sec: number): string {
  const safe = Math.max(0, sec);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}

type ReviewFilter = "all" | "review" | "approved" | "clips" | "images";
const REPLACE_PEOPLE = [
  "Princess Anne",
  "Princess Diana",
  "King Charles",
  "Queen Camilla",
  "Prince William",
  "Catherine, Princess of Wales",
  "Prince Harry",
  "Meghan, Duchess of Sussex",
  "Charles Spencer",
  "Prince George",
  "Princess Charlotte",
  "Prince Louis",
  "Prince Andrew",
  "Sarah Ferguson",
];

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

  const video = sceneIsVideo(scene) || Boolean(scene.secondPreviewUrl);
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
        scene.secondPreviewUrl ? (
          <div className="review-media-pair">
            <video src={scene.previewUrl} muted playsInline preload="metadata" />
            <video src={scene.secondPreviewUrl} muted playsInline preload="metadata" />
          </div>
        ) : (
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
        )
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
      {!unavailable && (
        <span className="review-media-kind">
          {scene.secondPreviewUrl ? "2 clips" : video ? "Clip" : "Image"}
        </span>
      )}
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
  const [replacePerson, setReplacePerson] = useState("");
  const [replaceMedia, setReplaceMedia] = useState<"any" | "image" | "raw_footage">("any");
  const [libraryHits, setLibraryHits] = useState<LibrarySearchHit[]>([]);

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
        return true;
      }),
    [scenes, approvals, filter]
  );

  function inspect(scene: Scene, mode: InspectorMode = "inspect") {
    setSelectedId(scene.sceneId);
    setInspectorMode(mode);
    setError("");
    setMessage("");
    if (mode === "replace") {
      setLibraryHits([]);
      setLibraryQuery(scene.viewerShouldSee || scene.mainPerson || "");
      setReplacePerson(scene.mainPerson || scene.viewerShouldSee || "");
      setReplaceMedia(scene.rawFootageUsed ? "raw_footage" : "any");
    }
  }

  function closeInspector() {
    setSelectedId("");
    setInspectorMode("inspect");
    setLibraryHits([]);
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
    if (!selected || (!libraryQuery.trim() && !replacePerson.trim())) return;
    setSearching(true);
    setError("");
    try {
      const data = await searchEditorLibrary(jobId || "", libraryQuery.trim(), 24, {
        person: replacePerson.trim() || undefined,
        mediaType: replaceMedia === "any" ? undefined : replaceMedia,
      });
      setLibraryHits(data.assets || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSearching(false);
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
      setMessage("Timeline approved and locked.");
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
        job?.niche === "Royal v2" ? (
          job.timelineLock?.locked ? (
            <button className="btn btn-secondary btn-sm" type="button" onClick={unlockRoyalTimeline}>
              Unlock timeline
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" type="button" onClick={lockRoyalTimeline}>
              Approve all & lock
            </button>
          )
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
                        {formatExactSeconds(scene.startTime)}–{formatExactSeconds(scene.endTime)} ·{" "}
                        {scene.duration.toFixed(2)}s
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
                        {formatExactSeconds(selected.startTime)}–{formatExactSeconds(selected.endTime)} ·{" "}
                        {selected.duration.toFixed(2)}s
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
                      onClick={() => inspect(selected, "replace")}
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
                <div className="review-searchbar">
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => setInspectorMode("inspect")}
                  >
                    Back
                  </button>
                  <input
                    value={libraryQuery}
                    onChange={(event) => setLibraryQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void runLibrarySearch();
                    }}
                    placeholder="Search the Royal library"
                    autoFocus
                  />
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={searching || (!libraryQuery.trim() && !replacePerson.trim())}
                    onClick={() => void runLibrarySearch()}
                  >
                    {searching ? "Searching…" : "Search"}
                  </button>
                </div>
                <div className="review-search-filters">
                  <label>
                    Person
                    <select value={replacePerson} onChange={(event) => setReplacePerson(event.target.value)}>
                      <option value="">Any person</option>
                      {REPLACE_PEOPLE.map((person) => (
                        <option key={person} value={person}>
                          {person}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Type
                    <select
                      value={replaceMedia}
                      onChange={(event) =>
                        setReplaceMedia(event.target.value as "any" | "image" | "raw_footage")
                      }
                    >
                      <option value="any">Images and raw clips</option>
                      <option value="image">Images only</option>
                      <option value="raw_footage">Raw clips only</option>
                    </select>
                  </label>
                </div>
                <p className="review-search-help">
                  Choose the person and whether you want a still or a raw clip, then search.
                </p>
                <div className="review-library-grid">
                  {libraryHits.map((asset) => (
                    <button
                      key={asset.assetId}
                      type="button"
                      className="review-library-result"
                      disabled={busySceneId === selected.sceneId}
                      onClick={() => void chooseVisual(asset.assetId)}
                    >
                      <div
                        className="review-library-thumb"
                        onMouseEnter={(event) => {
                          const video = event.currentTarget.querySelector("video");
                          if (!video) return;
                          video.preload = "auto";
                          if (video.readyState < 1) video.load();
                          void video.play().catch(() => undefined);
                        }}
                        onMouseLeave={(event) => {
                          const video = event.currentTarget.querySelector("video");
                          if (!video) return;
                          video.pause();
                          video.currentTime = 0.05;
                        }}
                      >
                        {asset.clipUrl ? (
                          <video
                            src={asset.clipUrl}
                            poster={asset.previewUrl}
                            muted
                            playsInline
                            preload="none"
                            onLoadedMetadata={(event) => {
                              if (event.currentTarget.duration > 0.08) {
                                event.currentTarget.currentTime = 0.05;
                              }
                            }}
                          />
                        ) : asset.previewUrl ? (
                          <img src={asset.previewUrl} alt="" />
                        ) : (
                          <span>No preview</span>
                        )}
                      </div>
                      <strong>{asset.person || asset.category || "Royal library visual"}</strong>
                      <small>{asset.description || asset.mediaType || "Library asset"}</small>
                    </button>
                  ))}
                  {!searching && libraryHits.length === 0 && (
                    <div className="review-library-empty">
                      Search the library to see replacement options.
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
