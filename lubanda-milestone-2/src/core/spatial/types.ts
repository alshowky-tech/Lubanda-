import type { Bounds } from "../geometry/types.js";

export interface SpatialEntry<T> {
  readonly id: string;
  readonly bounds: Bounds;
  readonly value: T;
}

export interface SpatialIndex<T> {
  insert(id: string, bounds: Bounds, value: T): void;
  update(id: string, bounds: Bounds): void;
  remove(id: string): boolean;
  query(bounds: Bounds): readonly SpatialEntry<T>[];
  clear(): void;
  readonly size: number;
}

export type SpatialIndexErrorCode =
  | "SPATIAL_DUPLICATE_ID"
  | "SPATIAL_MISSING_ID"
  | "SPATIAL_INVALID_ID";

export class SpatialIndexError extends Error {
  constructor(
    readonly code: SpatialIndexErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SpatialIndexError";
  }
}

