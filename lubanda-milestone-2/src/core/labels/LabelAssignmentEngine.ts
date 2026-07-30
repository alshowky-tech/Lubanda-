import { canonicalJson } from "../determinism/canonical-json.js";
import type { LabelConfig } from "../config/types.js";
import type { PersonId } from "../contracts/identifiers.js";
import type { Bounds, Vec2 } from "../geometry/types.js";
import type { SkeletonPlan } from "../skeleton/types.js";
import { DefaultLabelCollisionQuery, type LabelCollisionQuery } from "./LabelCollisionQuery.js";
import type {
  GeneratedCandidatesResult,
  LabelCandidate,
  LabelCandidateFamily,
  LabelLayoutMetrics,
  LabelPlacement,
  UnresolvedLabelReason,
} from "./types.js";

const FAMILY_PRIORITY: Readonly<Record<LabelCandidateFamily, number>> = Object.freeze({
  ALIGNED_WITH_BRANCH: 1,
  OFFSET_ABOVE_BRANCH: 2,
  OFFSET_BELOW_BRANCH: 3,
  LATERAL: 4,
  TERMINAL_LEAF: 5,
  CARTOUCHE_ZONE: 6,
});

export interface LabelAssignmentInput {
  readonly skeletonPlan: SkeletonPlan;
  readonly generatedCandidates: GeneratedCandidatesResult;
  readonly configuration: LabelConfig;
  readonly collisionQuery?: LabelCollisionQuery;
}

export interface LabelAssignmentResult {
  readonly placements: readonly LabelPlacement[];
  readonly unplacedPersons: readonly UnresolvedLabelReason[];
  readonly metrics: LabelLayoutMetrics;
  readonly deterministicFingerprint?: string;
}

export interface DecisionFrame {
  readonly personId: PersonId;
  readonly selectedCandidateIndex: number;
  readonly nextCandidateIndex: number;
  readonly placement: LabelPlacement;
}

interface OrderedPerson {
  readonly personId: PersonId;
  readonly validCandidateCount: number;
  readonly staticConflictDegree: number;
  readonly generation: number;
}

interface OrderedCandidate {
  readonly candidate: LabelCandidate;
  readonly originalIndex: number;
  readonly candidateId: string;
}

interface BacktrackResult {
  readonly foundAlternative: boolean;
  readonly exhaustedBudget: boolean;
  readonly poppedFrameCount: number;
  readonly displacedPersons: readonly PersonId[];
}

interface AssignmentState {
  readonly placements: LabelPlacement[];
  readonly decisionStack: DecisionFrame[];
  readonly orderedCandidatesByPerson: ReadonlyMap<PersonId, readonly OrderedCandidate[]>;
  readonly collisionQuery: LabelCollisionQuery;
}

export const assignCandidates = (input: LabelAssignmentInput): LabelAssignmentResult => {
  const maximumBacktrackDepth = normalizedBacktrackDepth(input.configuration);
  const collisionQuery = input.collisionQuery ?? new DefaultLabelCollisionQuery();
  const orderedCandidatesByPerson = buildCandidateOrders(input.generatedCandidates.personCandidateMap);
  const personOrder = buildPersonOrder(input.skeletonPlan, orderedCandidatesByPerson, collisionQuery);

  const state: AssignmentState = {
    placements: [],
    decisionStack: [],
    orderedCandidatesByPerson,
    collisionQuery,
  };
  const personOrderIndex = buildPersonOrderIndex(personOrder);
  const unplacedByPerson = new Map<PersonId, UnresolvedLabelReason>();

  for (const person of personOrder) {
    if (hasPlacementForPerson(state.placements, person.personId) || unplacedByPerson.has(person.personId)) {
      continue;
    }

    const orderedCandidates = orderedCandidatesByPerson.get(person.personId) ?? [];
    if (orderedCandidates.length === 0) {
      unplacedByPerson.set(person.personId, makeUnplacedReason(
        person.personId,
        "NO_CANDIDATES_GENERATED",
        0,
      ));
      continue;
    }

    assignPersonWithBacktracking(
      person.personId,
      state,
      maximumBacktrackDepth,
      personOrderIndex,
      unplacedByPerson,
      new Set<PersonId>(),
    );
  }

  const placements = Object.freeze([...state.placements].sort(comparePlacementByPersonId));
  const unplacedPersons = Object.freeze([...unplacedByPerson.values()].sort(compareUnresolvedByPersonId));
  const metrics = Object.freeze(buildMetrics(
    personOrder.length,
    placements,
    unplacedPersons,
    input.configuration.minimumFontSize,
  ));

  return Object.freeze({
    placements,
    unplacedPersons,
    metrics,
    deterministicFingerprint: canonicalJson({ placements, unplacedPersons }),
  });
};

export const buildCandidateOrder = (
  personId: PersonId,
  candidates: readonly LabelCandidate[],
): readonly OrderedCandidate[] => Object.freeze(candidates
  .map((candidate, originalIndex) => ({
    candidate,
    originalIndex,
    candidateId: getCandidateId(candidate, personId, originalIndex),
  }))
  .filter(({ candidate }) => candidate.validationStatus === "VALID")
  .sort(compareOrderedCandidates));

export const buildPersonOrder = (
  skeletonPlan: SkeletonPlan,
  orderedCandidatesByPerson: ReadonlyMap<PersonId, readonly OrderedCandidate[]>,
  collisionQuery: LabelCollisionQuery = new DefaultLabelCollisionQuery(),
): readonly OrderedPerson[] => {
  const generationByPerson = new Map<PersonId, number>();
  for (const branch of skeletonPlan.branches) {
    const current = generationByPerson.get(branch.ownerPersonId);
    if (current === undefined || branch.generation < current) {
      generationByPerson.set(branch.ownerPersonId, branch.generation);
    }
  }

  const personIds = new Set<PersonId>([
    ...generationByPerson.keys(),
    ...orderedCandidatesByPerson.keys(),
  ]);
  const staticConflictDegrees = computeStaticConflictDegrees([...personIds], orderedCandidatesByPerson, collisionQuery);

  return Object.freeze([...personIds]
    .map((personId): OrderedPerson => ({
      personId,
      validCandidateCount: orderedCandidatesByPerson.get(personId)?.length ?? 0,
      staticConflictDegree: staticConflictDegrees.get(personId)?.size ?? 0,
      generation: generationByPerson.get(personId) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort(compareOrderedPersons));
};

const assignPersonWithBacktracking = (
  personId: PersonId,
  state: AssignmentState,
  maximumBacktrackDepth: number,
  personOrderIndex: ReadonlyMap<PersonId, number>,
  unplacedByPerson: Map<PersonId, UnresolvedLabelReason>,
  activeReassignments: ReadonlySet<PersonId>,
): boolean => {
  if (hasPlacementForPerson(state.placements, personId)) return true;
  if (unplacedByPerson.has(personId)) return false;

  const orderedCandidates = state.orderedCandidatesByPerson.get(personId) ?? [];
  if (orderedCandidates.length === 0) {
    unplacedByPerson.set(personId, makeUnplacedReason(
      personId,
      "NO_CANDIDATES_GENERATED",
      0,
    ));
    return false;
  }

  if (placeFirstFittingCandidate(personId, 0, state)) return true;

  if (maximumBacktrackDepth === 0 || activeReassignments.has(personId)) {
    unplacedByPerson.set(personId, makeUnplacedReason(
      personId,
      "ALL_CANDIDATES_COLLIDE",
      orderedCandidates.length,
    ));
    return false;
  }

  let exhaustedBudget = false;
  let remainingBacktrackDepth = maximumBacktrackDepth;
  const nextActiveReassignments = new Set<PersonId>(activeReassignments);
  nextActiveReassignments.add(personId);

  while (remainingBacktrackDepth > 0) {
    const backtrack = backtrackChronologically(state, remainingBacktrackDepth);
    remainingBacktrackDepth -= backtrack.poppedFrameCount;
    exhaustedBudget = backtrack.exhaustedBudget || remainingBacktrackDepth <= 0;

    if (!backtrack.foundAlternative) break;

    for (const displacedPersonId of orderDisplacedPersons(backtrack.displacedPersons, personOrderIndex)) {
      if (hasPlacementForPerson(state.placements, displacedPersonId) || unplacedByPerson.has(displacedPersonId)) {
        continue;
      }
      assignPersonWithBacktracking(
        displacedPersonId,
        state,
        maximumBacktrackDepth,
        personOrderIndex,
        unplacedByPerson,
        nextActiveReassignments,
      );
    }

    if (placeFirstFittingCandidate(personId, 0, state)) return true;
    if (exhaustedBudget) break;
  }

  if (!unplacedByPerson.has(personId)) {
    unplacedByPerson.set(personId, makeUnplacedReason(
      personId,
      exhaustedBudget ? "BACKTRACK_EXHAUSTED" : "ALL_CANDIDATES_COLLIDE",
      orderedCandidates.length,
    ));
  }
  return false;
};

const buildPersonOrderIndex = (
  personOrder: readonly OrderedPerson[],
): ReadonlyMap<PersonId, number> => new Map(
  personOrder.map((person, index) => [person.personId, index]),
);

const orderDisplacedPersons = (
  displacedPersons: readonly PersonId[],
  personOrderIndex: ReadonlyMap<PersonId, number>,
): readonly PersonId[] => Object.freeze([...new Set(displacedPersons)].sort((left, right) => {
  const leftIndex = personOrderIndex.get(left) ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = personOrderIndex.get(right) ?? Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  return String(left).localeCompare(String(right), "en");
}));

const buildCandidateOrders = (
  personCandidateMap: ReadonlyMap<PersonId, readonly LabelCandidate[]>,
): ReadonlyMap<PersonId, readonly OrderedCandidate[]> => {
  const result = new Map<PersonId, readonly OrderedCandidate[]>();
  for (const [personId, candidates] of personCandidateMap) {
    result.set(personId, buildCandidateOrder(personId, candidates));
  }
  return result;
};

const normalizedBacktrackDepth = (configuration: LabelConfig): number => {
  const value = configuration.maximumBacktrackDepth;
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new TypeError("maximumBacktrackDepth must be an integer from 0 to 100 inclusive");
  }
  return value;
};

const compareOrderedPersons = (left: OrderedPerson, right: OrderedPerson): number => {
  if (left.validCandidateCount !== right.validCandidateCount) {
    return left.validCandidateCount - right.validCandidateCount;
  }
  if (left.staticConflictDegree !== right.staticConflictDegree) {
    return right.staticConflictDegree - left.staticConflictDegree;
  }
  if (left.generation !== right.generation) return left.generation - right.generation;
  return String(left.personId).localeCompare(String(right.personId), "en");
};

const compareOrderedCandidates = (left: OrderedCandidate, right: OrderedCandidate): number => {
  const scoreDiff = compareScoreDescending(left.candidate.score, right.candidate.score);
  if (scoreDiff !== 0) return scoreDiff;

  const familyDiff = FAMILY_PRIORITY[left.candidate.family] - FAMILY_PRIORITY[right.candidate.family];
  if (familyDiff !== 0) return familyDiff;

  if (left.candidate.leaderLength !== right.candidate.leaderLength) {
    return left.candidate.leaderLength - right.candidate.leaderLength;
  }

  const rotationDiff = Math.abs(left.candidate.rotation) - Math.abs(right.candidate.rotation);
  if (rotationDiff !== 0) return rotationDiff;

  if (left.originalIndex !== right.originalIndex) return left.originalIndex - right.originalIndex;
  return left.candidateId.localeCompare(right.candidateId, "en");
};

const compareScoreDescending = (left: number | null, right: number | null): number => {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
};

const computeStaticConflictDegrees = (
  personIds: readonly PersonId[],
  orderedCandidatesByPerson: ReadonlyMap<PersonId, readonly OrderedCandidate[]>,
  collisionQuery: LabelCollisionQuery,
): ReadonlyMap<PersonId, ReadonlySet<PersonId>> => {
  const result = new Map<PersonId, Set<PersonId>>();
  for (const personId of personIds) result.set(personId, new Set<PersonId>());

  for (let i = 0; i < personIds.length; i += 1) {
    const leftPersonId = personIds[i]!;
    const leftCandidates = orderedCandidatesByPerson.get(leftPersonId) ?? [];
    for (let j = i + 1; j < personIds.length; j += 1) {
      const rightPersonId = personIds[j]!;
      const rightCandidates = orderedCandidatesByPerson.get(rightPersonId) ?? [];
      if (personsHaveStaticConflict(leftCandidates, rightCandidates, collisionQuery)) {
        result.get(leftPersonId)!.add(rightPersonId);
        result.get(rightPersonId)!.add(leftPersonId);
      }
    }
  }

  return result;
};

const personsHaveStaticConflict = (
  leftCandidates: readonly OrderedCandidate[],
  rightCandidates: readonly OrderedCandidate[],
  collisionQuery: LabelCollisionQuery,
): boolean => {
  for (const left of leftCandidates) {
    for (const right of rightCandidates) {
      if (candidatesConflict(left.candidate, right.candidate, collisionQuery)) return true;
    }
  }
  return false;
};

const candidatesConflict = (
  left: LabelCandidate,
  right: LabelCandidate,
  collisionQuery: LabelCollisionQuery,
): boolean => {
  const rightPlacement = placementFromCandidate(right);
  const leftLeader = leaderSegmentForBounds(left.anchor, left.bounds);
  const rightLeader = leaderSegmentForBounds(right.anchor, right.bounds);

  return collisionQuery.overlapsPlacedLabel(left.bounds, rightPlacement) ||
    collisionQuery.leaderCrossesPlacedLabel(leftLeader.start, leftLeader.end, rightPlacement) ||
    collisionQuery.labelCrossesPlacedLeader(left.bounds, rightLeader.start, rightLeader.end) ||
    collisionQuery.leadersCross(leftLeader.start, leftLeader.end, rightLeader.start, rightLeader.end);
};

const placeFirstFittingCandidate = (
  personId: PersonId,
  startIndex: number,
  state: AssignmentState,
): boolean => {
  const candidates = state.orderedCandidatesByPerson.get(personId) ?? [];
  for (let index = startIndex; index < candidates.length; index += 1) {
    const ordered = candidates[index]!;
    const placement = placementFromCandidate(ordered.candidate);
    if (placementConflicts(placement, state.placements, state.collisionQuery)) continue;
    state.placements.push(placement);
    state.decisionStack.push(Object.freeze({
      personId,
      selectedCandidateIndex: index,
      nextCandidateIndex: index + 1,
      placement,
    }));
    return true;
  }
  return false;
};

const backtrackChronologically = (
  state: AssignmentState,
  maximumBacktrackDepth: number,
): BacktrackResult => {
  const displacedPersons: PersonId[] = [];
  let poppedFrames = 0;

  while (state.decisionStack.length > 0 && poppedFrames < maximumBacktrackDepth) {
    const frame = state.decisionStack.pop()!;
    poppedFrames += 1;
    removePlacement(frame.placement, state.placements);

    if (placeFirstFittingCandidate(frame.personId, frame.nextCandidateIndex, state)) {
      return Object.freeze({
        foundAlternative: true,
        exhaustedBudget: false,
        poppedFrameCount: poppedFrames,
        displacedPersons: Object.freeze(displacedPersons),
      });
    }

    displacedPersons.push(frame.personId);
  }

  return Object.freeze({
    foundAlternative: false,
    exhaustedBudget: poppedFrames >= maximumBacktrackDepth,
    poppedFrameCount: poppedFrames,
    displacedPersons: Object.freeze(displacedPersons),
  });
};

const placementConflicts = (
  candidatePlacement: LabelPlacement,
  placements: readonly LabelPlacement[],
  collisionQuery: LabelCollisionQuery,
): boolean => {
  const candidateLeader = leaderSegmentForPlacement(candidatePlacement);
  for (const placed of placements) {
    if (placed.personId === candidatePlacement.personId) continue;
    const placedLeader = leaderSegmentForPlacement(placed);
    if (collisionQuery.overlapsPlacedLabel(candidatePlacement.bounds, placed)) return true;
    if (collisionQuery.leaderCrossesPlacedLabel(candidateLeader.start, candidateLeader.end, placed)) return true;
    if (collisionQuery.labelCrossesPlacedLeader(candidatePlacement.bounds, placedLeader.start, placedLeader.end)) return true;
    if (collisionQuery.leadersCross(candidateLeader.start, candidateLeader.end, placedLeader.start, placedLeader.end)) return true;
  }
  return false;
};

const removePlacement = (placement: LabelPlacement, placements: LabelPlacement[]): void => {
  const index = placements.findIndex((existing) => existing === placement);
  if (index >= 0) placements.splice(index, 1);
};

const hasPlacementForPerson = (placements: readonly LabelPlacement[], personId: PersonId): boolean =>
  placements.some((placement) => placement.personId === personId);

const placementFromCandidate = (candidate: LabelCandidate): LabelPlacement => {
  const extra = candidate as LabelCandidate & Partial<Pick<LabelPlacement, "text" | "fontFamily" | "fontSize" | "fontWeight">>;
  return Object.freeze({
    personId: candidate.personId,
    bounds: Object.freeze({ ...candidate.bounds }),
    anchor: Object.freeze({ ...candidate.anchor }),
    rotation: candidate.rotation,
    leaderLength: candidate.leaderLength,
    family: candidate.family,
    text: extra.text ?? String(candidate.personId),
    fontFamily: extra.fontFamily ?? "",
    fontSize: extra.fontSize ?? 0,
    fontWeight: extra.fontWeight ?? 400,
  });
};

const leaderSegmentForPlacement = (placement: LabelPlacement): { readonly start: Vec2; readonly end: Vec2 } =>
  leaderSegmentForBounds(placement.anchor, placement.bounds);

const leaderSegmentForBounds = (anchor: Vec2, bounds: Bounds): { readonly start: Vec2; readonly end: Vec2 } => ({
  start: anchor,
  end: centerOfBounds(bounds),
});

const centerOfBounds = (bounds: Bounds): Vec2 => ({
  x: (bounds.minX + bounds.maxX) / 2,
  y: (bounds.minY + bounds.maxY) / 2,
});

const getCandidateId = (candidate: LabelCandidate, personId: PersonId, originalIndex: number): string => {
  const candidateWithId = candidate as LabelCandidate & { readonly candidateId?: string; readonly id?: string };
  return candidateWithId.candidateId ?? candidateWithId.id ?? `candidate:${String(personId)}:${originalIndex}`;
};

const makeUnplacedReason = (
  personId: PersonId,
  code: UnresolvedLabelReason["code"],
  candidateCount: number,
): UnresolvedLabelReason => Object.freeze({
  personId,
  code,
  message: unresolvedMessage(code),
  candidateCount,
});

const unresolvedMessage = (code: UnresolvedLabelReason["code"]): string => {
  switch (code) {
    case "NO_CANDIDATES_GENERATED":
      return "No valid label candidates were generated for this person.";
    case "ALL_CANDIDATES_COLLIDE":
      return "All valid label candidates collide with already placed labels or leaders.";
    case "BACKTRACK_EXHAUSTED":
      return "The chronological backtracking budget was exhausted before a conflict-free assignment was found.";
    case "GEOMETRY_RELAXATION_FAILED":
      return "Geometry relaxation failed.";
    case "TEXT_TOO_LONG":
      return "Text is too long.";
    case "FONT_MISSING":
      return "Required font is missing.";
    case "INVALID_PERSON_REFERENCE":
      return "Person reference is invalid.";
  }
};

const buildMetrics = (
  totalPersonCount: number,
  placements: readonly LabelPlacement[],
  unplacedPersons: readonly UnresolvedLabelReason[],
  configuredMinimumFontSize: number,
): LabelLayoutMetrics => {
  const maximumRotation = placements.reduce((max, placement) => Math.max(max, Math.abs(placement.rotation)), 0);
  const averageAnchorDistance = placements.length === 0
    ? 0
    : placements.reduce((sum, placement) => sum + placement.leaderLength, 0) / placements.length;
  const placedMinimumFontSize = placements.reduce(
    (min, placement) => placement.fontSize > 0 ? Math.min(min, placement.fontSize) : min,
    Number.POSITIVE_INFINITY,
  );

  return {
    totalPersonCount,
    placedLabelCount: placements.length,
    unplacedLabelCount: unplacedPersons.length,
    collisionCount: 0,
    minimumFontSize: placedMinimumFontSize === Number.POSITIVE_INFINITY
      ? configuredMinimumFontSize
      : placedMinimumFontSize,
    maximumRotation,
    averageAnchorDistance,
    totalOverlapCount: 0,
  };
};

const comparePlacementByPersonId = (left: LabelPlacement, right: LabelPlacement): number =>
  String(left.personId).localeCompare(String(right.personId), "en");

const compareUnresolvedByPersonId = (left: UnresolvedLabelReason, right: UnresolvedLabelReason): number =>
  String(left.personId).localeCompare(String(right.personId), "en");
