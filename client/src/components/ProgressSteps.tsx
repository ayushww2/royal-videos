import { PIPELINE_STEPS, JobStatus } from "../lib/types";

function failedActiveStatus(lastSuccessfulStatus?: JobStatus): JobStatus {
  // Upload itself succeeded if a job exists — blame the step that was running.
  if (!lastSuccessfulStatus || lastSuccessfulStatus === "uploaded") {
    return "analyzing_full_script";
  }
  return lastSuccessfulStatus;
}

export function ProgressSteps({
  status,
  lastSuccessfulStatus,
  niche,
}: {
  status: JobStatus;
  lastSuccessfulStatus?: JobStatus;
  niche?: string;
}) {
  const steps =
    niche === "Royal v2"
      ? [
          { key: "queued", label: "Queued" },
          { key: "script_analysis", label: "Script analysis" },
          { key: "beat_breakdown", label: "Beat breakdown" },
          { key: "library_candidate_collection", label: "R2 library candidates" },
          { key: "visual_assignment", label: "Visual assignment" },
          { key: "repetition_audit", label: "Repetition audit" },
          { key: "weak_scene_repair", label: "Weak scene repair" },
          { key: "effect_planning", label: "Remotion effect planning" },
          { key: "scene_review_ready", label: "Scene review ready" },
          { key: "approved", label: "Approved & locked" },
          { key: "rendering", label: "Shotstack rendering" },
          { key: "completed", label: "Completed" },
        ] as Array<{ key: JobStatus; label: string }>
      : PIPELINE_STEPS.filter((step) =>
          ![
            "queued",
            "script_analysis",
            "beat_breakdown",
            "library_candidate_collection",
            "visual_assignment",
            "repetition_audit",
            "weak_scene_repair",
            "effect_planning",
            "scene_review_ready",
            "approved",
            // Collapse terminal ingest states into the active ingest step for the stepper
            "raw_ready",
            "raw_ingest_failed",
          ].includes(step.key)
        );
  const keys = steps.map((s) => s.key);
  let activeStatus = status === "failed" ? failedActiveStatus(lastSuccessfulStatus) : status;
  // Treat ready/failed ingest as completed ingest so the stepper advances into analysis.
  if (activeStatus === "raw_ready" || activeStatus === "raw_ingest_failed") {
    activeStatus = "analyzing_full_script";
  }
  // Director pipeline uses these Royal-named stages; map onto the Celebrity/Mystery stepper.
  if (activeStatus === "weak_scene_repair") activeStatus = "assembling_timeline";
  if (activeStatus === "effect_planning") activeStatus = "assembling_timeline";
  const currentIdx = keys.indexOf(activeStatus);

  return (
    <div className="pipeline">
      {steps.map((step, i) => {
        let state: "pending" | "active" | "complete" | "failed" = "pending";
        if (status === "failed" && i === currentIdx) state = "failed";
        else if (status === "completed") state = "complete";
        else if (i < currentIdx) state = "complete";
        else if (i === currentIdx && status !== "failed") state = "active";
        return (
          <div key={step.key} className={`pipeline-step ${state}`}>
            <div className="dot" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{step.label}</div>
              <div className="dim" style={{ fontSize: 11 }}>{state}</div>
            </div>
            <div className="dim" style={{ fontSize: 11 }}>
              {i + 1}/{steps.length}
            </div>
          </div>
        );
      })}
      {status === "failed" && (
        <div className="pipeline-step failed">
          <div className="dot" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Failed</div>
            <div className="dim" style={{ fontSize: 11 }}>failed</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function pipelinePercent(status: JobStatus, lastSuccessfulStatus?: JobStatus): number {
  if (status === "completed") return 100;
  const use = status === "failed" ? failedActiveStatus(lastSuccessfulStatus) : status;
  const idx = PIPELINE_STEPS.findIndex((s) => s.key === use);
  if (idx < 0) return 0;
  return Math.round((idx / PIPELINE_STEPS.length) * 100);
}
