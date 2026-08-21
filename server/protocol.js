const SUPPORTED_TYPES = new Set([
  'Wall', 'Desk', 'Avatar', 'ZoomLink', 'Bot', 'Link', 'Note',
  'AudioBlock', 'RC::Calendar', 'AudioRoom',
]);
const COLORS = new Set(['gray', 'pink', 'orange', 'green', 'blue', 'purple', 'yellow']);

function finiteNumber(value, minimum = -100_000, maximum = 100_000) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function limitedString(value, maximumLength) {
  return typeof value === 'string' ? value.slice(0, maximumLength) : undefined;
}

/** Keep the browser protocol deliberately smaller than the upstream entity. */
export function sanitizeEntity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['string', 'number'].includes(typeof value.id) || !SUPPORTED_TYPES.has(value.type)) return null;

  const entity = { id: String(value.id), type: value.type };
  if (value.deleted === true) return { ...entity, deleted: true };
  if (!value.pos || !finiteNumber(value.pos.x) || !finiteNumber(value.pos.y)) return null;
  entity.pos = { x: value.pos.x, y: value.pos.y };

  if (value.type === 'Wall') {
    entity.color = COLORS.has(value.color) ? value.color : 'gray';
    const wallText = limitedString(value.wall_text, 8);
    if (wallText) entity.wall_text = wallText;
  } else if (value.type === 'Avatar') {
    const name = limitedString(value.name, 100);
    const initials = limitedString(value.initials, 4);
    if (name) entity.name = name;
    if (initials) entity.initials = initials;
  } else if (value.type === 'Bot') {
    entity.emoji = limitedString(value.emoji, 16) || '🤖';
    const name = limitedString(value.name, 100);
    if (name) entity.name = name;
  } else if (value.type === 'AudioRoom') {
    if (!finiteNumber(value.width, 0.01, 1_000) || !finiteNumber(value.height, 0.01, 1_000)) return null;
    entity.width = value.width;
    entity.height = value.height;
  }

  return entity;
}

export function decodeActionCableMessage(raw, subscriptionIdentifier) {
  let data;
  try {
    data = JSON.parse(raw.toString());
  } catch {
    return { kind: 'invalid' };
  }

  if (data.type === 'welcome') return { kind: 'welcome' };
  if (data.type === 'ping') return { kind: 'ping' };
  if (data.type === 'confirm_subscription') return { kind: 'confirmed' };
  if (data.type === 'reject_subscription') return { kind: 'rejected' };
  if (data.identifier !== subscriptionIdentifier || !data.message) return { kind: 'ignored' };

  if (data.message.type === 'world') {
    const values = Array.isArray(data.message.payload?.entities) ? data.message.payload.entities : [];
    return { kind: 'snapshot', entities: values.map(sanitizeEntity).filter(Boolean) };
  }

  const entity = sanitizeEntity(data.message.payload);
  return entity ? { kind: 'entity', entity } : { kind: 'invalid' };
}
