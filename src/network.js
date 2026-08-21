const reconnectMinimumMs = 500;
const reconnectMaximumMs = 10_000;

export function connectWorldStream({ onSnapshot, onEntity, onStatus }) {
  let socket;
  let reconnectTimer;
  let reconnectDelay = reconnectMinimumMs;
  let stopped = false;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/api/world`);
    onStatus('connecting');

    socket.addEventListener('open', () => {
      reconnectDelay = reconnectMinimumMs;
    });
    socket.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        console.warn('Ignored an invalid world-stream message.');
        return;
      }

      if (message.type === 'snapshot' && Array.isArray(message.entities)) onSnapshot(message.entities);
      else if (message.type === 'entity' && message.entity) onEntity(message.entity);
      else if (message.type === 'status' && typeof message.status === 'string') onStatus(message.status);
    });
    socket.addEventListener('close', () => {
      if (stopped) return;
      onStatus('disconnected');
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaximumMs);
    });
    socket.addEventListener('error', () => socket.close());
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    socket?.close();
  };
}
