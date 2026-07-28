import { boundsOverlap } from "../geometry/bounds.js";
import { distance } from "../geometry/vec2.js";
import { pointSegmentDistance, intersectSegments } from "../geometry/segments.js";
import type { Vec2, Bounds, Polygon } from "../geometry/types.js";
import type { CollisionIndex } from "../collision/types.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type { CandidateCollisionQuery, LabelPlacement } from "./types.js";

const EPSILON = 1e-7;

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
  ): boolean { /* unchanged — preserve previous logic */
    const candidates = this.#index.query(bounds);
    for (const entry of candidates) {
      if (!boundsOverlap(entry.envelopeBounds, bounds)) continue;
      if (entry.branchId === candidateBranchId) {
        const ox = Math.max(bounds.minX, entry.envelopeBounds.minX);
        const oy = Math.max(bounds.minY, entry.envelopeBounds.minY);
        const ox2 = Math.min(bounds.maxX, entry.envelopeBounds.maxX);
        const oy2 = Math.min(bounds.maxY, entry.envelopeBounds.maxY);
        let allInside = true;
        for (let xi = 0; xi < 3; xi += 1) {
          for (let yi = 0; yi < 3; yi += 1) {
            const px = ox + (ox2 - ox) * (xi / 2);
            const py = oy + (oy2 - oy) * (yi / 2);
            if (distance({ x: px, y: py }, anchor) > anchorRadius + EPSILON) allInside = false;
          }
        }
        if (allInside) continue;
      }
      return true;
    }
    return false;
  }

  overlapsFixedLabel(bounds: Bounds, fixedPlacements: readonly LabelPlacement[]): boolean {
    for (const fp of fixedPlacements) {
      if (boundsOverlap(bounds, fp.bounds)) return true;
    }
    return false;
  }

  /**
   * Concave-safe AABB boundary test: checks both corner containment AND
   * that no AABB edge crosses any polygon boundary edge. This prevents
   * false positives where all corners are inside but the AABB bridges
   * across a concave notch.
   */
  isBoundsInsideBoundary(bounds: Bounds): boolean {
    const pts = this.#templatePolygon.points;
    if (pts.length < 3) return false;

    // Check all four corners
    const corners: Vec2[] = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];
    for (const c of corners) {
      if (!this.isPointInsideBoundary(c)) return false;
    }

    // Check each AABB edge against each polygon edge for crossings
    const aabbEdges: readonly [Vec2, Vec2][] = [
      [corners[0]!, corners[1]!],
      [corners[1]!, corners[2]!],
      [corners[2]!, corners[3]!],
      [corners[3]!, corners[0]!],
    ];

    for (const [ae0, ae1] of aabbEdges) {
      for (let pi = 0; pi < pts.length; pi += 1) {
        const pp0 = pts[pi]!;
        const pp1 = pts[(pi + 1) % pts.length]!;
        const seg = intersectSegments(ae0, ae1, pp0, pp1, { epsilon: EPSILON });
        // PROPER and COLLINEAR_OVERLAP indicate the edge crosses the boundary
        if (seg.kind === "PROPER" || seg.kind === "COLLINEAR_OVERLAP") return false;
        // ENDPOINT_TOUCH and COLLINEAR_TOUCH are allowed (exactly on boundary)
      }
    }

    return true;
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
    return this.#edgeDistance(point, this.#templatePolygon.points);
  }

  /**
   * Minimum distance between ANY candidate AABB edge and ANY polygon
   * boundary edge. Returns 0 if any pair intersects/crosses.
   */
  minBoundsBoundaryClearance(bounds: Bounds): number {
    const pts = this.#templatePolygon.points;
    if (pts.length < 3) return 0;

    const corners: Vec2[] = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];

    const aabbEdges: readonly [Vec2, Vec2][] = [
      [corners[0]!, corners[1]!],
      [corners[1]!, corners[2]!],
      [corners[2]!, corners[3]!],
      [corners[3]!, corners[0]!],
    ];

    let minClear = Infinity;

    // Check each AABB edge against each polygon boundary edge
    for (const [ae0, ae1] of aabbEdges) {
      for (let pi = 0; pi < pts.length; pi += 1) {
        const pp0 = pts[pi]!;
        const pp1 = pts[(pi + 1) % pts.length]!;
        // Crossing → clearance is zero
        const seg = intersectSegments(ae0, ae1, pp0, pp1, { epsilon: EPSILON });
        if (seg.kind === "PROPER" || seg.kind === "COLLINEAR_OVERLAP") return 0;
        // Segment-to-segment min distance
        const d = this.#segmentSegmentDistance(ae0, ae1, pp0, pp1);
        if (d < minClear) minClear = d;
      }
    }

    // Also check corner-to-edge distances
    for (const corner of corners) {
      const d = this.#edgeDistance(corner, pts);
      if (d < minClear) minClear = d;
    }

    return minClear;
  }

  #edgeDistance(point: Vec2, pts: readonly Vec2[]): number {
    let minDist = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      const d = pointSegmentDistance(point, a, b);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  #segmentSegmentDistance(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): number {
    // Check endpoints against the other segment
    const d1 = pointSegmentDistance(a0, b0, b1);
    const d2 = pointSegmentDistance(a1, b0, b1);
    const d3 = pointSegmentDistance(b0, a0, a1);
    const d4 = pointSegmentDistance(b1, a0, a1);
    return Math.min(d1, d2, d3, d4);
  }
}
