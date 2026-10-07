// Connects to the RC Together stream, tallies the entity types it sees, and
// compares them with the types the BFF supports. Only field names and value
// kinds are printed, never values, so the output is safe to share.
//
// Usage: bun scripts/dump-entity-types.ts [listen-seconds]

import { ENTITY_TYPES } from "../server/protocol.js";

const listenSeconds = Number(process.argv[2] ?? 10);
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

interface TypeSummary {
  snapshot: number;
  updates: number;
  fields: Map<string, Set<string>>;
}
const types = new Map<string, TypeSummary>();
let sawSnapshot = false;

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function record(entity: unknown, source: "snapshot" | "updates") {
  if (typeof entity !== "object" || entity === null) return;
  const { type } = entity as { type?: unknown };
  const name = typeof type === "string" ? type : `<${kindOf(type)}>`;
  let summary = types.get(name);
  if (!summary) {
    summary = { snapshot: 0, updates: 0, fields: new Map() };
    types.set(name, summary);
  }
  summary[source] += 1;
  for (const [key, value] of Object.entries(entity)) {
    let kinds = summary.fields.get(key);
    if (!kinds) summary.fields.set(key, (kinds = new Set()));
    kinds.add(kindOf(value));
  }
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

function report() {
  socket.close();
  const supported = new Set<string>(ENTITY_TYPES);
  const names = [...types.keys()].sort();

  console.log("Entity types seen on the stream:\n");
  for (const name of names) {
    const { snapshot, updates, fields } = types.get(name)!;
    const status = supported.has(name) ? "supported" : "UNSUPPORTED";
    console.log(
      `${name}  [${status}]  snapshot=${snapshot} updates=${updates}`,
    );
    for (const [key, kinds] of [...fields].sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      console.log(`    ${key}: ${[...kinds].join(" | ")}`);
  }

  const unsupported = names.filter((name) => !supported.has(name));
  const unseen = ENTITY_TYPES.filter((name) => !types.has(name));
  console.log(
    `\nUnsupported (seen, not handled): ${unsupported.join(", ") || "none"}`,
  );
  console.log(`Supported but not seen: ${unseen.join(", ") || "none"}`);
  process.exit(0);
}
