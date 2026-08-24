import assert from "node:assert/strict";
import test from "node:test";
import { parseVerificationFixture } from "../src/verification.js";

test("parses a deterministic renderer fixture", () => {
  const fixture = parseVerificationFixture({
    entities: [{ id: "desk-1", type: "Desk", pos: { x: 1, y: 2 } }],
    camera: {
      position: { x: 5, y: 1, z: 8 },
      orientation: { yaw: 0.5, pitch: -0.1 },
      fov: 55,
    },
    time: "2021-06-20T16:00:00Z",
  });

  assert.deepEqual(fixture.camera.orientation, {
    yaw: 0.5,
    pitch: -0.1,
    roll: 0,
  });
  assert.equal(fixture.camera.fov, 55);
  assert.equal(fixture.time.toISOString(), "2021-06-20T16:00:00.000Z");
  assert.equal(fixture.entities[0]?.id, "desk-1");
});

test("rejects invalid fixtures before they reach the renderer", () => {
  assert.throws(
    () =>
      parseVerificationFixture({
        entities: [{ id: "desk-1", type: "Desk", pos: { x: Infinity, y: 2 } }],
        camera: {
          position: { x: 0, y: 1, z: 2 },
          orientation: { yaw: 0, pitch: 0 },
        },
        time: "2021-06-20T16:00:00Z",
      }),
    /entities\[0\]/,
  );
  assert.throws(
    () =>
      parseVerificationFixture({
        entities: [],
        camera: {
          position: { x: 0, y: 1, z: 2 },
          orientation: { yaw: 0, pitch: 0 },
        },
        time: "not-a-date",
      }),
    /valid ISO date/,
  );
});
