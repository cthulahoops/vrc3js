import type { EntityUpdate } from "../server/protocol.js";
import { sanitizeEntity } from "../server/protocol.js";

export interface VerificationFixture {
  entities: EntityUpdate[];
  camera: {
    position: { x: number; y: number; z: number };
    orientation: { yaw: number; pitch: number; roll: number };
    fov?: number;
  };
  time: Date;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

/** Parse the JSON contract used by browser screenshot verification. */
export function parseVerificationFixture(value: unknown): VerificationFixture {
  const fixture = record(value, "fixture");
  if (!Array.isArray(fixture.entities))
    throw new Error("fixture.entities must be an array");
  const entities = fixture.entities.map((entity, index) => {
    const sanitized = sanitizeEntity(entity);
    if (!sanitized)
      throw new Error(
        `fixture.entities[${index}] is not a valid protocol entity`,
      );
    return sanitized;
  });

  const camera = record(fixture.camera, "fixture.camera");
  const position = record(camera.position, "fixture.camera.position");
  const orientation = record(camera.orientation, "fixture.camera.orientation");
  const fov =
    camera.fov == null ? undefined : finite(camera.fov, "fixture.camera.fov");
  if (fov != null && (fov <= 0 || fov >= 180)) {
    throw new Error("fixture.camera.fov must be between 0 and 180 degrees");
  }

  if (typeof fixture.time !== "string")
    throw new Error("fixture.time must be an ISO date string");
  const time = new Date(fixture.time);
  if (!Number.isFinite(time.getTime()))
    throw new Error("fixture.time must be a valid ISO date string");

  return {
    entities,
    camera: {
      position: {
        x: finite(position.x, "fixture.camera.position.x"),
        y: finite(position.y, "fixture.camera.position.y"),
        z: finite(position.z, "fixture.camera.position.z"),
      },
      orientation: {
        yaw: finite(orientation.yaw, "fixture.camera.orientation.yaw"),
        pitch: finite(orientation.pitch, "fixture.camera.orientation.pitch"),
        roll:
          orientation.roll == null
            ? 0
            : finite(orientation.roll, "fixture.camera.orientation.roll"),
      },
      ...(fov == null ? {} : { fov }),
    },
    time,
  };
}
