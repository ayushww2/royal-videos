import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { formatTimecode, formatTime, isVideoMediaUrl } from "../lib/api";
import type { AssembledTimelineModel } from "../lib/assembleTimelineModel";

type TrackFilter = "all" | "media" | "text" | "audio" | "effects";

function formatDur(sec: number): string {
  if (sec < 10) return `${sec.toFixed(1)}s`;
  return `${Math.round(sec)}s`;
}

export function MultiTrackTimeline({
  model,
  playhead,
  selectedSceneId,
  pixelsPerSecond,
  trackFilter,
  onSeek,
  onSelectScene,
  onZoom,
  onFit,
}: {
  model: AssembledTimelineModel;
  playhead: number;
  selectedSceneId?: string;
  pixelsPerSecond: number;
  trackFilter: TrackFilter;
  onSeek: (sec: number) => void;
  onSelectScene: (sceneId: string) => void;
  onZoom: (delta: number) => void;
  onFit?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  const width = Math.max(720, model.durationSec * pixelsPerSecond + 80);
  const playheadX = playhead * pixelsPerSecond;
  const selectedIndex =
    model.visualClips.findIndex((c) => c.sceneId === selectedSceneId) + 1 || 1;

  const ticks = useMemo(() => {
    const step = pixelsPerSecond >= 48 ? 5 : pixelsPerSecond >= 24 ? 10 : 30;
    const out: number[] = [];
    for (let t = 0; t <= model.durationSec + 0.01; t += step) out.push(t);
    return out;
  }, [model.durationSec, pixelsPerSecond]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const root = scrollRef.current;
      if (!root) return;
      const track = root.querySelector(".ate-tracks-scroll") as HTMLElement | null;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const x = clientX - rect.left + track.scrollLeft - 108;
      const sec = Math.min(model.durationSec, Math.max(0, x / pixelsPerSecond));
      onSeek(sec);
    },
    [model.durationSec, onSeek, pixelsPerSecond]
  );

  const showCaptions = trackFilter === "text";
  const showVisual = trackFilter === "all" || trackFilter === "media";
  const showEffects = trackFilter === "all" || trackFilter === "effects";
  const showAudio = trackFilter === "all" || trackFilter === "audio";

  const zoomPct = Math.round((pixelsPerSecond / 42) * 100);

  return (
    <div className="ate-multitrack">
      <div className="ate-multitrack-head">
        <div className="ate-multitrack-title">
          <strong>TIMELINE</strong>
          <span className="dim">
            {model.visualClips.length} scenes · {formatTime(model.durationSec)}
          </span>
        </div>
        <div className="ate-multitrack-tools">
          <span className="ate-scene-counter">
            {String(selectedIndex).padStart(2, "0")} / {model.visualClips.length}
          </span>
          {onFit ? (
            <button type="button" className="ate-fit-btn" onClick={onFit}>
              FIT
            </button>
          ) : null}
          <div className="ate-zoom">
            <button type="button" className="ate-zoom-btn" onClick={() => onZoom(-8)} aria-label="Zoom out">
              −
            </button>
            <div className="ate-zoom-slider" aria-hidden>
              <span style={{ width: `${Math.min(100, Math.max(12, zoomPct / 2))}%` }} />
            </div>
            <button type="button" className="ate-zoom-btn" onClick={() => onZoom(8)} aria-label="Zoom in">
              +
            </button>
            <em>{zoomPct}%</em>
          </div>
        </div>
      </div>

      <div
        className="ate-tracks-wrap"
        ref={scrollRef}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button.ate-clip, button.ate-marker, button.ate-scene-block")) {
            return;
          }
          scrubbing.current = true;
          seekFromClientX(e.clientX);
        }}
        onMouseMove={(e) => {
          if (!scrubbing.current) return;
          seekFromClientX(e.clientX);
        }}
        onMouseUp={() => {
          scrubbing.current = false;
        }}
        onMouseLeave={() => {
          scrubbing.current = false;
        }}
      >
        <div className="ate-tracks-scroll">
          <div className="ate-ruler" style={{ width }}>
            <div className="ate-lane-label" />
            <div className="ate-ruler-ticks">
              {ticks.map((t) => (
                <span key={t} className="ate-tick" style={{ left: t * pixelsPerSecond }}>
                  {formatTimecode(t)}
                </span>
              ))}
            </div>
          </div>

          {showEffects && (
            <TrackLane label="FX / Overlays" width={width} tone="fx">
              {model.effectSegments.map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  className="ate-clip ate-clip-fx"
                  style={{
                    left: seg.startTime * pixelsPerSecond,
                    width: Math.max(22, seg.duration * pixelsPerSecond - 2),
                  }}
                  title={seg.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (seg.sceneId) onSelectScene(seg.sceneId);
                    onSeek(seg.startTime);
                  }}
                >
                  <span className="ate-clip-label">{seg.label}</span>
                </button>
              ))}
              {!model.effectSegments.length && (
                <span className="ate-empty-lane">
                  No overlays yet — add lower-thirds from the scene panel
                </span>
              )}
            </TrackLane>
          )}

          {showCaptions && (
            <TrackLane label="Text" width={width} tone="captions" tall={false}>
              {model.captionSegments.map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  className="ate-clip ate-clip-caption"
                  style={{
                    left: seg.startTime * pixelsPerSecond,
                    width: Math.max(14, seg.duration * pixelsPerSecond - 1),
                  }}
                  title={seg.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (seg.sceneId) onSelectScene(seg.sceneId);
                    onSeek(seg.startTime);
                  }}
                >
                  <span className="ate-clip-label">{seg.label}</span>
                </button>
              ))}
              {!model.captionSegments.length && <span className="ate-empty-lane">No caption text</span>}
            </TrackLane>
          )}

          {showVisual && (
            <TrackLane label="Video / Scenes" width={width} tall tone="video">
              {model.visualClips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  className={`ate-scene-block ate-clip-${clip.kind} ${
                    selectedSceneId === clip.sceneId ? "active" : ""
                  } ${clip.revise ? "revise" : ""}`}
                  style={{
                    left: clip.startTime * pixelsPerSecond,
                    width: Math.max(48, clip.duration * pixelsPerSecond - 3),
                  }}
                  title={`${clip.label} · ${formatTimecode(clip.startTime)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectScene(clip.sceneId);
                    onSeek(clip.startTime);
                  }}
                >
                  <div className="ate-scene-thumb">
                    {clip.previewUrl ? (
                      isVideoMediaUrl(clip.previewUrl) ? (
                        <video src={clip.previewUrl} muted preload="metadata" />
                      ) : (
                        <img src={clip.previewUrl} alt="" />
                      )
                    ) : (
                      <span className="ate-clip-thumb-fallback">{clip.index + 1}</span>
                    )}
                  </div>
                  <span className="ate-scene-num">{String(clip.index + 1).padStart(2, "0")}</span>
                  <span className="ate-scene-dur">{formatDur(clip.duration)}</span>
                  <span className="ate-scene-kind">{clip.kind === "raw" ? "VID" : clip.kind === "effect" ? "FX" : "IMG"}</span>
                </button>
              ))}
            </TrackLane>
          )}

          {showAudio && (
            <>
              <TrackLane label="Audio" width={width} tone="sfx">
                {model.visualClips.map((clip) => (
                  <div
                    key={`aud-${clip.id}`}
                    className={`ate-audio-chip ${clip.kind === "raw" ? "vid" : "img"}`}
                    style={{
                      left: clip.startTime * pixelsPerSecond,
                      width: Math.max(28, clip.duration * pixelsPerSecond - 3),
                    }}
                    title={clip.kind === "raw" ? "Video audio / raw" : "Image (silent)"}
                  >
                    {clip.kind === "raw" ? "VID" : "IMG"}
                  </div>
                ))}
                {model.sfxMarkers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="ate-audio-chip sfx ate-marker-sfx"
                    style={{
                      left: m.startTime * pixelsPerSecond,
                      width: Math.max(28, m.duration * pixelsPerSecond),
                    }}
                    title={`${m.label} @ ${formatTimecode(m.startTime)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (m.sceneId) onSelectScene(m.sceneId);
                      onSeek(m.startTime);
                    }}
                  >
                    SFX
                  </button>
                ))}
              </TrackLane>

              <TrackLane label="Music" width={width} tone="music">
                {model.musicSegments.map((seg) => (
                  <div
                    key={seg.id}
                    className="ate-clip ate-clip-music"
                    style={{
                      left: seg.startTime * pixelsPerSecond,
                      width: Math.max(28, seg.duration * pixelsPerSecond - 2),
                    }}
                    title={seg.meta || seg.label}
                  >
                    <span className="ate-clip-label">
                      MUSIC · {seg.label} · {formatDur(seg.duration)}
                    </span>
                    <span className="ate-clip-wave" aria-hidden />
                  </div>
                ))}
                {!model.musicSegments.length && <span className="ate-empty-lane">No music</span>}
              </TrackLane>

              <TrackLane label="Voice" width={width} tone="vo">
                {model.narration ? (
                  <div
                    className="ate-clip ate-clip-vo"
                    style={{
                      left: 0,
                      width: Math.max(48, model.narration.duration * pixelsPerSecond - 2),
                    }}
                    title="Voiceover"
                  >
                    <span className="ate-clip-label">
                      VOICE · {formatDur(model.narration.duration)}
                    </span>
                    <span className="ate-clip-wave" aria-hidden />
                  </div>
                ) : (
                  <span className="ate-empty-lane">No voiceover</span>
                )}
              </TrackLane>
            </>
          )}

          <div className="ate-playhead" style={{ left: 108 + playheadX }} />
        </div>
      </div>
    </div>
  );
}

function TrackLane({
  label,
  width,
  tone,
  tall,
  children,
}: {
  label: string;
  width: number;
  tone?: string;
  tall?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`ate-lane ${tone ? `ate-lane-${tone}` : ""} ${tall ? "ate-lane-tall" : ""}`}>
      <div className="ate-lane-label">{label}</div>
      <div className="ate-lane-body" style={{ width }}>
        {children}
      </div>
    </div>
  );
}
