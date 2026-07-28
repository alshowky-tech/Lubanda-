import { boundsOverlap } from "../geometry/bounds.js";
import { intersectSegments } from "../geometry/segments.js";
import type { Bounds, Vec2 } from "../geometry/types.js";
import type { LabelPlacement } from "./types.js";

const POL = { epsilon: 1e-9 };

/**
 * Read-only dynamic conflict abstraction for M7.3 label assignment.
 *
 * Tests candidate-vs-placement conflicts only (cross-person).
 * Does NOT test branch envelopes, templates, or fixed obstacles — those
 * are M7.2 concerns.
 * Does NOT use the M4.2 collision engine.
 */
export class LabelCollisionQueryImpl {
  /**
   * True if candidate's AABB overlaps the placed label's AABB.
   * Closed intervals — touching at the boundary counts as overlap.
   */
  overlapsPlacedLabel(candidateBounds: Bounds, placement: LabelPlacement): boolean {
    return boundsOverlap(candidateBounds, placement.bounds, 0);
  }

  /**
   * True if candidate's leader segment intersects the placed label's AABB
   * boundary. A leader endpoint at a non-overlapping position is allowed,
   * but if the leader's endpoint lies on the label's boundary it is conflict.
   */
  leaderCrossesPlacedLabel(
    leaderStart: Vec2,
    leaderEnd: Vec2,
    placement: LabelPlacement,
  ): boolean {
    return this.#segmentCrossesBounds(leaderStart, leaderEnd, placement.bounds);
  }

  /**
   * True if candidate's AABB intersects the placed label's leader segment.
   */
  labelCrossesPlacedLeader(
    candidateBounds: Bounds,
    placedLeaderStart: Vec2,
    placedLeaderEnd: Vec2,
  ): boolean {
    return this.#segmentCrossesBounds(placedLeaderStart, placedLeaderEnd, candidateBounds);
  }

  /**
   * True if two leader segments properly intersect or collinearly overlap.
   * ENDPOINT_TOUCH and COLLINEAR_TOUCH are allowed (no crossing).
   */
  leadersCross(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean {
    const seg = intersectSegments(a0, a1, b0, b1, POL);
    return seg.kind === "PROPER" || seg.kind === "COLLINEAR_OVERLAP";
  }

  /** Check if a segment crosses or touches the boundary of a rectangle. */
  #segmentCrossesBounds(a: Vec2, b: Vec2, rect: Bounds): boolean {
    // Build the four edges of the rectangle and test against segment
    const edges: readonly [Vec2, Vec2][] = [
      [{ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }],
      [{ x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }],
      [{ x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }],
      [{ x: rect.minX, y: rect.maxY }, { x: rect.minX, y: rect.minY }],
    ];

    for (const [e0, e1] of edges) {
      const seg = intersectSegments(a, b, e0, e1, POL);
      // PROPER and COLLINEAR_OVERLAP are definite crossings.
      // ENDPOINT_TOUCH / COLLINEAR_TOUCH: the leader endpoint touches the
      // boundary — per §5.3 this counts as conflict for leader↔label.
      if (seg.kind !== "NONE") return true;
    }

    // Also check if the segment is entirely inside the rect
    // (the whole leader might be within the label)
    if (this.#pointInsideRect(a, rect) && this.#pointInsideRect(b, rect)) return true;

    return false;
  }

  #pointInsideRect(p: Vec2, r: Bounds): boolean {
    return (
      p.x >= r.minX && p.x <= r.maxX &&
      p.y >= r.minY && p.y <= r.maxY
    );
  }
}
