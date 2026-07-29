import type { DemandConfig } from "../config/types.js";
import type {
  DemandPlanId,
  PersonId,
} from "../contracts/identifiers.js";
import type { DiagnosticCollector } from "../diagnostics/DiagnosticCollector.js";
import type { GenealogyGraph } from "../genealogy/graph.js";

export interface RawSubtreeStatistics {
  readonly descendantCount: number;
  readonly directChildCount: number;
  readonly subtreeDepth: number;
  readonly terminalPersonCount: number;
  readonly ownLabelFootprint: number;
  readonly subtreeLabelFootprint: number;
  readonly branchingEntropy: number;
  readonly branchingComplexity: number;
}

export interface DerivedSpatialDemand {
  readonly demandScore: number;
  readonly labelArea: number;
  readonly woodAndRoutingArea: number;
  readonly paddingAndSafetyArea: number;
  readonly minimumArea: number;
  readonly requiredArea: number;
  readonly appliedLineageWeight: number;
}

export interface PersonDemand {
  readonly personId: PersonId;
  readonly raw: RawSubtreeStatistics;
  readonly spatial: DerivedSpatialDemand;
  readonly metadata: {
    readonly postorderIndex: number;
    readonly canonicalScopeIndex: number;
    readonly algorithmVersion: "1.0";
  };
}

export interface DemandConfigurationSnapshot extends DemandConfig {
  readonly lineageWeights: Readonly<Record<string, number>>;
}

export interface DemandPlan {
  readonly schemaVersion: "1.0";
  readonly engineVersion: "0.2.0";
  readonly demandPlanId: DemandPlanId;
  readonly selectedRootId: PersonId;
  readonly sourceChecksum: string;
  readonly configurationUsed: DemandConfigurationSnapshot;
  readonly results: readonly PersonDemand[];
  readonly totalRequiredArea: number;
  readonly computationMetadata: {
    readonly algorithm: "ITERATIVE_BOTTOM_UP";
    readonly personCount: number;
    readonly maximumStackSize: number;
    readonly roundingDecimalPlaces: number;
    readonly deterministicFingerprint: string;
  };
}

export interface DemandComputationInput {
  readonly graph: GenealogyGraph;
  readonly selectedRootId: PersonId;
  readonly sourceChecksum: string;
  readonly configuration: DemandConfig;
  readonly diagnostics?: DiagnosticCollector;
}

export interface DemandEngine {
  compute(input: DemandComputationInput): Promise<DemandPlan>;
}

