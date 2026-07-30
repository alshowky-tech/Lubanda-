export interface GeometryConfig {
  readonly epsilon: number;
  readonly bezierSubdivisionTolerance: number;
  readonly maxSubdivisionDepth: number;
}

export interface DemandConfig {
  readonly subtreeSizeWeight: number;
  readonly directChildCountWeight: number;
  readonly terminalCountWeight: number;
  readonly maxDepthWeight: number;
  readonly branchEntropyWeight: number;
  readonly labelWeight: number;
  readonly routingClearanceWeight: number;
  readonly estimatedCharacterWidth: number;
  readonly estimatedLabelHeight: number;
  readonly personPadding: number;
  readonly safetyMargin: number;
  readonly woodClearance: number;
  readonly minimumArea: number;
  readonly maximumArea: number;
  readonly minimumDemand: number;
  readonly maximumDemand: number;
  readonly lineageWeights: Readonly<Record<string, number>>;
  readonly roundingDecimalPlaces: number;
}

export interface TerritoryConfig {
  readonly maxNegotiationIterations: number;
  readonly minimumCorridorWidth: number;
  readonly minimumCorridorLength: number;
  readonly corridorClearance: number;
  readonly minimumTerritoryArea: number;
  readonly boundaryMargin: number;
  readonly junctionZoneRadius: number;
  readonly rootEntryWidth: number;
  readonly rootEntryDepth: number;
  readonly maximumAreaErrorRatio: number;
  readonly convergenceTolerance: number;
  readonly seedJitter: number;
  readonly boundarySamplingPoints: number;
  readonly maximumFragmentCount: number;
  readonly roundingDecimalPlaces: number;
}

export interface SkeletonConfig {
  readonly candidateCount: number;
  readonly maxCurvature: number;
  readonly minimumBranchLength: number;
}

export interface CollisionConfig {
  readonly branchClearance: number;
  readonly labelClearance: number;
  readonly barkAllowance: number;
}

export interface LabelConfig {
  readonly minimumFontSize: number;
  readonly maximumRotationDegrees: number;
  readonly maximumBacktrackDepth: number;
}

export interface StabilityConfig {
  readonly priorLayoutWeight: number;
  readonly maximumUnrelatedMovement: number;
}

export interface PerformanceConfig {
  readonly checkpointIntervalMs: number;
  readonly maxSolveMilliseconds: number;
}

export interface EngineConfiguration {
  readonly version: "1.0";
  readonly geometry: GeometryConfig;
  readonly demand: DemandConfig;
  readonly territory: TerritoryConfig;
  readonly skeleton: SkeletonConfig;
  readonly collision: CollisionConfig;
  readonly labels: LabelConfig;
  readonly stability: StabilityConfig;
  readonly performance: PerformanceConfig;
}
