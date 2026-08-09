const AUTH_FLAG = "dvf_logged_in";

export function isLoggedIn(): boolean {
  return sessionStorage.getItem(AUTH_FLAG) === "1";
}

export function markLoggedIn(): void {
  sessionStorage.setItem(AUTH_FLAG, "1");
}

export function clearAuthCache(): void {
  sessionStorage.removeItem(AUTH_FLAG);
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } finally {
    clearAuthCache();
  }
}
