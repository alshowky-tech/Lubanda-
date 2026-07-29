import { cubicBezierTangent, evaluateCubicBezier } from "../geometry/bezier.js";
import { boundsContainPoint, expandBounds } from "../geometry/bounds.js";
import { classifyPointInPolygon } from "../geometry/polygon.js";
import { intersectSegments } from "../geometry/segments.js";
import type { Bounds, Polygon, Vec2 } from "../geometry/types.js";
import { add, normalize, scale } from "../geometry/vec2.js";
import type { SkeletonBranch } from "../skeleton/types.js";
import type {
  LabelCandidate,
  LabelCandidateGenerationResult,
  LabelLayoutInput,
  RejectedLabelCandidate,
} from "./types.js";

const DIRECTIONS = [
  { id: "forward", tangent: 1, normal: 0, score: 100 },
  { id: "forward-left", tangent: 1, normal: 1, score: 90 },
  { id: "forward-right", tangent: 1, normal: -1, score: 80 },
  { id: "left", tangent: 0, normal: 1, score: 70 },
  { id: "right", tangent: 0, normal: -1, score: 60 },
  { id: "back-left", tangent: -1, normal: 1, score: 50 },
  { id: "back-right", tangent: -1, normal: -1, score: 40 },
  { id: "back", tangent: -1, normal: 0, score: 30 },
] as const;

const ANCHOR_SITES = [
  { id: "tip", parameter: 1, scoreAdjustment: 0 },
  { id: "upper", parameter: 0.75, scoreAdjustment: -10 },
  { id: "middle", parameter: 0.5, scoreAdjustment: -20 },
] as const;

const rectangleCorners = (bounds: Bounds): readonly Vec2[] => [
  { x: bounds.minX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.maxY },
  { x: bounds.minX, y: bounds.maxY },
];

export const boundsInsidePolygon = (bounds: Bounds, polygon: Polygon): boolean => {
  const corners = rectangleCorners(bounds);
  if (corners.some((corner) => classifyPointInPolygon(corner, polygon) === "OUTSIDE")) {
    return false;
  }

  const rectangleEdges = corners.map((corner, index) => [
    corner,
    corners[(index + 1) % corners.length] as Vec2,
  ] as const);
  for (let index = 0; index < polygon.points.length; index += 1) {
    const start = polygon.points[index] as Vec2;
    const end = polygon.points[(index + 1) % polygon.points.length] as Vec2;
    for (const [left, right] of rectangleEdges) {
      if (intersectSegments(left, right, start, end).kind === "PROPER") return false;
    }
  }

  // A concave boundary can enter the label rectangle while every label corner
  // remains inside. Detect that case explicitly.
  return !polygon.points.some((point) =>
    point.x > bounds.minX &&
    point.x < bounds.maxX &&
    point.y > bounds.minY &&
    point.y < bounds.maxY &&
    boundsContainPoint(bounds, point),
  );
};

const safeTangent = (branch: SkeletonBranch, parameter: number): Vec2 => {
  try {
    return normalize(cubicBezierTangent(branch.curve, parameter));
  } catch {
    const fallback = {
      x: branch.endPoint.x - branch.startPoint.x,
      y: branch.endPoint.y - branch.startPoint.y,
    };
    try {
      return normalize(fallback);
    } catch {
      return { x: 0, y: -1 };
    }
  }
};

const rotatedBounds = (
  anchor: Vec2,
  width: number,
  height: number,
  rotationDegrees: number,
): Bounds => {
  const radians = Math.abs(rotationDegrees) * Math.PI / 180;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const extentX = Math.abs(Math.cos(radians)) * halfWidth +
    Math.abs(Math.sin(radians)) * halfHeight;
  const extentY = Math.abs(Math.sin(radians)) * halfWidth +
    Math.abs(Math.cos(radians)) * halfHeight;
  return {
    minX: anchor.x - extentX,
    minY: anchor.y - extentY,
    maxX: anchor.x + extentX,
    maxY: anchor.y + extentY,
  };
};

const rotatedHalfExtents = (
  width: number,
  height: number,
  rotationDegrees: number,
): Vec2 => {
  const radians = Math.abs(rotationDegrees) * Math.PI / 180;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return {
    x: Math.abs(Math.cos(radians)) * halfWidth +
      Math.abs(Math.sin(radians)) * halfHeight,
    y: Math.abs(Math.sin(radians)) * halfWidth +
      Math.abs(Math.cos(radians)) * halfHeight,
  };
};

const extentAlong = (axis: Vec2, halfExtents: Vec2): number =>
  Math.abs(axis.x) * halfExtents.x + Math.abs(axis.y) * halfExtents.y;

const readableRotation = (tangent: Vec2, maximumRotationDegrees: number): number => {
  let angle = Math.atan2(tangent.y, tangent.x) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return Math.max(-maximumRotationDegrees, Math.min(maximumRotationDegrees, angle));
};

export class LabelCandidateGenerator {
  generate(input: LabelLayoutInput): LabelCandidateGenerationResult {
    const { configuration, graph, skeletonPlan, templatePolygon } = input;
    const candidates: LabelCandidate[] = [];
    const rejected: RejectedLabelCandidate[] = [];
    const terminalBranchByPerson = new Map<string, SkeletonBranch>();
    for (const branch of skeletonPlan.branches) {
      const current = terminalBranchByPerson.get(branch.ownerPersonId);
      if (
        !current ||
        branch.metadata.branchIndex > current.metadata.branchIndex ||
        (
          branch.metadata.branchIndex === current.metadata.branchIndex &&
          branch.id.localeCompare(current.id) > 0
        )
      ) {
        terminalBranchByPerson.set(branch.ownerPersonId, branch);
      }
    }
    const branches = [...terminalBranchByPerson.values()].sort((left, right) =>
      left.ownerPersonId.localeCompare(right.ownerPersonId),
    );

    for (const branch of branches) {
      const person = graph.personsById.get(branch.ownerPersonId);
      if (!person) {
        throw new RangeError(`Skeleton branch references unknown person: ${branch.ownerPersonId}`);
      }

      const fontSize = configuration.labels.minimumFontSize;
      const width = Math.max(
        fontSize * 2,
        [...person.name].length * configuration.demand.estimatedCharacterWidth +
          configuration.demand.personPadding * 2,
      );
      const height = Math.max(
        fontSize,
        configuration.demand.estimatedLabelHeight +
          configuration.demand.personPadding * 2,
      );
      ANCHOR_SITES.forEach((site, siteIndex) => {
        const origin = evaluateCubicBezier(branch.curve, site.parameter);
        const tangent = safeTangent(branch, site.parameter);
        const normal = { x: -tangent.y, y: tangent.x };
        const branchThickness =
          branch.thickness.baseThickness +
          (branch.thickness.tipThickness - branch.thickness.baseThickness) *
            site.parameter;
        const woodRadius = branchThickness / 2 + configuration.collision.barkAllowance;
        const clearance = configuration.collision.labelClearance + 1;
        const rotationDegrees = readableRotation(
          tangent,
          configuration.labels.maximumRotationDegrees,
        );
        const halfExtents = rotatedHalfExtents(width, height, rotationDegrees);
        const tangentDistance =
          extentAlong(tangent, halfExtents) + woodRadius + clearance;
        const normalDistance =
          extentAlong(normal, halfExtents) + woodRadius + clearance;

        DIRECTIONS.forEach((direction, directionIndex) => {
          const anchor = add(
            origin,
            add(
              scale(tangent, direction.tangent * tangentDistance),
              scale(normal, direction.normal * normalDistance),
            ),
          );
          const candidate: LabelCandidate = {
            candidateId:
              `label-candidate:${branch.ownerPersonId}:${site.id}:${direction.id}`,
            personId: branch.ownerPersonId,
            sourceBranchId: branch.id,
            anchor,
            bounds: rotatedBounds(anchor, width, height, rotationDegrees),
            rotationDegrees,
            fontSize,
            score: direction.score + site.scoreAdjustment,
            ordinal: siteIndex * DIRECTIONS.length + directionIndex,
          };
          const boundarySafeBounds = expandBounds(
            candidate.bounds,
            configuration.collision.labelClearance,
          );
          if (boundsInsidePolygon(boundarySafeBounds, templatePolygon)) {
            candidates.push(candidate);
          } else {
            rejected.push({
              candidateId: candidate.candidateId,
              personId: candidate.personId,
              reason: "OUT_OF_BOUNDS",
              collisionIds: ["boundary:template"],
            });
          }
        });
      });
    }

    return {
      candidates: Object.freeze(candidates),
      rejected: Object.freeze(rejected),
    };
  }
}
