import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstanceBatch, InstanceBatchRegistry } from '../src/instanceBatches.js';

function translation(x: number, y = 0, z = 0): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

function position(batch: InstanceBatch, key: unknown): number[] | null {
  const matrix = batch.getMatrix(key);
  return matrix && new THREE.Vector3().setFromMatrixPosition(matrix).toArray();
}

test('an instance batch retains one mesh while matrices are updated', () => {
  const scene = new THREE.Scene();
  const batch = new InstanceBatch(scene, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), { initialCapacity: 2 });
  const mesh = batch.mesh;

  batch.set('a', translation(1));
  batch.set('b', translation(2));
  batch.set('a', translation(7, 0, 3));

  assert.strictEqual(batch.mesh, mesh);
  assert.equal(batch.size, 2);
  assert.deepEqual(position(batch, 'a'), [7, 0, 3]);
  assert.equal(scene.children.filter(child => child instanceof THREE.InstancedMesh).length, 1);
});

test('capacity growth preserves instances and replaces only the batch mesh', () => {
  const scene = new THREE.Scene();
  const batch = new InstanceBatch(scene, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), { initialCapacity: 1 });
  batch.set('a', translation(1));
  const initialMesh = batch.mesh;
  batch.set('b', translation(2));

  assert.notStrictEqual(batch.mesh, initialMesh);
  assert.equal(batch.capacity, 2);
  assert.deepEqual(position(batch, 'a'), [1, 0, 0]);
  assert.deepEqual(position(batch, 'b'), [2, 0, 0]);
  assert.deepEqual(scene.children, [batch.mesh]);
});

test('deletion compacts the dense buffer and repairs the moved index', () => {
  const batch = new InstanceBatch(new THREE.Scene(), new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  batch.set('a', translation(1));
  batch.set('b', translation(2));
  batch.set('c', translation(3));

  assert.equal(batch.delete('b'), true);
  assert.equal(batch.delete('missing'), false);
  assert.equal(batch.size, 2);
  assert.equal(batch.mesh.count, 2);
  assert.deepEqual(position(batch, 'c'), [3, 0, 0]);
  assert.equal(batch.indices.get('c'), 1);
});

test('registry moves a component between material buckets without retaining an empty draw', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const blue = new THREE.MeshBasicMaterial({ color: 'blue' });
  const pink = new THREE.MeshBasicMaterial({ color: 'pink' });
  const registry = new InstanceBatchRegistry(scene);
  registry.set('wall:body', { bucketKey: 'wall-blue', geometry, material: blue, matrix: translation(1) });
  registry.set('wall:body', { bucketKey: 'wall-pink', geometry, material: pink, matrix: translation(2) });

  assert.equal(registry.batches.has('wall-blue'), false);
  assert.equal(registry.batches.get('wall-pink')!.size, 1);
  assert.equal(registry.locations.get('wall:body'), 'wall-pink');
});

test('batch disposal releases instance buffers but not borrowed draw resources', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const batch = new InstanceBatch(scene, geometry, material);
  let geometryDisposals = 0;
  let materialDisposals = 0;
  geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
  material.addEventListener('dispose', () => { materialDisposals += 1; });

  batch.dispose();

  assert.equal(geometryDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(scene.children.length, 0);
});

test('instances preserve shadow flags and dynamic buffer usage', () => {
  const batch = new InstanceBatch(new THREE.Scene(), new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), {
    castShadow: true,
    receiveShadow: false,
  });

  assert.equal(batch.mesh.castShadow, true);
  assert.equal(batch.mesh.receiveShadow, false);
  assert.equal(batch.mesh.instanceMatrix.usage, THREE.DynamicDrawUsage);
});

test('instance colors survive growth and follow slots during compaction', () => {
  const batch = new InstanceBatch(new THREE.Scene(), new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), {
    initialCapacity: 1,
    useInstanceColor: true,
  });
  batch.set('red', translation(1), new THREE.Color('red'));
  batch.set('green', translation(2), new THREE.Color('green'));
  batch.set('blue', translation(3), new THREE.Color('blue'));

  const color = new THREE.Color();
  batch.mesh.getColorAt(batch.indices.get('green')!, color);
  assert.equal(color.getHexString(), '008000');
  batch.delete('red');
  batch.mesh.getColorAt(batch.indices.get('blue')!, color);
  assert.equal(color.getHexString(), '0000ff');
  assert.equal(batch.mesh.instanceColor!.needsUpdate, undefined);
  assert.ok(batch.mesh.instanceColor!.version > 0);
});
