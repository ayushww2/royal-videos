import { useEffect, useRef } from "react";
import { formatTimecode, isVideoMediaUrl } from "../lib/api";
import type { AssembledSegment } from "../lib/assembleTimelineModel";
import type { Scene } from "../lib/types";

export function TimelinePreview({
  scene,
  playhead,
  durationSec,
  playing,
  activeEffects,
  onTogglePlay,
  onSeek,
}: {
  scene?: Scene;
  playhead: number;
  durationSec: number;
  playing: boolean;
  activeEffects: AssembledSegment[];
  onTogglePlay: () => void;
  onSeek?: (sec: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isVideo = isVideoMediaUrl(scene?.previewUrl);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !isVideo || !scene) return;
    const local = Math.max(0, playhead - scene.startTime);
    if (Math.abs(el.currentTime - local) > 0.35) {
      try {
        el.currentTime = local;
      } catch {
        // ignore seek race while metadata loads
      }
    }
    if (playing) {
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, [playhead, playing, scene?.sceneId, scene?.startTime, isVideo]);

  return (
    <div className="ate-preview">
      <div className="ate-preview-stage" onDoubleClick={onTogglePlay}>
        {!scene?.previewUrl ? (
          <div className="ate-preview-empty">No preview media</div>
        ) : isVideo ? (
          <video
            ref={videoRef}
            key={scene.previewUrl}
            src={scene.previewUrl}
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <img src={scene.previewUrl} alt={scene.sceneId} />
        )}

        {scene?.narrationText ? (
          <div className="ate-preview-caption-burn">{scene.narrationText}</div>
        ) : null}

        {activeEffects.length > 0 && (
          <div className="ate-preview-overlays">
            {activeEffects.slice(0, 3).map((fx) => (
              <span key={fx.id} className="ate-fx-chip">
                {fx.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="ate-transport">
        <button type="button" className="ate-transport-play" onClick={onTogglePlay}>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          <span>{playing ? "Pause" : "Play"}</span>
        </button>
        <div className="ate-timecode">
          <strong>{formatTimecode(playhead)}</strong>
          <span>/</span>
          <span>{formatTimecode(durationSec)}</span>
        </div>
        <span className="ate-rate">1x</span>
        {onSeek ? (
          <div className="ate-transport-nudge">
            <button type="button" onClick={() => onSeek(playhead - 1)} title="−1s">
              −1s
            </button>
            <button type="button" onClick={() => onSeek(playhead + 1)} title="+1s">
              +1s
            </button>
          </div>
        ) : null}
        <span className="ate-preview-scene dim">{scene?.sceneId || "—"}</span>
      </div>
    </div>
  );
}
