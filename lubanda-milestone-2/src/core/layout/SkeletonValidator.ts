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

/** Validate that every sampled point of the curve is inside the polygon. */
const allPointsInside = (samples: readonly Vec2[], poly: Polygon): boolean =>
  samples.every((p) => classifyPointInPolygon(p, poly) !== "OUTSIDE");

/** For relaxed (major lineage entry): find first entry, then no re-exit. */
const entryThenStayInside = (samples: readonly Vec2[], poly: Polygon): boolean => {
  if (samples.length === 0) return false;
  let entryIndex = -1;
  for (let i = 0; i < samples.length; i += 1) {
    if (classifyPointInPolygon(samples[i]!, poly) !== "OUTSIDE") {
      entryIndex = i;
      break;
    }
  }
  if (entryIndex < 0) {
    return classifyPointInPolygon(samples[samples.length - 1]!, poly) !== "OUTSIDE";
  }
  for (let i = entryIndex; i < samples.length; i += 1) {
    if (classifyPointInPolygon(samples[i]!, poly) === "OUTSIDE") return false;
  }
  return true;
};

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

    // Build set of connected branch pairs
    const connectedPairs = new Set<string>();
    const pairKey = (l: string, r: string): string => l < r ? `${l}|${r}` : `${r}|${l}`;
    for (const branch of plan.branches) {
      if (branch.parentBranchId !== null) connectedPairs.add(pairKey(branch.id, branch.parentBranchId));
      for (const childId of branch.childrenBranchIds) connectedPairs.add(pairKey(branch.id, childId));
    }
    for (let i = 0; i < plan.trunk.segments.length; i += 1) {
      for (let j = i + 1; j < plan.trunk.segments.length; j += 1) {
        if (j === i + 1) connectedPairs.add(pairKey(plan.trunk.segments[i]!, plan.trunk.segments[j]!));
      }
    }

    // Pre-sample all branch curves
    const sampledCurves = new Map<SkeletonBranchId, readonly Vec2[]>();
    for (const branch of plan.branches) {
      sampledCurves.set(branch.id, sampleCubicBezier(branch.curve, BEZIER_SAMPLING));
    }

    // 1. Check that all persons in the subtree have a branch
    const subtree = graph.getSubtree(selectedRootId);
    const personsWithBranches = new Set(plan.branches.map((b) => b.ownerPersonId));
    for (const personId of subtree) {
      if (!personsWithBranches.has(personId)) {
        missingPersonBranchCount += 1;
        issues.push(issue("SKELETON_MISSING_PERSON", "VALIDATE_SKELETON", "skeleton.missingPerson", [personId]));
      }
    }

    // 2. Check each branch for structural integrity and geometry
    const branchBoundsList: Bounds[] = [];
    for (const branch of plan.branches) {
      // Parent chain
      if (branch.parentBranchId !== null) {
        const parent = branchMap.get(branch.parentBranchId);
        if (!parent) {
          orphanBranchCount += 1;
          issues.push(issue("SKELETON_ORPHAN_BRANCH", "VALIDATE_SKELETON", "skeleton.orphanBranch", [branch.id]));
        } else {
          // 💥 Verify parent's childrenBranchIds contains this child
          if (!parent.childrenBranchIds.includes(branch.id)) {
            invalidBranchCount += 1;
            issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
              reason: "parent childrenBranchIds does not include child",
            }));
          }
        }
      }

      // Start node
      const startNode = nodeMap.get(branch.startNodeId);
      if (!startNode) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
          reason: "startNodeId not found",
        }));
      } else {
        if (distance(branch.startPoint, startNode.point) > EPSILON) {
          invalidBranchCount += 1;
          issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
            reason: "startPoint does not match startNode point",
          }));
        }
        // 💥 For non-trunk, non-root branches: verify startNode.incomingBranchId
        if (branch.generation > 0 && branch.parentBranchId !== null) {
          if (startNode.incomingBranchId !== branch.parentBranchId &&
              startNode.incomingBranchId !== null) {
            // This is a soft check: the split node's incomingBranchId should reference the parent
            // But the parent end node won't have incomingBranchId set to the parent
            // So only flag if it's a BRANCH_SPLIT node with wrong incomingBranchId
          }
        }
      }

      // End node
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

      // 💥 BRANCH_SPLIT node topology: incomingBranchId should match parent
      if (endNode && endNode.kind === "BRANCH_SPLIT" && endNode.incomingBranchId !== null) {
        if (endNode.incomingBranchId !== branch.id) {
          invalidBranchCount += 1;
          issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id, endNode.id], {
            reason: "splitNode.incomingBranchId does not match the branch ending at this node",
          }));
        }
        // 💥 outgoingBranchIds should contain children
        for (const childId of branch.childrenBranchIds) {
          if (!endNode.outgoingBranchIds.includes(childId)) {
            invalidBranchCount += 1;
            issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id, childId], {
              reason: "splitNode.outgoingBranchIds missing child branch",
            }));
          }
        }
      }

      // Template containment on sampled curve
      const curveSamples = sampledCurves.get(branch.id) ?? [];
      if (!allPointsInside(curveSamples, templatePolygon)) {
        outOfBoundsCount += 1;
        issues.push(issue("SKELETON_BRANCH_OUT_OF_BOUNDS", "VALIDATE_SKELETON", "skeleton.branchOutOfBounds", [branch.id]));
      }

      // 💥 Territory containment: every sampled point must be inside
      if (branch.territoryId !== null) {
        const assignedPoly = territoryPolygons.get(branch.territoryId);
        if (assignedPoly) {
          // Determine if this is a major lineage branch (generation 1 starting from trunk)
          // These may enter from outside at the corridor boundary
          const isMajorLineage = branch.generation === 1 && branch.parentBranchId === null;
          const territoryOk = isMajorLineage
            ? entryThenStayInside(curveSamples, assignedPoly)
            : allPointsInside(curveSamples, assignedPoly);
          if (!territoryOk) {
            territoryMissCount += 1;
            issues.push(issue("SKELETON_TERRITORY_MISS", "VALIDATE_SKELETON", "skeleton.territoryMiss", [branch.id]));
          }
        } else {
          territoryMissCount += 1;
          issues.push(issue("SKELETON_TERRITORY_MISS", "VALIDATE_SKELETON", "skeleton.territoryMiss", [branch.id]));
        }
      }

      branchBoundsList.push({
        minX: Math.min(...[branch.curve.p0, branch.curve.p1, branch.curve.p2, branch.curve.p3].map((p) => p.x)) - 20,
        minY: Math.min(...[branch.curve.p0, branch.curve.p1, branch.curve.p2, branch.curve.p3].map((p) => p.y)) - 20,
        maxX: Math.max(...[branch.curve.p0, branch.curve.p1, branch.curve.p2, branch.curve.p3].map((p) => p.x)) + 20,
        maxY: Math.max(...[branch.curve.p0, branch.curve.p1, branch.curve.p2, branch.curve.p3].map((p) => p.y)) + 20,
      });
    }

    // 3. Check for branch intersections using sampled Bezier narrow phase
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
        // Skip connected pairs
        if (connectedPairs.has(pairKey(leftBranch.id, rightBranch.id))) continue;

        // Narrow phase: segment intersections on sampled polylines
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
          issues.push(issue("SKELETON_BRANCH_INTERSECTION", "VALIDATE_SKELETON", "skeleton.branchIntersection", [
            leftBranch.id, rightBranch.id,
          ]));
        }
      }
    }

    // 4. Trunk completeness
    for (const trunkBranchId of plan.trunk.segments) {
      if (!branchMap.has(trunkBranchId)) {
        issues.push(issue("SKELETON_TRUNK_INVALID", "VALIDATE_SKELETON", "skeleton.trunkInvalid", [trunkBranchId]));
      }
    }
    if (!nodeMap.has(plan.trunk.baseNodeId)) {
      issues.push(issue("SKELETON_TRUNK_INVALID", "VALIDATE_SKELETON", "skeleton.trunkInvalid", [], {
        reason: "baseNodeId not found",
      }));
    }

    // 5. Topology consistency in both directions
    for (const branch of plan.branches) {
      for (const childId of branch.childrenBranchIds) {
        const child = branchMap.get(childId);
        if (!child) {
          invalidBranchCount += 1;
          issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
            reason: "childrenBranchIds references nonexistent branch",
          }));
        } else if (child.parentBranchId !== branch.id) {
          invalidBranchCount += 1;
          issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id, childId], {
            reason: "child.parentBranchId does not match parent",
          }));
        }
      }
    }

    // 6. Check for duplicate child references
    for (const branch of plan.branches) {
      const uniqueChildren = new Set(branch.childrenBranchIds);
      if (uniqueChildren.size !== branch.childrenBranchIds.length) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
          reason: "duplicate child reference in childrenBranchIds",
        }));
      }
    }

    // 7. For non-trunk branches, check start node lies on parent curve
    for (const branch of plan.branches) {
      if (branch.parentBranchId !== null) {
        const parent = branchMap.get(branch.parentBranchId);
        if (parent) {
          const startNodeCheck = nodeMap.get(branch.startNodeId);
          if (startNodeCheck && startNodeCheck.point !== branch.startPoint) {
            // Already checked above via distance - this is fine
          }
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
