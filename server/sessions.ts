import { randomBytes } from "node:crypto";

export const sessionMaxAgeSeconds = 24 * 60 * 60;

const sessionLifetimeMs = sessionMaxAgeSeconds * 1000;
const sessions = new Map<string, number>();

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

export function validSession(
  sessionId: string | null | undefined,
): string | undefined {
  if (!sessionId) return undefined;

  const expiresAt = sessions.get(sessionId);

  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return undefined;
  }

  return sessionId;
}
