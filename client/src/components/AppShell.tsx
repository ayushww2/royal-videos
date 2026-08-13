import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ReactNode } from "react";
import { StatusBadge } from "./Badges";
import { JobRecord } from "../lib/types";
import { friendlyStatus } from "../lib/types";
import { logout } from "../lib/auth";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/new", label: "New Job" },
  { to: "/jobs", label: "Royal Jobs" },
  { to: "/library", label: "Royal Media" },
  { to: "/royal-v2/bulk", label: "Royal v2 Bulk" },
  { to: "/scene-review", label: "Scene Review" },
  { to: "/render-queue", label: "Render Queue" },
  { to: "/settings", label: "Settings" },
];

function jobSubnavActive(pathname: string, jobId: string, key: string): boolean {
  const base = `/jobs/${jobId}`;
  if (key === "status") return pathname === base || pathname === `${base}/`;
  return pathname.includes(`/${key}`);
}

export function AppShell({
  title,
  breadcrumbs,
  job,
  actions,
  children,
  contentClassName,
}: {
  title: string;
  breadcrumbs?: string;
  job?: JobRecord | null;
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  const loc = useLocation();
  const params = useParams();
  const navigate = useNavigate();
  const jobId = params.jobId;

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const jobPills = jobId
    ? [
        { key: "status", label: "Status", to: `/jobs/${jobId}` },
        { key: "timeline", label: "Timeline", to: `/jobs/${jobId}/timeline` },
        { key: "scenes", label: "Scenes", to: `/jobs/${jobId}/scenes` },
        { key: "library", label: "Library", to: `/jobs/${jobId}/library` },
        { key: "render", label: "Render", to: `/jobs/${jobId}/render` },
      ]
    : [];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <h1>Royal Videos</h1>
            <p>Royal Family production</p>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => {
            const active =
              item.to === "/"
                ? loc.pathname === "/"
                : loc.pathname === item.to || loc.pathname.startsWith(item.to + "/");
            return (
              <Link key={item.to} to={item.to} className={active ? "active" : ""}>
                {item.label}
              </Link>
            );
          })}
          {jobId && (
            <>
              <div className="dim nav-section-label">Current job</div>
              {jobPills.map((pill) => (
                <Link
                  key={pill.key}
                  to={pill.to}
                  className={jobSubnavActive(loc.pathname, jobId, pill.key) ? "active" : ""}
                >
                  {pill.label}
                </Link>
              ))}
            </>
          )}
        </nav>
        <div style={{ marginTop: "auto", padding: "8px 4px 0" }}>
          <button type="button" className="btn btn-secondary btn-sm" style={{ width: "100%" }} onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-left">
            <h2>{title}</h2>
            {breadcrumbs && <p className="breadcrumbs">{breadcrumbs}</p>}
          </div>
          <div className="topbar-right">
            {job && (
              <>
                <span className="dim topbar-job-title">{job.title}</span>
                <StatusBadge status={job.status} label={friendlyStatus(job.status)} />
              </>
            )}
            {actions}
          </div>
        </header>
        {jobId && (
          <nav className="job-subnav" aria-label="Job tools">
            {jobPills.map((pill) => (
              <Link
                key={pill.key}
                to={pill.to}
                className={`job-subnav-pill ${
                  jobSubnavActive(loc.pathname, jobId, pill.key) ? "active" : ""
                }`}
              >
                {pill.label}
              </Link>
            ))}
          </nav>
        )}
        <div className={`content ${contentClassName || ""}`.trim()}>{children}</div>
      </div>
    </div>
  );
}
