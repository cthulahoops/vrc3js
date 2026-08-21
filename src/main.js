import * as THREE from 'three';
import emojiFontUrl from '@fontsource/noto-color-emoji/files/noto-color-emoji-5-400-normal.woff2?url';
import { connectWorldStream } from './network.js';
import { buildWorld, loadWorldAssets } from './world.js';
import './style.css';

const canvas = document.querySelector('#world');
const screenshotMode = new URLSearchParams(location.search).has('screenshot');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: screenshotMode });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(62, 1, .1, 100); camera.position.set(5.5,.6,11);
scene.add(new THREE.HemisphereLight('#d8ece7','#6a7770',2.2)); const sun = new THREE.DirectionalLight('#fff4da',3); sun.position.set(-8,14,8); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-18; sun.shadow.camera.right=18; sun.shadow.camera.top=18; sun.shadow.camera.bottom=-18; scene.add(sun);
const emojiFont = new FontFace('Noto Color Emoji', `url(${emojiFontUrl})`);
document.fonts.add(await emojiFont.load());
await loadWorldAssets();
const world = buildWorld(scene, []);
const nearby = document.querySelector('#nearby');
const connectionStatus = document.querySelector('#connection-status');
function updateLegend() {
  const types = [...new Set([...world.entities.values()].map(object => object.userData.entity.type))].slice(0, 6);
  nearby.replaceChildren(...types.map(type => {
    const row = document.createElement('div'); row.className = 'person';
    const face = document.createElement('span'); face.className = 'face'; face.textContent = '◆';
    row.append(face, document.createTextNode(type)); return row;
  }));
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
  onSnapshot(entities) { world.replaceEntities(entities); updateLegend(); },
  onEntity(entity) { world.handleEntity(entity); updateLegend(); },
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
function animate(){ requestAnimationFrame(animate); const dt=Math.min(clock.getDelta(),.05); camera.rotation.set(pitch,yaw,0,'YXZ'); const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)); const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw)); const move=new THREE.Vector3(); if(keys.has('KeyW')||keys.has('ArrowUp'))move.add(forward); if(keys.has('KeyS')||keys.has('ArrowDown'))move.sub(forward); if(keys.has('KeyD')||keys.has('ArrowRight'))move.add(right); if(keys.has('KeyA')||keys.has('ArrowLeft'))move.sub(right); if(move.lengthSq())camera.position.addScaledVector(move.normalize(),dt*(keys.has('ShiftLeft')?7:4)); camera.position.x=THREE.MathUtils.clamp(camera.position.x,-13,13); camera.position.z=THREE.MathUtils.clamp(camera.position.z,-10,15); renderer.render(scene,camera); }
if (screenshotMode) renderScreenshot(); else animate();
