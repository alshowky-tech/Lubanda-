import { assertFiniteVec2 } from "./finite.js";
import {
  DEFAULT_NUMERIC_POLICY,
  assertNumericPolicy,
  type NumericPolicy,
} from "./numeric-policy.js";
import type { Vec2 } from "./types.js";
import { cross, distance, dot, subtract } from "./vec2.js";

export type SegmentIntersectionKind =
  | "NONE"
  | "PROPER"
  | "ENDPOINT_TOUCH"
  | "COLLINEAR_TOUCH"
  | "COLLINEAR_OVERLAP"
  | "DEGENERATE_TOUCH";

export type SegmentIntersectionResult =
  | { readonly kind: "NONE" }
  | {
      readonly kind:
        | "PROPER"
        | "ENDPOINT_TOUCH"
        | "COLLINEAR_TOUCH"
        | "DEGENERATE_TOUCH";
      readonly point: Vec2;
    }
  | {
      readonly kind: "COLLINEAR_OVERLAP";
      readonly overlap: readonly [Vec2, Vec2];
    };

const approximatelyZero = (value: number, epsilon: number): boolean =>
  Math.abs(value) <= epsilon;

export const pointSegmentDistance = (
  point: Vec2,
  start: Vec2,
  end: Vec2,
): number => {
  assertFiniteVec2(point, "point");
  assertFiniteVec2(start, "start");
  assertFiniteVec2(end, "end");
  const segment = subtract(end, start);
  const denominator = dot(segment, segment);
  if (denominator === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, dot(subtract(point, start), segment) / denominator));
  return distance(point, {
    x: start.x + segment.x * t,
    y: start.y + segment.y * t,
  });
};

export const pointOnSegment = (
  point: Vec2,
  start: Vec2,
  end: Vec2,
  policy: NumericPolicy = DEFAULT_NUMERIC_POLICY,
): boolean => {
  assertNumericPolicy(policy);
  return pointSegmentDistance(point, start, end) <= policy.epsilon;
};

const lineIntersection = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 => {
  const r = subtract(b, a);
  const s = subtract(d, c);
  const t = cross(subtract(c, a), s) / cross(r, s);
  return { x: a.x + t * r.x, y: a.y + t * r.y };
};

const pointAtAxisValue = (
  start: Vec2,
  end: Vec2,
  axis: "x" | "y",
  value: number,
): Vec2 => {
  const delta = end[axis] - start[axis];
  if (delta === 0) return start;
  const t = (value - start[axis]) / delta;
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
};

export const intersectSegments = (
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
  policy: NumericPolicy = DEFAULT_NUMERIC_POLICY,
): SegmentIntersectionResult => {
  assertNumericPolicy(policy);
  for (const [point, label] of [
    [a, "a"],
    [b, "b"],
    [c, "c"],
    [d, "d"],
  ] as const) {
    assertFiniteVec2(point, label);
  }
  const epsilon = policy.epsilon;
  const abDegenerate = distance(a, b) <= epsilon;
  const cdDegenerate = distance(c, d) <= epsilon;
  if (abDegenerate && cdDegenerate) {
    return distance(a, c) <= epsilon
      ? { kind: "DEGENERATE_TOUCH", point: a }
      : { kind: "NONE" };
  }
  if (abDegenerate) {
    return pointOnSegment(a, c, d, policy)
      ? { kind: "DEGENERATE_TOUCH", point: a }
      : { kind: "NONE" };
  }
  if (cdDegenerate) {
    return pointOnSegment(c, a, b, policy)
      ? { kind: "DEGENERATE_TOUCH", point: c }
      : { kind: "NONE" };
  }

  const ab = subtract(b, a);
  const cd = subtract(d, c);
  const orientationC = cross(ab, subtract(c, a));
  const orientationD = cross(ab, subtract(d, a));
  const orientationA = cross(cd, subtract(a, c));
  const orientationB = cross(cd, subtract(b, c));
  const collinear =
    approximatelyZero(orientationC, epsilon) &&
    approximatelyZero(orientationD, epsilon) &&
    approximatelyZero(orientationA, epsilon) &&
    approximatelyZero(orientationB, epsilon);

  if (collinear) {
    const axis: "x" | "y" = Math.abs(ab.x) >= Math.abs(ab.y) ? "x" : "y";
    const firstMin = Math.min(a[axis], b[axis]);
    const firstMax = Math.max(a[axis], b[axis]);
    const secondMin = Math.min(c[axis], d[axis]);
    const secondMax = Math.max(c[axis], d[axis]);
    const overlapMin = Math.max(firstMin, secondMin);
    const overlapMax = Math.min(firstMax, secondMax);
    if (overlapMax < overlapMin - epsilon) return { kind: "NONE" };
    const start = pointAtAxisValue(a, b, axis, overlapMin);
    if (overlapMax - overlapMin <= epsilon) {
      return { kind: "COLLINEAR_TOUCH", point: start };
    }
    return {
      kind: "COLLINEAR_OVERLAP",
      overlap: [start, pointAtAxisValue(a, b, axis, overlapMax)],
    };
  }

  const strictCross =
    orientationC * orientationD < -epsilon * epsilon &&
    orientationA * orientationB < -epsilon * epsilon;
  if (strictCross) {
    return { kind: "PROPER", point: lineIntersection(a, b, c, d) };
  }

  for (const [point, start, end] of [
    [a, c, d],
    [b, c, d],
    [c, a, b],
    [d, a, b],
  ] as const) {
    if (pointOnSegment(point, start, end, policy)) {
      return { kind: "ENDPOINT_TOUCH", point };
    }
  }
  return { kind: "NONE" };
};

