import { boundsContainPoint, boundsOverlap } from "../geometry/bounds.js";
import { intersectSegments } from "../geometry/segments.js";
import type { Bounds, Vec2 } from "../geometry/types.js";
import type { LabelPlacement } from "./types.js";

const EPSILON = 1e-7;

export interface LabelCollisionQuery {
  /** True if candidate's bounds overlap placed bounds. */
  overlapsPlacedLabel(candidateBounds: Bounds, placement: LabelPlacement): boolean;

  /** True if candidate's leader segment intersects placed bounds. */
  leaderCrossesPlacedLabel(
    leaderStart: Vec2,
    leaderEnd: Vec2,
    placement: LabelPlacement,
  ): boolean;

  /** True if candidate's bounds intersect a placed leader segment. */
  labelCrossesPlacedLeader(
    candidateBounds: Bounds,
    placedLeaderStart: Vec2,
    placedLeaderEnd: Vec2,
  ): boolean;

  /** True if two leader segments properly intersect or collinearly overlap.
   * Endpoint-touch without crossing is allowed. */
  leadersCross(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean;
}

const cornersOf = (bounds: Bounds): readonly [Vec2, Vec2, Vec2, Vec2] => [
  { x: bounds.minX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.maxY },
  { x: bounds.minX, y: bounds.maxY },
];

const edgesOf = (bounds: Bounds): readonly [readonly [Vec2, Vec2], readonly [Vec2, Vec2], readonly [Vec2, Vec2], readonly [Vec2, Vec2]] => {
  const corners = cornersOf(bounds);
  return [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
};

const segmentIntersectsBounds = (start: Vec2, end: Vec2, bounds: Bounds): boolean => {
  if (boundsContainPoint(bounds, start, EPSILON) || boundsContainPoint(bounds, end, EPSILON)) {
    return true;
  }

  for (const [edgeStart, edgeEnd] of edgesOf(bounds)) {
    const intersection = intersectSegments(start, end, edgeStart, edgeEnd, { epsilon: EPSILON });
    if (intersection.kind !== "NONE") return true;
  }

  return false;
};

export class DefaultLabelCollisionQuery implements LabelCollisionQuery {
  overlapsPlacedLabel(candidateBounds: Bounds, placement: LabelPlacement): boolean {
    return boundsOverlap(candidateBounds, placement.bounds, EPSILON);
  }

  leaderCrossesPlacedLabel(
    leaderStart: Vec2,
    leaderEnd: Vec2,
    placement: LabelPlacement,
  ): boolean {
    return segmentIntersectsBounds(leaderStart, leaderEnd, placement.bounds);
  }

  labelCrossesPlacedLeader(
    candidateBounds: Bounds,
    placedLeaderStart: Vec2,
    placedLeaderEnd: Vec2,
  ): boolean {
    return segmentIntersectsBounds(placedLeaderStart, placedLeaderEnd, candidateBounds);
  }

  leadersCross(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean {
    const intersection = intersectSegments(a0, a1, b0, b1, { epsilon: EPSILON });
    return intersection.kind === "PROPER" || intersection.kind === "COLLINEAR_OVERLAP";
  }
}
