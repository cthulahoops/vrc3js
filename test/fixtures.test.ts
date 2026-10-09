import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { UPSTREAM_FIELDS } from "../server/upstream.generated.js";

// Fixtures are fed through sanitizeEntity as if they came from upstream, so
// they may only use fields the stream actually sends. Deletions carry
// `deleted`, which the sampled stream may not have included.
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
    const fixture = JSON.parse(
      readFileSync(new URL(file, fixturesDirectory), "utf8"),
    ) as { entities: Array<Record<string, unknown>> };
    for (const entity of fixture.entities) {
      const allowed = allowedFields.get(String(entity.type));
      assert.ok(allowed, `${entity.id}: unknown type ${String(entity.type)}`);
      const unknown = Object.keys(entity).filter((key) => !allowed.has(key));
      assert.deepEqual(unknown, [], `${entity.id} (${String(entity.type)})`);
    }
  });
}
