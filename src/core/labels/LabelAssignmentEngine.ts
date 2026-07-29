import type { PersonId } from "../contracts/identifiers.js";
import { LabelCollisionQuery } from "./LabelCollisionQuery.js";
import type {
  LabelAssignmentInput,
  LabelAssignmentResult,
  LabelCandidate,
  LabelPlacement,
  RejectedLabelCandidate,
} from "./types.js";

const compareCandidates = (left: LabelCandidate, right: LabelCandidate): number =>
  left.personId.localeCompare(right.personId) ||
  right.score - left.score ||
  left.ordinal - right.ordinal ||
  left.candidateId.localeCompare(right.candidateId);

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

export class LabelAssignmentEngine {
  assign(input: LabelAssignmentInput): LabelAssignmentResult {
    const queryOptions: { cellSize?: number; clearance?: number } = {};
    if (input.cellSize !== undefined) queryOptions.cellSize = input.cellSize;
    if (input.clearance !== undefined) queryOptions.clearance = input.clearance;
    const query = new LabelCollisionQuery(queryOptions);
    for (const obstacle of [...(input.obstacles ?? [])].sort((a, b) =>
      a.obstacleId.localeCompare(b.obstacleId),
    )) {
      query.addObstacle(obstacle);
    }

    const placements: LabelPlacement[] = [];
    const assignedPeople = new Set<PersonId>();
    for (const placement of [...(input.fixedPlacements ?? [])].sort((a, b) =>
      a.placementId.localeCompare(b.placementId),
    )) {
      if (assignedPeople.has(placement.personId)) {
        throw new Error(`Duplicate fixed label placement for person: ${placement.personId}`);
      }
      query.addPlacement(placement);
      placements.push(placement);
      assignedPeople.add(placement.personId);
    }

    const rejected: RejectedLabelCandidate[] = [];
    const seenCandidateIds = new Set<string>();
    const candidates = [...input.candidates].sort(compareCandidates);
    const allPeople = new Set<PersonId>(candidates.map((candidate) => candidate.personId));

    for (const candidate of candidates) {
      if (seenCandidateIds.has(candidate.candidateId)) {
        rejected.push({
          candidateId: candidate.candidateId,
          personId: candidate.personId,
          reason: "DUPLICATE_CANDIDATE_ID",
          collisionIds: [],
        });
        continue;
      }
      seenCandidateIds.add(candidate.candidateId);

      if (assignedPeople.has(candidate.personId)) {
        rejected.push({
          candidateId: candidate.candidateId,
          personId: candidate.personId,
          reason: "PERSON_ALREADY_ASSIGNED",
          collisionIds: [],
        });
        continue;
      }

      const collisions = query.collisions(candidate.bounds);
      if (collisions.length > 0) {
        rejected.push({
          candidateId: candidate.candidateId,
          personId: candidate.personId,
          reason: "COLLISION",
          collisionIds: collisions.map((collision) => collision.id),
        });
        continue;
      }

      const placement = toPlacement(candidate);
      query.addPlacement(placement);
      placements.push(placement);
      assignedPeople.add(candidate.personId);
    }

    return {
      placements: placements.sort((a, b) => a.personId.localeCompare(b.personId)),
      rejected,
      unassignedPersonIds: [...allPeople]
        .filter((personId) => !assignedPeople.has(personId))
        .sort((a, b) => a.localeCompare(b)),
    };
  }
}
