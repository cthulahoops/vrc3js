import * as THREE from 'three';
import { ORIGINAL_TEXTURES } from './originalTextures.js';

const EMOJI_DATA_URL = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/emoji.json';
const EMOJI_SHEET_URL = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/sheets-256/64.png';
const EMOJI_SIZE = 64;
const EMOJI_CELL_SIZE = EMOJI_SIZE + 2;

export const COLORS = {
  gray: '#919c9c', pink: '#d95a88', orange: '#e6a56e', green: '#3dc06c',
  blue: '#66bdff', purple: '#956bc3', yellow: '#e7dd6f',
};

const ICONS = {
  ZoomLink: ['↗', '#2472d9'], Link: ['↗', '#eeeeee'], Note: ['✎', COLORS.yellow],
  AudioBlock: ['♪', '#eeeeee'], 'RC::Calendar': ['31', '#eeeeee'], AudioRoom: ['●', '#eeeeee'],
};

let loadedAssets = {};
let emojiSprites = new Map();

function loadImage(source, crossOrigin = false) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image); image.onerror = reject; image.src = source;
  });
}

function addEmojiSprite(sprites, entry) {
  if (entry.sheet_x == null || entry.sheet_y == null || !entry.has_img_apple) return;
  const sprite = { x: entry.sheet_x * EMOJI_CELL_SIZE + 1, y: entry.sheet_y * EMOJI_CELL_SIZE + 1 };
  sprites.set(entry.unified, sprite);
  if (entry.non_qualified) sprites.set(entry.non_qualified, sprite);
}

function indexEmojiSprites(data) {
  const sprites = new Map();
  data.forEach(entry => {
    addEmojiSprite(sprites, entry);
    Object.values(entry.skin_variations || {}).forEach(variation => addEmojiSprite(sprites, variation));
  });
  return sprites;
}

export async function loadWorldAssets() {
  const [assets, emojiData, emojiSheet] = await Promise.all([
    Promise.all(Object.entries(ORIGINAL_TEXTURES).map(async ([name, source]) => [name, await loadImage(source)])),
    fetch(EMOJI_DATA_URL).then(response => {
      if (!response.ok) throw new Error(`Could not load emoji data (${response.status})`);
      return response.json();
    }),
    loadImage(EMOJI_SHEET_URL, true),
  ]);
  loadedAssets = { ...Object.fromEntries(assets), emojiSheet };
  emojiSprites = indexEmojiSprites(emojiData);
}

function canvasTexture(draw, repeat) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  draw(canvas.getContext('2d'), canvas);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat.x, repeat.y);
  }
  return texture;
}

function gridTexture() {
  const texture = canvasTexture((context, canvas) => {
    context.fillStyle = '#eeeeee'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(loadedAssets.grid, 0, 0, canvas.width, canvas.height);
  }, new THREE.Vector2(1000, 1000));
  return texture;
}

function faceTexture(symbol, background, foreground = '#16201e', emoji = false) {
  return canvasTexture((context, canvas) => {
    context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = foreground; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.font = emoji ? '136px "Noto Color Emoji", sans-serif' : '600 136px sans-serif';
    context.fillText(symbol, 128, 133, 220);
  });
}

function glyphTexture(symbol, background, foreground = '#16201e') {
  const unified = [...symbol].map(character => character.codePointAt(0).toString(16).toUpperCase()).join('-');
  const sprite = emojiSprites.get(unified);
  if (sprite) return canvasTexture((context, canvas) => {
    context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(loadedAssets.emojiSheet, sprite.x, sprite.y, EMOJI_SIZE, EMOJI_SIZE, 28, 28, 200, 200);
  });
  return faceTexture(symbol, background, foreground, /[^\u0000-\u00ff]/.test(symbol));
}

function material(color, texture = null) {
  return new THREE.MeshStandardMaterial({ color: texture ? '#ffffff' : color, map: texture, roughness: .76, metalness: .02 });
}

function iconTexture(type, background) {
  const [symbol, defaultBackground] = ICONS[type];
  const assetName = { ZoomLink: 'zoom', Link: 'link', Note: 'note', AudioBlock: 'audio_block', 'RC::Calendar': 'calendar', AudioRoom: 'microphone' }[type];
  if (!loadedAssets[assetName]) return faceTexture(symbol, background || defaultBackground);
  return canvasTexture((context, canvas) => {
    context.fillStyle = background || defaultBackground; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(loadedAssets[assetName], 0, 0, canvas.width, canvas.height);
  });
}

function avatarTexture(entity, image) {
  if (image) return canvasTexture((context, canvas) => {
    context.fillStyle = '#cccccc'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  });
  const initials = entity.initials || entity.name?.split(/\s+/).map(part => part[0]).join('').slice(0, 2) || '?';
  return faceTexture(initials, entity.photo_color || '#c8ceca');
}

function valuesEqual(left, right, ignoredKey = null) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left).filter(key => key !== ignoredKey);
  const rightKeys = Object.keys(right).filter(key => key !== ignoredKey);
  if (leftKeys.length !== rightKeys.length || leftKeys.some(key => !Object.hasOwn(right, key))) return false;
  return leftKeys.every(key => valuesEqual(left[key], right[key]));
}

export class VirtualRcRenderer {
  constructor(scene) {
    this.scene = scene;
    this.entities = new Map();
    this.avatarImages = new Map();
    this.avatarImageVersions = new Map();
    // These resources are renderer-owned. Entity deletion only detaches scene
    // objects; shared GPU resources are released together by dispose().
    this.geometries = new Map();
    this.materials = new Map();
    this.textures = new Map();
    const floor = new THREE.Mesh(
      this.geometry(new THREE.Vector3(1000, 1, 1000)),
      this.cachedMaterial('#eeeeee', this.texture('grid', gridTexture)),
    );
    // Entity coordinates identify cell centers, so the floor boundaries sit at
    // half-integers: the cell centered at (0, 0) spans -0.5 through 0.5.
    floor.position.set(499.5, -0.5, 499.5); floor.receiveShadow = true; this.scene.add(floor);
    this.floor = floor;
  }

  texture(key, create) {
    if (!this.textures.has(key)) this.textures.set(key, create());
    return this.textures.get(key);
  }

  geometry(size) {
    const key = `${size.x}:${size.y}:${size.z}`;
    if (!this.geometries.has(key)) this.geometries.set(key, new THREE.BoxGeometry(size.x, size.y, size.z));
    return this.geometries.get(key);
  }

  cachedMaterial(color, texture = null) {
    const key = `${texture ? '#ffffff' : color}:${texture?.uuid || ''}`;
    if (!this.materials.has(key)) this.materials.set(key, material(color, texture));
    return this.materials.get(key);
  }

  cachedGlyphTexture(symbol, background, foreground = '#16201e') {
    return this.texture(`glyph:${JSON.stringify([symbol, background, foreground])}`,
      () => glyphTexture(symbol, background, foreground));
  }

  cachedIconTexture(type, background, repeat = null) {
    const key = `icon:${JSON.stringify([type, background || '', repeat?.x || 0, repeat?.y || 0])}`;
    return this.texture(key, () => {
      const texture = iconTexture(type, background);
      if (repeat) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(repeat.x, repeat.y);
      }
      return texture;
    });
  }

  cachedAvatarTexture(entity) {
    const imageVersion = this.avatarImageVersions.get(entity.id) || 0;
    const initials = entity.initials || entity.name?.split(/\s+/).map(part => part[0]).join('').slice(0, 2) || '?';
    const image = this.avatarImages.get(entity.id);
    const visual = image ? [entity.id, imageVersion] : [initials, entity.photo_color || '#c8ceca'];
    const key = `avatar:${JSON.stringify(visual)}`;
    return this.texture(key, () => avatarTexture(entity, this.avatarImages.get(entity.id)));
  }

  cube(size, color, texture = null, offset = new THREE.Vector3()) {
    const mesh = new THREE.Mesh(this.geometry(size), this.cachedMaterial(color, texture));
    mesh.position.set(offset.x, offset.y + size.y / 2, offset.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  async setAvatarImage(id, source) {
    const image = typeof source === 'string' ? await new Promise((resolve, reject) => {
      const loaded = new Image(); loaded.onload = () => resolve(loaded); loaded.onerror = reject; loaded.src = source;
    }) : source;
    const previousVersion = this.avatarImageVersions.get(id) || 0;
    this.avatarImages.set(id, image);
    this.avatarImageVersions.set(id, previousVersion + 1);
    const current = this.entities.get(id)?.userData.entity;
    if (current?.type === 'Avatar') this.handleEntity(current, true);
    // Uploaded avatar textures are unique to an id/version, so once the scene
    // object has been rebuilt no other entity can still reference this pair.
    if (previousVersion) this.disposeAvatarImageVersion(id, previousVersion);
  }

  disposeAvatarImageVersion(id, version) {
    const textureKey = `avatar:${JSON.stringify([id, version])}`;
    const texture = this.textures.get(textureKey);
    if (!texture) return;
    const materialKey = `#ffffff:${texture.uuid}`;
    const cachedMaterial = this.materials.get(materialKey);
    cachedMaterial?.dispose();
    texture.dispose();
    this.materials.delete(materialKey);
    this.textures.delete(textureKey);
  }

  handleEntity(entity, forceRebuild = false) {
    if (entity.deleted) return this.deleteEntity(entity.id);
    const currentObject = this.entities.get(entity.id);
    const currentEntity = currentObject?.userData.entity;
    if (!forceRebuild && currentEntity && valuesEqual(currentEntity, entity)) return;
    if (!forceRebuild && currentEntity && valuesEqual(currentEntity, entity, 'pos')) {
      currentObject.position.set(entity.pos.x, 0, entity.pos.y);
      currentObject.userData.entity = structuredClone(entity);
      return;
    }
    const rendered = this.createEntity(entity);
    if (!rendered) {
      // A renderable record can become intentionally invisible (for example,
      // the upstream default bot emoji). Do not leave its old object behind.
      if (currentObject) this.deleteEntity(entity.id);
      return;
    }
    this.deleteEntity(entity.id);
    rendered.position.set(entity.pos.x, 0, entity.pos.y);
    rendered.userData.entity = structuredClone(entity);
    this.entities.set(entity.id, rendered); this.scene.add(rendered);
  }

  deleteEntity(id) {
    const object = this.entities.get(id); if (!object) return;
    this.scene.remove(object); this.entities.delete(id);
  }

  replaceEntities(entities) {
    const incomingIds = new Set();
    entities.forEach(entity => {
      this.handleEntity(entity);
      if (this.entities.has(entity.id)) incomingIds.add(entity.id);
    });
    for (const id of this.entities.keys()) if (!incomingIds.has(id)) this.deleteEntity(id);
  }

  dispose() {
    for (const id of [...this.entities.keys()]) this.deleteEntity(id);
    this.scene.remove(this.floor);
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(cached => cached.dispose());
    this.textures.forEach(texture => texture.dispose());
    this.geometries.clear(); this.materials.clear(); this.textures.clear();
    this.avatarImages.clear(); this.avatarImageVersions.clear();
  }

  createEntity(entity) {
    const group = new THREE.Group();
    if (entity.type === 'Wall') {
      const texture = entity.wall_text
        ? this.cachedGlyphTexture(entity.wall_text, COLORS[entity.color], '#17201e')
        : null;
      group.add(this.cube(new THREE.Vector3(1, 1, 1), COLORS[entity.color], texture));
    } else if (entity.type === 'Desk') {
      group.add(this.cube(new THREE.Vector3(.9, .04, .9), COLORS.orange, null, new THREE.Vector3(0, .35, 0)));
      for (const x of [-.4, .4]) for (const z of [-.4, .4])
        group.add(this.cube(new THREE.Vector3(.04, .35, .04), '#333333', null, new THREE.Vector3(x, 0, z)));
    } else if (entity.type === 'Avatar') {
      group.add(this.cube(new THREE.Vector3(.05, .8, .4), '#000000', this.cachedAvatarTexture(entity)));
    } else if (entity.type === 'ZoomLink') {
      group.add(this.cube(new THREE.Vector3(.6, .6, .6), '#0000ff', this.cachedIconTexture(entity.type, '#2472d9')));
    } else if (entity.type === 'Bot' && entity.emoji !== '👾') {
      group.add(this.cube(new THREE.Vector3(.4, .4, .4), '#202020', this.cachedGlyphTexture(entity.emoji, '#202020', '#ffffff')));
    } else if (entity.type === 'Link') {
      group.add(this.cube(new THREE.Vector3(.8, .8, .8), '#114433', this.cachedIconTexture(entity.type)));
    } else if (entity.type === 'Note') {
      group.add(this.cube(new THREE.Vector3(1, 1, 1), COLORS.yellow, this.cachedIconTexture(entity.type)));
    } else if (entity.type === 'AudioBlock' || entity.type === 'RC::Calendar') {
      group.add(this.cube(new THREE.Vector3(.6, .6, .6), '#114433', this.cachedIconTexture(entity.type)));
    } else if (entity.type === 'AudioRoom') {
      const texture = this.cachedIconTexture(entity.type, null, { x: entity.width, y: entity.height });
      group.add(this.cube(
        new THREE.Vector3(entity.width, .002, entity.height), '#114433', texture,
        new THREE.Vector3(entity.width / 2 - .5, 0, entity.height / 2 - .5),
      ));
    } else return null;
    return group;
  }
}

export const FIXTURE_WORLD = [
  { id: 'wall-a', type: 'Wall', pos: { x: 0, y: 0 }, color: 'blue', wall_text: 'A' },
  { id: 'wall-rocket', type: 'Wall', pos: { x: 1, y: 0 }, color: 'pink', wall_text: '🚀' },
  { id: 'wall-bike', type: 'Wall', pos: { x: 2, y: 0 }, color: 'orange', wall_text: '🚲' },
  { id: 'wall-helicopter', type: 'Wall', pos: { x: 3, y: 0 }, color: 'green', wall_text: '🚁' },
  { id: 'wall-3', type: 'Wall', pos: { x: 4, y: 0 }, color: 'purple' },
  { id: 'wall-4', type: 'Wall', pos: { x: 5, y: 0 }, color: 'yellow' },
  { id: 'desk-1', type: 'Desk', pos: { x: 1, y: 4 } },
  { id: 'avatar-1', type: 'Avatar', pos: { x: 3, y: 4 }, name: 'Ada Lovelace', initials: 'AL', photo_color: '#d7b18a' },
  { id: 'bot-1', type: 'Bot', pos: { x: 5, y: 4 }, name: 'Rocket', emoji: '🚀' },
  { id: 'zoom-1', type: 'ZoomLink', pos: { x: 7, y: 0 } },
  { id: 'link-1', type: 'Link', pos: { x: 8, y: 0 } },
  { id: 'note-1', type: 'Note', pos: { x: 9, y: 0 } },
  { id: 'audio-1', type: 'AudioBlock', pos: { x: 10, y: 0 } },
  { id: 'calendar-1', type: 'RC::Calendar', pos: { x: 11, y: 0 } },
  { id: 'room-1', type: 'AudioRoom', pos: { x: 7, y: 3 }, width: 4, height: 4 },
];

export function buildWorld(scene, initialEntities = FIXTURE_WORLD) {
  scene.background = new THREE.Color('#172322'); scene.fog = new THREE.Fog('#172322', 35, 85);
  const renderer = new VirtualRcRenderer(scene);
  initialEntities.forEach(entity => renderer.handleEntity(entity));
  return renderer;
}
