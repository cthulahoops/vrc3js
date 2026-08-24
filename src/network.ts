const reconnectMinimumMs = 500;
const reconnectMaximumMs = 10_000;

import type { EntityUpdate } from "../server/protocol.js";

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
}: WorldStreamHandlers): () => void {
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = reconnectMinimumMs;
  let stopped = false;

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/api/world`);
    onStatus("connecting");

    socket.addEventListener("open", () => {
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
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaximumMs);
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
