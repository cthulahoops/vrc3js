import type { UpstreamEntity } from "./upstream.generated.js";

export const ENTITY_TYPES = [
  "Wall",
  "Desk",
  "Avatar",
  "ZoomLink",
  "Bot",
  "Link",
  "Note",
  "AudioBlock",
  "PhotoBlock",
  "RC::Calendar",
  "AudioRoom",
] as const satisfies readonly UpstreamEntity["type"][];

export const ENTITY_COLORS = [
  "gray",
  "pink",
  "orange",
  "green",
  "blue",
  "purple",
  "yellow",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];
export type EntityColor = (typeof ENTITY_COLORS)[number];
export type EntityId = string;
export interface Position {
  x: number;
  y: number;
}

interface EntityBase {
  id: EntityId;
  type: EntityType;
  pos: Position;
}
export interface WallEntity extends EntityBase {
  type: "Wall";
  color: EntityColor;
  wall_text?: string;
}
export interface AvatarEntity extends EntityBase {
  type: "Avatar";
  name?: string;
  image_url?: string;
}
export interface BotEntity extends EntityBase {
  type: "Bot";
  emoji: string;
  name?: string;
}
export interface AudioRoomEntity extends EntityBase {
  type: "AudioRoom";
  width: number;
  height: number;
}
export interface NoteEntity extends EntityBase {
  type: "Note";
  note_text?: string;
}
type SimpleEntityType = Exclude<
  EntityType,
  "Wall" | "Avatar" | "Bot" | "AudioRoom" | "Note"
>;
export interface SimpleEntity extends EntityBase {
  type: SimpleEntityType;
}
export type WorldEntity =
  | WallEntity
  | AvatarEntity
  | BotEntity
  | AudioRoomEntity
  | NoteEntity
  | SimpleEntity;
export type DeletedEntity = { id: EntityId; type: EntityType; deleted: true };
export type EntityUpdate = WorldEntity | DeletedEntity;

export type DecodedActionCableMessage =
  | {
      kind:
        "welcome" | "ping" | "confirmed" | "rejected" | "ignored" | "invalid";
    }
  | { kind: "snapshot"; entities: EntityUpdate[] }
  | { kind: "entity"; entity: EntityUpdate };

/**
 * An upstream entity whose field names are known but whose values have not
 * been checked yet. Reading a field upstream doesn't send is a compile error.
 */
type Unchecked<T> = { [K in keyof T]?: unknown };
type Upstream<Type extends EntityType> = Unchecked<
  Extract<UpstreamEntity, { type: Type }>
>;

/**
 * Deletions are too rare to appear in a sample of the stream, so the
 * generator leaves them out and their shape is declared here instead.
 */
interface UpstreamDeletion {
  id: number;
  type: UpstreamEntity["type"];
  deleted: true;
}

const supportedTypes = new Set<unknown>(ENTITY_TYPES);
const colors = new Set<unknown>(ENTITY_COLORS);

function isEntityType(value: unknown): value is EntityType {
  return supportedTypes.has(value);
}

function isEntityColor(value: unknown): value is EntityColor {
  return colors.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(
  value: unknown,
  minimum = -100_000,
  maximum = 100_000,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function limitedString(
  value: unknown,
  maximumLength: number,
): string | undefined {
  return typeof value === "string" ? value.slice(0, maximumLength) : undefined;
}

function avatarImageVersion(path: string): string {
  // This is only a cache key, not a security boundary. Keeping the upstream
  // path out of the browser protocol avoids leaking signed image URLs.
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export type AvatarImageObserver = (
  id: EntityId,
  imagePath: string | undefined,
) => void;

/** Keep the browser protocol deliberately smaller than the upstream entity. */
export function sanitizeEntity(
  value: unknown,
  onAvatarImage?: AvatarImageObserver,
): EntityUpdate | null {
  if (!isRecord(value)) return null;
  const entity: Unchecked<UpstreamEntity> = value;
  const { type } = entity;
  if (
    (typeof entity.id !== "string" && typeof entity.id !== "number") ||
    !isEntityType(type)
  )
    return null;

  const id = String(entity.id);
  const deletion: Unchecked<UpstreamDeletion> = value;
  if (deletion.deleted === true) return { id, type, deleted: true };
  const pos = position(entity.pos);
  if (!pos) return null;

  switch (type) {
    case "Wall": {
      const wall: Upstream<typeof type> = value;
      const wallText = limitedString(wall.wall_text, 8);
      return {
        id,
        type,
        pos,
        color: isEntityColor(wall.color) ? wall.color : "gray",
        ...(wallText ? { wall_text: wallText } : {}),
      };
    }
    case "Avatar": {
      const avatar: Upstream<typeof type> = value;
      const name = limitedString(avatar.person_name, 100);
      const imagePath = limitedString(avatar.image_path, 2_048);
      onAvatarImage?.(id, imagePath);
      return {
        id,
        type,
        pos,
        ...(name ? { name } : {}),
        ...(imagePath
          ? {
              image_url: `/api/avatars/${encodeURIComponent(id)}?v=${avatarImageVersion(imagePath)}`,
            }
          : {}),
      };
    }
    case "Bot": {
      const bot: Upstream<typeof type> = value;
      const name = limitedString(bot.name, 100);
      return {
        id,
        type,
        pos,
        emoji: limitedString(bot.emoji, 16) || "🤖",
        ...(name ? { name } : {}),
      };
    }
    case "AudioRoom": {
      const room: Upstream<typeof type> = value;
      if (
        !finiteNumber(room.width, 0.01, 1_000) ||
        !finiteNumber(room.height, 0.01, 1_000)
      )
        return null;
      return { id, type, pos, width: room.width, height: room.height };
    }
    case "Note": {
      const note: Upstream<typeof type> = value;
      const noteText = limitedString(note.note_text, 4_000);
      return { id, type, pos, ...(noteText ? { note_text: noteText } : {}) };
    }
    case "Desk":
    case "ZoomLink":
    case "Link":
    case "AudioBlock":
    case "PhotoBlock":
    case "RC::Calendar":
      return { id, type, pos };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function position(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  const pos: Unchecked<UpstreamEntity["pos"]> = value;
  return finiteNumber(pos.x) && finiteNumber(pos.y)
    ? { x: pos.x, y: pos.y }
    : null;
}

export function decodeActionCableMessage(
  raw: string | ArrayBuffer | ArrayBufferView,
  subscriptionIdentifier: string,
  onAvatarImage?: AvatarImageObserver,
): DecodedActionCableMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw.toString());
  } catch {
    return { kind: "invalid" };
  }
  if (!isRecord(data)) return { kind: "invalid" };
  if (data.type === "welcome") return { kind: "welcome" };
  if (data.type === "ping") return { kind: "ping" };
  if (data.type === "confirm_subscription") return { kind: "confirmed" };
  if (data.type === "reject_subscription") return { kind: "rejected" };
  if (data.identifier !== subscriptionIdentifier || !isRecord(data.message))
    return { kind: "ignored" };

  if (data.message.type === "world") {
    const payload = data.message.payload;
    const values =
      isRecord(payload) && Array.isArray(payload.entities)
        ? payload.entities
        : [];
    return {
      kind: "snapshot",
      entities: values
        .map((value) => sanitizeEntity(value, onAvatarImage))
        .filter((entity): entity is EntityUpdate => entity !== null),
    };
  }

  const entity = sanitizeEntity(data.message.payload, onAvatarImage);
  return entity ? { kind: "entity", entity } : { kind: "invalid" };
}
