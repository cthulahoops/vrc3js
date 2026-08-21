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

const { FIXTURE_WORLD, VirtualRcRenderer } = await import('../src/world.js');

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

function firstBatch(renderer, object) {
  const component = object.userData.components[0];
  const bucketKey = renderer.instanceBatches.locations.get(component.key);
  return renderer.instanceBatches.batches.get(bucketKey);
}

test('an identical entity update does not replace its render object or resources', () => {
  const { renderer } = makeRenderer();
  const entity = wall('wall-1');
  renderer.handleEntity(entity);

  const before = renderer.entities.get(entity.id);
  const batchBefore = firstBatch(renderer, before);
  renderer.handleEntity(structuredClone(entity));

  const after = renderer.entities.get(entity.id);
  const batchAfter = firstBatch(renderer, after);
  assert.strictEqual(after, before);
  assert.strictEqual(batchAfter, batchBefore);
  assert.strictEqual(batchAfter.mesh, batchBefore.mesh);
});

test('a position-only update mutates the transform and retains resources', () => {
  const { renderer } = makeRenderer();
  renderer.handleEntity(wall('wall-1', 1));

  const before = renderer.entities.get('wall-1');
  const batchBefore = firstBatch(renderer, before);
  renderer.handleEntity(wall('wall-1', 7, { pos: { x: 7, y: 3 } }));

  const after = renderer.entities.get('wall-1');
  const batchAfter = firstBatch(renderer, after);
  assert.strictEqual(after, before);
  assert.deepEqual(after.position.toArray(), [7, 0, 3]);
  assert.deepEqual(after.userData.entity.pos, { x: 7, y: 3 });
  assert.strictEqual(batchAfter, batchBefore);
  assert.equal(batchAfter.size, 1);
  const matrix = batchAfter.getMatrix(after.userData.components[0].key);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(matrix).toArray(), [7, .5, 3]);
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
  assert.equal(renderer.instanceBatches.locations.has(removed.userData.components[0].key), false);
  assert.equal(renderer.entities.has('add'), true);
  assert.deepEqual([...renderer.entities.keys()].sort(), ['add', 'keep', 'move']);
});

test('an update that becomes non-renderable removes its previous object', () => {
  const { scene, renderer } = makeRenderer();
  renderer.handleEntity({ id: 'bot-1', type: 'Bot', pos: { x: 1, y: 2 }, emoji: '🚀' });
  const previous = renderer.entities.get('bot-1');

  renderer.handleEntity({ id: 'bot-1', type: 'Bot', pos: { x: 1, y: 2 }, emoji: '👾' });

  assert.equal(renderer.entities.has('bot-1'), false);
  assert.equal(renderer.instanceBatches.locations.has(previous.userData.components[0].key), false);
});

test('equivalent entities share immutable geometry, material, and texture resources', () => {
  const { renderer } = makeRenderer();
  renderer.handleEntity(wall('wall-1', 1));
  renderer.handleEntity(wall('wall-2', 2));

  const first = firstBatch(renderer, renderer.entities.get('wall-1'));
  const second = firstBatch(renderer, renderer.entities.get('wall-2'));
  assert.strictEqual(second, first);
  assert.equal(first.size, 2);
  assert.equal(first.mesh.count, 2);
});

test('shared resources live until renderer disposal, not individual entity deletion', () => {
  const { renderer } = makeRenderer();
  renderer.handleEntity(wall('wall-1', 1));
  renderer.handleEntity(wall('wall-2', 2));
  const batch = firstBatch(renderer, renderer.entities.get('wall-1'));
  const disposeCounts = { geometry: 0, material: 0, texture: 0 };
  batch.geometry.addEventListener('dispose', () => { disposeCounts.geometry += 1; });
  batch.material.addEventListener('dispose', () => { disposeCounts.material += 1; });
  batch.material.map.addEventListener('dispose', () => { disposeCounts.texture += 1; });

  renderer.deleteEntity('wall-1');
  renderer.deleteEntity('wall-2');
  assert.deepEqual(disposeCounts, { geometry: 0, material: 0, texture: 0 });

  renderer.dispose();
  assert.deepEqual(disposeCounts, { geometry: 1, material: 1, texture: 1 });
});

test('a representative update stream keeps renderer resource cardinality bounded', () => {
  const { scene, renderer } = makeRenderer();
  const entities = Array.from({ length: 100 }, (_, index) => wall(`wall-${index}`, index));
  renderer.replaceEntities(entities);
  const initialObjects = new Map(renderer.entities);

  for (let pass = 0; pass < 10; pass += 1) {
    for (const entity of entities) {
      renderer.handleEntity({ ...entity, pos: { x: entity.pos.x, y: pass + 1 } });
    }
  }

  const objects = [...renderer.entities.values()];
  assert.equal(new Set(objects).size, 100);
  assert.ok([...renderer.entities].every(([id, object]) => object === initialObjects.get(id)));
  assert.ok(objects.every(object => object.position.z === 10));
  assert.equal(renderer.instanceBatches.batches.size, 1);
  const [batch] = renderer.instanceBatches.batches.values();
  assert.equal(batch.size, 100);
  assert.equal(batch.mesh.count, 100);
  assert.equal(scene.children.filter(child => child.isInstancedMesh).length, 1);
});

test('desks collapse all components and colors into one shared draw batch', () => {
  const { scene, renderer } = makeRenderer();
  renderer.handleEntity({ id: 'desk-1', type: 'Desk', pos: { x: 1, y: 2 } });
  renderer.handleEntity({ id: 'desk-2', type: 'Desk', pos: { x: 3, y: 4 } });

  assert.equal(renderer.instanceBatches.batches.size, 1);
  assert.deepEqual([...renderer.instanceBatches.batches.values()].map(batch => batch.size), [10]);
  assert.equal(scene.children.filter(child => child.isInstancedMesh).length, 1);
});

test('different cube dimensions share a material batch through matrix scaling', () => {
  const { renderer } = makeRenderer();
  const handle = new THREE.Object3D();
  handle.userData.components = [];
  renderer.setEntityComponents(handle, [
    renderer.cube(new THREE.Vector3(1, 1, 1), '#123456'),
    renderer.cube(new THREE.Vector3(.2, .4, .6), '#123456'),
  ]);

  assert.equal(renderer.instanceBatches.batches.size, 1);
  const [batch] = renderer.instanceBatches.batches.values();
  assert.strictEqual(batch.material, renderer.instanceColorMaterial);
  assert.equal(batch.size, 2);
});

test('fixture world batches its nineteen cube components into thirteen draws', () => {
  const { scene, renderer } = makeRenderer();
  renderer.replaceEntities(FIXTURE_WORLD);

  const componentCount = [...renderer.entities.values()]
    .reduce((total, handle) => total + handle.userData.components.length, 0);
  assert.equal(componentCount, 19);
  assert.equal(renderer.instanceBatches.batches.size, 13);
  assert.equal(scene.children.filter(child => child.isInstancedMesh).length, 13);
});
