import { decodeActionCableMessage } from "./protocol.js";
import type { EntityUpdate } from "./protocol.js";
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

function tokensMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;

  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);

  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

interface OAuthTokenResponse { access_token?: unknown; error?: unknown; [key: string]: unknown }

async function exchangeAuthorizationCode(code: string): Promise<OAuthTokenResponse> {
  if (!oauthClientId || !oauthClientSecret || !oauthRedirectUri) {
    throw new Error("OAuth is not configured");
  }
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

  const result = await response.json().catch(() => null) as OAuthTokenResponse | null;

  if (!response.ok) {
    const oauthError = typeof result?.error === "string" ? result.error : `HTTP ${response.status}`;
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
const world = new Map<string, EntityUpdate>();
let hasSnapshot = false;
let upstream: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = reconnectMinimumMs;
let shuttingDown = false;
let upstreamStatus = "connecting";

const configuredOrigins = new Set(
  (Bun.env.BFF_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function isAllowedOrigin(origin: string | null): boolean {
  if (configuredOrigins.size) return origin !== null && configuredOrigins.has(origin);
  return (
    origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173"
  );
}

function encode(message: unknown): string {
  return JSON.stringify(message);
}

const browserClients = new Set<Bun.ServerWebSocket<undefined>>();

function send(client: Bun.ServerWebSocket<undefined>, message: unknown): void {
  if (client.readyState === WebSocket.OPEN) client.send(encode(message));
}

function broadcast(message: unknown): void {
  const encoded = encode(message);
  for (const client of browserClients) {
    if (client.readyState === WebSocket.OPEN) client.send(encoded);
  }
}

function replaceWorld(entities: EntityUpdate[]): void {
  world.clear();
  for (const entity of entities) {
    if (!("deleted" in entity)) world.set(entity.id, entity);
  }
  hasSnapshot = true;
  broadcast({ type: "snapshot", entities: [...world.values()] });
}

function updateWorld(entity: EntityUpdate): void {
  if ("deleted" in entity) world.delete(entity.id);
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
  const WebSocketWithOptions = WebSocket as unknown as {
    new(url: string, options: Bun.WebSocketOptions): WebSocket;
  };
  upstream = new WebSocketWithOptions(config.url, {
    headers: { Origin: config.origin },
  });

  const connectedSocket = upstream;
  connectedSocket.onmessage = (event) => {
    const raw = event.data;
    const size =
      typeof raw === "string" ? Buffer.byteLength(raw) : raw.byteLength;
    if (size > upstreamMaxPayloadBytes) {
      console.error(
        `Upstream world message exceeded RC_MAX_PAYLOAD_BYTES (${upstreamMaxPayloadBytes} bytes).`,
      );
      connectedSocket.close();
      return;
    }

    const message = decodeActionCableMessage(raw, subscriptionIdentifier);
    if (message.kind === "welcome") {
      connectedSocket.send(
        encode({ command: "subscribe", identifier: subscriptionIdentifier }),
      );
    } else if (message.kind === "confirmed") {
      upstreamStatus = "connected";
      broadcast({ type: "status", status: upstreamStatus });
    } else if (message.kind === "rejected") {
      console.error("RC Together rejected the Action Cable subscription.");
      connectedSocket.close();
    } else if (message.kind === "snapshot") {
      reconnectDelay = reconnectMinimumMs;
      replaceWorld(message.entities);
    } else if (message.kind === "entity") {
      updateWorld(message.entity);
    } else if (message.kind === "invalid") {
      console.warn("Dropped an invalid upstream message.");
    }
  };
  connectedSocket.onerror = (event) => {
    const errorEvent = event as ErrorEvent;
    console.error(
      `Upstream WebSocket error: ${errorEvent.message || String(errorEvent.error || "unknown")}`,
    );
    scheduleReconnect();
  };
  connectedSocket.onclose = scheduleReconnect;
}

const server = Bun.serve({
  hostname: Bun.env.BFF_HOST ?? "localhost",
  port: Number(Bun.env.BFF_PORT ?? 8787),

  routes: {
    "/api/session": {
      GET(request) {
        return Response.json(
          { authenticated: Boolean(validSession(request.cookies.get("session"))) },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },

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
            secure: Boolean(oauthRedirectUri?.startsWith("https:")),
          });

          return new Response(null, {
            status: 302,
            headers: {
              location: appOrigin ?? "/",
              "cache-control": "no-store",
            },
          });
        } catch (error) {
          console.error(`OAuth callback failed: ${error instanceof Error ? error.message : String(error)}`);

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
  if (reconnectTimer) clearTimeout(reconnectTimer);
  upstream?.close();
  for (const client of browserClients)
    client.close(1001, "Server shutting down");
  server.stop();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
