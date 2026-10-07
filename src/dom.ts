import type { ConnectionStatus } from "./network.js";

export function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export function setConnectionStatus(status: ConnectionStatus) {
  const labels: Record<string, string> = {
    connected: "World stream connected",
    connecting: "Connecting to world",
    reconnecting: "Reconnecting to world",
    disconnected: "World stream disconnected",
    unconfigured: "RC credentials required",
    verification: "Verification fixture",
    unauthenticated: "Sign in to connect",
  };
  const connectionStatus = requiredElement<HTMLElement>("#connection-status");
  connectionStatus.dataset.state = status;
  requiredElement<HTMLElement>("#connection-status .status-label").textContent =
    labels[status] || "World stream unavailable";
}
