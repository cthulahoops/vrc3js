import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// CanvasTexture only needs a canvas-shaped object when it is not uploaded to a
// WebGL context. This keeps the retained-renderer tests fast and independent of
// a browser or native canvas package.
globalThis.document ??= {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return {
      width: 0,
      height: 0,
      getContext(type) {
        assert.equal(type, '2d');
        return {
          fillStyle: '',
          font: '',
          textAlign: '',
          textBaseline: '',
          fillRect() {},
          fillText() {},
          drawImage() {},
        };
      },
    };
  },
};

const { VirtualRcRenderer } = await import('../src/world.js');

function makeRenderer() {
  const scene = new THREE.Scene();
  return { scene, renderer: new VirtualRcRenderer(scene) };
}

function wall(id, x = 0, overrides = {}) {
  return {
    id,
    type: 'Wall',
    pos: { x, y: 0 },
    color: 'blue',
    wall_text: 'A',
    ...overrides,
  };
}

function firstMesh(object) {
  let result;
  object.traverse(child => {
    if (!result && child.isMesh) result = child;
  });
  return result;
}

test('an identical entity update does not replace its render object or resources', () => {
  const { renderer } = makeRenderer();
  const entity = wall('wall-1');
  renderer.handleEntity(entity);

  const before = renderer.entities.get(entity.id);
  const meshBefore = firstMesh(before);
  renderer.handleEntity(structuredClone(entity));

  const after = renderer.entities.get(entity.id);
  const meshAfter = firstMesh(after);
  assert.strictEqual(after, before);
  assert.strictEqual(meshAfter.geometry, meshBefore.geometry);
  assert.strictEqual(meshAfter.material, meshBefore.material);
  assert.strictEqual(meshAfter.material.map, meshBefore.material.map);
});

test('a position-only update mutates the transform and retains resources', () => {
  const { renderer } = makeRenderer();
  renderer.handleEntity(wall('wall-1', 1));

  const before = renderer.entities.get('wall-1');
  const meshBefore = firstMesh(before);
  renderer.handleEntity(wall('wall-1', 7, { pos: { x: 7, y: 3 } }));

  const after = renderer.entities.get('wall-1');
  const meshAfter = firstMesh(after);
  assert.strictEqual(after, before);
  assert.deepEqual(after.position.toArray(), [7, 0, 3]);
  assert.deepEqual(after.userData.entity.pos, { x: 7, y: 3 });
  assert.strictEqual(meshAfter.geometry, meshBefore.geometry);
  assert.strictEqual(meshAfter.material, meshBefore.material);
  assert.strictEqual(meshAfter.material.map, meshBefore.material.map);
});

test('snapshot replacement reconciles by id instead of rebuilding the world', () => {
  const { scene, renderer } = makeRenderer();
  renderer.replaceEntities([wall('keep', 1), wall('move', 2), wall('remove', 3)]);
  const kept = renderer.entities.get('keep');
  const moved = renderer.entities.get('move');
  const removed = renderer.entities.get('remove');

  renderer.replaceEntities([wall('keep', 1), wall('move', 8), wall('add', 4)]);

  assert.strictEqual(renderer.entities.get('keep'), kept);
  assert.strictEqual(renderer.entities.get('move'), moved);
  assert.deepEqual(moved.position.toArray(), [8, 0, 0]);
  assert.equal(renderer.entities.has('remove'), false);
  assert.equal(scene.children.includes(removed), false);
  assert.equal(renderer.entities.has('add'), true);
  assert.deepEqual([...renderer.entities.keys()].sort(), ['add', 'keep', 'move']);
});

test('an update that becomes non-renderable removes its previous object', () => {
  const { scene, renderer } = makeRenderer();
  renderer.handleEntity({ id: 'bot-1', type: 'Bot', pos: { x: 1, y: 2 }, emoji: '🚀' });
  const previous = renderer.entities.get('bot-1');

  renderer.handleEntity({ id: 'bot-1', type: 'Bot', pos: { x: 1, y: 2 }, emoji: '👾' });

  assert.equal(renderer.entities.has('bot-1'), false);
  assert.equal(scene.children.includes(previous), false);
});

test('equivalent entities share immutable geometry, material, and texture resources', () => {
  const { renderer } = makeRenderer();
  renderer.handleEntity(wall('wall-1', 1));
  renderer.handleEntity(wall('wall-2', 2));

  const first = firstMesh(renderer.entities.get('wall-1'));
  const second = firstMesh(renderer.entities.get('wall-2'));
  assert.strictEqual(second.geometry, first.geometry);
  assert.strictEqual(second.material, first.material);
  assert.strictEqual(second.material.map, first.material.map);
});

test('shared resources live until renderer disposal, not individual entity deletion', () => {
  const { renderer } = makeRenderer();
  renderer.handleEntity(wall('wall-1', 1));
  renderer.handleEntity(wall('wall-2', 2));
  const mesh = firstMesh(renderer.entities.get('wall-1'));
  const disposeCounts = { geometry: 0, material: 0, texture: 0 };
  mesh.geometry.addEventListener('dispose', () => { disposeCounts.geometry += 1; });
  mesh.material.addEventListener('dispose', () => { disposeCounts.material += 1; });
  mesh.material.map.addEventListener('dispose', () => { disposeCounts.texture += 1; });

  renderer.deleteEntity('wall-1');
  renderer.deleteEntity('wall-2');
  assert.deepEqual(disposeCounts, { geometry: 0, material: 0, texture: 0 });

  renderer.dispose();
  assert.deepEqual(disposeCounts, { geometry: 1, material: 1, texture: 1 });
});

test('a representative update stream keeps renderer resource cardinality bounded', () => {
  const { renderer } = makeRenderer();
  const entities = Array.from({ length: 100 }, (_, index) => wall(`wall-${index}`, index));
  renderer.replaceEntities(entities);
  const initialObjects = new Map(renderer.entities);

  for (let pass = 0; pass < 10; pass += 1) {
    for (const entity of entities) {
      renderer.handleEntity({ ...entity, pos: { x: entity.pos.x, y: pass + 1 } });
    }
  }

  const objects = [...renderer.entities.values()];
  const meshes = objects.map(firstMesh);
  assert.equal(new Set(objects).size, 100);
  assert.ok([...renderer.entities].every(([id, object]) => object === initialObjects.get(id)));
  assert.equal(new Set(meshes.map(mesh => mesh.geometry)).size, 1);
  assert.equal(new Set(meshes.map(mesh => mesh.material)).size, 1);
  assert.equal(new Set(meshes.map(mesh => mesh.material.map)).size, 1);
  assert.ok(objects.every(object => object.position.z === 10));
});
