import http from 'node:http';
import process from 'node:process';
import { WebSocket, WebSocketServer } from 'ws';
import { decodeActionCableMessage } from './protocol.js';

const host = process.env.BFF_HOST || '127.0.0.1';
const port = Number(process.env.BFF_PORT || 8787);
const configuredMaxPayload = Number(process.env.RC_MAX_PAYLOAD_BYTES || 16 * 1024 * 1024);
if (!Number.isSafeInteger(configuredMaxPayload) || configuredMaxPayload <= 0) {
  throw new Error('RC_MAX_PAYLOAD_BYTES must be a positive integer.');
}
const upstreamMaxPayloadBytes = configuredMaxPayload;
const reconnectMinimumMs = 1_000;
const reconnectMaximumMs = 30_000;
const subscriptionIdentifier = JSON.stringify({ channel: 'ApiChannel' });
const world = new Map();
let hasSnapshot = false;
let upstream;
let reconnectTimer;
let reconnectDelay = reconnectMinimumMs;
let shuttingDown = false;
let upstreamStatus = 'connecting';

const configuredOrigins = new Set(
  (process.env.BFF_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
);

function isAllowedOrigin(origin) {
  if (configuredOrigins.size) return configuredOrigins.has(origin);
  return origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173';
}

function encode(message) {
  return JSON.stringify(message);
}

function send(client, message) {
  if (client.readyState === WebSocket.OPEN) client.send(encode(message));
}

function broadcast(message) {
  const encoded = encode(message);
  for (const client of browserServer.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(encoded);
  }
}

function replaceWorld(entities) {
  world.clear();
  for (const entity of entities) {
    if (!entity.deleted) world.set(entity.id, entity);
  }
  hasSnapshot = true;
  broadcast({ type: 'snapshot', entities: [...world.values()] });
}

function updateWorld(entity) {
  if (entity.deleted) world.delete(entity.id);
  else world.set(entity.id, entity);
  broadcast({ type: 'entity', entity });
}

function upstreamConfiguration() {
  const appId = process.env.RC_APP_ID;
  const appSecret = process.env.RC_APP_SECRET;
  const endpoint = process.env.RC_ENDPOINT || 'recurse.rctogether.com';
  if (!appId || !appSecret) return null;
  const query = new URLSearchParams({ app_id: appId, app_secret: appSecret });
  return {
    origin: `https://${endpoint}`,
    url: `wss://${endpoint}/cable?${query}`,
  };
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  upstreamStatus = 'reconnecting';
  broadcast({ type: 'status', status: 'reconnecting' });
  const jitteredDelay = Math.round(reconnectDelay * (0.8 + Math.random() * 0.4));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectUpstream();
  }, jitteredDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaximumMs);
}

function connectUpstream() {
  const config = upstreamConfiguration();
  if (!config) {
    console.error('RC_APP_ID and RC_APP_SECRET are required by the BFF.');
    upstreamStatus = 'unconfigured';
    broadcast({ type: 'status', status: 'unconfigured' });
    return;
  }

  upstreamStatus = 'connecting';
  broadcast({ type: 'status', status: upstreamStatus });
  upstream = new WebSocket(config.url, { origin: config.origin, maxPayload: upstreamMaxPayloadBytes });

  upstream.on('message', raw => {
    const message = decodeActionCableMessage(raw, subscriptionIdentifier);
    if (message.kind === 'welcome') {
      upstream.send(encode({ command: 'subscribe', identifier: subscriptionIdentifier }));
    } else if (message.kind === 'confirmed') {
      upstreamStatus = 'connected';
      broadcast({ type: 'status', status: upstreamStatus });
    } else if (message.kind === 'rejected') {
      console.error('RC Together rejected the Action Cable subscription.');
      upstream.close();
    } else if (message.kind === 'snapshot') {
      reconnectDelay = reconnectMinimumMs;
      replaceWorld(message.entities);
    } else if (message.kind === 'entity') {
      updateWorld(message.entity);
    } else if (message.kind === 'invalid') {
      console.warn('Dropped an invalid upstream message.');
    }
  });
  upstream.on('error', error => {
    if (error.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
      console.error(`Upstream world message exceeded RC_MAX_PAYLOAD_BYTES (${upstreamMaxPayloadBytes} bytes).`);
    } else {
      console.error(`Upstream WebSocket error: ${error.message}`);
    }
  });
  upstream.on('close', scheduleReconnect);
}

const server = http.createServer((request, response) => {
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('Not found');
});
const browserServer = new WebSocketServer({ noServer: true, maxPayload: 16_384 });

server.on('upgrade', (request, socket, head) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path !== '/api/world' || !isAllowedOrigin(request.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  browserServer.handleUpgrade(request, socket, head, client => browserServer.emit('connection', client, request));
});

browserServer.on('connection', client => {
  send(client, { type: 'status', status: upstreamStatus });
  if (hasSnapshot) send(client, { type: 'snapshot', entities: [...world.values()] });
});

server.listen(port, host, () => {
  console.log(`World BFF listening on ws://${host}:${port}/api/world`);
  connectUpstream();
});

function shutdown() {
  shuttingDown = true;
  clearTimeout(reconnectTimer);
  upstream?.close();
  for (const client of browserServer.clients) client.close(1001, 'Server shutting down');
  server.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
