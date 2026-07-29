import { classifyPointInPolygon } from "../geometry/polygon.js";
import { distance } from "../geometry/vec2.js";
import { sampleCubicBezier } from "../geometry/bezier.js";
import { boundsOverlap } from "../geometry/bounds.js";
import { intersectSegments } from "../geometry/segments.js";
import type { Polygon, Bounds, Vec2 } from "../geometry/types.js";
import type { PersonId, SkeletonBranchId } from "../contracts/identifiers.js";
import type { EngineIssue } from "../contracts/issues.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import type {
  SkeletonPlan,
  SkeletonBranch,
  SkeletonValidationReport,
  SkeletonValidationMetrics,
} from "../skeleton/types.js";

const issue = (
  code: string,
  stage: string,
  messageKey: string,
  entityIds: readonly string[] = [],
  details: Readonly<Record<string, unknown>> = {},
): EngineIssue => ({
  code,
  severity: "ERROR",
  messageKey,
  stage,
  ...(entityIds.length === 0 ? {} : { entityIds }),
  details,
  recoverable: true,
}) as unknown as EngineIssue;

const BEZIER_SAMPLING = Object.freeze({ tolerance: 2, maxSubdivisionDepth: 10 });
const EPSILON = 1e-7;

/**
 * Validates a grown skeleton plan against structural, geometric, and
 * genealogical correctness constraints using sampled Bezier curves
 * for all geometric checks. Intentional shared endpoints (parent/child
 * junctions) are excluded from intersection detection.
 */
export class SkeletonValidator {
  validate(
    plan: SkeletonPlan,
    graph: GenealogyGraph,
    selectedRootId: PersonId,
    templatePolygon: Polygon,
    territoryPolygons: ReadonlyMap<string, Polygon>,
  ): SkeletonValidationReport {
    const issues: EngineIssue[] = [];
    const branchMap = new Map(plan.branches.map((b) => [b.id, b]));
    const nodeMap = new Map(plan.nodes.map((n) => [n.id, n]));
    let invalidBranchCount = 0;
    let missingPersonBranchCount = 0;
    let orphanBranchCount = 0;
    let territoryMissCount = 0;
    let outOfBoundsCount = 0;
    let intersectionCount = 0;

    // Build set of connected branch pairs (parent-child, trunk neighbors)
    // that are allowed to share endpoints
    const connectedPairs = new Set<string>();
    const pairKey = (l: string, r: string): string =>
      l < r ? `${l}|${r}` : `${r}|${l}`;

    for (const branch of plan.branches) {
      if (branch.parentBranchId !== null) {
        connectedPairs.add(pairKey(branch.id, branch.parentBranchId));
      }
      for (const childId of branch.childrenBranchIds) {
        connectedPairs.add(pairKey(branch.id, childId));
      }
    }
    for (let i = 0; i < plan.trunk.segments.length; i += 1) {
      for (let j = i + 1; j < plan.trunk.segments.length; j += 1) {
        // Adjacent trunk segments are connected
        if (j === i + 1) {
          connectedPairs.add(pairKey(plan.trunk.segments[i]!, plan.trunk.segments[j]!));
        }
      }
    }

    // Pre-sample all branch curves
    const sampledCurves = new Map<SkeletonBranchId, readonly Vec2[]>();
    for (const branch of plan.branches) {
      sampledCurves.set(branch.id, sampleCubicBezier(branch.curve, BEZIER_SAMPLING));
    }

    // 1. Check that all persons in the subtree have a branch
    const subtree = graph.getSubtree(selectedRootId);
    const personsWithBranches = new Set(
      plan.branches.map((b) => b.ownerPersonId),
    );
    for (const personId of subtree) {
      if (!personsWithBranches.has(personId)) {
        missingPersonBranchCount += 1;
        issues.push(
          issue("SKELETON_MISSING_PERSON", "VALIDATE_SKELETON", "skeleton.missingPerson", [personId]),
        );
      }
    }

    // 2. Check each branch for structural integrity
    const branchBoundsList: Bounds[] = [];

    for (const branch of plan.branches) {
      if (branch.parentBranchId !== null) {
        const parent = branchMap.get(branch.parentBranchId);
        if (!parent) {
          orphanBranchCount += 1;
          issues.push(
            issue("SKELETON_ORPHAN_BRANCH", "VALIDATE_SKELETON", "skeleton.orphanBranch", [branch.id]),
          );
        }
      }

      // Check start node
      const startNode = nodeMap.get(branch.startNodeId);
      if (!startNode) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
          reason: "startNodeId not found",
        }));
      } else if (distance(branch.startPoint, startNode.point) > EPSILON) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
          reason: "startPoint does not match startNode point",
        }));
      }

      // Check end node
      const endNode = nodeMap.get(branch.endNodeId);
      if (!endNode) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
          reason: "endNodeId not found",
        }));
      } else if (distance(branch.endPoint, endNode.point) > EPSILON) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
          reason: "endPoint does not match endNode point",
        }));
      }

      // Template containment on sampled curve
      const curveSamples = sampledCurves.get(branch.id) ?? [];
      let branchOutOfBounds = false;
      for (const point of curveSamples) {
        if (classifyPointInPolygon(point, templatePolygon) === "OUTSIDE") {
          branchOutOfBounds = true;
          break;
        }
      }
      // Also check endpoints p0 and p3
      if (!branchOutOfBounds) {
        for (const cp of [branch.curve.p0, branch.curve.p3]) {
          if (classifyPointInPolygon(cp, templatePolygon) === "OUTSIDE") {
            branchOutOfBounds = true;
            break;
          }
        }
      }
      if (branchOutOfBounds) {
        outOfBoundsCount += 1;
        issues.push(
          issue("SKELETON_BRANCH_OUT_OF_BOUNDS", "VALIDATE_SKELETON", "skeleton.branchOutOfBounds", [branch.id]),
        );
      }

      // Territory containment by assigned TerritoryId
      if (branch.territoryId !== null) {
        const assignedPoly = territoryPolygons.get(branch.territoryId);
        if (assignedPoly) {
          let inTerritory = false;
          for (const point of curveSamples) {
            if (classifyPointInPolygon(point, assignedPoly) !== "OUTSIDE") {
              inTerritory = true;
              break;
            }
          }
          if (!inTerritory) {
            territoryMissCount += 1;
            issues.push(
              issue("SKELETON_TERRITORY_MISS", "VALIDATE_SKELETON", "skeleton.territoryMiss", [branch.id]),
            );
          }
        } else {
          territoryMissCount += 1;
          issues.push(
            issue("SKELETON_TERRITORY_MISS", "VALIDATE_SKELETON", "skeleton.territoryMiss", [branch.id]),
          );
        }
      }

      branchBoundsList.push(branchBounds(branch));
    }

    // 3. Check for branch intersections using segment tests on sampled Bezier polylines
    //    Uses proper segment intersection (not just proximity), excluding connected pairs.
    const branchesArray = plan.branches;
    for (let left = 0; left < branchesArray.length; left += 1) {
      const leftBranch = branchesArray[left]!;
      const leftSamples = sampledCurves.get(leftBranch.id) ?? [];
      const leftB = branchBoundsList[left]!;

      for (let right = left + 1; right < branchesArray.length; right += 1) {
        const rightBranch = branchesArray[right]!;
        const rightSamples = sampledCurves.get(rightBranch.id) ?? [];
        const rightB = branchBoundsList[right]!;

        // Broad phase
        if (!boundsOverlap(leftB, rightB, 4)) continue;

        // Skip connected pairs (parent-child, adjacent trunk)
        if (connectedPairs.has(pairKey(leftBranch.id, rightBranch.id))) continue;

        // Narrow phase: test segment intersections between sampled polylines
        let foundIntersection = false;
        for (let li = 0; li < leftSamples.length - 1 && !foundIntersection; li += 1) {
          const la = leftSamples[li]!;
          const lb = leftSamples[li + 1]!;
          for (let ri = 0; ri < rightSamples.length - 1 && !foundIntersection; ri += 1) {
            const ra = rightSamples[ri]!;
            const rb = rightSamples[ri + 1]!;
            const segResult = intersectSegments(la, lb, ra, rb, { epsilon: EPSILON });
            if (segResult.kind === "PROPER" || segResult.kind === "COLLINEAR_OVERLAP") {
              foundIntersection = true;
            }
          }
        }

        if (foundIntersection) {
          intersectionCount += 1;
          issues.push(
            issue("SKELETON_BRANCH_INTERSECTION", "VALIDATE_SKELETON", "skeleton.branchIntersection", [
              leftBranch.id,
              rightBranch.id,
            ]),
          );
        }
      }
    }

    // 4-6: Trunk, root node, topology consistency
    for (const trunkBranchId of plan.trunk.segments) {
      if (!branchMap.has(trunkBranchId)) {
        issues.push(
          issue("SKELETON_TRUNK_INVALID", "VALIDATE_SKELETON", "skeleton.trunkInvalid", [trunkBranchId]),
        );
      }
    }
    if (!nodeMap.has(plan.trunk.baseNodeId)) {
      issues.push(
        issue("SKELETON_TRUNK_INVALID", "VALIDATE_SKELETON", "skeleton.trunkInvalid", [], {
          reason: "baseNodeId not found",
        }),
      );
    }
    for (const branch of plan.branches) {
      for (const childId of branch.childrenBranchIds) {
        const child = branchMap.get(childId);
        if (child && child.parentBranchId !== branch.id) {
          issues.push(
            issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id, childId], {
              reason: "childBranchIds does not match parentBranchId",
            }),
          );
        }
      }
    }

    const metrics: SkeletonValidationMetrics = {
      branchCount: plan.branches.length,
      nodeCount: plan.nodes.length,
      trunkSegmentCount: plan.trunk.segments.length,
      junctionCount: plan.mappedJunctions.length,
      invalidBranchCount,
      missingPersonBranchCount,
      orphanBranchCount,
      territoryMissCount,
      outOfBoundsCount,
      intersectionCount,
      totalCurveLength: plan.branches.reduce((sum, b) => sum + b.length, 0),
      maxDepth: plan.metadata.maximumGenealogyDepth,
      acceptedPersonCount: plan.branches.length,
      connectedPersonCount: plan.branches.filter(
        (b) => b.parentBranchId !== null || b.generation === 0,
      ).length,
    };

    return {
      accepted: issues.length === 0,
      issues: Object.freeze(issues),
      metrics,
    };
  }
}

const branchBounds = (branch: SkeletonBranch): Bounds => {
  const allPoints = [branch.curve.p0, branch.curve.p1, branch.curve.p2, branch.curve.p3];
  return {
    minX: Math.min(...allPoints.map((p) => p.x)) - 20,
    minY: Math.min(...allPoints.map((p) => p.y)) - 20,
    maxX: Math.max(...allPoints.map((p) => p.x)) + 20,
    maxY: Math.max(...allPoints.map((p) => p.y)) + 20,
  };
};
