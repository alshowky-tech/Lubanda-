import type { EngineConfiguration } from "../config/types.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import type { SkeletonPlan } from "../skeleton/types.js";
import type { TerritoryPlan } from "../territory/types.js";

export interface BotanicalTerritoryGrowthConfig {
  readonly archetype: BotanicalArchetype;
  readonly descendantStrategy: BotanicalDescendantStrategy;
  readonly boundaryInset: number;
  readonly crownInsetRatio: number;
  readonly curvatureRatio: number;
  readonly trunkBaseThickness: number;
  readonly minimumTwigThickness: number;
  readonly roundingDecimalPlaces: number;
}

export type BotanicalArchetype = "olive" | "pine" | "oak" | "freeform";

export type BotanicalDescendantStrategy = "ARBOR_ONLY" | "ARBOR_IVY";

export interface BotanicalTerritoryGrowthInput {
  readonly graph: GenealogyGraph;
  readonly skeletonPlan: SkeletonPlan;
  readonly territoryPlan: TerritoryPlan;
  readonly configuration: EngineConfiguration;
  readonly growth?: Partial<BotanicalTerritoryGrowthConfig>;
}

export interface BranchHierarchyStatistics {
  readonly trunk: number;
  readonly primary: number;
  readonly secondary: number;
  readonly majorLimbs: number;
  readonly twigs: number;
  readonly terminal: number;
}

export interface BotanicalTerritoryGrowthMetrics {
  readonly branchCount: number;
  readonly primaryBranchCount: number;
  readonly secondaryBranchCount: number;
  readonly maximumGenealogyDepth: number;
  readonly averageTwigDepth: number;
  readonly branchHierarchy: BranchHierarchyStatistics;
}

export interface BotanicalTerritoryGrowthResult {
  readonly skeletonPlan: SkeletonPlan;
  readonly sourceSkeletonFingerprint: string;
  readonly deterministicFingerprint: string;
  readonly metrics: BotanicalTerritoryGrowthMetrics;
}
