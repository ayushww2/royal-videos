import { ReactNode } from "react";
import { formatTime } from "../lib/api";
import type { Scene } from "../lib/types";

export function TimelineStrip({
  scenes,
  selectedId,
  onSelect,
  headerExtra,
}: {
  scenes: Scene[];
  selectedId?: string;
  onSelect: (sceneId: string) => void;
  headerExtra?: ReactNode;
}) {
  return (
    <div className="timeline-strip card card-pad-sm">
      <div className="section-head section-head-tight">
        <div>
          <h3 style={{ margin: 0 }}>Timeline</h3>
          <span className="dim">{scenes.length} scenes</span>
        </div>
        {headerExtra}
      </div>
      <div className="timeline-track">
        {scenes.map((s, index) => {
          const effects = (s.effects || []).map((e) => e.presetId.replace(/^\d+_/, "").slice(0, 18));
          return (
            <button
              key={s.sceneId}
              type="button"
              className={`timeline-clip ${selectedId === s.sceneId ? "active" : ""} ${
                s.markForAiRevise ? "revise" : ""
              }`}
              onClick={() => onSelect(s.sceneId)}
              title={s.narrationText}
            >
              <div className="timeline-thumb">
                {s.previewUrl ? (
                  s.previewUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                    <video src={s.previewUrl} muted preload="metadata" />
                  ) : (
                    <img src={s.previewUrl} alt="" />
                  )
                ) : (
                  <span className="dim">No media</span>
                )}
              </div>
              <div className="timeline-meta">
                <strong>#{index + 1}</strong>
                <span className="dim">{formatTime(s.startTime)} · {s.duration.toFixed(1)}s</span>
                <span className="timeline-person">
                  {s.mainPerson || s.specificPlace || s.beatType || "scene"}
                </span>
                <div className="timeline-badges">
                  {s.rawFootageUsed && <span className="badge badge-neutral">raw</span>}
                  {s.markForAiRevise && <span className="badge badge-warning">revise</span>}
                  {effects.slice(0, 2).map((fx) => (
                    <span key={fx} className="badge badge-violet">
                      fx · {fx}
                    </span>
                  ))}
                  {(s.sfx || []).slice(0, 2).map((e) => (
                    <span key={e.id} className="badge badge-info">
                      sfx · {e.sfxId.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
