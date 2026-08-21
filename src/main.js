import * as THREE from 'three';
import emojiFontUrl from '@fontsource/noto-color-emoji/files/noto-color-emoji-5-400-normal.woff2?url';
import { connectWorldStream } from './network.js';
import { applyRenderQuality, createAdaptivePixelRatio } from './renderQuality.js';
import { buildWorld, loadWorldAssets } from './world.js';
import { Skybox } from './skybox.js';
import './style.css';

const canvas = document.querySelector('#world');
const screenshotMode = new URLSearchParams(location.search).has('screenshot');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: screenshotMode });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(62, 1, .1, 100); camera.position.set(5.5,.6,11);
scene.add(new THREE.HemisphereLight('#d8ece7','#6a7770',2.2)); const sun = new THREE.DirectionalLight('#fff4da',3); sun.position.set(-8,14,8); sun.castShadow=true; sun.shadow.camera.left=-18; sun.shadow.camera.right=18; sun.shadow.camera.top=18; sun.shadow.camera.bottom=-18; scene.add(sun);
const renderQuality = applyRenderQuality(renderer, sun, { screenshotMode });
const adaptivePixelRatio = renderQuality.adaptive ? createAdaptivePixelRatio(renderer, {
  initialPixelRatio: renderQuality.pixelRatio,
  maximumPixelRatio: Math.min(devicePixelRatio, renderQuality.maxPixelRatio),
  minimumPixelRatio: renderQuality.minPixelRatio,
}) : null;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
const skyboxPromise = Skybox.create(scene, {
  directionalLight: sun,
  date: screenshotMode ? new Date('2021-06-20T16:00:00Z') : new Date(),
});
const emojiFont = new FontFace('Noto Color Emoji', `url(${emojiFontUrl})`);
const [skybox] = await Promise.all([
  skyboxPromise,
  emojiFont.load().then(font => document.fonts.add(font)),
  loadWorldAssets(),
]);
const shadowSunDirection = skybox.sunDirection.clone();
const shadowSunThreshold = THREE.MathUtils.degToRad(.25);
let shadowSunVisible = sun.visible;
const world = buildWorld(scene, []);
const nearby = document.querySelector('#nearby');
const connectionStatus = document.querySelector('#connection-status');
const legendEntityTypes = new Map();
const legendTypeCounts = new Map();
let displayedLegendTypes = [];
function renderLegend() {
  const types = [...legendTypeCounts.keys()].slice(0, 6);
  if (types.length === displayedLegendTypes.length && types.every((type, index) => type === displayedLegendTypes[index])) return;
  displayedLegendTypes = types;
  nearby.replaceChildren(...types.map(type => {
    const row = document.createElement('div'); row.className = 'person';
    const face = document.createElement('span'); face.className = 'face'; face.textContent = '◆';
    row.append(face, document.createTextNode(type)); return row;
  }));
}
function resetLegend() {
  legendEntityTypes.clear(); legendTypeCounts.clear();
  for (const [id, object] of world.entities) {
    const type = object.userData.entity.type;
    legendEntityTypes.set(id, type);
    legendTypeCounts.set(type, (legendTypeCounts.get(type) || 0) + 1);
  }
  renderLegend();
}
function updateLegendEntity(id) {
  const previousType = legendEntityTypes.get(id);
  const nextType = world.entities.get(id)?.userData.entity.type;
  if (previousType === nextType) return;
  if (previousType) {
    const count = legendTypeCounts.get(previousType) - 1;
    if (count) legendTypeCounts.set(previousType, count); else legendTypeCounts.delete(previousType);
    legendEntityTypes.delete(id);
  }
  if (nextType) {
    legendEntityTypes.set(id, nextType);
    legendTypeCounts.set(nextType, (legendTypeCounts.get(nextType) || 0) + 1);
  }
  renderLegend();
}
function setConnectionStatus(status) {
  const labels = {
    connected: 'World stream connected', connecting: 'Connecting to world',
    reconnecting: 'Reconnecting to world', disconnected: 'World stream disconnected',
    unconfigured: 'RC credentials required',
  };
  connectionStatus.dataset.state = status;
  connectionStatus.querySelector('.status-label').textContent = labels[status] || 'World stream unavailable';
}
connectWorldStream({
  onSnapshot(entities) { world.replaceEntities(entities); resetLegend(); renderer.shadowMap.needsUpdate = true; if (screenshotMode) renderScreenshot(); },
  onEntity(entity) { world.handleEntity(entity); updateLegendEntity(entity.id); renderer.shadowMap.needsUpdate = true; if (screenshotMode) renderScreenshot(); },
  onStatus: setConnectionStatus,
});

let yaw = 0, pitch = -.04, active = false; const keys = new Set(); const clock = new THREE.Clock();
function lock() { canvas.requestPointerLock(); document.querySelector('#welcome').classList.add('hidden'); }
document.querySelector('#enter').addEventListener('click', lock); canvas.addEventListener('click', () => { if (document.querySelector('#welcome').classList.contains('hidden')) lock(); });
document.addEventListener('pointerlockchange',()=>{ active=document.pointerLockElement===canvas; document.body.classList.toggle('active',active); document.querySelector('#hint').textContent=active?'WASD to move · ESC to release':'Click anywhere to look around · WASD to move'; });
document.addEventListener('mousemove',e=>{ if(!active)return; yaw-=e.movementX*.0018; pitch=Math.max(-1.25,Math.min(1.25,pitch-e.movementY*.0018)); });
addEventListener('keydown',e=>keys.add(e.code)); addEventListener('keyup',e=>keys.delete(e.code));
function renderScreenshot(){ renderer.render(scene, camera); renderer.getContext().finish(); document.body.dataset.renderReady = 'true'; }
function resize(){ const w=innerWidth,h=innerHeight; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); if(screenshotMode) renderScreenshot(); } addEventListener('resize',resize); resize();
function updateSkybox(){ if(!skybox.update())return; const visibilityChanged=shadowSunVisible!==sun.visible; if(visibilityChanged||(sun.visible&&shadowSunDirection.angleTo(skybox.sunDirection)>=shadowSunThreshold)){ shadowSunDirection.copy(skybox.sunDirection); shadowSunVisible=sun.visible; renderer.shadowMap.needsUpdate=true; } }
function animate(){ requestAnimationFrame(animate); const frameDelta=clock.getDelta(); const dt=Math.min(frameDelta,.05); adaptivePixelRatio?.reportFrame(frameDelta); updateSkybox(); camera.rotation.set(pitch,yaw,0,'YXZ'); const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)); const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw)); const move=new THREE.Vector3(); if(keys.has('KeyW')||keys.has('ArrowUp'))move.add(forward); if(keys.has('KeyS')||keys.has('ArrowDown'))move.sub(forward); if(keys.has('KeyD')||keys.has('ArrowRight'))move.add(right); if(keys.has('KeyA')||keys.has('ArrowLeft'))move.sub(right); if(move.lengthSq())camera.position.addScaledVector(move.normalize(),dt*(keys.has('ShiftLeft')?7:4)); renderer.render(scene,camera); }
if (screenshotMode) renderScreenshot(); else animate();
