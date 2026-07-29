import type { EngineConfiguration } from "../config/types.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import type { LabelLayoutResult } from "../labels/types.js";
import type { SkeletonPlan } from "../skeleton/types.js";
import type { TerritoryPlan } from "../territory/types.js";

export interface BotanicalRelaxationConfig {
  readonly maxIterations: number;
  readonly proposalBatchCount: number;
  readonly initialStepRatio: number;
  readonly stepDecay: number;
  readonly maximumControlPointMovement: number;
  readonly minimumMovement: number;
  readonly minimumScoreImprovement: number;
  readonly roundingDecimalPlaces: number;
  readonly requireCompleteLabelLayout: boolean;
  readonly preserveLabelPlacements: boolean;
}

export interface BotanicalRelaxationInput {
  readonly graph: GenealogyGraph;
  readonly skeletonPlan: SkeletonPlan;
  readonly territoryPlan: TerritoryPlan;
  readonly configuration: EngineConfiguration;
  readonly labelLayout?: LabelLayoutResult;
  readonly relaxation?: Partial<BotanicalRelaxationConfig>;
}

export interface BotanicalRelaxationMetrics {
  readonly eligibleBranchCount: number;
  readonly movedBranchCount: number;
  readonly acceptedIterationCount: number;
  readonly rejectedIterationCount: number;
  readonly meanTerritoryDistanceBefore: number;
  readonly meanTerritoryDistanceAfter: number;
  readonly scoreImprovement: number;
  readonly maximumAppliedMovement: number;
}

export interface BotanicalRelaxationIteration {
  readonly iteration: number;
  readonly stepRatio: number;
  readonly proposedBranchCount: number;
  readonly maximumProposedMovement: number;
  readonly scoreBefore: number;
  readonly scoreAfter: number;
  readonly accepted: boolean;
  readonly rejectionReason?:
    | "NO_MOVEMENT"
    | "HARD_GEOMETRY_CONSTRAINT"
    | "LABEL_LAYOUT_PARTIAL"
    | "FIXED_LABEL_COLLISION"
    | "NO_SCORE_IMPROVEMENT";
}

export interface BotanicalRelaxationResult {
  readonly status: "RELAXED" | "UNCHANGED";
  readonly terminationReason:
    | "CONVERGED"
    | "ITERATION_LIMIT"
    | "NO_VALID_IMPROVEMENT"
    | "BASELINE_LABELS_PARTIAL";
  readonly sourceSkeletonFingerprint: string;
  readonly deterministicFingerprint: string;
  readonly skeletonPlan: SkeletonPlan;
  readonly labelLayout: LabelLayoutResult;
  readonly iterations: readonly BotanicalRelaxationIteration[];
  readonly metrics: BotanicalRelaxationMetrics;
  readonly configurationUsed: BotanicalRelaxationConfig;
}
