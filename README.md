# VRC3D Three.js prototype

A Three.js port of the rendering core from [cthulahoops/vrc3d](https://github.com/cthulahoops/vrc3d). The renderer consumes protocol-shaped entity records and preserves the original entity dimensions and placement rules. A localhost backend-for-frontend (BFF) holds the RC application credentials, maintains one shared Action Cable subscription, and relays sanitized world snapshots and entity updates to browsers.

## Run

```bash
npm install
export RC_APP_ID=<app_id>
export RC_APP_SECRET=<app_secret>
npm run dev
```

Open `http://127.0.0.1:5173`, select **Enter world**, then use the mouse to look and WASD to move. Press Escape to release the mouse. Set `RC_ENDPOINT` to override the default `recurse.rctogether.com` upstream host.

The upstream WebSocket accepts world snapshots up to 16 MiB by default. Set `RC_MAX_PAYLOAD_BYTES` to a larger byte count if the configured world requires it.

`npm run dev` starts Vite and the BFF on loopback only. Vite proxies `/api/world` WebSocket upgrades to the BFF at `127.0.0.1:8787`. To run them independently, use `npm run dev:web` and `npm run dev:bff`; `BFF_HOST`, `BFF_PORT`, and the Vite proxy must agree if those defaults are changed.

The development BFF intentionally has no user authentication. It accepts browser connections only from `http://127.0.0.1:5173` and `http://localhost:5173` by default. `BFF_ALLOWED_ORIGINS` can provide a comma-separated exact allowlist, but authentication and HTTPS are required before exposing the service beyond localhost. RC credentials remain server-side and must never use Vite's client-visible `VITE_*` environment variables.

## Renderer boundary

`VirtualRcRenderer.handleEntity(entity)` adds or updates an entity by ID. Passing an entity with `deleted: true` removes it. The BFF sends a small browser-facing protocol:

```json
{ "type": "snapshot", "entities": [] }
{ "type": "entity", "entity": {} }
{ "type": "status", "status": "connected" }
```

Snapshots replace the renderer's entire entity set; entity messages are incremental. The exported `FIXTURE_WORLD` remains available for renderer development and tests, but the application starts with an empty scene and waits for the shared stream.

Emoji SVG artwork is from [Twemoji](https://github.com/jdecked/twemoji), licensed under CC-BY 4.0.
