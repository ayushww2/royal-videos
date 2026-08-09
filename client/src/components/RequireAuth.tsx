import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { clearAuthCache, markLoggedIn } from "../lib/auth";
import { LoadingState } from "./Badges";

export function RequireAuth() {
  const location = useLocation();
  const [state, setState] = useState<"checking" | "ok" | "no">("checking");

  useEffect(() => {
    let cancelled = false;
    setState("checking");
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          markLoggedIn();
          setState("ok");
        } else {
          clearAuthCache();
          setState("no");
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearAuthCache();
          setState("no");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (state === "checking") {
    return (
      <div className="login-page">
        <LoadingState label="Checking session..." />
      </div>
    );
  }
  if (state === "no") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
