import { asSkeletonPlanId } from "../contracts/identifiers.js";
import { sha256Canonical } from "../determinism/canonical-json.js";
import { roundDeterministic, stableUnit } from "../determinism/numeric.js";
import {
  approximateCubicBezierLength,
  sampleCubicBezier,
} from "../geometry/bezier.js";
import { boundsFromPoints } from "../geometry/bounds.js";
import type { Bounds, CubicBezier, Vec2 } from "../geometry/types.js";
import { freezeSkeletonPlan } from "../layout/FreezeSkeleton.js";
import { SkeletonValidator } from "../layout/SkeletonValidator.js";
import type { SkeletonBranch, SkeletonPlan } from "../skeleton/types.js";
import type { Territory } from "../territory/types.js";
import type { BotanicalArchetype } from "../territory-growth/types.js";
import type {
  BotanicalDensityCell,
  BotanicalGrowthIntelligenceConfig,
  BotanicalGrowthIntelligenceInput,
  BotanicalGrowthIntelligenceMetrics,
  BotanicalGrowthIntelligenceResult,
  BotanicalGrowthVector,
} from "./types.js";

interface IntelligenceProfile {
  readonly curvatureBias: number;
  readonly persistence: number;
  readonly crownDensity: number;
  readonly earlyBend: number;
}

interface MutableDensityCell {
  branchDensity: number;
  labelDensity: number;
  sinOrientation: number;
  cosOrientation: number;
  targetCount: number;
}

interface TerritoryField {
  readonly territory: Territory;
  readonly bounds: Bounds;
  readonly cells: MutableDensityCell[];
}

const PROFILES: Readonly<Record<BotanicalArchetype, IntelligenceProfile>> =
  Object.freeze({
    olive: Object.freeze({
      curvatureBias: 1.16,
      persistence: 0.68,
      crownDensity: 1.14,
      earlyBend: 0.82,
    }),
    oak: Object.freeze({
      curvatureBias: 0.92,
      persistence: 0.8,
      crownDensity: 0.94,
      earlyBend: 1.18,
    }),
    pine: Object.freeze({
      curvatureBias: 0.56,
      persistence: 0.9,
      crownDensity: 1.2,
      earlyBend: 0.72,
    }),
    freeform: Object.freeze({
      curvatureBias: 1.28,
      persistence: 0.62,
      crownDensity: 0.84,
      earlyBend: 1,
    }),
  });

export const DEFAULT_BOTANICAL_GROWTH_INTELLIGENCE_CONFIG:
  BotanicalGrowthIntelligenceConfig = Object.freeze({
    archetype: "oak",
    densityGridSize: 18,
    maximumBendRatio: 0.16,
    maximumBendDistance: 42,
    memoryWeight: 0.72,
    freeSpaceWeight: 1,
    densityWeight: 0.86,
    orientationDiversityWeight: 0.64,
    asymmetryWeight: 0.58,
    roundingDecimalPlaces: 6,
  });

const validateConfig = (
  partial: Partial<BotanicalGrowthIntelligenceConfig> | undefined,
): BotanicalGrowthIntelligenceConfig => {
  const config = {
    ...DEFAULT_BOTANICAL_GROWTH_INTELLIGENCE_CONFIG,
    ...partial,
  };
  if (!(config.archetype in PROFILES)) {
    throw new TypeError("archetype must be olive, pine, oak, or freeform");
  }
  if (
    !Number.isSafeInteger(config.densityGridSize) ||
    config.densityGridSize < 8 ||
    config.densityGridSize > 64
  ) {
    throw new TypeError("densityGridSize must be an integer from 8 through 64");
  }
  for (const [name, value] of [
    ["maximumBendRatio", config.maximumBendRatio],
    ["maximumBendDistance", config.maximumBendDistance],
    ["memoryWeight", config.memoryWeight],
    ["freeSpaceWeight", config.freeSpaceWeight],
    ["densityWeight", config.densityWeight],
    ["orientationDiversityWeight", config.orientationDiversityWeight],
    ["asymmetryWeight", config.asymmetryWeight],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`${name} must be finite and non-negative`);
    }
  }
  if (config.maximumBendRatio > 0.35 || config.memoryWeight > 1) {
    throw new TypeError("BGI ratios exceed their deterministic safety range");
  }
  if (
    !Number.isSafeInteger(config.roundingDecimalPlaces) ||
    config.roundingDecimalPlaces < 0 ||
    config.roundingDecimalPlaces > 12
  ) {
    throw new TypeError("roundingDecimalPlaces must be an integer from 0 through 12");
  }
  return Object.freeze(config);
};

const roundPoint = (point: Vec2, decimals: number): Vec2 => ({
  x: roundDeterministic(point.x, decimals),
  y: roundDeterministic(point.y, decimals),
});

const add = (left: Vec2, right: Vec2): Vec2 => ({
  x: left.x + right.x,
  y: left.y + right.y,
});

const subtract = (left: Vec2, right: Vec2): Vec2 => ({
  x: left.x - right.x,
  y: left.y - right.y,
});

const scale = (value: Vec2, factor: number): Vec2 => ({
  x: value.x * factor,
  y: value.y * factor,
});

const magnitude = (value: Vec2): number => Math.hypot(value.x, value.y);

const normalize = (value: Vec2, fallback: Vec2 = { x: 0, y: -1 }): Vec2 => {
  const length = magnitude(value);
  return length <= 1e-9
    ? fallback
    : { x: value.x / length, y: value.y / length };
};

const mix = (left: Vec2, right: Vec2, weight: number): Vec2 =>
  normalize(add(scale(left, 1 - weight), scale(right, weight)), left);

const variance = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  ) / values.length;
};

const entropy = (values: readonly number[]): number => {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  const raw = values.reduce((sum, value) => {
    if (value === 0) return sum;
    const probability = value / total;
    return sum - probability * Math.log2(probability);
  }, 0);
  return raw / Math.log2(values.length);
};

const maximumTurn = (curve: CubicBezier): number => {
  const samples = sampleCubicBezier(curve, {
    tolerance: 1,
    maxSubdivisionDepth: 8,
  });
  let total = 0;
  for (let index = 1; index < samples.length - 1; index += 1) {
    const first = subtract(samples[index] as Vec2, samples[index - 1] as Vec2);
    const second = subtract(samples[index + 1] as Vec2, samples[index] as Vec2);
    const denominator = magnitude(first) * magnitude(second);
    if (denominator <= 1e-9) continue;
    const cosine = Math.max(
      -1,
      Math.min(1, (first.x * second.x + first.y * second.y) / denominator),
    );
    total += Math.acos(cosine);
  }
  return total;
};

const cellIndex = (
  point: Vec2,
  bounds: Bounds,
  gridSize: number,
): number => {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const column = Math.max(
    0,
    Math.min(gridSize - 1, Math.floor((point.x - bounds.minX) / width * gridSize)),
  );
  const row = Math.max(
    0,
    Math.min(gridSize - 1, Math.floor((point.y - bounds.minY) / height * gridSize)),
  );
  return row * gridSize + column;
};

const cellCenter = (
  index: number,
  bounds: Bounds,
  gridSize: number,
): Vec2 => {
  const column = index % gridSize;
  const row = Math.floor(index / gridSize);
  return {
    x: bounds.minX +
      (column + 0.5) / gridSize * (bounds.maxX - bounds.minX),
    y: bounds.minY +
      (row + 0.5) / gridSize * (bounds.maxY - bounds.minY),
  };
};

const createFields = (
  input: BotanicalGrowthIntelligenceInput,
  config: BotanicalGrowthIntelligenceConfig,
): ReadonlyMap<string, TerritoryField> => {
  const fields = new Map<string, TerritoryField>();
  for (const territory of input.territoryPlan.territories) {
    const cells = Array.from(
      { length: config.densityGridSize ** 2 },
      (): MutableDensityCell => ({
        branchDensity: 0,
        labelDensity: 0,
        sinOrientation: 0,
        cosOrientation: 0,
        targetCount: 0,
      }),
    );
    fields.set(territory.ownerLineageRootId, {
      territory,
      bounds: boundsFromPoints(territory.polygon.points),
      cells,
    });
  }
  for (const branch of input.skeletonPlan.branches) {
    if (branch.generation === 0) continue;
    const field = fields.get(branch.metadata.lineageRootId);
    if (!field) continue;
    const direction = subtract(branch.endPoint, branch.startPoint);
    const orientation = Math.atan2(direction.y, direction.x);
    const samples = sampleCubicBezier(branch.curve, {
      tolerance: Math.max(
        2,
        Math.min(
          field.bounds.maxX - field.bounds.minX,
          field.bounds.maxY - field.bounds.minY,
        ) / 120,
      ),
      maxSubdivisionDepth: 8,
    });
    for (const sample of samples) {
      const cell = field.cells[
        cellIndex(sample, field.bounds, config.densityGridSize)
      ] as MutableDensityCell;
      cell.branchDensity += 1;
      cell.sinOrientation += Math.sin(orientation);
      cell.cosOrientation += Math.cos(orientation);
    }
  }
  for (const placement of input.labelLayout?.placements ?? []) {
    const branch = input.skeletonPlan.branches.find(
      (candidate) => candidate.ownerPersonId === placement.personId,
    );
    if (!branch) continue;
    const field = fields.get(branch.metadata.lineageRootId);
    if (!field) continue;
    const center = {
      x: (placement.bounds.minX + placement.bounds.maxX) / 2,
      y: (placement.bounds.minY + placement.bounds.maxY) / 2,
    };
    const cell = field.cells[
      cellIndex(center, field.bounds, config.densityGridSize)
    ] as MutableDensityCell;
    cell.labelDensity += 1;
  }
  return fields;
};

const chooseGrowthVector = (
  branch: SkeletonBranch,
  field: TerritoryField,
  config: BotanicalGrowthIntelligenceConfig,
  profile: IntelligenceProfile,
  seed: number,
): BotanicalGrowthVector => {
  const originIndex = cellIndex(
    branch.endPoint,
    field.bounds,
    config.densityGridSize,
  );
  const originCell = field.cells[originIndex] as MutableDensityCell;
  const diagonal = Math.hypot(
    field.bounds.maxX - field.bounds.minX,
    field.bounds.maxY - field.bounds.minY,
  );
  const personality =
    stableUnit(`${branch.metadata.lineageRootId}:limb-personality`, seed) - 0.5;
  let bestIndex = originIndex;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < field.cells.length; index += 1) {
    const cell = field.cells[index] as MutableDensityCell;
    const center = cellCenter(index, field.bounds, config.densityGridSize);
    const distance = magnitude(subtract(center, branch.endPoint)) /
      Math.max(1, diagonal);
    const density =
      cell.branchDensity * config.densityWeight +
      cell.labelDensity * profile.crownDensity;
    const asymmetry =
      personality *
      ((center.x - field.territory.centroid.x) /
        Math.max(1, field.bounds.maxX - field.bounds.minX)) *
      config.asymmetryWeight;
    const score =
      config.freeSpaceWeight * distance -
      density -
      cell.targetCount * 0.75 +
      asymmetry +
      stableUnit(`${branch.id}:cell:${index}`, seed) * 1e-6;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  const target = cellCenter(bestIndex, field.bounds, config.densityGridSize);
  const targetCell = field.cells[bestIndex] as MutableDensityCell;
  targetCell.targetCount += 1;
  const raw = normalize(subtract(target, branch.endPoint));
  const nearbyOrientation = Math.atan2(
    originCell.sinOrientation,
    originCell.cosOrientation,
  );
  const localDirection = normalize(subtract(branch.endPoint, branch.startPoint));
  const nearbyDirection = {
    x: Math.cos(nearbyOrientation),
    y: Math.sin(nearbyOrientation),
  };
  const diversity = normalize(
    subtract(raw, scale(nearbyDirection, config.orientationDiversityWeight)),
    localDirection,
  );
  return Object.freeze({
    branchId: branch.id,
    origin: roundPoint(branch.endPoint, config.roundingDecimalPlaces),
    vector: roundPoint(diversity, config.roundingDecimalPlaces),
    localDensity: roundDeterministic(
      originCell.branchDensity + originCell.labelDensity,
      config.roundingDecimalPlaces,
    ),
    nearbyOrientation: roundDeterministic(
      nearbyOrientation,
      config.roundingDecimalPlaces,
    ),
    territoryHistory: targetCell.targetCount - 1,
  });
};

const intelligentCurve = (
  branch: SkeletonBranch,
  parent: SkeletonBranch | undefined,
  vector: BotanicalGrowthVector,
  profile: IntelligenceProfile,
  config: BotanicalGrowthIntelligenceConfig,
  seed: number,
  intensity: number,
): CubicBezier => {
  if (intensity === 0) return branch.curve;
  const chord = subtract(branch.endPoint, branch.startPoint);
  const length = Math.max(1, magnitude(chord));
  const chordDirection = normalize(chord);
  const parentDirection = parent
    ? normalize(subtract(parent.curve.p3, parent.curve.p2), chordDirection)
    : chordDirection;
  const rememberedDirection = mix(
    chordDirection,
    parentDirection,
    config.memoryWeight * profile.persistence,
  );
  const perpendicular = { x: -chordDirection.y, y: chordDirection.x };
  const vectorCross =
    chordDirection.x * vector.vector.y -
    chordDirection.y * vector.vector.x;
  const parentCurveCross = parent
    ? Math.sign(
      (parent.curve.p2.x - parent.curve.p1.x) * chordDirection.y -
      (parent.curve.p2.y - parent.curve.p1.y) * chordDirection.x,
    )
    : 0;
  const stableSign =
    stableUnit(`${branch.id}:bgi-curvature`, seed) < 0.5 ? -1 : 1;
  const memorySign = parentCurveCross === 0 ? stableSign : parentCurveCross;
  const requestedSign = Math.abs(vectorCross) > 0.18
    ? Math.sign(vectorCross)
    : memorySign;
  const congestionDamping = 1 / (1 + vector.localDensity * 0.025);
  const personality =
    0.72 +
    stableUnit(`${branch.metadata.lineageRootId}:bgi-personality`, seed) *
      config.asymmetryWeight;
  const depthDamping = branch.genealogyDepth <= 2
    ? 0.72
    : Math.max(0.5, 1 - branch.genealogyDepth * 0.025);
  const bend = Math.min(
    config.maximumBendDistance,
    length * config.maximumBendRatio,
  ) * profile.curvatureBias * personality * congestionDamping *
    depthDamping * requestedSign;
  const handle = Math.min(length * 0.34, Math.max(4, length * 0.27));
  const earlyBend = profile.earlyBend;
  const first = add(
    add(branch.startPoint, scale(rememberedDirection, handle)),
    scale(perpendicular, bend * 0.28 * earlyBend),
  );
  const arrival = mix(chordDirection, vector.vector, 0.12);
  const second = add(
    add(branch.endPoint, scale(arrival, -handle)),
    scale(perpendicular, bend),
  );
  return {
    p0: roundPoint(branch.startPoint, config.roundingDecimalPlaces),
    p1: roundPoint(add(
      branch.curve.p1,
      scale(subtract(first, branch.curve.p1), intensity),
    ), config.roundingDecimalPlaces),
    p2: roundPoint(add(
      branch.curve.p2,
      scale(subtract(second, branch.curve.p2), intensity),
    ), config.roundingDecimalPlaces),
    p3: roundPoint(branch.endPoint, config.roundingDecimalPlaces),
  };
};

const buildCandidate = (
  source: SkeletonPlan,
  vectors: ReadonlyMap<string, BotanicalGrowthVector>,
  profile: IntelligenceProfile,
  config: BotanicalGrowthIntelligenceConfig,
  engineConfig: BotanicalGrowthIntelligenceInput["configuration"],
  intensity: number,
): readonly SkeletonBranch[] => {
  const byId = new Map(source.branches.map((branch) => [branch.id, branch]));
  return source.branches.map((branch) => {
    if (branch.generation === 0) return branch;
    const vector = vectors.get(branch.id);
    if (!vector) return branch;
    const curve = intelligentCurve(
      branch,
      branch.parentBranchId
        ? byId.get(branch.parentBranchId)
        : undefined,
      vector,
      profile,
      config,
      source.seed,
      intensity,
    );
    return {
      ...branch,
      curve,
      length: roundDeterministic(
        approximateCubicBezierLength(curve, {
          tolerance: engineConfig.geometry.bezierSubdivisionTolerance,
          maxSubdivisionDepth: engineConfig.geometry.maxSubdivisionDepth,
        }),
        config.roundingDecimalPlaces,
      ),
    };
  });
};

const densityCells = (
  fields: ReadonlyMap<string, TerritoryField>,
  config: BotanicalGrowthIntelligenceConfig,
): readonly BotanicalDensityCell[] =>
  [...fields.values()].flatMap((field) =>
    field.cells.map((cell, index) => Object.freeze({
      territoryId: field.territory.id,
      column: index % config.densityGridSize,
      row: Math.floor(index / config.densityGridSize),
      center: roundPoint(
        cellCenter(index, field.bounds, config.densityGridSize),
        config.roundingDecimalPlaces,
      ),
      branchDensity: roundDeterministic(
        cell.branchDensity,
        config.roundingDecimalPlaces,
      ),
      labelDensity: roundDeterministic(
        cell.labelDensity,
        config.roundingDecimalPlaces,
      ),
    })),
  );

const calculateMetrics = (
  branches: readonly SkeletonBranch[],
  fields: ReadonlyMap<string, TerritoryField>,
  cells: readonly BotanicalDensityCell[],
  movedBranchCount: number,
  acceptedIntensity: number,
  decimals: number,
): BotanicalGrowthIntelligenceMetrics => {
  const nonTrunk = branches.filter((branch) => branch.generation > 0);
  const occupied = cells.filter(
    (cell) => cell.branchDensity + cell.labelDensity > 0,
  ).length;
  const branchDensities = cells.map((cell) => cell.branchDensity);
  const angleBins = Array.from({ length: 12 }, () => 0);
  for (const branch of nonTrunk) {
    const tangent = subtract(branch.curve.p3, branch.curve.p2);
    const angle = (Math.atan2(tangent.y, tangent.x) + Math.PI * 2) %
      (Math.PI * 2);
    const index = Math.min(11, Math.floor(angle / (Math.PI * 2) * 12));
    angleBins[index] = (angleBins[index] ?? 0) + 1;
  }
  const lengths = nonTrunk.map((branch) => branch.length);
  const curvature = nonTrunk.map((branch) => maximumTurn(branch.curve));
  const symmetryValues = [...fields.values()].map((field) => {
    let difference = 0;
    let total = 0;
    const grid = Math.sqrt(field.cells.length);
    for (let row = 0; row < grid; row += 1) {
      for (let column = 0; column < Math.floor(grid / 2); column += 1) {
        const left = field.cells[row * grid + column] as MutableDensityCell;
        const right = field.cells[
          row * grid + (grid - 1 - column)
        ] as MutableDensityCell;
        difference += Math.abs(left.branchDensity - right.branchDensity);
        total += left.branchDensity + right.branchDensity;
      }
    }
    return total === 0 ? 1 : Math.max(0, 1 - difference / total);
  });
  const occupancyByTerritory = [...fields.values()].map((field) =>
    field.cells.filter(
      (cell) => cell.branchDensity + cell.labelDensity > 0,
    ).length / field.cells.length
  );
  return Object.freeze({
    territoryOccupancy: roundDeterministic(
      occupancyByTerritory.reduce((sum, value) => sum + value, 0) /
        Math.max(1, occupancyByTerritory.length),
      decimals,
    ),
    canopyDensityVariance: roundDeterministic(
      variance(branchDensities),
      decimals,
    ),
    branchAngleEntropy: roundDeterministic(entropy(angleBins), decimals),
    averageCurvature: roundDeterministic(
      curvature.reduce((sum, value) => sum + value, 0) /
        Math.max(1, curvature.length),
      decimals,
    ),
    emptySpaceUtilization: roundDeterministic(
      occupied / Math.max(1, cells.length),
      decimals,
    ),
    branchLengthVariance: roundDeterministic(variance(lengths), decimals),
    symmetryScore: roundDeterministic(
      symmetryValues.reduce((sum, value) => sum + value, 0) /
        Math.max(1, symmetryValues.length),
      decimals,
    ),
    movedBranchCount,
    acceptedIntensity: roundDeterministic(acceptedIntensity, decimals),
  });
};

export class BotanicalGrowthIntelligenceEngine {
  async guide(
    input: BotanicalGrowthIntelligenceInput,
  ): Promise<BotanicalGrowthIntelligenceResult> {
    if (input.skeletonPlan.status !== "ACCEPTED") {
      throw new TypeError("BGI requires an accepted Arbor-Ivy skeleton");
    }
    if (input.territoryPlan.status !== "ACCEPTED") {
      throw new TypeError("BGI requires an accepted territory plan");
    }
    if (
      input.skeletonPlan.territoryPlanFingerprint !==
      input.territoryPlan.deterministicFingerprint
    ) {
      throw new TypeError("Skeleton and territory fingerprints do not match");
    }
    const config = validateConfig(input.intelligence);
    const profile = PROFILES[config.archetype];
    const fields = createFields(input, config);
    const vectorList = input.skeletonPlan.branches
      .filter((branch) => branch.generation > 0)
      .sort((left, right) =>
        left.genealogyDepth - right.genealogyDepth ||
        left.metadata.branchIndex - right.metadata.branchIndex ||
        left.id.localeCompare(right.id)
      )
      .flatMap((branch) => {
        const field = fields.get(branch.metadata.lineageRootId);
        return field
          ? [chooseGrowthVector(branch, field, config, profile, input.skeletonPlan.seed)]
          : [];
      });
    const vectors = new Map(vectorList.map((vector) => [vector.branchId, vector]));
    const territoryPolygons = new Map(
      input.territoryPlan.territories.map((territory) => [
        territory.id,
        territory.polygon,
      ]),
    );
    const validator = new SkeletonValidator();
    let acceptedBranches = input.skeletonPlan.branches;
    let acceptedIntensity = 0;
    let acceptedValidation = input.skeletonPlan.validation;
    for (const intensity of [1, 0.75, 0.5, 0.35, 0.2, 0.1]) {
      const branches = buildCandidate(
        input.skeletonPlan,
        vectors,
        profile,
        config,
        input.configuration,
        intensity,
      );
      const validation = validator.validate(
        { ...input.skeletonPlan, branches },
        input.graph,
        input.skeletonPlan.selectedRootId,
        input.territoryPlan.templatePolygon,
        territoryPolygons,
      );
      if (validation.accepted) {
        acceptedBranches = branches;
        acceptedIntensity = intensity;
        acceptedValidation = validation;
        break;
      }
    }
    const movedBranchCount = acceptedBranches.filter((branch, index) => {
      const source = input.skeletonPlan.branches[index] as SkeletonBranch;
      return JSON.stringify(branch.curve) !== JSON.stringify(source.curve);
    }).length;
    const guidedFields = createFields({
      ...input,
      skeletonPlan: {
        ...input.skeletonPlan,
        branches: acceptedBranches,
      },
    }, config);
    const cells = densityCells(guidedFields, config);
    const metrics = calculateMetrics(
      acceptedBranches,
      guidedFields,
      cells,
      movedBranchCount,
      acceptedIntensity,
      config.roundingDecimalPlaces,
    );
    const planFingerprint = await sha256Canonical({
      stage: "BOTANICAL_GROWTH_INTELLIGENCE",
      sourceSkeletonFingerprint: input.skeletonPlan.deterministicFingerprint,
      territoryPlanFingerprint: input.territoryPlan.deterministicFingerprint,
      config,
      growthVectors: vectorList,
      branches: acceptedBranches,
      metrics,
    });
    const plan = freezeSkeletonPlan({
      ...input.skeletonPlan,
      skeletonPlanId: asSkeletonPlanId(
        `botanical-growth-intelligence:${planFingerprint.slice(0, 24)}`,
      ),
      branches: acceptedBranches,
      validation: acceptedValidation,
      diagnostics: [
        ...input.skeletonPlan.diagnostics,
        {
          sequence: input.skeletonPlan.diagnostics.length,
          stage: "RECURSIVE_GROWTH",
          code: "BOTANICAL_GROWTH_INTELLIGENCE_COMPLETE",
          metrics: {
            movedBranchCount,
            acceptedIntensity,
            canopyDensityVariance: metrics.canopyDensityVariance,
            branchAngleEntropy: metrics.branchAngleEntropy,
          },
        },
      ],
      deterministicFingerprint: planFingerprint,
    });
    const deterministicFingerprint = await sha256Canonical({
      stage: "BOTANICAL_GROWTH_INTELLIGENCE_RESULT",
      sourceSkeletonFingerprint: input.skeletonPlan.deterministicFingerprint,
      guidedSkeletonFingerprint: planFingerprint,
      growthVectors: vectorList,
      metrics,
      config,
    });
    return Object.freeze({
      skeletonPlan: plan,
      sourceSkeletonFingerprint: input.skeletonPlan.deterministicFingerprint,
      deterministicFingerprint,
      growthVectors: Object.freeze(vectorList),
      densityCells: Object.freeze(cells),
      metrics,
      configurationUsed: config,
    });
  }
}
