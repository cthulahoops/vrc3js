export const ENTITY_TYPES = [
  "Wall", "Desk", "Avatar", "ZoomLink", "Bot", "Link", "Note",
  "AudioBlock", "RC::Calendar", "AudioRoom",
] as const;

export const ENTITY_COLORS = [
  "gray", "pink", "orange", "green", "blue", "purple", "yellow",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];
export type EntityColor = (typeof ENTITY_COLORS)[number];
export type EntityId = string;
export interface Position { x: number; y: number }

interface EntityBase { id: EntityId; type: EntityType; pos: Position }
export interface WallEntity extends EntityBase { type: "Wall"; color: EntityColor; wall_text?: string }
export interface AvatarEntity extends EntityBase { type: "Avatar"; name?: string; initials?: string; photo_color?: string }
export interface BotEntity extends EntityBase { type: "Bot"; emoji: string; name?: string }
export interface AudioRoomEntity extends EntityBase { type: "AudioRoom"; width: number; height: number }
type SimpleEntityType = Exclude<EntityType, "Wall" | "Avatar" | "Bot" | "AudioRoom">;
export type SimpleEntity = {
  [Type in SimpleEntityType]: EntityBase & { type: Type };
}[SimpleEntityType];
export type WorldEntity = WallEntity | AvatarEntity | BotEntity | AudioRoomEntity | SimpleEntity;
export type DeletedEntity = { id: EntityId; type: EntityType; deleted: true };
export type EntityUpdate = WorldEntity | DeletedEntity;

export type DecodedActionCableMessage =
  | { kind: "welcome" | "ping" | "confirmed" | "rejected" | "ignored" | "invalid" }
  | { kind: "snapshot"; entities: EntityUpdate[] }
  | { kind: "entity"; entity: EntityUpdate };

const supportedTypes = new Set<string>(ENTITY_TYPES);
const colors = new Set<string>(ENTITY_COLORS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, minimum = -100_000, maximum = 100_000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function limitedString(value: unknown, maximumLength: number): string | undefined {
  return typeof value === "string" ? value.slice(0, maximumLength) : undefined;
}

/** Keep the browser protocol deliberately smaller than the upstream entity. */
export function sanitizeEntity(value: unknown): EntityUpdate | null {
  if (!isRecord(value)) return null;
  if ((typeof value.id !== "string" && typeof value.id !== "number") ||
      typeof value.type !== "string" || !supportedTypes.has(value.type)) return null;

  const id = String(value.id);
  const type = value.type as EntityType;
  if (value.deleted === true) return { id, type, deleted: true };
  if (!isRecord(value.pos) || !finiteNumber(value.pos.x) || !finiteNumber(value.pos.y)) return null;
  const pos = { x: value.pos.x, y: value.pos.y };

  if (type === "Wall") {
    const wallText = limitedString(value.wall_text, 8);
    return { id, type, pos, color: colors.has(String(value.color)) ? value.color as EntityColor : "gray", ...(wallText ? { wall_text: wallText } : {}) };
  }
  if (type === "Avatar") {
    const name = limitedString(value.name, 100);
    const initials = limitedString(value.initials, 4);
    return { id, type, pos, ...(name ? { name } : {}), ...(initials ? { initials } : {}) };
  }
  if (type === "Bot") {
    const name = limitedString(value.name, 100);
    return { id, type, pos, emoji: limitedString(value.emoji, 16) || "🤖", ...(name ? { name } : {}) };
  }
  if (type === "AudioRoom") {
    if (!finiteNumber(value.width, 0.01, 1_000) || !finiteNumber(value.height, 0.01, 1_000)) return null;
    return { id, type, pos, width: value.width, height: value.height };
  }
  return { id, type, pos } as SimpleEntity;
}

export function decodeActionCableMessage(
  raw: string | ArrayBuffer | ArrayBufferView,
  subscriptionIdentifier: string,
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
  if (data.identifier !== subscriptionIdentifier || !isRecord(data.message)) return { kind: "ignored" };

  if (data.message.type === "world") {
    const payload = data.message.payload;
    const values = isRecord(payload) && Array.isArray(payload.entities) ? payload.entities : [];
    return { kind: "snapshot", entities: values.map(sanitizeEntity).filter((entity): entity is EntityUpdate => entity !== null) };
  }

  const entity = sanitizeEntity(data.message.payload);
  return entity ? { kind: "entity", entity } : { kind: "invalid" };
}
