import { assertFiniteBounds, assertFiniteVec2 } from "./finite.js";
import type { Bounds, Vec2 } from "./types.js";

export const createBounds = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Bounds => {
  const bounds = { minX, minY, maxX, maxY };
  assertFiniteBounds(bounds);
  return bounds;
};

export const boundsFromPoints = (points: readonly Vec2[]): Bounds => {
  if (points.length === 0) throw new RangeError("At least one point is required");
  for (const point of points) assertFiniteVec2(point);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
};

export const expandBounds = (bounds: Bounds, margin: number): Bounds => {
  assertFiniteBounds(bounds);
  if (!Number.isFinite(margin) || margin < 0) {
    throw new TypeError("margin must be finite and non-negative");
  }
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  };
};

export const boundsContainPoint = (
  bounds: Bounds,
  point: Vec2,
  epsilon = 0,
): boolean => {
  assertFiniteBounds(bounds);
  assertFiniteVec2(point);
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new TypeError("epsilon must be finite and non-negative");
  }
  return (
    point.x >= bounds.minX - epsilon &&
    point.x <= bounds.maxX + epsilon &&
    point.y >= bounds.minY - epsilon &&
    point.y <= bounds.maxY + epsilon
  );
};

export const boundsOverlap = (
  left: Bounds,
  right: Bounds,
  epsilon = 0,
): boolean => {
  assertFiniteBounds(left, "left");
  assertFiniteBounds(right, "right");
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new TypeError("epsilon must be finite and non-negative");
  }
  return !(
    left.maxX < right.minX - epsilon ||
    right.maxX < left.minX - epsilon ||
    left.maxY < right.minY - epsilon ||
    right.maxY < left.minY - epsilon
  );
};
