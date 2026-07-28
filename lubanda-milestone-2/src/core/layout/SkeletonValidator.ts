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
  details?: Readonly<Record<string, unknown>>,
): EngineIssue => ({
  code,
  severity: "ERROR" as const,
  messageKey,
  stage,
  ...(entityIds.length === 0 ? {} : { entityIds }),
  ...(details ? { details } : {}),
  recoverable: true,
}) as unknown as EngineIssue;

const BEZIER_SAMPLING = Object.freeze({ tolerance: 2, maxSubdivisionDepth: 10 });
const EPSILON = 1e-7;

const allPointsInside = (samples: readonly Vec2[], poly: Polygon): boolean =>
  samples.every((p) => classifyPointInPolygon(p, poly) !== "OUTSIDE");

const entryThenStayInside = (samples: readonly Vec2[], poly: Polygon): boolean => {
  if (samples.length === 0) return false;
  let entryIndex = -1;
  for (let i = 0; i < samples.length; i += 1) {
    if (classifyPointInPolygon(samples[i]!, poly) !== "OUTSIDE") { entryIndex = i; break; }
  }
  if (entryIndex < 0) return classifyPointInPolygon(samples[samples.length - 1]!, poly) !== "OUTSIDE";
  for (let i = entryIndex; i < samples.length; i += 1) {
    if (classifyPointInPolygon(samples[i]!, poly) === "OUTSIDE") return false;
  }
  return true;
};

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

    const pairKey = (l: string, r: string): string => l < r ? `${l}|${r}` : `${r}|${l}`;
    const connectedPairs = new Set<string>();
    for (const branch of plan.branches) {
      if (branch.parentBranchId !== null) connectedPairs.add(pairKey(branch.id, branch.parentBranchId));
      for (const childId of branch.childrenBranchIds) connectedPairs.add(pairKey(branch.id, childId));
    }
    for (let i = 0; i < plan.trunk.segments.length; i += 1) {
      for (let j = i + 1; j < plan.trunk.segments.length; j += 1) {
        if (j === i + 1) connectedPairs.add(pairKey(plan.trunk.segments[i]!, plan.trunk.segments[j]!));
      }
    }

    const sampledCurves = new Map<SkeletonBranchId, readonly Vec2[]>();
    for (const branch of plan.branches) {
      sampledCurves.set(branch.id, sampleCubicBezier(branch.curve, BEZIER_SAMPLING));
    }

    // ── 1. Person coverage ──
    const subtree = graph.getSubtree(selectedRootId);
    const personsWithBranches = new Set(plan.branches.map((b) => b.ownerPersonId));
    for (const personId of subtree) {
      if (!personsWithBranches.has(personId)) {
        missingPersonBranchCount += 1;
        issues.push(issue("SKELETON_MISSING_PERSON", "VALIDATE_SKELETON", "skeleton.missingPerson", [personId]));
      }
    }

    // ── 2. Structural checks per branch ──
    const branchBoundsList: Bounds[] = [];
    for (const branch of plan.branches) {
      if (branch.parentBranchId !== null) {
        const parent = branchMap.get(branch.parentBranchId);
        if (!parent) {
          orphanBranchCount += 1;
          issues.push(issue("SKELETON_ORPHAN_BRANCH", "VALIDATE_SKELETON", "skeleton.orphanBranch", [branch.id]));
        } else if (!parent.childrenBranchIds.includes(branch.id)) {
          invalidBranchCount += 1;
          issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
            reason: "parent childrenBranchIds does not include child",
          }));
        }
      }

      const startNode = nodeMap.get(branch.startNodeId);
      if (!startNode) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], { reason: "startNodeId not found" }));
      } else if (distance(branch.startPoint, startNode.point) > EPSILON) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], { reason: "startPoint does not match startNode point" }));
      }

      const endNode = nodeMap.get(branch.endNodeId);
      if (!endNode) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], { reason: "endNodeId not found" }));
      } else if (distance(branch.endPoint, endNode.point) > EPSILON) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], { reason: "endPoint does not match endNode point" }));
      }

      // Template containment
      const curveSamples = sampledCurves.get(branch.id) ?? [];
      if (!allPointsInside(curveSamples, templatePolygon)) {
        outOfBoundsCount += 1;
        issues.push(issue("SKELETON_BRANCH_OUT_OF_BOUNDS", "VALIDATE_SKELETON", "skeleton.branchOutOfBounds", [branch.id]));
      }

      // Territory containment
      if (branch.territoryId !== null) {
        const assignedPoly = territoryPolygons.get(branch.territoryId);
        if (assignedPoly) {
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

    // ── 3. BRANCH_SPLIT validation (Defects 2 & 3) ──
    for (const node of plan.nodes) {
      if (node.kind !== "BRANCH_SPLIT") continue;

      // 💥 Defect 3: null incomingBranchId is always rejected
      if (node.incomingBranchId === null) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [node.id], {
          reason: "BRANCH_SPLIT has null incomingBranchId",
        }));
        continue;
      }

      const incomingBranch = branchMap.get(node.incomingBranchId);
      if (!incomingBranch) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [node.id], {
          reason: "BRANCH_SPLIT incomingBranchId references nonexistent branch",
        }));
        continue;
      }

      // Validate the split node point lies on the incoming branch's Bezier curve
      const parentSamples = sampledCurves.get(incomingBranch.id) ?? [];
      if (parentSamples.length > 0) {
        let minDistToCurve = Infinity;
        for (const sp of parentSamples) {
          minDistToCurve = Math.min(minDistToCurve, distance(node.point, sp));
        }
        if (minDistToCurve > 5.0) {
          invalidBranchCount += 1;
          issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [node.id, incomingBranch.id], {
            reason: "BRANCH_SPLIT point does not lie on incoming branch Bezier",
          }));
        }
      }

      // Validate outgoing children exist
      if (node.outgoingBranchIds.length === 0) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [node.id], {
          reason: "BRANCH_SPLIT has zero outgoing children",
        }));
      }

      // Validate each outgoing child exists and starts at this node
      for (const childId of node.outgoingBranchIds) {
        const child = branchMap.get(childId);
        if (!child) {
          invalidBranchCount += 1;
          issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [node.id], {
            reason: "BRANCH_SPLIT outgoingBranchIds references nonexistent child",
          }));
        } else {
          if (child.startNodeId !== node.id) {
            invalidBranchCount += 1;
            issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [childId, node.id], {
              reason: "child branch startNodeId does not match split node id",
            }));
          }
          if (child.parentBranchId !== incomingBranch?.id) {
            invalidBranchCount += 1;
            issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [childId], {
              reason: "child parentBranchId does not match split node incomingBranchId",
            }));
          }
        }
      }
    }

    // ── 4. Non-root branch start node lies on parent curve ──
    for (const branch of plan.branches) {
      if (branch.parentBranchId === null) continue;
      const parent = branchMap.get(branch.parentBranchId);
      if (!parent) continue;
      const startNode = nodeMap.get(branch.startNodeId);
      if (!startNode) continue;

      // Skip if startNode is the parent's end node (single child, intentional connection)
      if (startNode.id === parent.endNodeId) continue;

      // This is an interior split; verify start point lies on parent Bezier
      const parentSamples = sampledCurves.get(parent.id) ?? [];
      if (parentSamples.length > 0) {
        let minDist = Infinity;
        for (const sp of parentSamples) {
          minDist = Math.min(minDist, distance(branch.startPoint, sp));
        }
        if (minDist > 5.0) {
          invalidBranchCount += 1;
          issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], {
            reason: "child branch startPoint does not lie on parent Bezier curve",
          }));
        }
      }
    }

    // ── 5. Intersection check ──
    const branchesArray = plan.branches;
    for (let left = 0; left < branchesArray.length; left += 1) {
      const leftBranch = branchesArray[left]!;
      const leftSamples = sampledCurves.get(leftBranch.id) ?? [];
      const leftB = branchBoundsList[left]!;
      for (let right = left + 1; right < branchesArray.length; right += 1) {
        const rightBranch = branchesArray[right]!;
        const rightSamples = sampledCurves.get(rightBranch.id) ?? [];
        const rightB = branchBoundsList[right]!;
        if (!boundsOverlap(leftB, rightB, 4)) continue;
        if (connectedPairs.has(pairKey(leftBranch.id, rightBranch.id))) continue;
        let found = false;
        for (let li = 0; li < leftSamples.length - 1 && !found; li += 1) {
          const la = leftSamples[li]!;
          const lb = leftSamples[li + 1]!;
          for (let ri = 0; ri < rightSamples.length - 1 && !found; ri += 1) {
            const ra = rightSamples[ri]!;
            const rb = rightSamples[ri + 1]!;
            const segResult = intersectSegments(la, lb, ra, rb, { epsilon: EPSILON });
            if (segResult.kind === "PROPER" || segResult.kind === "COLLINEAR_OVERLAP") found = true;
          }
        }
        if (found) {
          intersectionCount += 1;
          issues.push(issue("SKELETON_BRANCH_INTERSECTION", "VALIDATE_SKELETON", "skeleton.branchIntersection", [leftBranch.id, rightBranch.id]));
        }
      }
    }

    // ── 6. Trunk checks ──
    for (const trunkBranchId of plan.trunk.segments) {
      if (!branchMap.has(trunkBranchId)) {
        issues.push(issue("SKELETON_TRUNK_INVALID", "VALIDATE_SKELETON", "skeleton.trunkInvalid", [trunkBranchId]));
      }
    }
    if (!nodeMap.has(plan.trunk.baseNodeId)) {
      issues.push(issue("SKELETON_TRUNK_INVALID", "VALIDATE_SKELETON", "skeleton.trunkInvalid", [], { reason: "baseNodeId not found" }));
    }

    // ── 7. Bidirectional topology ──
    for (const branch of plan.branches) {
      for (const childId of branch.childrenBranchIds) {
        const child = branchMap.get(childId);
        if (!child) {
          invalidBranchCount += 1;
          issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], { reason: "childrenBranchIds references nonexistent branch" }));
        } else if (child.parentBranchId !== branch.id) {
          invalidBranchCount += 1;
          issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id, childId], { reason: "child.parentBranchId does not match parent" }));
        }
      }
      const uniqueChildren = new Set(branch.childrenBranchIds);
      if (uniqueChildren.size !== branch.childrenBranchIds.length) {
        invalidBranchCount += 1;
        issues.push(issue("SKELETON_BRANCH_INVALID", "VALIDATE_SKELETON", "skeleton.branchInvalid", [branch.id], { reason: "duplicate child reference" }));
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
      connectedPersonCount: plan.branches.filter((b) => b.parentBranchId !== null || b.generation === 0).length,
    };

    return { accepted: issues.length === 0, issues: Object.freeze(issues), metrics };
  }
}
