// Connects to the RC Together stream, tallies the entity types it sees, and
// compares them with the types the BFF supports. Only field names and value
// kinds are printed, never values, so the output is safe to share.
//
// With --write it also regenerates server/upstream.generated.ts, the
// TypeScript shape of every entity type seen. Review the diff before
// committing: it is how upstream changes reach the compiler. Deletions are
// counted but left out of the shapes: they are too rare for a sample to
// describe, so server/protocol.ts declares them by hand.
//
// Usage: bun scripts/dump-entity-types.ts [listen-seconds] [--write]

import { format, resolveConfig } from "prettier";
import { ENTITY_TYPES } from "../server/protocol.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const listenSeconds = Number(args.find((arg) => arg !== "--write") ?? 10);
const generatedPath = new URL(
  "../server/upstream.generated.ts",
  import.meta.url,
).pathname;
const appId = Bun.env.RC_APP_ID;
const appSecret = Bun.env.RC_APP_SECRET;
const endpoint = Bun.env.RC_ENDPOINT || "recurse.rctogether.com";
if (!appId || !appSecret) {
  console.error("RC_APP_ID and RC_APP_SECRET are required (see .env).");
  process.exit(1);
}

const subscriptionIdentifier = JSON.stringify({ channel: "ApiChannel" });
const query = new URLSearchParams({ app_id: appId, app_secret: appSecret });
const WebSocketWithOptions = WebSocket as unknown as {
  new (url: string, options: Bun.WebSocketOptions): WebSocket;
};
const socket = new WebSocketWithOptions(`wss://${endpoint}/cable?${query}`, {
  headers: { Origin: `https://${endpoint}` },
});

/** The kinds of value seen at one place in the data, and how often. */
interface Shape {
  seen: number;
  kinds: Set<string>;
  object?: ObjectShape;
  items?: Shape;
}
interface ObjectShape {
  samples: number;
  fields: Map<string, Shape>;
}
interface TypeSummary {
  snapshot: number;
  updates: number;
  shape: ObjectShape;
}
const types = new Map<string, TypeSummary>();
let deletions = 0;
let sawSnapshot = false;

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function observe(shape: Shape, value: unknown) {
  shape.seen += 1;
  const kind = kindOf(value);
  shape.kinds.add(kind);
  if (kind === "object")
    observeObject(
      (shape.object ??= { samples: 0, fields: new Map() }),
      value as object,
    );
  if (kind === "array")
    for (const item of value as unknown[])
      observe((shape.items ??= { seen: 0, kinds: new Set() }), item);
}

function observeObject(shape: ObjectShape, value: object) {
  shape.samples += 1;
  for (const [key, field] of Object.entries(value)) {
    let fieldShape = shape.fields.get(key);
    if (!fieldShape)
      shape.fields.set(key, (fieldShape = { seen: 0, kinds: new Set() }));
    observe(fieldShape, field);
  }
}

function record(entity: unknown, source: "snapshot" | "updates") {
  if (typeof entity !== "object" || entity === null) return;
  const { type, deleted } = entity as { type?: unknown; deleted?: unknown };
  if (deleted === true) {
    deletions += 1;
    return;
  }
  const name = typeof type === "string" ? type : `<${kindOf(type)}>`;
  let summary = types.get(name);
  if (!summary) {
    summary = {
      snapshot: 0,
      updates: 0,
      shape: { samples: 0, fields: new Map() },
    };
    types.set(name, summary);
  }
  summary[source] += 1;
  observeObject(summary.shape, entity);
}

socket.onmessage = (event) => {
  let data;
  try {
    data = JSON.parse(String(event.data));
  } catch {
    console.error("Ignored a message that was not valid JSON.");
    return;
  }
  if (data.type === "welcome") {
    socket.send(
      JSON.stringify({
        command: "subscribe",
        identifier: subscriptionIdentifier,
      }),
    );
    return;
  }
  if (data.type === "reject_subscription") {
    console.error("Subscription rejected.");
    process.exit(1);
  }
  if (data.identifier !== subscriptionIdentifier || !data.message) return;

  if (data.message.type === "world") {
    sawSnapshot = true;
    for (const entity of data.message.payload?.entities ?? [])
      record(entity, "snapshot");
    console.error(
      `Snapshot received; listening ${listenSeconds}s for updates…`,
    );
    setTimeout(report, listenSeconds * 1000);
  } else {
    record(data.message.payload, "updates");
  }
};
socket.onerror = () => {
  console.error("WebSocket error.");
  process.exit(1);
};
setTimeout(() => {
  if (!sawSnapshot) {
    console.error("Timed out waiting for the world snapshot.");
    process.exit(1);
  }
}, 30_000);

function byName<T>(map: Map<string, T>): Array<[string, T]> {
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}

async function report() {
  socket.close();
  const supported = new Set<string>(ENTITY_TYPES);
  const names = [...types.keys()].sort();

  console.log("Entity types seen on the stream:\n");
  for (const name of names) {
    const { snapshot, updates, shape } = types.get(name)!;
    const status = supported.has(name) ? "supported" : "UNSUPPORTED";
    console.log(
      `${name}  [${status}]  snapshot=${snapshot} updates=${updates}`,
    );
    for (const [key, field] of byName(shape.fields))
      console.log(`    ${key}: ${[...field.kinds].join(" | ")}`);
  }

  const unsupported = names.filter((name) => !supported.has(name));
  const unseen = ENTITY_TYPES.filter((name) => !types.has(name));
  console.log(
    `\nUnsupported (seen, not handled): ${unsupported.join(", ") || "none"}`,
  );
  console.log(`Supported but not seen: ${unseen.join(", ") || "none"}`);
  console.log(`Deletions (not included in shapes): ${deletions}`);

  if (write && unseen.length) {
    // Writing now would drop those interfaces from the generated file.
    console.error(
      `\nNot writing ${generatedPath}: supported types were not seen. Listen longer and try again.`,
    );
    process.exit(1);
  }
  if (write) {
    const options = await resolveConfig(generatedPath);
    const source = await format(generate(), {
      ...options,
      filepath: generatedPath,
    });
    await Bun.write(generatedPath, source);
    console.log(`\nWrote ${generatedPath}; review the diff before committing.`);
  }
  process.exit(0);
}

// Nested objects deeper than this, or whose keys don't look like field names,
// are emitted as Record<string, unknown>. A map keyed by ids or names would
// otherwise write those keys, which are data, into a committed file.
const MAX_DEPTH = 3;
const MAX_FIELDS = 40;
const FIELD_NAME = /^[a-z_][a-z0-9_]*$/;

function renderShape(shape: Shape, depth: number): string {
  return [...shape.kinds]
    .sort()
    .map((kind) => {
      if (kind === "object") return renderObject(shape.object!, depth + 1);
      if (kind === "array")
        return shape.items
          ? `Array<${renderShape(shape.items, depth + 1)}>`
          : "unknown[]";
      return kind;
    })
    .join(" | ");
}

function renderObject(
  shape: ObjectShape,
  depth: number,
  type?: string,
): string {
  const keys = [...shape.fields.keys()];
  if (
    depth > MAX_DEPTH ||
    keys.length > MAX_FIELDS ||
    !keys.every((key) => FIELD_NAME.test(key))
  )
    return "Record<string, unknown>";
  const fields = byName(shape.fields).map(([key, field]) => {
    const optional = field.seen < shape.samples ? "?" : "";
    const value =
      key === "type" && type ? JSON.stringify(type) : renderShape(field, depth);
    return `${key}${optional}: ${value};`;
  });
  return `{ ${fields.join(" ")} }`;
}

function interfaceName(type: string): string {
  return `Upstream${type.replace(/[^A-Za-z0-9]/g, "")}`;
}

function generate(): string {
  // Skip the <kind> placeholders record() uses for a missing or odd type.
  const names = [...types.keys()]
    .filter((name) => /^[A-Za-z][A-Za-z0-9:]*$/.test(name))
    .sort();
  const interfaces = names.map(
    (name) =>
      `export interface ${interfaceName(name)} ${renderObject(types.get(name)!.shape, 0, name)}`,
  );
  const fieldLists = names.map(
    (name) =>
      `${JSON.stringify(name)}: ${JSON.stringify(byName(types.get(name)!.shape.fields).map(([key]) => key))},`,
  );
  return `// Generated by \`npm run dump:entities -- --write\` from the RC Together
// stream: field names and value kinds only. Do not edit by hand; regenerate
// and review the diff. A field is optional if some sampled entity lacked it.

${interfaces.join("\n\n")}

export type UpstreamEntity =
${names.map((name) => `  | ${interfaceName(name)}`).join("\n")};

/** Field names per entity type, for checking JSON fixtures at runtime. */
export const UPSTREAM_FIELDS = {
${fieldLists.join("\n")}
} as const satisfies Record<UpstreamEntity["type"], readonly string[]>;
`;
}
