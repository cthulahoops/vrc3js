import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { UPSTREAM_FIELDS } from "../server/upstream.generated.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Fixtures are fed through sanitizeEntity as if they came from upstream, so
// they may only use fields the stream actually sends. Deletions carry
// `deleted`, which protocol.ts declares by hand rather than generating.
const fixturesDirectory = new URL("./fixtures/", import.meta.url);
const allowedFields = new Map<string, Set<string>>(
  Object.entries(UPSTREAM_FIELDS).map(([type, fields]) => [
    type,
    new Set<string>([...fields, "deleted"]),
  ]),
);

for (const file of readdirSync(fixturesDirectory).filter((name) =>
  name.endsWith(".json"),
)) {
  test(`${file} only uses fields upstream sends`, () => {
    const fixture: unknown = JSON.parse(
      readFileSync(new URL(file, fixturesDirectory), "utf8"),
    );
    assert.ok(
      isRecord(fixture) && Array.isArray(fixture.entities),
      "fixture has no entities array",
    );
    const entities: readonly unknown[] = fixture.entities;
    for (const [index, entity] of entities.entries()) {
      assert.ok(isRecord(entity), `entities[${index}] is not an object`);
      const allowed = allowedFields.get(String(entity.type));
      assert.ok(allowed, `${entity.id}: unknown type ${String(entity.type)}`);
      const unknown = Object.keys(entity).filter((key) => !allowed.has(key));
      assert.deepEqual(unknown, [], `${entity.id} (${String(entity.type)})`);
    }
  });
}
