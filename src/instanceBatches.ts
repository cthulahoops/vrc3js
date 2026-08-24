import * as THREE from "three";

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1)
    throw new RangeError(`${name} must be a positive integer`);
  return value;
}

/**
 * A dense, retained InstancedMesh with O(1) lookup, update, and removal.
 *
 * Geometry and material are borrowed from the renderer's resource caches. This
 * class owns only its InstancedMesh and instance buffer; dispose() deliberately
 * leaves geometry and material disposal to their original owner.
 */
export class InstanceBatch {
  static readonly scratchMatrix = new THREE.Matrix4();
  static readonly scratchColor = new THREE.Color();

  readonly scene: THREE.Scene;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
  capacity: number;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly frustumCulled: boolean;
  readonly useInstanceColor: boolean;
  readonly name: string;
  readonly indices = new Map<unknown, number>();
  readonly keys: unknown[] = [];
  mesh: THREE.InstancedMesh;

  constructor(
    scene: THREE.Scene,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    options: InstanceBatchOptions = {},
  ) {
    this.scene = scene;
    this.geometry = geometry;
    this.material = material;
    this.capacity = positiveInteger(
      options.initialCapacity ?? 16,
      "initialCapacity",
    );
    this.castShadow = options.castShadow ?? true;
    this.receiveShadow = options.receiveShadow ?? true;
    this.frustumCulled = options.frustumCulled ?? false;
    this.useInstanceColor = options.useInstanceColor ?? false;
    this.name = options.name ?? "";
    this.mesh = this.createMesh(this.capacity);
    this.scene.add(this.mesh);
  }

  get size() {
    return this.keys.length;
  }

  has(key: unknown): boolean {
    return this.indices.has(key);
  }

  createMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      capacity,
    );
    mesh.count = this.size;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    mesh.frustumCulled = this.frustumCulled;
    mesh.name = this.name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }

  grow() {
    const previous = this.mesh;
    this.capacity *= 2;
    this.mesh = this.createMesh(this.capacity);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < this.size; index += 1) {
      previous.getMatrixAt(index, matrix);
      this.mesh.setMatrixAt(index, matrix);
      if (this.useInstanceColor) {
        previous.getColorAt(index, InstanceBatch.scratchColor);
        this.mesh.setColorAt(index, InstanceBatch.scratchColor);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.scene.remove(previous);
    previous.dispose();
    this.scene.add(this.mesh);
  }

  set(
    key: unknown,
    matrix: THREE.Matrix4,
    color: THREE.Color | null = null,
  ): number {
    let index = this.indices.get(key);
    if (index == null) {
      if (this.size === this.capacity) this.grow();
      index = this.size;
      this.indices.set(key, index);
      this.keys.push(key);
      this.mesh.count = this.size;
    }
    this.mesh.setMatrixAt(index, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.useInstanceColor) {
      if (color == null)
        throw new TypeError("color is required for a color instance batch");
      this.mesh.setColorAt(index, color);
      this.mesh.instanceColor!.needsUpdate = true;
    }
    return index;
  }

  getMatrix(key: unknown, target = new THREE.Matrix4()): THREE.Matrix4 | null {
    const index = this.indices.get(key);
    if (index == null) return null;
    this.mesh.getMatrixAt(index, target);
    return target;
  }

  delete(key: unknown): boolean {
    const index = this.indices.get(key);
    if (index == null) return false;
    const lastIndex = this.size - 1;
    if (index !== lastIndex) {
      const movedKey = this.keys[lastIndex]!;
      this.mesh.getMatrixAt(lastIndex, InstanceBatch.scratchMatrix);
      this.mesh.setMatrixAt(index, InstanceBatch.scratchMatrix);
      if (this.useInstanceColor) {
        this.mesh.getColorAt(lastIndex, InstanceBatch.scratchColor);
        this.mesh.setColorAt(index, InstanceBatch.scratchColor);
      }
      this.keys[index] = movedKey;
      this.indices.set(movedKey, index);
    }
    this.keys.pop();
    this.indices.delete(key);
    this.mesh.count = this.size;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.indices.clear();
    this.keys.length = 0;
  }
}

export interface InstanceBatchOptions {
  initialCapacity?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  frustumCulled?: boolean;
  useInstanceColor?: boolean;
  name?: string;
}

export interface InstanceDefinition extends Omit<
  InstanceBatchOptions,
  "useInstanceColor" | "initialCapacity"
> {
  bucketKey: unknown;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
  color?: THREE.Color | null;
}

/**
 * Routes retained component instances to batches. A component may change its
 * bucket (for example when its texture changes) without callers managing the
 * old batch slot. bucketKey must encode every draw-state difference, normally
 * geometry identity, material identity, and shadow flags.
 */
export class InstanceBatchRegistry {
  readonly scene: THREE.Scene;
  readonly initialCapacity: number;
  readonly batches = new Map<unknown, InstanceBatch>();
  readonly locations = new Map<unknown, unknown>();

  constructor(
    scene: THREE.Scene,
    options: Pick<InstanceBatchOptions, "initialCapacity"> = {},
  ) {
    this.scene = scene;
    this.initialCapacity = options.initialCapacity ?? 16;
  }

  ensureBatch(
    bucketKey: unknown,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    options: InstanceDefinition,
  ): InstanceBatch {
    let batch = this.batches.get(bucketKey);
    if (!batch) {
      batch = new InstanceBatch(this.scene, geometry, material, {
        initialCapacity: this.initialCapacity,
        ...options,
        name: options?.name ?? `instances:${String(bucketKey)}`,
        useInstanceColor: options?.color != null,
      });
      this.batches.set(bucketKey, batch);
    } else if (batch.geometry !== geometry || batch.material !== material) {
      throw new Error(
        `Instance batch ${String(bucketKey)} was reused with different draw resources`,
      );
    } else if (batch.useInstanceColor !== (options?.color != null)) {
      throw new Error(
        `Instance batch ${String(bucketKey)} mixed colored and uncolored instances`,
      );
    }
    return batch;
  }

  set(componentKey: unknown, definition: InstanceDefinition): InstanceBatch {
    const { bucketKey, geometry, material, matrix } = definition;
    if (bucketKey == null) throw new TypeError("bucketKey is required");
    const previousBucketKey = this.locations.get(componentKey);
    if (previousBucketKey != null && previousBucketKey !== bucketKey) {
      const previousBatch = this.batches.get(previousBucketKey);
      previousBatch!.delete(componentKey);
      this.removeEmptyBatch(previousBucketKey, previousBatch!);
    }
    const batch = this.ensureBatch(bucketKey, geometry, material, definition);
    batch.set(componentKey, matrix, definition.color ?? null);
    this.locations.set(componentKey, bucketKey);
    return batch;
  }

  delete(componentKey: unknown): boolean {
    const bucketKey = this.locations.get(componentKey);
    if (bucketKey == null) return false;
    const batch = this.batches.get(bucketKey);
    batch!.delete(componentKey);
    this.locations.delete(componentKey);
    this.removeEmptyBatch(bucketKey, batch!);
    return true;
  }

  removeEmptyBatch(bucketKey: unknown, batch: InstanceBatch): void {
    if (batch.size) return;
    batch.dispose();
    this.batches.delete(bucketKey);
  }

  dispose() {
    this.batches.forEach((batch) => batch.dispose());
    this.batches.clear();
    this.locations.clear();
  }
}
