import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/dm-mono/latin-400.css";
import "@fontsource/dm-mono/latin-500.css";
import { requiredElement, setConnectionStatus } from "./dom.js";
import "./style.css";

const query = new URLSearchParams(location.search);
const login = requiredElement<HTMLElement>("#login");
const loginLink = requiredElement<HTMLAnchorElement>("#login-link");
const authStatus = requiredElement<HTMLElement>("#auth-status");
const welcome = requiredElement<HTMLElement>("#welcome");

interface SessionResponse {
  authenticated?: unknown;
}

function showLogin(message: string) {
  loginLink.hidden = false;
  authStatus.textContent = message;
}

async function checkSession(): Promise<boolean> {
  try {
    const response = await fetch("/api/session", {
      headers: { accept: "application/json" },
    });
    const session = response.ok
      ? ((await response.json()) as SessionResponse)
      : null;
    if (session?.authenticated) return true;
    showLogin("Recurse Center members only");
    setConnectionStatus("unauthenticated");
  } catch {
    showLogin("Unable to check your session. You can still try signing in.");
    setConnectionStatus("disconnected");
  }
  return false;
}

// The world (three.js, textures, skybox) is only fetched and started once we
// know the visitor may see it; verification fixtures skip the session check.
if (query.has("verify") || (await checkSession())) {
  authStatus.textContent = "Loading world…";
  await import("./app.js");
  login.classList.add("hidden");
  if (!query.has("verify")) welcome.classList.remove("hidden");
}
