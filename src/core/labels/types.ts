import type { PersonId } from "../contracts/identifiers.js";
import type { Bounds, Vec2 } from "../geometry/types.js";

export type LabelCandidateId = string;
export type LabelPlacementId = string;

export interface LabelCandidate {
  readonly candidateId: LabelCandidateId;
  readonly personId: PersonId;
  readonly anchor: Vec2;
  readonly bounds: Bounds;
  readonly rotationDegrees: number;
  readonly fontSize: number;
  readonly score: number;
  readonly ordinal: number;
}

export interface LabelPlacement {
  readonly placementId: LabelPlacementId;
  readonly candidateId: LabelCandidateId;
  readonly personId: PersonId;
  readonly anchor: Vec2;
  readonly bounds: Bounds;
  readonly rotationDegrees: number;
  readonly fontSize: number;
  readonly score: number;
}

export interface LabelObstacle {
  readonly obstacleId: string;
  readonly bounds: Bounds;
  readonly kind: "WOOD" | "LABEL" | "RESERVED";
}

export interface LabelCollision {
  readonly id: string;
  readonly kind: LabelObstacle["kind"];
  readonly bounds: Bounds;
}

export interface LabelAssignmentInput {
  readonly candidates: readonly LabelCandidate[];
  readonly fixedPlacements?: readonly LabelPlacement[];
  readonly obstacles?: readonly LabelObstacle[];
  readonly clearance?: number;
  readonly cellSize?: number;
}

export interface RejectedLabelCandidate {
  readonly candidateId: LabelCandidateId;
  readonly personId: PersonId;
  readonly reason: "COLLISION" | "DUPLICATE_CANDIDATE_ID" | "PERSON_ALREADY_ASSIGNED";
  readonly collisionIds: readonly string[];
}

export interface LabelAssignmentResult {
  readonly placements: readonly LabelPlacement[];
  readonly rejected: readonly RejectedLabelCandidate[];
  readonly unassignedPersonIds: readonly PersonId[];
}
