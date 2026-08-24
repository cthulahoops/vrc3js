import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeActionCableMessage,
  sanitizeEntity,
} from "../server/protocol.js";

test("sanitizes supported entities and strips upstream-only fields", () => {
  assert.deepEqual(
    sanitizeEntity({
      id: 42,
      type: "Avatar",
      pos: { x: 3, y: 4 },
      name: "Ada",
      image_path: "https://private/image",
      admin: true,
    }),
    { id: "42", type: "Avatar", pos: { x: 3, y: 4 }, name: "Ada" },
  );
});

test("accepts deletion events without a position", () => {
  assert.deepEqual(
    sanitizeEntity({ id: "wall-1", type: "Wall", deleted: true }),
    {
      id: "wall-1",
      type: "Wall",
      deleted: true,
    },
  );
});

test("decodes a world snapshot from the Action Cable envelope", () => {
  const identifier = JSON.stringify({ channel: "ApiChannel" });
  const result = decodeActionCableMessage(
    JSON.stringify({
      identifier,
      message: {
        type: "world",
        payload: {
          entities: [
            { id: 1, type: "Desk", pos: { x: 1, y: 2 } },
            { id: 2, type: "Unknown", pos: { x: 3, y: 4 } },
          ],
        },
      },
    }),
    identifier,
  );
  assert.deepEqual(result, {
    kind: "snapshot",
    entities: [{ id: "1", type: "Desk", pos: { x: 1, y: 2 } }],
  });
});

test("rejects malformed positions and dimensions", () => {
  assert.equal(
    sanitizeEntity({ id: 1, type: "Desk", pos: { x: Infinity, y: 0 } }),
    null,
  );
  assert.equal(
    sanitizeEntity({
      id: 2,
      type: "AudioRoom",
      pos: { x: 0, y: 0 },
      width: -1,
      height: 4,
    }),
    null,
  );
});
