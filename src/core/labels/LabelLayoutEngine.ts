import { sampleCubicBezier } from "../geometry/bezier.js";
import type { Bounds, Vec2 } from "../geometry/types.js";
import type { SkeletonBranch } from "../skeleton/types.js";
import { LabelAssignmentEngine } from "./LabelAssignmentEngine.js";
import { LabelCandidateGenerator } from "./LabelCandidateGenerator.js";
import type {
  LabelLayoutDiagnostic,
  LabelLayoutInput,
  LabelLayoutResult,
  LabelObstacle,
  RejectedLabelCandidate,
} from "./types.js";

const MAX_WOOD_SAMPLE_STEP = 8;

const interpolate = (start: Vec2, end: Vec2, ratio: number): Vec2 => ({
  x: start.x + (end.x - start.x) * ratio,
  y: start.y + (end.y - start.y) * ratio,
});

const densifyPolyline = (points: readonly Vec2[]): readonly Vec2[] => {
  if (points.length < 2) return points;
  const result: Vec2[] = [points[0] as Vec2];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1] as Vec2;
    const end = points[index] as Vec2;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(distance / MAX_WOOD_SAMPLE_STEP));
    for (let step = 1; step <= steps; step += 1) {
      result.push(interpolate(start, end, step / steps));
    }
  }
  return result;
};

const pointBounds = (point: Vec2, radius: number): Bounds => ({
  minX: point.x - radius,
  minY: point.y - radius,
  maxX: point.x + radius,
  maxY: point.y + radius,
});

export const buildBranchWoodObstacles = (
  branch: SkeletonBranch,
  barkAllowance: number,
  tolerance: number,
  maxSubdivisionDepth: number,
): readonly LabelObstacle[] => {
  const samples = densifyPolyline(sampleCubicBezier(branch.curve, {
    tolerance,
    maxSubdivisionDepth,
  }));
  return samples.map((point, index) => {
    const progress = samples.length <= 1 ? 1 : index / (samples.length - 1);
    const thickness =
      branch.thickness.baseThickness +
      (branch.thickness.tipThickness - branch.thickness.baseThickness) * progress;
    return {
      obstacleId: `wood:${branch.id}:${index}`,
      bounds: pointBounds(point, thickness / 2 + barkAllowance),
      kind: "WOOD",
    };
  });
};

export const buildSkeletonWoodObstacles = (
  branches: readonly SkeletonBranch[],
  barkAllowance: number,
  tolerance: number,
  maxSubdivisionDepth: number,
): readonly LabelObstacle[] =>
  [...branches]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((branch) =>
      buildBranchWoodObstacles(
        branch,
        barkAllowance,
        tolerance,
        maxSubdivisionDepth,
      ),
    );

export class LabelLayoutEngine {
  layout(input: LabelLayoutInput): LabelLayoutResult {
    if (input.skeletonPlan.status !== "ACCEPTED") {
      throw new TypeError("Label layout requires an accepted skeleton plan");
    }
    if (!input.graph.personsById.has(input.skeletonPlan.selectedRootId)) {
      throw new TypeError("Skeleton selected root is missing from the genealogy graph");
    }

    const generation = new LabelCandidateGenerator().generate(input);
    const obstacles = buildSkeletonWoodObstacles(
      input.skeletonPlan.branches,
      input.configuration.collision.barkAllowance,
      input.configuration.geometry.bezierSubdivisionTolerance,
      input.configuration.geometry.maxSubdivisionDepth,
    );
    const assignment = new LabelAssignmentEngine().assign({
      candidates: generation.candidates,
      obstacles,
      clearance: input.configuration.collision.labelClearance / 2,
    });
    const rejected: RejectedLabelCandidate[] = [
      ...generation.rejected,
      ...assignment.rejected,
    ];
    const expectedPeople = [...new Set(
      input.skeletonPlan.branches.map((branch) => branch.ownerPersonId),
    )].sort((left, right) => left.localeCompare(right));
    const placedPeople = new Set(assignment.placements.map((placement) => placement.personId));
    const unresolvedPersonIds = expectedPeople.filter((personId) => !placedPeople.has(personId));
    const diagnostics: LabelLayoutDiagnostic[] = unresolvedPersonIds.map((personId) => {
      const personRejected = rejected.filter((item) => item.personId === personId);
      return {
        code: "LABEL_UNRESOLVED",
        severity: "WARNING",
        personId,
        candidateCount: generation.candidates.filter(
          (candidate) => candidate.personId === personId,
        ).length,
        rejectedCandidateCount: personRejected.length,
        collisionIds: [...new Set(personRejected.flatMap((item) => item.collisionIds))].sort(),
      };
    });

    return Object.freeze({
      status: unresolvedPersonIds.length === 0 ? "ACCEPTED" : "PARTIAL",
      placements: Object.freeze([...assignment.placements]),
      candidates: Object.freeze([...generation.candidates]),
      rejected: Object.freeze(rejected),
      unresolvedPersonIds: Object.freeze(unresolvedPersonIds),
      diagnostics: Object.freeze(diagnostics),
      metrics: Object.freeze({
        requestedPersonCount: expectedPeople.length,
        candidateCount: generation.candidates.length,
        placedLabelCount: assignment.placements.length,
        unresolvedLabelCount: unresolvedPersonIds.length,
        woodObstacleCount: obstacles.length,
        boundaryRejectedCandidateCount: generation.rejected.length,
        collisionRejectedCandidateCount: assignment.rejected.filter(
          (item) => item.reason === "COLLISION",
        ).length,
      }),
    });
  }
}
