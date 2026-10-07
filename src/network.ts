const reconnectMinimumMs = 500;
const reconnectMaximumMs = 10_000;

import type { EntityUpdate } from "../server/protocol.js";
import { hasSession } from "./session.js";

export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected"
  | "unconfigured"
  | string;

export interface WorldStreamHandlers {
  onSnapshot(entities: EntityUpdate[]): void;
  onEntity(entity: EntityUpdate): void;
  onStatus(status: ConnectionStatus): void;
  onSignedOut(): void;
}

interface StreamMessage {
  type?: unknown;
  entities?: unknown;
  entity?: unknown;
  status?: unknown;
}

export function connectWorldStream({
  onSnapshot,
  onEntity,
  onStatus,
  onSignedOut,
}: WorldStreamHandlers): () => void {
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = reconnectMinimumMs;
  let stopped = false;

  function scheduleReconnect() {
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaximumMs);
  }

  // Browsers hide the HTTP status of a refused WebSocket upgrade, so an
  // expired session looks like any other failed connection. Ask directly
  // before retrying, otherwise we'd retry a 401 forever.
  async function reconnectUnlessSignedOut() {
    try {
      if (!(await hasSession())) {
        stopped = true;
        onSignedOut();
        return;
      }
    } catch {
      // Server unreachable; keep retrying.
    }
    if (!stopped) scheduleReconnect();
  }

  function connect() {
    let opened = false;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/api/world`);
    onStatus("connecting");

    socket.addEventListener("open", () => {
      opened = true;
      reconnectDelay = reconnectMinimumMs;
    });
    socket.addEventListener("message", (event) => {
      let message: StreamMessage;
      try {
        message = JSON.parse(String(event.data)) as StreamMessage;
      } catch {
        console.warn("Ignored an invalid world-stream message.");
        return;
      }

      if (message.type === "snapshot" && Array.isArray(message.entities))
        onSnapshot(message.entities as EntityUpdate[]);
      else if (message.type === "entity" && message.entity)
        onEntity(message.entity as EntityUpdate);
      else if (message.type === "status" && typeof message.status === "string")
        onStatus(message.status);
    });
    socket.addEventListener("close", () => {
      if (stopped) return;
      onStatus("disconnected");
      if (opened) scheduleReconnect();
      else void reconnectUnlessSignedOut();
    });
    socket.addEventListener("error", () => socket?.close());
  }

  connect();
  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  };
}
