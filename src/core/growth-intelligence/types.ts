import type { EngineConfiguration } from "../config/types.js";
import type { SkeletonBranchId, TerritoryId } from "../contracts/identifiers.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import type { Vec2 } from "../geometry/types.js";
import type { LabelLayoutResult } from "../labels/types.js";
import type { SkeletonPlan } from "../skeleton/types.js";
import type { TerritoryPlan } from "../territory/types.js";
import type { BotanicalArchetype } from "../territory-growth/types.js";

export interface BotanicalGrowthIntelligenceConfig {
  readonly archetype: BotanicalArchetype;
  readonly densityGridSize: number;
  readonly maximumBendRatio: number;
  readonly maximumBendDistance: number;
  readonly memoryWeight: number;
  readonly freeSpaceWeight: number;
  readonly densityWeight: number;
  readonly orientationDiversityWeight: number;
  readonly asymmetryWeight: number;
  readonly roundingDecimalPlaces: number;
}

export interface BotanicalGrowthIntelligenceInput {
  readonly graph: GenealogyGraph;
  readonly skeletonPlan: SkeletonPlan;
  readonly territoryPlan: TerritoryPlan;
  readonly configuration: EngineConfiguration;
  readonly labelLayout?: LabelLayoutResult;
  readonly intelligence?: Partial<BotanicalGrowthIntelligenceConfig>;
}

export interface BotanicalGrowthVector {
  readonly branchId: SkeletonBranchId;
  readonly origin: Vec2;
  readonly vector: Vec2;
  readonly localDensity: number;
  readonly nearbyOrientation: number;
  readonly territoryHistory: number;
}

export interface BotanicalDensityCell {
  readonly territoryId: TerritoryId;
  readonly column: number;
  readonly row: number;
  readonly center: Vec2;
  readonly branchDensity: number;
  readonly labelDensity: number;
}

export interface BotanicalGrowthIntelligenceMetrics {
  readonly territoryOccupancy: number;
  readonly canopyDensityVariance: number;
  readonly branchAngleEntropy: number;
  readonly averageCurvature: number;
  readonly emptySpaceUtilization: number;
  readonly branchLengthVariance: number;
  readonly symmetryScore: number;
  readonly movedBranchCount: number;
  readonly acceptedIntensity: number;
}

export interface BotanicalGrowthIntelligenceResult {
  readonly skeletonPlan: SkeletonPlan;
  readonly sourceSkeletonFingerprint: string;
  readonly deterministicFingerprint: string;
  readonly growthVectors: readonly BotanicalGrowthVector[];
  readonly densityCells: readonly BotanicalDensityCell[];
  readonly metrics: BotanicalGrowthIntelligenceMetrics;
  readonly configurationUsed: BotanicalGrowthIntelligenceConfig;
}
