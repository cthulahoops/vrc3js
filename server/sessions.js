import { randomBytes, timingSafeEqual } from "node:crypto";

const appOrigin = process.env.APP_ORIGIN || "http://localhost:5173";
const sessionLifetimeMs = 24 * 60 * 60 * 1000;
const sessions = new Map();
const oauthRedirectUri = process.env.OAUTH_REDIRECT_URI;

function readCookie(cookieHeader, name) {
  for (const cookie of (cookieHeader || "").split(";")) {
    const separator = cookie.indexOf("=");
    if (separator === -1) continue;

    const cookieName = cookie.slice(0, separator).trim();
    if (cookieName !== name) continue;

    try {
      return decodeURIComponent(cookie.slice(separator + 1));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

export function createSession() {
  const now = Date.now();

  // Opportunistically remove expired sessions.
  for (const [id, expiresAt] of sessions) {
    if (expiresAt <= now) sessions.delete(id);
  }

  const id = randomToken();
  sessions.set(id, now + sessionLifetimeMs);
  return id;
}

export function sessionCookie(sessionId) {
  const secure = oauthRedirectUri?.startsWith("https:");

  return [
    `session=${encodeURIComponent(sessionId)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${sessionLifetimeMs / 1000}`,
    secure && "Secure",
  ]
    .filter(Boolean)
    .join("; ");
}

export function validSessionId(cookieHeader) {
  const sessionId = readCookie(cookieHeader, "session");
  if (!sessionId) return undefined;

  const expiresAt = sessions.get(sessionId);

  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return undefined;
  }

  return sessionId;
}
