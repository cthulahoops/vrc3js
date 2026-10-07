import * as THREE from "three";
import emojiFontUrl from "@fontsource/noto-color-emoji/files/noto-color-emoji-5-400-normal.woff2?url";
import { connectWorldStream } from "./network.js";
import type {
  EntityId,
  EntityUpdate,
  WorldEntity,
} from "../server/protocol.js";
import {
  applyRenderQuality,
  createAdaptivePixelRatio,
} from "./renderQuality.js";
import { buildWorld, loadWorldAssets } from "./world.js";
import { Skybox } from "./skybox.js";
import { parseVerificationFixture } from "./verification.js";
import { requiredElement, setConnectionStatus } from "./dom.js";
import { showLogin } from "./session.js";

declare global {
  interface Window {
    __VRC3D_VERIFY__?: { render(fixture: unknown): void };
  }
}

const canvas = requiredElement<HTMLCanvasElement>("#world");
const query = new URLSearchParams(location.search);
const verificationMode = query.has("verify");
const welcome = requiredElement<HTMLElement>("#welcome");
const screenshotMode = query.has("screenshot") || verificationMode;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
  preserveDrawingBuffer: screenshotMode,
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 100);
camera.position.set(73, 0.6, 47);
scene.add(new THREE.HemisphereLight("#d8ece7", "#6a7770", 2.2));
const sun = new THREE.DirectionalLight("#fff4da", 3);
sun.position.set(-8, 14, 8);
sun.castShadow = true;
sun.shadow.camera.left = -18;
sun.shadow.camera.right = 18;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
scene.add(sun);
const renderQuality = applyRenderQuality(renderer, sun, { screenshotMode });
const adaptivePixelRatio = renderQuality.adaptive
  ? createAdaptivePixelRatio(renderer, {
      initialPixelRatio: renderQuality.pixelRatio,
      maximumPixelRatio: Math.min(
        devicePixelRatio,
        renderQuality.maxPixelRatio,
      ),
      minimumPixelRatio: renderQuality.minPixelRatio,
    })
  : null;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
const skyboxPromise = Skybox.create(scene, {
  directionalLight: sun,
  date: screenshotMode ? new Date("2021-06-20T16:00:00Z") : new Date(),
});
const emojiFont = new FontFace("Noto Color Emoji", `url(${emojiFontUrl})`);
const [skybox] = await Promise.all([
  skyboxPromise,
  emojiFont.load().then((font) => document.fonts.add(font)),
  loadWorldAssets(),
]);
const shadowSunDirection = skybox.sunDirection.clone();
const shadowSunThreshold = THREE.MathUtils.degToRad(0.25);
let shadowSunVisible = sun.visible;
const world = buildWorld(scene, []);
const avatarImageUrls = new Map<EntityId, string>();

function syncAvatarImage(entity: EntityUpdate): void {
  const imageUrl =
    !("deleted" in entity) && entity.type === "Avatar"
      ? entity.image_url
      : undefined;
  if (!imageUrl) {
    avatarImageUrls.delete(entity.id);
    world.clearAvatarImage(entity.id);
    return;
  }
  if (avatarImageUrls.get(entity.id) === imageUrl) return;
  avatarImageUrls.set(entity.id, imageUrl);
  world.clearAvatarImage(entity.id);

  const image = new Image();
  image.onload = () => {
    if (avatarImageUrls.get(entity.id) === imageUrl)
      void world.setAvatarImage(entity.id, image);
  };
  image.onerror = () => {
    if (avatarImageUrls.get(entity.id) === imageUrl)
      console.warn(`Could not load avatar image for ${entity.id}.`);
  };
  image.src = imageUrl;
}

function syncSnapshotAvatarImages(entities: EntityUpdate[]): void {
  const incoming = new Set(
    entities
      .filter((entity): entity is WorldEntity => !("deleted" in entity))
      .map((entity) => entity.id),
  );
  for (const id of avatarImageUrls.keys()) {
    if (!incoming.has(id)) {
      avatarImageUrls.delete(id);
      world.clearAvatarImage(id);
    }
  }
  entities.forEach(syncAvatarImage);
}
const streamHandlers = {
  onSnapshot(entities) {
    world.replaceEntities(entities);
    syncSnapshotAvatarImages(entities);
    renderer.shadowMap.needsUpdate = true;
    if (screenshotMode) renderScreenshot();
  },
  onEntity(entity) {
    world.handleEntity(entity);
    syncAvatarImage(entity);
    renderer.shadowMap.needsUpdate = true;
    if (screenshotMode) renderScreenshot();
  },
  onStatus: setConnectionStatus,
  onSignedOut() {
    document.exitPointerLock();
    showLogin("Your session has ended. Log in again to continue.");
    setConnectionStatus("unauthenticated");
  },
} satisfies Parameters<typeof connectWorldStream>[0];
if (verificationMode) setConnectionStatus("verification");
else connectWorldStream(streamHandlers);

// Spawn facing east (+x on the RC grid).
let yaw = -Math.PI / 2,
  pitch = -0.04,
  active = false;
const keys = new Set();
const clock = new THREE.Clock();
let verificationHasFixture = false;
let verificationFramesUntilReady = 0;
const hint = requiredElement<HTMLElement>("#hint");
function lock() {
  welcome.classList.add("hidden");
  // Pointer lock needs a recent user gesture; if the world took too long to
  // load, a click on the canvas takes it instead. Only Chromium returns a
  // promise here.
  Promise.resolve(canvas.requestPointerLock()).catch(() => {});
}
export { lock as enterWorld };
canvas.addEventListener("click", () => {
  if (welcome.classList.contains("hidden")) lock();
});
document.addEventListener("pointerlockchange", () => {
  active = document.pointerLockElement === canvas;
  document.body.classList.toggle("active", active);
  hint.textContent = active
    ? "WASD to move · ESC to release"
    : "Click anywhere to look around · WASD to move";
});
document.addEventListener("mousemove", (e) => {
  if (!active) return;
  yaw -= e.movementX * 0.0018;
  pitch = Math.max(-1.25, Math.min(1.25, pitch - e.movementY * 0.0018));
});
window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));
function renderScreenshot() {
  renderer.render(scene, camera);
  renderer.getContext().finish();
  document.body.dataset.renderReady = "true";
}
function resize() {
  const w = innerWidth,
    h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (screenshotMode && !verificationMode) renderScreenshot();
}
addEventListener("resize", resize);
resize();
function updateSkybox() {
  if (!skybox.update()) return;
  const visibilityChanged = shadowSunVisible !== sun.visible;
  if (
    visibilityChanged ||
    (sun.visible &&
      shadowSunDirection.angleTo(skybox.sunDirection) >= shadowSunThreshold)
  ) {
    shadowSunDirection.copy(skybox.sunDirection);
    shadowSunVisible = sun.visible;
    renderer.shadowMap.needsUpdate = true;
  }
}
// RC Together's grid (x, y) is the scene's (x, z), one unit per cell.
const coords = requiredElement<HTMLElement>("#coords");
function updateCoords() {
  const text = `x ${Math.round(camera.position.x)} · y ${Math.round(camera.position.z)}`;
  if (coords.textContent !== text) coords.textContent = text;
}
function animate() {
  requestAnimationFrame(animate);
  const frameDelta = clock.getDelta();
  const dt = Math.min(frameDelta, 0.05);
  adaptivePixelRatio?.reportFrame(frameDelta);
  updateSkybox();
  camera.rotation.set(pitch, yaw, 0, "YXZ");
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  if (keys.has("KeyW") || keys.has("ArrowUp")) move.add(forward);
  if (keys.has("KeyS") || keys.has("ArrowDown")) move.sub(forward);
  if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(right);
  if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(right);
  if (move.lengthSq())
    camera.position.addScaledVector(
      move.normalize(),
      dt * (keys.has("ShiftLeft") ? 7 : 4),
    );
  updateCoords();
  world.updateNoteDetail(camera.position);
  renderer.render(scene, camera);
}
function animateVerification() {
  requestAnimationFrame(animateVerification);
  if (!verificationHasFixture) return;
  renderer.render(scene, camera);
  renderer.getContext().finish();
  if (
    verificationFramesUntilReady > 0 &&
    --verificationFramesUntilReady === 0
  ) {
    document.body.dataset.renderReady = "true";
  }
}
if (verificationMode) {
  welcome.classList.add("hidden");
  window.__VRC3D_VERIFY__ = {
    render(input) {
      delete document.body.dataset.renderReady;
      delete document.body.dataset.renderError;
      try {
        const fixture = parseVerificationFixture(input);
        world.replaceEntities(fixture.entities);
        camera.position.set(
          fixture.camera.position.x,
          fixture.camera.position.y,
          fixture.camera.position.z,
        );
        const {
          pitch: fixturePitch,
          yaw: fixtureYaw,
          roll,
        } = fixture.camera.orientation;
        camera.rotation.set(fixturePitch, fixtureYaw, roll, "YXZ");
        camera.fov = fixture.camera.fov ?? 62;
        camera.updateProjectionMatrix();
        world.updateNoteDetail(camera.position, Infinity);
        skybox.update(fixture.time, true);
        renderer.shadowMap.needsUpdate = true;
        verificationHasFixture = true;
        // One frame submits WebGL work and the next gives the browser compositor
        // a presentation opportunity before Playwright observes the ready marker.
        verificationFramesUntilReady = 2;
      } catch (error) {
        document.body.dataset.renderError =
          error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
  };
  document.body.dataset.verificationReady = "true";
  animateVerification();
} else if (screenshotMode) renderScreenshot();
else animate();
