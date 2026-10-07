import { requiredElement } from "./dom.js";

interface SessionResponse {
  authenticated?: unknown;
}

/** Throws if the server can't be reached. */
export async function hasSession(): Promise<boolean> {
  const response = await fetch("/api/session", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) return false;
  const session = (await response.json()) as SessionResponse;
  return Boolean(session.authenticated);
}

export function showLogin(message = "") {
  requiredElement<HTMLElement>("#login").classList.remove("hidden");
  requiredElement<HTMLAnchorElement>("#login-link").hidden = false;
  requiredElement<HTMLElement>("#auth-status").textContent = message;
}
