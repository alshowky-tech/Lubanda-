import { boundsFromPoints } from "./bounds.js";
import { assertFiniteBezier } from "./finite.js";
import { pointSegmentDistance } from "./segments.js";
import type { Bounds, CubicBezier, Vec2 } from "./types.js";
import { distance, lerp } from "./vec2.js";

export interface BezierSamplingOptions {
  readonly tolerance: number;
  readonly maxSubdivisionDepth: number;
}

const assertParameter = (t: number): void => {
  if (!Number.isFinite(t) || t < 0 || t > 1) {
    throw new RangeError("Bézier parameter t must be finite and within [0, 1]");
  }
};

export const evaluateCubicBezier = (curve: CubicBezier, t: number): Vec2 => {
  assertFiniteBezier(curve);
  assertParameter(t);
  const a = lerp(curve.p0, curve.p1, t);
  const b = lerp(curve.p1, curve.p2, t);
  const c = lerp(curve.p2, curve.p3, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
};

export const cubicBezierTangent = (curve: CubicBezier, t: number): Vec2 => {
  assertFiniteBezier(curve);
  assertParameter(t);
  const oneMinus = 1 - t;
  return {
    x:
      3 * oneMinus * oneMinus * (curve.p1.x - curve.p0.x) +
      6 * oneMinus * t * (curve.p2.x - curve.p1.x) +
      3 * t * t * (curve.p3.x - curve.p2.x),
    y:
      3 * oneMinus * oneMinus * (curve.p1.y - curve.p0.y) +
      6 * oneMinus * t * (curve.p2.y - curve.p1.y) +
      3 * t * t * (curve.p3.y - curve.p2.y),
  };
};

export const splitCubicBezier = (
  curve: CubicBezier,
  t = 0.5,
): readonly [CubicBezier, CubicBezier] => {
  assertFiniteBezier(curve);
  assertParameter(t);
  const p01 = lerp(curve.p0, curve.p1, t);
  const p12 = lerp(curve.p1, curve.p2, t);
  const p23 = lerp(curve.p2, curve.p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p = lerp(p012, p123, t);
  return [
    { p0: curve.p0, p1: p01, p2: p012, p3: p },
    { p0: p, p1: p123, p2: p23, p3: curve.p3 },
  ];
};

const isFlatEnough = (curve: CubicBezier, tolerance: number): boolean =>
  Math.max(
    pointSegmentDistance(curve.p1, curve.p0, curve.p3),
    pointSegmentDistance(curve.p2, curve.p0, curve.p3),
  ) <= tolerance;

export const sampleCubicBezier = (
  curve: CubicBezier,
  options: BezierSamplingOptions,
): readonly Vec2[] => {
  assertFiniteBezier(curve);
  if (!Number.isFinite(options.tolerance) || options.tolerance <= 0) {
    throw new TypeError("Bézier sampling tolerance must be positive and finite");
  }
  if (
    !Number.isSafeInteger(options.maxSubdivisionDepth) ||
    options.maxSubdivisionDepth < 1
  ) {
    throw new TypeError("maxSubdivisionDepth must be a positive safe integer");
  }

  const points: Vec2[] = [curve.p0];
  const visit = (part: CubicBezier, depth: number): void => {
    if (depth >= options.maxSubdivisionDepth || isFlatEnough(part, options.tolerance)) {
      points.push(part.p3);
      return;
    }
    const [left, right] = splitCubicBezier(part);
    visit(left, depth + 1);
    visit(right, depth + 1);
  };
  visit(curve, 0);
  return points;
};

export const approximateCubicBezierLength = (
  curve: CubicBezier,
  options: BezierSamplingOptions,
): number => {
  const points = sampleCubicBezier(curve, options);
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1] as Vec2, points[index] as Vec2);
  }
  return total;
};

export const approximateCubicBezierBounds = (
  curve: CubicBezier,
  options: BezierSamplingOptions,
): Bounds => boundsFromPoints(sampleCubicBezier(curve, options));

