import { sampleCubicBezier, approximateCubicBezierBounds } from "../geometry/bezier.js";
import { expandBounds } from "../geometry/bounds.js";
import { computeRequiredClearance } from "../routing/ClearanceModel.js";
import { buildCollisionIndex } from "./CollisionIndex.js";
import { testBranchAgainstIndex, testSelfCollision, testBoundaryContainment } from "./ConstraintSolver.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type {
  CollisionInput,
  CollisionIndex,
  CollisionIndexEntry,
  CollisionPolicy,
  CollisionTestResult,
  CollisionValidationReport,
  CollisionValidationMetrics,
  CollisionRecord,
} from "./types.js";
import { DEFAULT_COLLISION_POLICY } from "./types.js";

const EPSILON = 1e-7;

/**
 * Deterministic CollisionEngine implementing the full collision detection pipeline.
 *
 * Per LCS-CON-004:
 * - index() builds a spatial index of branch collision envelopes
 * - testCandidate() checks one branch against the index
 * - validateLayout() performs exact final validation
 *
 * The engine consumes the existing RoutingPlan corridor data rather than
 * rebuilding collision envelopes from scratch. Clearance uses the canonical
 * formula from routing's ClearanceModel (shared single source of truth).
 */
export class DeterministicCollisionEngine {
  /**
   * Build a CollisionIndex from the input skeleton + routing data.
   */
  index(input: CollisionInput): CollisionIndex {
    return buildCollisionIndex(input);
  }

  /**
   * Test a single branch candidate against the collision index.
   * Returns valid with minimum clearance if no collisions found,
   * or invalid with collision records.
   */
  testCandidate(
    branchId: SkeletonBranchId,
    index: CollisionIndex,
    input: CollisionInput,
    policy: CollisionPolicy = DEFAULT_COLLISION_POLICY,
  ): CollisionTestResult {
    const entry = index.branchIdMap.get(branchId);
    if (!entry) {
      return { valid: true, minimumClearance: Infinity };
    }

    const collisions: CollisionRecord[] = [];

    // Branch–branch collisions
    const branchCollisions = testBranchAgainstIndex(branchId, entry, index, policy);
    collisions.push(...branchCollisions);

    // Self-collision
    const selfCollisions = testSelfCollision(entry, policy);
    collisions.push(...selfCollisions);

    // Boundary containment
    const templatePoints = input.skeletonPlan.trunk.segments.length > 0
      ? input.skeletonPlan.branches
          .filter((b) => b.generation === 1)
          .flatMap((b) => {
            const cr = input.routingRecordMap.get(b.id);
            return cr ? cr.corridorPolygon.points : [];
          })
      : [];
    const boundaryCollisions = testBoundaryContainment(entry, templatePoints, policy);
    collisions.push(...boundaryCollisions);

    if (collisions.length > 0) {
      return { valid: false, collisions: Object.freeze(collisions) };
    }

    // Compute minimum clearance to nearest neighbor
    let minClearance = Infinity;
    for (const candidate of index.query(entry.envelopeBounds)) {
      if (candidate.branchId === branchId) continue;
      const required = computeRequiredClearance(
        entry.routingRecord.branchRadius,
        candidate.routingRecord.branchRadius,
        entry.routingRecord.safetyMargin,
        candidate.routingRecord.safetyMargin,
      );
      if (required < minClearance) minClearance = required;
    }

    return {
      valid: true,
      minimumClearance: minClearance === Infinity ? 0 : Math.round(minClearance * 1000) / 1000,
    };
  }

  /**
   * Exact final validation of the entire layout.
   * Uses a stricter sampling tolerance (configurable via policy.finalValidationTolerance)
   * than interactive candidate testing.
   */
  validateLayout(
    input: CollisionInput,
    policy: CollisionPolicy = DEFAULT_COLLISION_POLICY,
  ): CollisionValidationReport {
    // Use stricter sampling for final validation
    const strictSampling = Object.freeze({
      tolerance: policy.finalValidationTolerance,
      maxSubdivisionDepth: 20,
    });

    // Rebuild index with strict sampling
    const strictIndex = this.buildStrictIndex(input, strictSampling);

    const allCollisions: CollisionRecord[] = [];

    for (const entry of strictIndex.entries) {
      // Branch–branch
      const branchCollisions = testBranchAgainstIndex(entry.branchId, entry, strictIndex, policy);
      allCollisions.push(...branchCollisions);

      // Self-collision
      const selfCollisions = testSelfCollision(entry, policy);
      allCollisions.push(...selfCollisions);

      // Boundary (check against template if available)
      if (input.skeletonPlan.trunk.segments.length > 0) {
        const boundaryCollisions = testBoundaryContainment(entry, this.getTemplatePolygon(input), policy);
        allCollisions.push(...boundaryCollisions);
      }
    }

    // Compute metrics
    const metrics = this.computeMetrics(allCollisions, strictIndex.entries.length);

    return {
      accepted: allCollisions.length === 0,
      collisions: Object.freeze(allCollisions),
      metrics,
    };
  }

  /**
   * Build an index with strict sampling tolerance for final validation.
   */
  private buildStrictIndex(
    input: CollisionInput,
    sampling: { readonly tolerance: number; readonly maxSubdivisionDepth: number },
  ): CollisionIndex {
    const { skeletonPlan, routingRecordMap, configuration } = input;
    const entries: CollisionIndexEntry[] = [];
    const branchIdMap = new Map<SkeletonBranchId, CollisionIndexEntry>();

    for (const branch of skeletonPlan.branches) {
      if (branch.generation === 0) continue;
      const routingRecord = routingRecordMap.get(branch.id);
      if (!routingRecord) continue;

      const envelopeRadius = routingRecord.branchRadius + configuration.barkAllowance + configuration.branchClearance + routingRecord.safetyMargin;
      const sampledCurve = sampleCubicBezier(branch.curve, sampling);
      const curveBounds = approximateCubicBezierBounds(branch.curve, sampling);
      const envelopeBounds = expandBounds(curveBounds, envelopeRadius);

      const entry: CollisionIndexEntry = {
        branchId: branch.id,
        routingRecord,
        envelopeBounds,
        envelopeRadius,
        sampledCurve,
      };

      branchIdMap.set(branch.id, entry);
      entries.push(entry);
    }

    entries.sort((a, b) => String(a.branchId).localeCompare(String(b.branchId)));

    return {
      entries: Object.freeze(entries),
      branchIdMap,
      query: (bounds) => entries.filter((e) =>
        boundsOverlap(e.envelopeBounds, bounds)
      ),
    };
  }

  /**
   * Extract template boundary points from the input.
   */
  private getTemplatePolygon(input: CollisionInput): readonly import("../geometry/types.js").Vec2[] {
    const pts: import("../geometry/types.js").Vec2[] = [];
    for (const branch of input.skeletonPlan.branches) {
      if (branch.generation === 1) {
        const rec = input.routingRecordMap.get(branch.id);
        if (rec) pts.push(...rec.corridorPolygon.points);
      }
    }
    return pts;
  }

  /**
   * Compute validation metrics from all collision records.
   */
  private computeMetrics(
    collisions: readonly CollisionRecord[],
    branchCount: number,
  ): CollisionValidationMetrics {
    let testedPairCount = 0;
    let clearanceDeficitCount = 0;
    let penetrationCount = 0;
    let boundaryViolationCount = 0;
    let selfIntersectionCount = 0;
    let minimumClearance = Infinity;
    let maximumClearanceDeficit = 0;

    for (const record of collisions) {
      testedPairCount += 1;
      if (record.measuredDistance <= EPSILON) penetrationCount += 1;
      else clearanceDeficitCount += 1;

      if (record.collisionClass === "BRANCH_BOUNDARY") boundaryViolationCount += 1;
      if (record.collisionClass === "SELF_INTERSECTION") selfIntersectionCount += 1;

      if (record.clearanceDeficit > maximumClearanceDeficit) {
        maximumClearanceDeficit = record.clearanceDeficit;
      }
      if (record.measuredDistance < minimumClearance) {
        minimumClearance = record.measuredDistance;
      }
    }

    if (minimumClearance === Infinity) minimumClearance = 0;

    return {
      branchCount,
      testedPairCount,
      collisionCount: collisions.length,
      clearanceDeficitCount,
      penetrationCount,
      boundaryViolationCount,
      selfIntersectionCount,
      minimumClearance: Math.round(minimumClearance * 1000) / 1000,
      maximumClearanceDeficit: Math.round(maximumClearanceDeficit * 1000) / 1000,
    };
  }
}

/**
 * Check if two axis-aligned bounds overlap.
 */
const boundsOverlap = (
  a: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
  b: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
): boolean => !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
