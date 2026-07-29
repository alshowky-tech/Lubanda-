import type { EngineConfiguration } from "../config/types.js";
import type { PersonId } from "../contracts/identifiers.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import { boundsFromPoints, expandBounds } from "../geometry/bounds.js";
import { classifyPointInPolygon } from "../geometry/polygon.js";
import type { Bounds, Polygon, Vec2 } from "../geometry/types.js";
import type { SkeletonBranch } from "../skeleton/types.js";
import { boundsInsidePolygon } from "./LabelCandidateGenerator.js";
import { LabelCollisionQuery } from "./LabelCollisionQuery.js";
import { measureLabelText } from "./LabelTextMetrics.js";
import type {
  LabelCandidate,
  LabelObstacle,
  LabelPlacement,
  RejectedLabelCandidate,
} from "./types.js";

const POSITION_EPSILON = 1e-6;
const MAX_LANE_ATTEMPTS = 512;
const MAX_UNRESOLVED_EVIDENCE = 16;

export interface LabelFallbackInput {
  readonly graph: GenealogyGraph;
  readonly branches: readonly SkeletonBranch[];
  readonly templatePolygon: Polygon;
  readonly configuration: EngineConfiguration;
  readonly unresolvedPersonIds: readonly PersonId[];
  readonly fixedPlacements: readonly LabelPlacement[];
  readonly obstacles: readonly LabelObstacle[];
}

export interface LabelFallbackResult {
  readonly candidates: readonly LabelCandidate[];
  readonly placements: readonly LabelPlacement[];
  readonly rejected: readonly RejectedLabelCandidate[];
  readonly unresolvedPersonIds: readonly PersonId[];
}

const centeredBounds = (
  center: Vec2,
  dimensions: Pick<ReturnType<typeof measureLabelText>, "width" | "height">,
): Bounds => ({
  minX: center.x - dimensions.width / 2,
  minY: center.y - dimensions.height / 2,
  maxX: center.x + dimensions.width / 2,
  maxY: center.y + dimensions.height / 2,
});

const terminalBranchesByPerson = (
  branches: readonly SkeletonBranch[],
): ReadonlyMap<PersonId, SkeletonBranch> => {
  const result = new Map<PersonId, SkeletonBranch>();
  for (const branch of branches) {
    const current = result.get(branch.ownerPersonId);
    if (
      current === undefined ||
      branch.metadata.branchIndex > current.metadata.branchIndex ||
      (
        branch.metadata.branchIndex === current.metadata.branchIndex &&
        branch.id.localeCompare(current.id) > 0
      )
    ) {
      result.set(branch.ownerPersonId, branch);
    }
  }
  return result;
};

const laneCenters = (
  polygonBounds: Bounds,
  height: number,
  clearance: number,
): readonly number[] => {
  const minimumY = polygonBounds.minY + clearance + height / 2;
  const maximumY = polygonBounds.maxY - clearance - height / 2;
  if (minimumY > maximumY) return [];
  const step = height + clearance * 2;
  const centers: number[] = [];
  for (let y = minimumY; y <= maximumY + POSITION_EPSILON; y += step) {
    centers.push(Math.min(y, maximumY));
  }
  if (
    centers.length > 0 &&
    maximumY - (centers[centers.length - 1] as number) >
      clearance + POSITION_EPSILON
  ) {
    centers.push(maximumY);
  }
  return centers;
};

const toPlacement = (candidate: LabelCandidate): LabelPlacement => ({
  placementId: `label:${candidate.personId}`,
  candidateId: candidate.candidateId,
  personId: candidate.personId,
  displayName: candidate.displayName,
  anchor: { ...candidate.anchor },
  bounds: { ...candidate.bounds },
  rotationDegrees: candidate.rotationDegrees,
  fontSize: candidate.fontSize,
  score: candidate.score,
});

/**
 * Packs labels that exhausted their local branch candidates into deterministic
 * horizontal lanes. Every accepted fallback remains inside the template and
 * is checked against both sampled wood and already placed labels.
 */
export class LabelFallbackPlanner {
  plan(input: LabelFallbackInput): LabelFallbackResult {
    const {
      configuration,
      graph,
      templatePolygon,
      unresolvedPersonIds,
    } = input;
    const clearance = configuration.collision.labelClearance;
    const collisionClearance = clearance / 2;
    const polygonBounds = boundsFromPoints(templatePolygon.points);
    const branchesByPerson = terminalBranchesByPerson(input.branches);
    const query = new LabelCollisionQuery({
      clearance: collisionClearance,
    });
    for (const obstacle of [...input.obstacles].sort((left, right) =>
      left.obstacleId.localeCompare(right.obstacleId),
    )) {
      query.addObstacle(obstacle);
    }
    for (const placement of [...input.fixedPlacements].sort((left, right) =>
      left.placementId.localeCompare(right.placementId),
    )) {
      query.addPlacement(placement);
    }

    const people = unresolvedPersonIds
      .map((personId) => {
        const person = graph.personsById.get(personId);
        const branch = branchesByPerson.get(personId);
        if (person === undefined || branch === undefined) return null;
        return {
          personId,
          branch,
          dimensions: measureLabelText(person.name, configuration),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((left, right) =>
        right.dimensions.width - left.dimensions.width ||
        left.personId.localeCompare(right.personId),
      );

    const candidates: LabelCandidate[] = [];
    const placements: LabelPlacement[] = [];
    const rejectionEvidence = new Map<PersonId, RejectedLabelCandidate[]>();
    const assignedPeople = new Set<PersonId>();
    const laneCursorByY = new Map<number, number>();

    for (const item of people) {
      const preferred = item.branch.endPoint;
      if (classifyPointInPolygon(preferred, templatePolygon) === "OUTSIDE") {
        continue;
      }
      const halfWidth = item.dimensions.width / 2;
      const minimumX = polygonBounds.minX + clearance + halfWidth;
      const maximumX = polygonBounds.maxX - clearance - halfWidth;
      if (minimumX > maximumX) continue;
      const lanes = [...laneCenters(
        polygonBounds,
        item.dimensions.height,
        clearance,
      )].sort((left, right) =>
        Math.abs(left - preferred.y) - Math.abs(right - preferred.y) ||
        left - right,
      );
      let candidateOrdinal = 24;

      for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
        const y = lanes[laneIndex] as number;
        const laneCursor =
          laneCursorByY.get(y) ?? polygonBounds.minX + clearance;
        let x = Math.max(minimumX, laneCursor + halfWidth);
        let attempts = 0;

        while (x <= maximumX && attempts < MAX_LANE_ATTEMPTS) {
          const bounds = centeredBounds(
            { x, y },
            item.dimensions,
          );
          const candidate: LabelCandidate = {
            candidateId:
              `label-candidate:${item.personId}:fallback:${laneIndex}:${candidateOrdinal}`,
            personId: item.personId,
            displayName: item.dimensions.displayName,
            sourceBranchId: item.branch.id,
            anchor: { x, y },
            bounds,
            rotationDegrees: 0,
            fontSize: configuration.labels.minimumFontSize,
            score:
              -1_000 -
              Math.hypot(x - preferred.x, y - preferred.y),
            ordinal: candidateOrdinal,
          };
          candidateOrdinal += 1;
          attempts += 1;

          if (
            !boundsInsidePolygon(
              expandBounds(bounds, clearance),
              templatePolygon,
            )
          ) {
            const evidence = rejectionEvidence.get(item.personId) ?? [];
            if (evidence.length < MAX_UNRESOLVED_EVIDENCE) evidence.push({
              candidateId: candidate.candidateId,
              personId: candidate.personId,
              reason: "OUT_OF_BOUNDS",
              collisionIds: ["boundary:template"],
            });
            rejectionEvidence.set(item.personId, evidence);
            x += item.dimensions.width + clearance;
            continue;
          }

          const collisions = query.collisions(bounds);
          if (collisions.length === 0) {
            candidates.push(candidate);
            const placement = toPlacement(candidate);
            query.addPlacement(placement);
            placements.push(placement);
            assignedPeople.add(item.personId);
            laneCursorByY.set(y, bounds.maxX + clearance);
            rejectionEvidence.delete(item.personId);
            break;
          }

          const evidence = rejectionEvidence.get(item.personId) ?? [];
          if (evidence.length < MAX_UNRESOLVED_EVIDENCE) evidence.push({
            candidateId: candidate.candidateId,
            personId: candidate.personId,
            reason: "COLLISION",
            collisionIds: collisions.map((collision) => collision.id),
          });
          rejectionEvidence.set(item.personId, evidence);
          x = Math.max(
            ...collisions.map(
              (collision) =>
                collision.bounds.maxX +
                halfWidth +
                collisionClearance +
                POSITION_EPSILON,
            ),
          );
        }
        if (assignedPeople.has(item.personId)) break;
      }
    }

    return {
      candidates: Object.freeze(candidates),
      placements: Object.freeze(
        placements.sort((left, right) =>
          left.personId.localeCompare(right.personId),
        ),
      ),
      rejected: Object.freeze(
        [...rejectionEvidence.values()]
          .flat()
          .sort((left, right) =>
            left.personId.localeCompare(right.personId) ||
            left.candidateId.localeCompare(right.candidateId),
          ),
      ),
      unresolvedPersonIds: Object.freeze(
        unresolvedPersonIds
          .filter((personId) => !assignedPeople.has(personId))
          .sort((left, right) => left.localeCompare(right)),
      ),
    };
  }
}
