import type { Bounds, CubicBezier, Vec2 } from "./types.js";

export const assertFiniteNumber = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
};

export const assertFiniteVec2 = (point: Vec2, label = "point"): void => {
  assertFiniteNumber(point.x, `${label}.x`);
  assertFiniteNumber(point.y, `${label}.y`);
};

export const assertFiniteBounds = (bounds: Bounds, label = "bounds"): void => {
  assertFiniteNumber(bounds.minX, `${label}.minX`);
  assertFiniteNumber(bounds.minY, `${label}.minY`);
  assertFiniteNumber(bounds.maxX, `${label}.maxX`);
  assertFiniteNumber(bounds.maxY, `${label}.maxY`);
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    throw new TypeError(`${label} must be normalized`);
  }
};

export const assertFiniteBezier = (curve: CubicBezier): void => {
  assertFiniteVec2(curve.p0, "curve.p0");
  assertFiniteVec2(curve.p1, "curve.p1");
  assertFiniteVec2(curve.p2, "curve.p2");
  assertFiniteVec2(curve.p3, "curve.p3");
};

