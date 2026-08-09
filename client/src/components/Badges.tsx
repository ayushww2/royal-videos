import { ReactNode } from "react";
import { statusTone } from "../lib/types";

const toneClass: Record<string, string> = {
  neutral: "badge-neutral",
  info: "badge-info",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  violet: "badge-violet",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${toneClass[statusTone(status)]}`}>{label || status.replaceAll("_", " ")}</span>;
}

export function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 75 ? "success" : pct >= 55 ? "warning" : "danger";
  return <span className={`badge badge-${tone}`}>{pct}% conf</span>;
}

export function WarningBadge({ text }: { text: string }) {
  return <span className="badge badge-warning">{text}</span>;
}

export function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    raw_footage: "badge-success",
    user_youtube_raw: "badge-success",
    brave_image: "badge-info",
    google_image: "badge-info",
    pexels_clip: "badge-violet",
    pexels_image: "badge-violet",
    pixabay_clip: "badge-violet",
    pixabay_image: "badge-violet",
    uploaded_asset: "badge-neutral",
    fallback_card: "badge-warning",
  };
  const short =
    source === "raw_footage" || source === "user_youtube_raw"
      ? "Raw"
      : source === "brave_image" || source === "google_image"
        ? source === "google_image"
          ? "Google"
          : "Brave"
        : source.startsWith("pexels")
          ? "Pexels"
          : source.startsWith("pixabay")
            ? "Pixabay"
            : source === "uploaded_asset"
              ? "Uploaded"
              : source === "fallback_card"
                ? "Needs Better"
                : source;
  return <span className={`badge ${map[source] || "badge-neutral"}`}>{short}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="state-box">
      <h3 style={{ margin: "0 0 8px", color: "var(--text)" }}>{title}</h3>
      {body && <p style={{ margin: "0 0 14px" }}>{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return <div className="state-box error">{message}</div>;
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <div className="state-box">{label}</div>;
}
