# VRC3D Three.js prototype

A Three.js port of the rendering core from [cthulahoops/vrc3d](https://github.com/cthulahoops/vrc3d). The renderer consumes protocol-shaped entity records and preserves the original entity dimensions and placement rules. A localhost backend-for-frontend (BFF) holds the RC application credentials, maintains one shared Action Cable subscription, and relays sanitized world snapshots and entity updates to browsers. The astronomical sky ports the original NASA star map, Moon phase lighting, and atmospheric-scattering shader.

## Run

```bash
npm install
export RC_APP_ID=<app_id>
export RC_APP_SECRET=<app_secret>
export OAUTH_CLIENT_ID=<oauth_client_id>
export OAUTH_CLIENT_SECRET=<oauth_client_secret>
export OAUTH_REDIRECT_URI=http://localhost:5173/auth/callback
export APP_ORIGIN=http://localhost:5173
npm run dev
```

Open `http://localhost:5173`, sign in with Recurse Center, and select **Enter world**. Then use the mouse to look and WASD to move. Press Escape to release the mouse. Set `RC_ENDPOINT` to override the default `recurse.rctogether.com` upstream host.

The upstream WebSocket accepts world snapshots up to 16 MiB by default. Set `RC_MAX_PAYLOAD_BYTES` to a larger byte count if the configured world requires it.

`npm run dev` starts Vite and the BFF on loopback only. Vite proxies `/api` requests and `/auth` redirects to the BFF at `localhost:8787`. To run them independently, use `npm run dev:web` and `npm run dev:bff`; `BFF_HOST`, `BFF_PORT`, and the Vite proxy must agree if those defaults are changed.

The BFF authenticates visitors through Recurse Center OAuth before accepting a world WebSocket. Register `OAUTH_REDIRECT_URI` as the OAuth application's callback URL; `APP_ORIGIN` is where successful callbacks return. Sessions are stored in memory for 24 hours, so restarting the BFF signs everyone out. The service accepts browser connections only from `http://127.0.0.1:5173` and `http://localhost:5173` by default. `BFF_ALLOWED_ORIGINS` can provide a comma-separated exact allowlist. All credentials remain server-side and must never use Vite's client-visible `VITE_*` environment variables.

## Screenshots

The Playwright verifier accepts protocol-shaped entities, camera position and
orientation (yaw/pitch/roll in radians), and an ISO sky time in a JSON fixture.
Install its managed Chromium once after installing dependencies:

Use [Rodney](https://github.com/simonw/rodney) for browser checks and screenshots.
The `screenshot` query parameter renders a static camera and exposes a ready
marker after WebGL finishes, so Rodney cannot capture a partial frame. A fresh
browser session will show the login screen; world screenshots require an
authenticated browser session:

```bash
npx playwright install chromium
```

The command starts an isolated Vite server and browser context, bypasses the
live world stream, waits for WebGL and browser presentation to complete, and
writes a screenshot:

```bash
npm run verify:screenshot -- test/fixtures/verification.json /tmp/vrc3d.png
# Optional viewport: ... /tmp/vrc3d.png 1920 1080
```

See `test/fixtures/verification.json` for the fixture contract. Invalid entities,
camera values, FOV, or dates fail before a frame is marked ready. This path
exercises the browser-facing entity protocol and real renderer; it deliberately
does not open the live WebSocket, keeping visual verification independent of RC
credentials and upstream state.

## Renderer boundary

`VirtualRcRenderer.handleEntity(entity)` adds or updates an entity by ID. Passing an entity with `deleted: true` removes it. The BFF sends a small browser-facing protocol:

```json
{ "type": "snapshot", "entities": [] }
{ "type": "entity", "entity": {} }
{ "type": "status", "status": "connected" }
```

Snapshots replace the renderer's entire entity set; entity messages are incremental. The exported `FIXTURE_WORLD` remains available for renderer development and tests, but the application starts with an empty scene and waits for the shared stream.

Avatar photo URLs remain server-side. Authenticated browsers receive cache-busted
`/api/avatars/:id` references, and the BFF fetches the corresponding upstream
image so canvas textures remain same-origin.

Sky textures are stored in `src/assets`, and UI fonts are installed from npm,
so those assets do not rely on third-party hosts at runtime. Source revisions
and file checksums are recorded alongside the vendored files.

Emoji artwork comes from the Apple sprite sheet in
[`emoji-datasource-apple`](https://github.com/iamcal/emoji-data). Apple emoji
images are copyrighted by Apple Inc. and are not licensed for commercial use.
