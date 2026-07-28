import { SpatialHash } from "../spatial/SpatialHash.js";
import { approximateCubicBezierBounds, sampleCubicBezier } from "../geometry/bezier.js";
import { expandBounds } from "../geometry/bounds.js";
import { computeEnvelopeRadius } from "../routing/ClearanceModel.js";
import type { Bounds } from "../geometry/types.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type {
  CollisionIndex as CollisionIndexContract,
  CollisionIndexEntry,
  CollisionInput,
} from "./types.js";

const BEZIER_SAMPLING = Object.freeze({ tolerance: 4, maxSubdivisionDepth: 10 });

/**
 * Build a spatial index of branch collision envelopes.
 *
 * Consumes the existing RoutingPlan corridor data rather than
 * rebuilding collision envelopes from scratch. Each entry stores:
 * - the RoutingRecord (with branchRadius, safetyMargin, corridorPolygon)
 * - the computed envelope radius (branchRadius + barkAllowance + classClearance + safetyMargin)
 * - the sampled curve for narrow-phase testing
 * - the expanded envelope bounds for broad-phase queries
 */
export const buildCollisionIndex = (input: CollisionInput): CollisionIndexContract => {
  const { skeletonPlan, routingRecordMap, configuration } = input;
  const cellSize = Math.max(64, configuration.branchClearance * 4);
  const spatialHash = new SpatialHash<CollisionIndexEntry>(cellSize);
  const branchIdMap = new Map<SkeletonBranchId, CollisionIndexEntry>();
  const entries: CollisionIndexEntry[] = [];

  for (const branch of skeletonPlan.branches) {
    if (branch.generation === 0) continue; // skip trunk

    const routingRecord = routingRecordMap.get(branch.id);
    if (!routingRecord) continue;

    const branchHalfWidth = routingRecord.branchRadius;
    const envelopeRadius = computeEnvelopeRadius(
      branchHalfWidth,
      configuration.barkAllowance,
      configuration.branchClearance,
      routingRecord.safetyMargin,
    );

    // Sample the curve for narrow-phase distance checks
    const sampledCurve = sampleCubicBezier(branch.curve, BEZIER_SAMPLING);

    // Build envelope bounds: expand the curve's bounding box by the envelope radius
    const curveBounds = approximateCubicBezierBounds(branch.curve, BEZIER_SAMPLING);
    const envelopeBounds = expandBounds(curveBounds, envelopeRadius);

    const entry: CollisionIndexEntry = {
      branchId: branch.id,
      routingRecord,
      envelopeBounds,
      envelopeRadius,
      sampledCurve,
    };

    spatialHash.insert(branch.id, envelopeBounds, entry);
    branchIdMap.set(branch.id, entry);
    entries.push(entry);
  }

  // Sort deterministically by branchId
  entries.sort((a, b) => String(a.branchId).localeCompare(String(b.branchId)));

  return {
    entries: Object.freeze(entries),
    branchIdMap,
    query: (bounds: Bounds): readonly CollisionIndexEntry[] => {
      const results = spatialHash.query(bounds);
      // SpatialHash.query returns SpatialEntry<CollisionIndexEntry>[]
      return results.map((r) => r.value);
    },
  };
};
