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

const enterButton = requiredElement<HTMLButtonElement>("#enter");

async function enterWorld() {
  enterButton.disabled = true;
  enterButton.textContent = "Loading world…";
  try {
    const app = await import("./app.js");
    app.enterWorld();
  } catch (error) {
    console.error(error);
    enterButton.textContent = "Couldn't load the world — reload to retry";
  }
}

// The world (three.js, textures, skybox) is only fetched and started once the
// visitor chooses to enter; verification and screenshot pages load it
// straight away.
if (query.has("verify")) {
  await import("./app.js");
  login.classList.add("hidden");
} else if (await checkSession()) {
  login.classList.add("hidden");
  if (query.has("screenshot")) await import("./app.js");
  else welcome.classList.remove("hidden");
  enterButton.addEventListener("click", () => void enterWorld(), {
    once: true,
  });
}
