import { boundsOverlap } from "../geometry/bounds.js";
import { distance } from "../geometry/vec2.js";
import { pointSegmentDistance, intersectSegments } from "../geometry/segments.js";
import type { Vec2, Bounds, Polygon } from "../geometry/types.js";
import type { CollisionIndex } from "../collision/types.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type { CandidateCollisionQuery, LabelPlacement } from "./types.js";

const EPSILON = 1e-7;

/**
 * Read-only CandidateCollisionQuery wrapping a CollisionIndex.
 */
export class DefaultCandidateCollisionQuery implements CandidateCollisionQuery {
  readonly #index: CollisionIndex;
  readonly #templatePolygon: Polygon;

  constructor(index: CollisionIndex, templatePolygon: Polygon) {
    this.#index = index;
    this.#templatePolygon = templatePolygon;
  }

  overlapsFixedBranch(
    candidateBranchId: SkeletonBranchId,
    bounds: Bounds,
    anchor: Vec2,
    anchorRadius: number,
  ): boolean {
    const candidates = this.#index.query(bounds);
    for (const entry of candidates) {
      if (!boundsOverlap(entry.envelopeBounds, bounds)) continue;

      // Skip if this is the candidate's OWN branch and the overlap is
      // within the circular self-anchor attachment zone
      if (entry.branchId === candidateBranchId) {
        // Only exempt geometry that is strictly within the anchor-radius circle.
        // Check all four corners of the bounds: if any corner is outside the
        // exemption circle, the overlap is real.
        const corners: Vec2[] = [
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.maxY },
          { x: bounds.minX, y: bounds.maxY },
        ];
        const allInsideAnchor = corners.every(
          (c) => distance(c, anchor) <= anchorRadius + EPSILON,
        );
        if (allInsideAnchor) continue; // exempted
        // Otherwise the overlap is real (label extends beyond anchor zone)
      }

      return true; // Other branch always collides
    }
    return false;
  }

  overlapsFixedLabel(
    bounds: Bounds,
    fixedPlacements: readonly LabelPlacement[],
  ): boolean {
    for (const fp of fixedPlacements) {
      if (boundsOverlap(bounds, fp.bounds)) return true;
    }
    return false;
  }

  isBoundsInsideBoundary(bounds: Bounds): boolean {
    const corners: Vec2[] = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];
    return corners.every((c) => this.isPointInsideBoundary(c));
  }

  isPointInsideBoundary(point: Vec2): boolean {
    const pts = this.#templatePolygon.points;
    if (pts.length < 3) return false;
    let inside = false;
    let j = pts.length - 1;
    for (let i = 0; i < pts.length; j = i, i += 1) {
      const xi = pts[i]!.x, yi = pts[i]!.y;
      const xj = pts[j]!.x, yj = pts[j]!.y;
      if (
        (yi > point.y) !== (yj > point.y) &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  leaderCrossesFixedObstacle(a: Vec2, b: Vec2): boolean {
    for (const entry of this.#index.entries) {
      const samples = entry.sampledCurve;
      for (let i = 0; i < samples.length - 1; i += 1) {
        const s0 = samples[i]!, s1 = samples[i + 1]!;
        const seg = intersectSegments(a, b, s0, s1, { epsilon: EPSILON });
        if (seg.kind === "PROPER" || seg.kind === "COLLINEAR_OVERLAP") return true;
      }
    }
    return false;
  }

  minClearanceToFixedBranches(point: Vec2): number {
    let minDist = Infinity;
    for (const entry of this.#index.entries) {
      for (const sp of entry.sampledCurve) {
        const d = distance(point, sp);
        if (d < minDist) minDist = d;
      }
    }
    return minDist;
  }

  boundaryClearance(point: Vec2): number {
    const pts = this.#templatePolygon.points;
    if (pts.length < 3) return 0;
    let minDist = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      const d = pointSegmentDistance(point, a, b);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }
}
