# VRC3D Three.js prototype

A Three.js port of the rendering core from [cthulahoops/vrc3d](https://github.com/cthulahoops/vrc3d). The renderer consumes protocol-shaped entity records and preserves the original entity dimensions and placement rules. A fixed fixture exercises every supported entity type through the same add/update/delete interface intended for later network integration. Networking and the sky/star renderer are intentionally out of scope.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints, select **Enter world**, then use the mouse to look and WASD to move. Press Escape to release the mouse.

## Renderer boundary

`VirtualRcRenderer.handleEntity(entity)` adds or updates an entity by ID. Passing an entity with `deleted: true` removes it. `FIXTURE_WORLD` is the temporary data source; a later network adapter can feed the same renderer without changing scene construction.

Emoji SVG artwork is from [Twemoji](https://github.com/jdecked/twemoji), licensed under CC-BY 4.0.
