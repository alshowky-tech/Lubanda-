import { expandBounds } from "../geometry/bounds.js";
import { assertFiniteBounds } from "../geometry/finite.js";
import type { Bounds } from "../geometry/types.js";
import { SpatialHash } from "../spatial/SpatialHash.js";
import type {
  LabelCollision,
  LabelObstacle,
  LabelPlacement,
} from "./types.js";

interface CollisionEntry {
  readonly kind: LabelCollision["kind"];
}

export class LabelCollisionQuery {
  readonly #index: SpatialHash<CollisionEntry>;
  readonly #clearance: number;

  constructor(options: { readonly cellSize?: number; readonly clearance?: number } = {}) {
    const cellSize = options.cellSize ?? 64;
    const clearance = options.clearance ?? 0;
    if (!Number.isFinite(clearance) || clearance < 0) {
      throw new TypeError("LabelCollisionQuery clearance must be finite and non-negative");
    }
    this.#index = new SpatialHash<CollisionEntry>(cellSize);
    this.#clearance = clearance;
  }

  get size(): number {
    return this.#index.size;
  }

  addObstacle(obstacle: LabelObstacle): void {
    this.#insert(obstacle.obstacleId, obstacle.bounds, obstacle.kind);
  }

  addPlacement(placement: LabelPlacement): void {
    this.#insert(placement.placementId, placement.bounds, "LABEL");
  }

  remove(id: string): boolean {
    return this.#index.remove(id);
  }

  clear(): void {
    this.#index.clear();
  }

  collisions(bounds: Bounds, ignoreIds: readonly string[] = []): readonly LabelCollision[] {
    assertFiniteBounds(bounds);
    const ignored = new Set(ignoreIds);
    const queryBounds = expandBounds(bounds, this.#clearance);
    return this.#index
      .query(queryBounds)
      .filter((entry) => !ignored.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        kind: entry.value.kind,
        bounds: { ...entry.bounds },
      }));
  }

  hasCollision(bounds: Bounds, ignoreIds: readonly string[] = []): boolean {
    return this.collisions(bounds, ignoreIds).length > 0;
  }

  #insert(id: string, bounds: Bounds, kind: LabelCollision["kind"]): void {
    assertFiniteBounds(bounds);
    this.#index.insert(id, expandBounds(bounds, this.#clearance), { kind });
  }
}
