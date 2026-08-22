import { decodeActionCableMessage } from "./protocol.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createSession,
  sessionMaxAgeSeconds,
  validSession,
} from "./sessions.js";

const oauthClientId = Bun.env.OAUTH_CLIENT_ID;
const oauthRedirectUri = Bun.env.OAUTH_REDIRECT_URI;
const oauthClientSecret = Bun.env.OAUTH_CLIENT_SECRET;

const appOrigin = Bun.env.APP_ORIGIN;
const oauthAuthorizeEndpoint = "https://recurse.com/oauth/authorize";
const oauthTokenEndpoint = "https://www.recurse.com/oauth/token";

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function tokensMatch(left, right) {
  if (!left || !right) return false;

  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);

  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

async function exchangeAuthorizationCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: oauthClientId,
    client_secret: oauthClientSecret,
    redirect_uri: oauthRedirectUri,
  });

  const response = await fetch(oauthTokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const oauthError = result?.error || `HTTP ${response.status}`;
    throw new Error(`Recurse token exchange failed: ${oauthError}`);
  }

  if (typeof result?.access_token !== "string") {
    throw new Error("Recurse token response did not include an access token");
  }

  return result;
}

const configuredMaxPayload = Number(
  Bun.env.RC_MAX_PAYLOAD_BYTES || 16 * 1024 * 1024,
);
if (!Number.isSafeInteger(configuredMaxPayload) || configuredMaxPayload <= 0) {
  throw new Error("RC_MAX_PAYLOAD_BYTES must be a positive integer.");
}
const upstreamMaxPayloadBytes = configuredMaxPayload;
const reconnectMinimumMs = 1_000;
const reconnectMaximumMs = 30_000;
const subscriptionIdentifier = JSON.stringify({ channel: "ApiChannel" });
const world = new Map();
let hasSnapshot = false;
let upstream;
let reconnectTimer;
let reconnectDelay = reconnectMinimumMs;
let shuttingDown = false;
let upstreamStatus = "connecting";

const configuredOrigins = new Set(
  (Bun.env.BFF_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function isAllowedOrigin(origin) {
  if (configuredOrigins.size) return configuredOrigins.has(origin);
  return (
    origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173"
  );
}

function encode(message) {
  return JSON.stringify(message);
}

const browserClients = new Set();

function send(client, message) {
  if (client.readyState === WebSocket.OPEN) client.send(encode(message));
}

function broadcast(message) {
  const encoded = encode(message);
  for (const client of browserClients) {
    if (client.readyState === WebSocket.OPEN) client.send(encoded);
  }
}

function replaceWorld(entities) {
  world.clear();
  for (const entity of entities) {
    if (!entity.deleted) world.set(entity.id, entity);
  }
  hasSnapshot = true;
  broadcast({ type: "snapshot", entities: [...world.values()] });
}

function updateWorld(entity) {
  if (entity.deleted) world.delete(entity.id);
  else world.set(entity.id, entity);
  broadcast({ type: "entity", entity });
}

function upstreamConfiguration() {
  const appId = Bun.env.RC_APP_ID;
  const appSecret = Bun.env.RC_APP_SECRET;
  const endpoint = Bun.env.RC_ENDPOINT || "recurse.rctogether.com";
  if (!appId || !appSecret) return null;
  const query = new URLSearchParams({ app_id: appId, app_secret: appSecret });
  return {
    origin: `https://${endpoint}`,
    url: `wss://${endpoint}/cable?${query}`,
  };
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  upstreamStatus = "reconnecting";
  broadcast({ type: "status", status: "reconnecting" });
  const jitteredDelay = Math.round(
    reconnectDelay * (0.8 + Math.random() * 0.4),
  );
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectUpstream();
  }, jitteredDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaximumMs);
}

function connectUpstream() {
  const config = upstreamConfiguration();
  if (!config) {
    console.error("RC_APP_ID and RC_APP_SECRET are required by the BFF.");
    upstreamStatus = "unconfigured";
    broadcast({ type: "status", status: "unconfigured" });
    return;
  }

  upstreamStatus = "connecting";
  broadcast({ type: "status", status: upstreamStatus });
  upstream = new WebSocket(config.url, {
    headers: { Origin: config.origin },
  });

  upstream.onmessage = (event) => {
    const raw = event.data;
    const size =
      typeof raw === "string" ? Buffer.byteLength(raw) : raw.byteLength;
    if (size > upstreamMaxPayloadBytes) {
      console.error(
        `Upstream world message exceeded RC_MAX_PAYLOAD_BYTES (${upstreamMaxPayloadBytes} bytes).`,
      );
      upstream.close();
      return;
    }

    const message = decodeActionCableMessage(raw, subscriptionIdentifier);
    if (message.kind === "welcome") {
      upstream.send(
        encode({ command: "subscribe", identifier: subscriptionIdentifier }),
      );
    } else if (message.kind === "confirmed") {
      upstreamStatus = "connected";
      broadcast({ type: "status", status: upstreamStatus });
    } else if (message.kind === "rejected") {
      console.error("RC Together rejected the Action Cable subscription.");
      upstream.close();
    } else if (message.kind === "snapshot") {
      reconnectDelay = reconnectMinimumMs;
      replaceWorld(message.entities);
    } else if (message.kind === "entity") {
      updateWorld(message.entity);
    } else if (message.kind === "invalid") {
      console.warn("Dropped an invalid upstream message.");
    }
  };
  upstream.onerror = (event) => {
    console.error(
      `Upstream WebSocket error: ${event.message || event.error?.message || "unknown"}`,
    );
    scheduleReconnect();
  };
  upstream.onclose = scheduleReconnect;
}

const server = Bun.serve({
  hostname: Bun.env.BFF_HOST ?? "localhost",
  port: Number(Bun.env.BFF_PORT ?? 8787),

  routes: {
    "/auth/login": {
      GET(request) {
        if (!oauthClientId || !oauthRedirectUri) {
          return new Response("OAuth is not configured", {
            status: 503,
            headers: { "content-type": "text/plain" },
          });
        }

        const state = randomToken();
        const authorizationUrl = new URL(oauthAuthorizeEndpoint);

        authorizationUrl.searchParams.set("client_id", oauthClientId);
        authorizationUrl.searchParams.set("redirect_uri", oauthRedirectUri);
        authorizationUrl.searchParams.set("response_type", "code");
        //    authorizationUrl.searchParams.set("scope", "user:email");
        authorizationUrl.searchParams.set("state", state);

        request.cookies.set("oauth_state", state, {
          httpOnly: true,
          sameSite: "lax",
          path: "/auth/callback",
          maxAge: 600,
          secure: oauthRedirectUri.startsWith("https:"),
        });

        return new Response(null, {
          status: 302,
          headers: {
            location: authorizationUrl.toString(),
            "cache-control": "no-store",
          },
        });
      },
    },

    "/auth/callback": {
      async GET(request) {
        const requestUrl = new URL(request.url);
        const code = requestUrl.searchParams.get("code");
        const returnedState = requestUrl.searchParams.get("state");
        const cookieState = request.cookies.get("oauth_state");

        // The state cookie is single-use however the callback turns out.
        request.cookies.delete("oauth_state", { path: "/auth/callback" });

        if (!code || !tokensMatch(returnedState, cookieState)) {
          return new Response("Invalid OAuth callback", {
            status: 400,
            headers: {
              "content-type": "text/plain",
              "cache-control": "no-store",
            },
          });
        }

        try {
          await exchangeAuthorizationCode(code);

          request.cookies.set("session", createSession(), {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            maxAge: sessionMaxAgeSeconds,
            secure: oauthRedirectUri?.startsWith("https:"),
          });

          return new Response(null, {
            status: 302,
            headers: {
              location: appOrigin,
              "cache-control": "no-store",
            },
          });
        } catch (error) {
          console.error(`OAuth callback failed: ${error.message}`);

          return new Response("Could not complete Recurse authorization", {
            status: 502,
            headers: {
              "content-type": "text/plain",
              "cache-control": "no-store",
            },
          });
        }
      },
    },

    "/api/world": (request, server) => {
      if (!isAllowedOrigin(request.headers.get("origin"))) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!validSession(request.cookies.get("session"))) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (server.upgrade(request)) return undefined;
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    },
  },

  fetch() {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  },

  websocket: {
    idleTimeout: 0,
    maxPayloadLength: 16_384,

    open(client) {
      browserClients.add(client);
      send(client, { type: "status", status: upstreamStatus });
      if (hasSnapshot)
        send(client, { type: "snapshot", entities: [...world.values()] });
    },

    // The browser protocol is one-way; ignore anything a client sends.
    message() {},

    close(client) {
      browserClients.delete(client);
    },
  },
});

console.log(
  `World BFF listening on ws://${server.hostname}:${server.port}/api/world`,
);
connectUpstream();

function shutdown() {
  shuttingDown = true;
  clearTimeout(reconnectTimer);
  upstream?.close();
  for (const client of browserClients)
    client.close(1001, "Server shutting down");
  server.stop();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
