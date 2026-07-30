import { sha256Canonical } from "../determinism/canonical-json.js";
import { DefaultLabelCollisionQuery, type LabelCollisionQuery } from "./LabelCollisionQuery.js";
import { assignCandidates, type LabelAssignmentResult } from "./LabelAssignmentEngine.js";
import { DeterministicLabelCandidateGenerator } from "./LabelCandidateGenerator.js";
import type { PersonId } from "../contracts/identifiers.js";
import type { LabelConfig } from "../config/types.js";
import type { Bounds, Vec2 } from "../geometry/types.js";
import type {
  GeneratedCandidatesResult,
  LabelCandidate,
  LabelCandidateGenerationInput,
  LabelLayoutMetrics,
  LabelLayoutResult,
  LabelPlacement,
  UnresolvedReasonCode,
} from "./types.js";

const FONT_FAMILY = "DejaVu Sans";
const FONT_WEIGHT = 400;

export interface LabelPipelineInput extends LabelCandidateGenerationInput {
  readonly assignmentCollisionQuery?: LabelCollisionQuery;
}

export interface LabelPipelineDiagnostics {
  readonly totalGeneratedCandidates: number;
  readonly totalValidCandidates: number;
  readonly unresolvedByReason: Readonly<Record<UnresolvedReasonCode, number>>;
}

export interface LabelPipelineResult {
  readonly generatedCandidates: GeneratedCandidatesResult;
  readonly assignment: LabelAssignmentResult;
  readonly layout: LabelLayoutResult;
  readonly diagnostics: LabelPipelineDiagnostics;
}

interface LabelCandidateWithMetadata extends LabelCandidate {
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
}

export class DeterministicLabelLayoutEngine {
  async place(input: LabelPipelineInput): Promise<LabelPipelineResult> {
    const generated = await new DeterministicLabelCandidateGenerator().generate(input);
    const generatedCandidates = attachPipelineMetadata(
      generated,
      input.nameMap,
      input.configuration,
    );
    const assignment = assignCandidates({
      skeletonPlan: input.skeletonPlan,
      generatedCandidates,
      configuration: input.configuration,
      collisionQuery: input.assignmentCollisionQuery ?? new DefaultLabelCollisionQuery(),
    });
    const metrics = Object.freeze(recountDynamicConflicts(assignment.placements, assignment.metrics));
    const layoutFingerprint = await sha256Canonical({
      placements: [...assignment.placements].sort(comparePlacementByPersonId),
      unresolvedReasons: [...assignment.unplacedPersons].sort(compareUnresolvedByPersonId),
      metrics,
    });
    const layout: LabelLayoutResult = Object.freeze({
      accepted: assignment.unplacedPersons.length === 0 && metrics.collisionCount === 0,
      placements: assignment.placements,
      unresolvedReasons: assignment.unplacedPersons,
      metrics,
      deterministicFingerprint: layoutFingerprint,
    });

    return Object.freeze({
      generatedCandidates,
      assignment,
      layout,
      diagnostics: Object.freeze({
        totalGeneratedCandidates: generatedCandidates.allCandidates.length,
        totalValidCandidates: generatedCandidates.validCandidates.length,
        unresolvedByReason: Object.freeze(groupUnresolvedByReason(layout.unresolvedReasons)),
      }),
    });
  }
}

export const runLabelPipeline = async (
  input: LabelPipelineInput,
): Promise<LabelPipelineResult> => new DeterministicLabelLayoutEngine().place(input);

const attachPipelineMetadata = (
  generated: GeneratedCandidatesResult,
  nameMap: ReadonlyMap<PersonId, string>,
  configuration: LabelConfig,
): GeneratedCandidatesResult => {
  const perPersonIndex = new Map<PersonId, number>();
  const byOriginal = new Map<LabelCandidate, LabelCandidateWithMetadata>();
  const allCandidates = Object.freeze(generated.allCandidates.map((candidate) => {
    const index = perPersonIndex.get(candidate.personId) ?? 0;
    perPersonIndex.set(candidate.personId, index + 1);
    const withMetadata: LabelCandidateWithMetadata = Object.freeze({
      ...candidate,
      bounds: Object.freeze({ ...candidate.bounds }),
      anchor: Object.freeze({ ...candidate.anchor }),
      rejectionReasons: Object.freeze([...candidate.rejectionReasons]),
      componentScores: candidate.componentScores === undefined
        ? undefined
        : Object.freeze({ ...candidate.componentScores }),
      candidateId: candidate.candidateId ?? `candidate:${String(candidate.personId)}:${index}`,
      text: nameMap.get(candidate.personId) ?? String(candidate.personId),
      fontFamily: FONT_FAMILY,
      fontSize: configuration.minimumFontSize,
      fontWeight: FONT_WEIGHT,
    });
    byOriginal.set(candidate, withMetadata);
    return withMetadata;
  }));

  const personCandidateMap = new Map<PersonId, readonly LabelCandidate[]>();
  for (const [personId, candidates] of generated.personCandidateMap) {
    personCandidateMap.set(personId, Object.freeze(candidates.map((candidate) => {
      const rebuilt = byOriginal.get(candidate);
      if (rebuilt === undefined) {
        throw new Error(`Generated candidate missing from allCandidates for person ${String(personId)}`);
      }
      return rebuilt;
    })));
  }

  return Object.freeze({
    allCandidates,
    validCandidates: Object.freeze(allCandidates.filter((candidate) => candidate.validationStatus === "VALID")),
    personCandidateMap,
    totalGeneratablePeople: generated.totalGeneratablePeople,
    diagnostics: generated.diagnostics,
  });
};

const recountDynamicConflicts = (
  placements: readonly LabelPlacement[],
  metrics: LabelLayoutMetrics,
): LabelLayoutMetrics => {
  const query = new DefaultLabelCollisionQuery();
  let totalOverlapCount = 0;
  let collisionCount = 0;
  for (let i = 0; i < placements.length; i += 1) {
    const left = placements[i]!;
    const leftLeader = leaderSegmentForPlacement(left);
    for (let j = i + 1; j < placements.length; j += 1) {
      const right = placements[j]!;
      const rightLeader = leaderSegmentForPlacement(right);
      const overlaps = query.overlapsPlacedLabel(left.bounds, right);
      if (overlaps) totalOverlapCount += 1;
      if (
        overlaps ||
        query.leaderCrossesPlacedLabel(leftLeader.start, leftLeader.end, right) ||
        query.labelCrossesPlacedLeader(left.bounds, rightLeader.start, rightLeader.end) ||
        query.leadersCross(leftLeader.start, leftLeader.end, rightLeader.start, rightLeader.end)
      ) {
        collisionCount += 1;
      }
    }
  }

  return {
    ...metrics,
    collisionCount,
    totalOverlapCount,
  };
};

const leaderSegmentForPlacement = (placement: LabelPlacement): { readonly start: Vec2; readonly end: Vec2 } => ({
  start: placement.anchor,
  end: centerOfBounds(placement.bounds),
});

const centerOfBounds = (bounds: Bounds): Vec2 => ({
  x: (bounds.minX + bounds.maxX) / 2,
  y: (bounds.minY + bounds.maxY) / 2,
});

const groupUnresolvedByReason = (
  unresolvedReasons: readonly { readonly code: UnresolvedReasonCode }[],
): Readonly<Record<UnresolvedReasonCode, number>> => {
  const counts: Record<UnresolvedReasonCode, number> = {
    NO_CANDIDATES_GENERATED: 0,
    ALL_CANDIDATES_COLLIDE: 0,
    BACKTRACK_EXHAUSTED: 0,
    GEOMETRY_RELAXATION_FAILED: 0,
    TEXT_TOO_LONG: 0,
    FONT_MISSING: 0,
    INVALID_PERSON_REFERENCE: 0,
  };
  for (const reason of unresolvedReasons) counts[reason.code] += 1;
  return counts;
};

const comparePlacementByPersonId = (left: LabelPlacement, right: LabelPlacement): number =>
  String(left.personId).localeCompare(String(right.personId), "en");

const compareUnresolvedByPersonId = (
  left: { readonly personId: PersonId },
  right: { readonly personId: PersonId },
): number => String(left.personId).localeCompare(String(right.personId), "en");
