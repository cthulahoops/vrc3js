import * as THREE from "three";
import { ORIGINAL_TEXTURES } from "./originalTextures.js";
import { InstanceBatchRegistry } from "./instanceBatches.js";
import { fitNoteText } from "./noteText.js";
import type {
  AvatarEntity,
  EntityColor,
  EntityId,
  EntityUpdate,
  EntityType,
  NoteEntity,
  WorldEntity,
} from "../server/protocol.js";

type ImageAsset = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
interface EmojiSprite {
  x: number;
  y: number;
}
interface EmojiEntry {
  sheet_x?: number;
  sheet_y?: number;
  has_img_apple?: boolean;
  unified: string;
  non_qualified?: string;
  skin_variations?: Record<string, EmojiEntry>;
}
interface RenderComponent {
  size: THREE.Vector3;
  offset: THREE.Vector3;
  material: THREE.MeshStandardMaterial;
  color: THREE.Color | null;
  castShadow?: boolean;
}
export interface RetainedComponent extends RenderComponent {
  key: object;
}
export type EntityHandle = THREE.Object3D & {
  userData: {
    entity?: WorldEntity;
    components?: RetainedComponent[];
  };
};

const EMOJI_DATA_URL =
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/emoji.json";
const EMOJI_SHEET_URL =
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@14.0.0/img/apple/sheets-256/64.png";
const EMOJI_SIZE = 64;
const EMOJI_CELL_SIZE = EMOJI_SIZE + 2;
const PHOTO_ICON_URL = new URL("./assets/photo.svg", import.meta.url).href;

export const COLORS: Record<EntityColor, string> = {
  gray: "#919c9c",
  pink: "#d95a88",
  orange: "#e6a56e",
  green: "#3dc06c",
  blue: "#66bdff",
  purple: "#956bc3",
  yellow: "#e7dd6f",
};

type IconType = Exclude<
  EntityType,
  "Wall" | "Desk" | "Avatar" | "Bot" | "Note"
>;
const ICONS: Record<IconType, readonly [string, string]> = {
  ZoomLink: ["↗", "#2472d9"],
  Link: ["↗", "#eeeeee"],
  AudioBlock: ["♪", "#eeeeee"],
  PhotoBlock: ["▣", COLORS.gray],
  "RC::Calendar": ["31", "#eeeeee"],
  AudioRoom: ["●", "#eeeeee"],
};

const POST_IT_COLOR = "#fbe56b";
const POST_IT_INK = "#2a2d36";
const POST_IT_FONT = "Manrope, sans-serif";
const POST_IT_SIZE = 0.84;
const POST_IT_THICKNESS = 0.012;
// Text is drawn only for nearby notes. The wider release distance stops notes
// on the boundary from rebuilding their texture every frame.
const NOTE_DETAIL_DISTANCE = 6;
const NOTE_DETAIL_RELEASE_DISTANCE = 8;
const MAX_DETAILED_NOTES = 16;

let loadedAssets: Record<string, ImageAsset> = {};
let emojiSprites = new Map<string, EmojiSprite>();

function loadImage(
  source: string,
  crossOrigin = false,
): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function addEmojiSprite(
  sprites: Map<string, EmojiSprite>,
  entry: EmojiEntry,
): void {
  if (entry.sheet_x == null || entry.sheet_y == null || !entry.has_img_apple)
    return;
  const sprite = {
    x: entry.sheet_x * EMOJI_CELL_SIZE + 1,
    y: entry.sheet_y * EMOJI_CELL_SIZE + 1,
  };
  sprites.set(entry.unified, sprite);
  if (entry.non_qualified) sprites.set(entry.non_qualified, sprite);
}

function indexEmojiSprites(data: EmojiEntry[]): Map<string, EmojiSprite> {
  const sprites = new Map<string, EmojiSprite>();
  data.forEach((entry) => {
    addEmojiSprite(sprites, entry);
    Object.values(entry.skin_variations || {}).forEach((variation) =>
      addEmojiSprite(sprites, variation),
    );
  });
  return sprites;
}

export async function loadWorldAssets() {
  const [assets, emojiData, emojiSheet] = await Promise.all([
    Promise.all(
      Object.entries({ ...ORIGINAL_TEXTURES, photo: PHOTO_ICON_URL }).map(
        async ([name, source]) => [name, await loadImage(source)],
      ),
    ),
    fetch(EMOJI_DATA_URL).then(async (response) => {
      if (!response.ok)
        throw new Error(`Could not load emoji data (${response.status})`);
      return (await response.json()) as EmojiEntry[];
    }),
    loadImage(EMOJI_SHEET_URL, true),
  ]);
  // Canvas text does not trigger web font loading, so load the note face first.
  await document.fonts.load(`600 32px ${POST_IT_FONT}`);
  loadedAssets = { ...Object.fromEntries(assets), emojiSheet };
  emojiSprites = indexEmojiSprites(emojiData);
}

function canvasTexture(
  draw: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void,
  repeat: THREE.Vector2 | null = null,
  size: { width: number; height: number } = { width: 256, height: 256 },
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D rendering is unavailable");
  draw(context, canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat.x, repeat.y);
  }
  return texture;
}

function gridTexture() {
  const texture = canvasTexture(
    (context, canvas) => {
      context.fillStyle = "#eeeeee";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(loadedAssets.grid!, 0, 0, canvas.width, canvas.height);
    },
    new THREE.Vector2(1000, 1000),
  );
  return texture;
}

function faceTexture(
  symbol: string,
  background: string,
  foreground = "#16201e",
  emoji = false,
): THREE.CanvasTexture {
  return canvasTexture((context, canvas) => {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = foreground;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = emoji
      ? '136px "Noto Color Emoji", sans-serif'
      : "600 136px sans-serif";
    context.fillText(symbol, 128, 133, 220);
  });
}

function emojiSprite(symbol: string): EmojiSprite | undefined {
  const unified = [...symbol]
    .map((character) => character.codePointAt(0)!.toString(16).toUpperCase())
    .join("-");
  return emojiSprites.get(unified);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
type TextRun = string | EmojiSprite;

/** Split text so emoji can be drawn from the sprite sheet between text runs. */
function textRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const { segment } of graphemes.segment(text)) {
    const sprite = /\p{Emoji_Presentation}|\uFE0F/u.test(segment)
      ? emojiSprite(segment)
      : undefined;
    const previous = runs[runs.length - 1];
    if (sprite) runs.push(sprite);
    else if (typeof previous === "string") runs[runs.length - 1] += segment;
    else runs.push(segment);
  }
  return runs;
}

const EMOJI_ADVANCE = 1.15;

function measureRuns(
  context: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
): number {
  context.font = `600 ${fontSize}px ${POST_IT_FONT}`;
  return textRuns(text).reduce(
    (width, run) =>
      width +
      (typeof run === "string"
        ? context.measureText(run).width
        : fontSize * EMOJI_ADVANCE),
    0,
  );
}

function drawRuns(
  context: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  x: number,
  y: number,
): void {
  for (const run of textRuns(text)) {
    if (typeof run === "string") {
      context.fillText(run, x, y);
      x += context.measureText(run).width;
      continue;
    }
    const inset = fontSize * (EMOJI_ADVANCE - 1) * 0.5;
    context.drawImage(
      loadedAssets.emojiSheet!,
      run.x,
      run.y,
      EMOJI_SIZE,
      EMOJI_SIZE,
      x + inset,
      y,
      fontSize,
      fontSize,
    );
    x += fontSize * EMOJI_ADVANCE;
  }
}

function glyphTexture(
  symbol: string,
  background: string,
  foreground = "#16201e",
): THREE.CanvasTexture {
  const sprite = emojiSprite(symbol);
  if (sprite)
    return canvasTexture((context, canvas) => {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        loadedAssets.emojiSheet!,
        sprite.x,
        sprite.y,
        EMOJI_SIZE,
        EMOJI_SIZE,
        28,
        28,
        200,
        200,
      );
    });
  return faceTexture(
    symbol,
    background,
    foreground,
    /[^\u0000-\u00ff]/.test(symbol),
  );
}

function material(
  color: THREE.ColorRepresentation,
  texture: THREE.Texture | null = null,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: texture ? "#ffffff" : color,
    map: texture,
    roughness: 0.76,
    metalness: 0.02,
  });
}

function iconTexture(
  type: IconType,
  background?: string | null,
): THREE.CanvasTexture {
  const [symbol, defaultBackground] = ICONS[type];
  const assetName: Record<IconType, string> = {
    ZoomLink: "zoom",
    Link: "link",
    AudioBlock: "audio_block",
    PhotoBlock: "photo",
    "RC::Calendar": "calendar",
    AudioRoom: "microphone",
  };
  const asset = loadedAssets[assetName[type]];
  if (!asset) return faceTexture(symbol, background || defaultBackground);
  return canvasTexture((context, canvas) => {
    context.fillStyle = background || defaultBackground;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(asset, 0, 0, canvas.width, canvas.height);
  });
}

/**
 * A post-it with its bottom-right corner peeled up. `text` null draws the
 * distant placeholder; `scribble` hints that a distant note has content.
 */
function postItTexture(
  text: string | null,
  scribble = false,
): THREE.CanvasTexture {
  const size = text && text.length > 240 ? 1024 : 512;
  return canvasTexture(
    (context, canvas) => {
      const s = canvas.width;
      const fold = s * 0.14;
      context.fillStyle = POST_IT_COLOR;
      context.fillRect(0, 0, s, s);
      // The adhesive strip is slightly darker, as on a real pad.
      context.fillStyle = "rgba(170, 130, 0, 0.1)";
      context.fillRect(0, 0, s, s * 0.06);
      const shade = context.createLinearGradient(0, 0, 0, s);
      shade.addColorStop(0, "rgba(255, 255, 255, 0.12)");
      shade.addColorStop(1, "rgba(160, 120, 0, 0.12)");
      context.fillStyle = shade;
      context.fillRect(0, 0, s, s);
      // The block shows through where the corner has curled away.
      context.fillStyle = COLORS.gray;
      context.beginPath();
      context.moveTo(s - fold, s);
      context.lineTo(s, s - fold);
      context.lineTo(s, s);
      context.fill();
      context.fillStyle = "#d9bf3c";
      context.beginPath();
      context.moveTo(s - fold, s);
      context.lineTo(s, s - fold);
      context.lineTo(s - fold * 0.92, s - fold * 0.92);
      context.fill();

      if (scribble) {
        context.strokeStyle = "rgba(42, 45, 54, 0.32)";
        context.lineWidth = s * 0.022;
        context.lineCap = "round";
        [0.62, 0.48, 0.7, 0.35].forEach((width, row) => {
          const y = s * (0.24 + row * 0.13);
          context.beginPath();
          context.moveTo(s * 0.14, y);
          context.lineTo(s * (0.14 + width), y);
          context.stroke();
        });
      }
      if (!text) return;

      const left = s * 0.08;
      const top = s * 0.09;
      const layout = fitNoteText(
        (line, fontSize) => measureRuns(context, line, fontSize),
        text,
        {
          width: s - left * 2,
          height: s - top - s * 0.15,
          minFontSize: Math.round(s * 0.022),
          maxFontSize: Math.round(s * 0.16),
        },
      );
      context.font = `600 ${layout.fontSize}px ${POST_IT_FONT}`;
      context.fillStyle = POST_IT_INK;
      context.textAlign = "left";
      context.textBaseline = "top";
      layout.lines.forEach((line, index) =>
        drawRuns(
          context,
          line,
          layout.fontSize,
          left,
          top + index * layout.lineHeight,
        ),
      );
    },
    null,
    { width: size, height: size },
  );
}

function avatarTexture(
  entity: AvatarEntity,
  image?: ImageAsset,
): THREE.CanvasTexture {
  if (image)
    return canvasTexture(
      (context, canvas) => {
        context.fillStyle = "#cccccc";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const sourceWidth = image.width;
        const sourceHeight = image.height;
        const scale = Math.max(canvas.width / sourceWidth, 128 / sourceHeight);
        const width = sourceWidth * scale;
        const height = sourceHeight * scale;
        context.drawImage(
          image,
          (canvas.width - width) / 2,
          (128 - height) / 2,
          width,
          height,
        );
      },
      null,
      { width: 128, height: 256 },
    );
  const initials =
    entity.initials ||
    entity.name
      ?.split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2) ||
    "?";
  return canvasTexture(
    (context, canvas) => {
      context.fillStyle = "#cccccc";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = entity.photo_color || "#c8ceca";
      context.fillRect(0, 0, canvas.width, 128);
      context.fillStyle = "#16201e";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "600 82px sans-serif";
      context.fillText(initials, canvas.width / 2, 67, 112);
    },
    null,
    { width: 128, height: 256 },
  );
}

function valuesEqual(
  left: unknown,
  right: unknown,
  ignoredKey: string | null = null,
): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left).filter((key) => key !== ignoredKey);
  const rightKeys = Object.keys(right).filter((key) => key !== ignoredKey);
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key) => !Object.hasOwn(right, key))
  )
    return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  return leftKeys.every((key) =>
    valuesEqual(leftRecord[key], rightRecord[key]),
  );
}

interface NoteDetail {
  text: string;
  texture: THREE.CanvasTexture;
  material: THREE.MeshStandardMaterial;
}

export class VirtualRcRenderer {
  static readonly scratchMatrix = new THREE.Matrix4();
  static readonly scratchPosition = new THREE.Vector3();
  static readonly identityQuaternion = new THREE.Quaternion();

  readonly scene: THREE.Scene;
  readonly entities = new Map<EntityId, EntityHandle>();
  readonly avatarImages = new Map<EntityId, ImageAsset>();
  readonly avatarImageVersions = new Map<EntityId, number>();
  readonly geometries = new Map<string, THREE.BoxGeometry>();
  readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  readonly textures = new Map<string, THREE.Texture>();
  readonly notes = new Set<EntityId>();
  // Detailed note textures are unique per note, so they live outside the
  // shared caches and are disposed as soon as the viewer walks away.
  readonly noteDetails = new Map<EntityId, NoteDetail>();
  readonly instanceBatches: InstanceBatchRegistry;
  readonly instanceGeometry: THREE.BoxGeometry;
  readonly instanceColorMaterial: THREE.MeshStandardMaterial;
  readonly floor: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // These resources are renderer-owned. Entity deletion only detaches scene
    // objects; shared GPU resources are released together by dispose().
    this.instanceBatches = new InstanceBatchRegistry(scene);
    this.instanceGeometry = this.geometry(new THREE.Vector3(1, 1, 1));
    this.instanceColorMaterial = this.cachedMaterial("#ffffff");
    const floor = new THREE.Mesh(
      this.geometry(new THREE.Vector3(1000, 1, 1000)),
      this.cachedMaterial("#eeeeee", this.texture("grid", gridTexture)),
    );
    // Entity coordinates identify cell centers, so the floor boundaries sit at
    // half-integers: the cell centered at (0, 0) spans -0.5 through 0.5.
    floor.position.set(499.5, -0.5, 499.5);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;
  }

  texture<T extends THREE.Texture>(key: string, create: () => T): T {
    if (!this.textures.has(key)) this.textures.set(key, create());
    return this.textures.get(key)! as T;
  }

  geometry(size: THREE.Vector3): THREE.BoxGeometry {
    const key = `${size.x}:${size.y}:${size.z}`;
    if (!this.geometries.has(key))
      this.geometries.set(key, new THREE.BoxGeometry(size.x, size.y, size.z));
    return this.geometries.get(key)!;
  }

  cachedMaterial(
    color: THREE.ColorRepresentation,
    texture: THREE.Texture | null = null,
  ): THREE.MeshStandardMaterial {
    const key = `${texture ? "#ffffff" : color}:${texture?.uuid || ""}`;
    if (!this.materials.has(key))
      this.materials.set(key, material(color, texture));
    return this.materials.get(key)!;
  }

  cachedGlyphTexture(
    symbol: string,
    background: string,
    foreground = "#16201e",
  ): THREE.Texture {
    return this.texture(
      `glyph:${JSON.stringify([symbol, background, foreground])}`,
      () => glyphTexture(symbol, background, foreground),
    );
  }

  cachedIconTexture(
    type: IconType,
    background?: string | null,
    repeat: { x: number; y: number } | null = null,
  ): THREE.Texture {
    const key = `icon:${JSON.stringify([type, background || "", repeat?.x || 0, repeat?.y || 0])}`;
    return this.texture(key, () => {
      const texture = iconTexture(type, background);
      if (repeat) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(repeat.x, repeat.y);
      }
      return texture;
    });
  }

  cachedAvatarTexture(entity: AvatarEntity): THREE.Texture {
    const imageVersion = this.avatarImageVersions.get(entity.id) || 0;
    const initials =
      entity.initials ||
      entity.name
        ?.split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2) ||
      "?";
    const image = this.avatarImages.get(entity.id);
    const visual = image
      ? [entity.id, imageVersion]
      : [initials, entity.photo_color || "#c8ceca"];
    const key = `avatar:${JSON.stringify(visual)}`;
    return this.texture(key, () =>
      avatarTexture(entity, this.avatarImages.get(entity.id)),
    );
  }

  cube(
    size: THREE.Vector3,
    color: THREE.ColorRepresentation,
    texture: THREE.Texture | null = null,
    offset = new THREE.Vector3(),
  ): RenderComponent {
    return {
      size,
      offset,
      material: texture
        ? this.cachedMaterial(color, texture)
        : this.instanceColorMaterial,
      color: texture ? null : new THREE.Color(color),
    };
  }

  componentMatrix(
    handle: EntityHandle,
    component: RetainedComponent,
    target = new THREE.Matrix4(),
  ): THREE.Matrix4 {
    const position = VirtualRcRenderer.scratchPosition.set(
      handle.position.x + component.offset.x,
      component.offset.y + component.size.y / 2,
      handle.position.z + component.offset.z,
    );
    return target.compose(
      position,
      VirtualRcRenderer.identityQuaternion,
      component.size,
    );
  }

  setEntityComponents(
    handle: EntityHandle,
    components: RenderComponent[],
  ): void {
    const previous = handle.userData.components || [];
    handle.userData.components = components.map((component, index) => ({
      ...component,
      key: previous[index]?.key || {},
    }));
    this.updateEntityMatrices(handle);
    for (let index = components.length; index < previous.length; index += 1) {
      this.instanceBatches.delete(previous[index]!.key);
    }
  }

  updateEntityMatrices(handle: EntityHandle): void {
    for (const component of handle.userData.components || []) {
      const castShadow = component.castShadow ?? true;
      const bucketKey = `${this.instanceGeometry.uuid}:${component.material.uuid}:${castShadow ? "shadow" : "flat"}`;
      this.instanceBatches.set(component.key, {
        bucketKey,
        geometry: this.instanceGeometry,
        material: component.material,
        matrix: this.componentMatrix(
          handle,
          component,
          VirtualRcRenderer.scratchMatrix,
        ),
        castShadow,
        receiveShadow: true,
        color: component.color,
      });
    }
  }

  async setAvatarImage(
    id: EntityId,
    source: string | ImageAsset,
  ): Promise<void> {
    const image =
      typeof source === "string"
        ? await new Promise<HTMLImageElement>((resolve, reject) => {
            const loaded = new Image();
            loaded.onload = () => resolve(loaded);
            loaded.onerror = reject;
            loaded.src = source;
          })
        : source;
    const previousVersion = this.avatarImageVersions.get(id) || 0;
    this.avatarImages.set(id, image);
    this.avatarImageVersions.set(id, previousVersion + 1);
    const current = this.entities.get(id)?.userData.entity;
    if (current?.type === "Avatar") this.handleEntity(current, true);
    // Uploaded avatar textures are unique to an id/version, so once the scene
    // object has been rebuilt no other entity can still reference this pair.
    if (previousVersion) this.disposeAvatarImageVersion(id, previousVersion);
  }

  clearAvatarImage(id: EntityId): void {
    if (!this.avatarImages.has(id)) return;
    const previousVersion = this.avatarImageVersions.get(id) || 0;
    this.avatarImages.delete(id);
    this.avatarImageVersions.delete(id);
    const current = this.entities.get(id)?.userData.entity;
    if (current?.type === "Avatar") this.handleEntity(current, true);
    if (previousVersion) this.disposeAvatarImageVersion(id, previousVersion);
  }

  disposeAvatarImageVersion(id: EntityId, version: number): void {
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

  handleEntity(entity: EntityUpdate, forceRebuild = false): void {
    if ("deleted" in entity) return this.deleteEntity(entity.id);
    const currentObject = this.entities.get(entity.id);
    const currentEntity = currentObject?.userData.entity;
    if (!forceRebuild && currentEntity && valuesEqual(currentEntity, entity))
      return;
    if (
      !forceRebuild &&
      currentEntity &&
      valuesEqual(currentEntity, entity, "pos")
    ) {
      currentObject.position.set(entity.pos.x, 0, entity.pos.y);
      currentObject.userData.entity = structuredClone(entity);
      this.updateEntityMatrices(currentObject);
      return;
    }
    const components = this.createEntity(entity);
    if (!components) {
      // A renderable record can become intentionally invisible (for example,
      // the upstream default bot emoji). Do not leave its old object behind.
      if (currentObject) this.deleteEntity(entity.id);
      return;
    }
    const rendered = (currentObject || new THREE.Object3D()) as EntityHandle;
    rendered.position.set(entity.pos.x, 0, entity.pos.y);
    rendered.userData.entity = structuredClone(entity);
    this.setEntityComponents(rendered, components);
    this.entities.set(entity.id, rendered);
    if (entity.type === "Note") this.notes.add(entity.id);
    else {
      this.notes.delete(entity.id);
      this.disposeNoteDetail(entity.id);
    }
  }

  disposeNoteDetail(id: EntityId): void {
    const detail = this.noteDetails.get(id);
    if (!detail) return;
    detail.material.dispose();
    detail.texture.dispose();
    this.noteDetails.delete(id);
  }

  /**
   * Draw text on the notes nearest the viewer and return the rest to the shared
   * placeholder. `creationBudget` caps how many textures are drawn per call so
   * walking into a crowd of notes does not stall a frame.
   */
  updateNoteDetail(viewer: THREE.Vector3, creationBudget = 2): void {
    const nearby: { id: EntityId; distance: number }[] = [];
    for (const id of this.notes) {
      const handle = this.entities.get(id)!;
      if (!(handle.userData.entity as NoteEntity).note_text) continue;
      const distance = Math.hypot(
        handle.position.x - viewer.x,
        handle.position.z - viewer.z,
      );
      const limit = this.noteDetails.has(id)
        ? NOTE_DETAIL_RELEASE_DISTANCE
        : NOTE_DETAIL_DISTANCE;
      if (distance <= limit) nearby.push({ id, distance });
    }
    nearby.sort((left, right) => left.distance - right.distance);
    const wanted = new Set(
      nearby.slice(0, MAX_DETAILED_NOTES).map(({ id }) => id),
    );
    for (const [id, detail] of [...this.noteDetails]) {
      if (wanted.has(id)) continue;
      this.noteDetails.delete(id);
      this.handleEntity(this.entities.get(id)!.userData.entity!, true);
      detail.material.dispose();
      detail.texture.dispose();
    }
    for (const id of wanted) {
      if (this.noteDetails.has(id)) continue;
      if (creationBudget-- <= 0) break;
      const entity = this.entities.get(id)!.userData.entity as NoteEntity;
      const texture = postItTexture(entity.note_text!);
      this.noteDetails.set(id, {
        text: entity.note_text!,
        texture,
        material: material(POST_IT_COLOR, texture),
      });
      this.handleEntity(entity, true);
    }
  }

  deleteEntity(id: EntityId): void {
    const object = this.entities.get(id);
    if (!object) return;
    for (const component of object.userData.components || [])
      this.instanceBatches.delete(component.key);
    this.entities.delete(id);
    this.notes.delete(id);
    this.disposeNoteDetail(id);
    const imageVersion = this.avatarImageVersions.get(id) || 0;
    this.avatarImages.delete(id);
    this.avatarImageVersions.delete(id);
    if (imageVersion) this.disposeAvatarImageVersion(id, imageVersion);
  }

  replaceEntities(entities: EntityUpdate[]): void {
    const incomingIds = new Set<EntityId>();
    entities.forEach((entity) => {
      this.handleEntity(entity);
      if (this.entities.has(entity.id)) incomingIds.add(entity.id);
    });
    for (const id of this.entities.keys())
      if (!incomingIds.has(id)) this.deleteEntity(id);
  }

  dispose() {
    for (const id of [...this.entities.keys()]) this.deleteEntity(id);
    this.scene.remove(this.floor);
    this.instanceBatches.dispose();
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((cached) => cached.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
    this.avatarImages.clear();
    this.avatarImageVersions.clear();
  }

  createEntity(entity: WorldEntity): RenderComponent[] | null {
    const components: RenderComponent[] = [];
    if (entity.type === "Wall") {
      const texture = entity.wall_text
        ? this.cachedGlyphTexture(
            entity.wall_text,
            COLORS[entity.color],
            "#17201e",
          )
        : null;
      components.push(
        this.cube(new THREE.Vector3(1, 1, 1), COLORS[entity.color], texture),
      );
    } else if (entity.type === "Desk") {
      components.push(
        this.cube(
          new THREE.Vector3(0.9, 0.04, 0.9),
          COLORS.orange,
          null,
          new THREE.Vector3(0, 0.35, 0),
        ),
      );
      for (const x of [-0.4, 0.4])
        for (const z of [-0.4, 0.4])
          components.push(
            this.cube(
              new THREE.Vector3(0.04, 0.35, 0.04),
              "#333333",
              null,
              new THREE.Vector3(x, 0, z),
            ),
          );
    } else if (entity.type === "Avatar") {
      components.push(
        this.cube(
          new THREE.Vector3(0.05, 0.8, 0.4),
          "#000000",
          this.cachedAvatarTexture(entity),
        ),
      );
    } else if (entity.type === "ZoomLink") {
      components.push(
        this.cube(
          new THREE.Vector3(0.6, 0.6, 0.6),
          "#0000ff",
          this.cachedIconTexture(entity.type, "#2472d9"),
        ),
      );
    } else if (entity.type === "Bot" && entity.emoji !== "👾") {
      components.push(
        this.cube(
          new THREE.Vector3(0.4, 0.4, 0.4),
          "#202020",
          this.cachedGlyphTexture(entity.emoji, "#202020", "#ffffff"),
        ),
      );
    } else if (entity.type === "Link") {
      components.push(
        this.cube(
          new THREE.Vector3(0.8, 0.8, 0.8),
          "#114433",
          this.cachedIconTexture(entity.type),
        ),
      );
    } else if (entity.type === "Note") {
      components.push(this.cube(new THREE.Vector3(1, 1, 1), COLORS.gray));
      if (this.noteDetails.get(entity.id)?.text !== entity.note_text)
        this.disposeNoteDetail(entity.id);
      const postItMaterial =
        this.noteDetails.get(entity.id)?.material ??
        this.cachedMaterial(
          POST_IT_COLOR,
          this.texture(
            `post-it:${entity.note_text ? "scribble" : "blank"}`,
            () => postItTexture(null, !!entity.note_text),
          ),
        );
      const lift = (1 - POST_IT_SIZE) / 2;
      const out = 0.5 + POST_IT_THICKNESS / 2;
      const across = new THREE.Vector3(
        POST_IT_SIZE,
        POST_IT_SIZE,
        POST_IT_THICKNESS,
      );
      const along = new THREE.Vector3(
        POST_IT_THICKNESS,
        POST_IT_SIZE,
        POST_IT_SIZE,
      );
      for (const [size, x, z] of [
        [across, 0, out],
        [across, 0, -out],
        [along, out, 0],
        [along, -out, 0],
      ] as const)
        components.push({
          size,
          offset: new THREE.Vector3(x, lift, z),
          material: postItMaterial,
          color: null,
          // A sheet this thin only adds shadow acne; the block casts for it.
          castShadow: false,
        });
    } else if (entity.type === "AudioBlock" || entity.type === "RC::Calendar") {
      components.push(
        this.cube(
          new THREE.Vector3(0.6, 0.6, 0.6),
          "#114433",
          this.cachedIconTexture(entity.type),
        ),
      );
    } else if (entity.type === "PhotoBlock") {
      components.push(
        this.cube(
          new THREE.Vector3(1, 1, 1),
          COLORS.gray,
          this.cachedIconTexture(entity.type),
        ),
      );
    } else if (entity.type === "AudioRoom") {
      const texture = this.cachedIconTexture(entity.type, null, {
        x: entity.width,
        y: entity.height,
      });
      components.push(
        this.cube(
          new THREE.Vector3(entity.width, 0.002, entity.height),
          "#114433",
          texture,
          new THREE.Vector3(entity.width / 2 - 0.5, 0, entity.height / 2 - 0.5),
        ),
      );
    } else return null;
    return components;
  }
}

export const FIXTURE_WORLD: WorldEntity[] = [
  {
    id: "wall-a",
    type: "Wall",
    pos: { x: 0, y: 0 },
    color: "blue",
    wall_text: "A",
  },
  {
    id: "wall-rocket",
    type: "Wall",
    pos: { x: 1, y: 0 },
    color: "pink",
    wall_text: "🚀",
  },
  {
    id: "wall-bike",
    type: "Wall",
    pos: { x: 2, y: 0 },
    color: "orange",
    wall_text: "🚲",
  },
  {
    id: "wall-helicopter",
    type: "Wall",
    pos: { x: 3, y: 0 },
    color: "green",
    wall_text: "🚁",
  },
  { id: "wall-3", type: "Wall", pos: { x: 4, y: 0 }, color: "purple" },
  { id: "wall-4", type: "Wall", pos: { x: 5, y: 0 }, color: "yellow" },
  { id: "desk-1", type: "Desk", pos: { x: 1, y: 4 } },
  {
    id: "avatar-1",
    type: "Avatar",
    pos: { x: 3, y: 4 },
    name: "Ada Lovelace",
    initials: "AL",
    photo_color: "#d7b18a",
  },
  {
    id: "bot-1",
    type: "Bot",
    pos: { x: 5, y: 4 },
    name: "Rocket",
    emoji: "🚀",
  },
  { id: "zoom-1", type: "ZoomLink", pos: { x: 7, y: 0 } },
  { id: "link-1", type: "Link", pos: { x: 8, y: 0 } },
  {
    id: "note-1",
    type: "Note",
    pos: { x: 9, y: 0 },
    note_text: "Welcome! Notes show their text when you walk up to them.",
  },
  { id: "audio-1", type: "AudioBlock", pos: { x: 10, y: 0 } },
  { id: "calendar-1", type: "RC::Calendar", pos: { x: 11, y: 0 } },
  { id: "photo-1", type: "PhotoBlock", pos: { x: 12, y: 0 } },
  { id: "room-1", type: "AudioRoom", pos: { x: 7, y: 3 }, width: 4, height: 4 },
];

export function buildWorld(
  scene: THREE.Scene,
  initialEntities: EntityUpdate[] = FIXTURE_WORLD,
): VirtualRcRenderer {
  scene.fog = new THREE.Fog("#172322", 35, 85);
  const renderer = new VirtualRcRenderer(scene);
  initialEntities.forEach((entity) => renderer.handleEntity(entity));
  return renderer;
}
