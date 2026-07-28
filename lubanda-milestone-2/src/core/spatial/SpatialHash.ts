import { boundsOverlap } from "../geometry/bounds.js";
import { assertFiniteBounds } from "../geometry/finite.js";
import type { Bounds } from "../geometry/types.js";
import {
  SpatialIndexError,
  type SpatialEntry,
  type SpatialIndex,
} from "./types.js";

interface InternalEntry<T> extends SpatialEntry<T> {
  readonly cellKeys: readonly string[];
}

export class SpatialHash<T> implements SpatialIndex<T> {
  readonly #cellSize: number;
  readonly #entries = new Map<string, InternalEntry<T>>();
  readonly #cells = new Map<string, Set<string>>();

  constructor(cellSize = 64) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new TypeError("SpatialHash cellSize must be positive and finite");
    }
    this.#cellSize = cellSize;
  }

  get size(): number {
    return this.#entries.size;
  }

  insert(id: string, bounds: Bounds, value: T): void {
    this.#assertId(id);
    assertFiniteBounds(bounds);
    if (this.#entries.has(id)) {
      throw new SpatialIndexError(
        "SPATIAL_DUPLICATE_ID",
        `SpatialHash already contains ID: ${id}`,
      );
    }
    const cellKeys = this.#cellKeys(bounds);
    const entry = { id, bounds: { ...bounds }, value, cellKeys };
    this.#entries.set(id, entry);
    for (const key of cellKeys) {
      const cell = this.#cells.get(key) ?? new Set<string>();
      cell.add(id);
      this.#cells.set(key, cell);
    }
  }

  update(id: string, bounds: Bounds): void {
    this.#assertId(id);
    assertFiniteBounds(bounds);
    const current = this.#entries.get(id);
    if (!current) {
      throw new SpatialIndexError(
        "SPATIAL_MISSING_ID",
        `SpatialHash cannot update missing ID: ${id}`,
      );
    }
    this.#detach(current);
    const cellKeys = this.#cellKeys(bounds);
    const updated = { id, bounds: { ...bounds }, value: current.value, cellKeys };
    this.#entries.set(id, updated);
    for (const key of cellKeys) {
      const cell = this.#cells.get(key) ?? new Set<string>();
      cell.add(id);
      this.#cells.set(key, cell);
    }
  }

  remove(id: string): boolean {
    this.#assertId(id);
    const current = this.#entries.get(id);
    if (!current) return false;
    this.#detach(current);
    this.#entries.delete(id);
    return true;
  }

  query(bounds: Bounds): readonly SpatialEntry<T>[] {
    assertFiniteBounds(bounds);
    const candidateIds = new Set<string>();
    for (const key of this.#cellKeys(bounds)) {
      for (const id of this.#cells.get(key) ?? []) candidateIds.add(id);
    }
    return [...candidateIds]
      .sort()
      .map((id) => this.#entries.get(id))
      .filter((entry): entry is InternalEntry<T> => Boolean(entry))
      .filter((entry) => boundsOverlap(entry.bounds, bounds))
      .map(({ id, bounds: entryBounds, value }) => ({
        id,
        bounds: { ...entryBounds },
        value,
      }));
  }

  clear(): void {
    this.#entries.clear();
    this.#cells.clear();
  }

  #assertId(id: string): void {
    if (id.trim().length === 0) {
      throw new SpatialIndexError(
        "SPATIAL_INVALID_ID",
        "SpatialHash ID must be non-empty",
      );
    }
  }

  #cellKeys(bounds: Bounds): readonly string[] {
    const minColumn = Math.floor(bounds.minX / this.#cellSize);
    const maxColumn = Math.floor(bounds.maxX / this.#cellSize);
    const minRow = Math.floor(bounds.minY / this.#cellSize);
    const maxRow = Math.floor(bounds.maxY / this.#cellSize);
    const keys: string[] = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        keys.push(`${column},${row}`);
      }
    }
    return keys;
  }

  #detach(entry: InternalEntry<T>): void {
    for (const key of entry.cellKeys) {
      const cell = this.#cells.get(key);
      cell?.delete(entry.id);
      if (cell?.size === 0) this.#cells.delete(key);
    }
  }
}

