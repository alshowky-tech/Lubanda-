import { asSkeletonPlanId } from "../contracts/identifiers.js";
import { sha256Canonical } from "../determinism/canonical-json.js";
import { roundDeterministic } from "../determinism/numeric.js";
import {
  approximateCubicBezierLength,
  evaluateCubicBezier,
} from "../geometry/bezier.js";
import type { CubicBezier, Polygon, Vec2 } from "../geometry/types.js";
import { freezeSkeletonPlan } from "../layout/FreezeSkeleton.js";
import { SkeletonValidator } from "../layout/SkeletonValidator.js";
import { LabelLayoutEngine } from "../labels/LabelLayoutEngine.js";
import {
  buildSkeletonWoodObstacles,
} from "../labels/LabelLayoutEngine.js";
import { LabelCollisionQuery } from "../labels/LabelCollisionQuery.js";
import type { LabelLayoutResult } from "../labels/types.js";
import type { SkeletonBranch, SkeletonPlan } from "../skeleton/types.js";
import type { Territory } from "../territory/types.js";
import type {
  BotanicalRelaxationConfig,
  BotanicalRelaxationInput,
  BotanicalRelaxationIteration,
  BotanicalRelaxationResult,
} from "./types.js";

export const DEFAULT_BOTANICAL_RELAXATION_CONFIG: BotanicalRelaxationConfig =
  Object.freeze({
    maxIterations: 8,
    proposalBatchCount: 8,
    initialStepRatio: 0.08,
    stepDecay: 0.65,
    maximumControlPointMovement: 24,
    minimumMovement: 0.05,
    minimumScoreImprovement: 0.000001,
    roundingDecimalPlaces: 6,
    requireCompleteLabelLayout: true,
    preserveLabelPlacements: true,
  });

const validateConfiguration = (
  partial: Partial<BotanicalRelaxationConfig> | undefined,
): BotanicalRelaxationConfig => {
  const config = { ...DEFAULT_BOTANICAL_RELAXATION_CONFIG, ...partial };
  if (!Number.isSafeInteger(config.maxIterations) || config.maxIterations < 1) {
    throw new TypeError("maxIterations must be a positive safe integer");
  }
  if (
    !Number.isSafeInteger(config.proposalBatchCount) ||
    config.proposalBatchCount < 1
  ) {
    throw new TypeError("proposalBatchCount must be a positive safe integer");
  }
  for (const [name, value] of [
    ["initialStepRatio", config.initialStepRatio],
    ["stepDecay", config.stepDecay],
    ["maximumControlPointMovement", config.maximumControlPointMovement],
    ["minimumMovement", config.minimumMovement],
    ["minimumScoreImprovement", config.minimumScoreImprovement],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`${name} must be finite and non-negative`);
    }
  }
  if (config.initialStepRatio > 1 || config.stepDecay > 1) {
    throw new TypeError("initialStepRatio and stepDecay must be within [0, 1]");
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

const branchOrder = (left: SkeletonBranch, right: SkeletonBranch): number =>
  left.metadata.branchIndex - right.metadata.branchIndex ||
  left.id.localeCompare(right.id);

const roundPoint = (point: Vec2, decimalPlaces: number): Vec2 => ({
  x: roundDeterministic(point.x, decimalPlaces),
  y: roundDeterministic(point.y, decimalPlaces),
});

const territoryMap = (
  territories: readonly Territory[],
): ReadonlyMap<string, Territory> =>
  new Map<string, Territory>(
    territories.flatMap((territory) => [
      [territory.id, territory] as const,
      [`lineage:${territory.ownerLineageRootId}`, territory] as const,
    ]),
  );

const branchTerritory = (
  branch: SkeletonBranch,
  territories: ReadonlyMap<string, Territory>,
): Territory | undefined =>
  branch.territoryId === null
    ? territories.get(`lineage:${branch.metadata.lineageRootId}`)
    : territories.get(branch.territoryId);

const eligibleBranches = (
  branches: readonly SkeletonBranch[],
  territories: ReadonlyMap<string, Territory>,
): readonly SkeletonBranch[] =>
  branches.filter(
    (branch) =>
      branch.generation > 0 &&
      branchTerritory(branch, territories) !== undefined,
  );

const meanTerritoryDistance = (
  branches: readonly SkeletonBranch[],
  territories: ReadonlyMap<string, Territory>,
  decimalPlaces: number,
): number => {
  const eligible = eligibleBranches(branches, territories);
  if (eligible.length === 0) return 0;
  const total = eligible.reduce((sum, branch) => {
    const territory = branchTerritory(branch, territories);
    if (!territory) return sum;
    const midpoint = evaluateCubicBezier(branch.curve, 0.5);
    return sum + Math.hypot(
      midpoint.x - territory.centroid.x,
      midpoint.y - territory.centroid.y,
    );
  }, 0);
  return roundDeterministic(total / eligible.length, decimalPlaces);
};

const moveCurveToward = (
  curve: CubicBezier,
  target: Vec2,
  stepRatio: number,
  maximumMovement: number,
  decimalPlaces: number,
): { readonly curve: CubicBezier; readonly movement: number } => {
  const midpoint = evaluateCubicBezier(curve, 0.5);
  const raw = {
    x: (target.x - midpoint.x) * stepRatio,
    y: (target.y - midpoint.y) * stepRatio,
  };
  const rawLength = Math.hypot(raw.x, raw.y);
  const scale = rawLength > maximumMovement && rawLength > 0
    ? maximumMovement / rawLength
    : 1;
  const delta = roundPoint({
    x: raw.x * scale,
    y: raw.y * scale,
  }, decimalPlaces);
  const movement = roundDeterministic(
    Math.hypot(delta.x, delta.y),
    decimalPlaces,
  );
  return {
    curve: {
      p0: curve.p0,
      p1: roundPoint({
        x: curve.p1.x + delta.x,
        y: curve.p1.y + delta.y,
      }, decimalPlaces),
      p2: roundPoint({
        x: curve.p2.x + delta.x,
        y: curve.p2.y + delta.y,
      }, decimalPlaces),
      p3: curve.p3,
    },
    movement,
  };
};

const proposeBranches = (
  plan: SkeletonPlan,
  territories: ReadonlyMap<string, Territory>,
  stepRatio: number,
  proposalBatchIndex: number,
  config: BotanicalRelaxationConfig,
  geometry: BotanicalRelaxationInput["configuration"]["geometry"],
): {
  readonly branches: readonly SkeletonBranch[];
  readonly movedBranchIds: ReadonlySet<string>;
  readonly maximumMovement: number;
} => {
  const movedBranchIds = new Set<string>();
  let maximumMovement = 0;
  const eligible = [...eligibleBranches(plan.branches, territories)]
    .sort(branchOrder);
  const proposalIds = new Set(
    eligible
      .filter((_, index) =>
        index % config.proposalBatchCount === proposalBatchIndex
      )
      .map((branch) => branch.id),
  );
  const branches = [...plan.branches].sort(branchOrder).map((branch) => {
    if (!proposalIds.has(branch.id)) return branch;
    if (branch.generation === 0) return branch;
    const territory = branchTerritory(branch, territories);
    if (!territory) return branch;
    const proposal = moveCurveToward(
      branch.curve,
      territory.centroid,
      stepRatio,
      config.maximumControlPointMovement,
      config.roundingDecimalPlaces,
    );
    if (proposal.movement < config.minimumMovement) return branch;
    movedBranchIds.add(branch.id);
    maximumMovement = Math.max(maximumMovement, proposal.movement);
    return {
      ...branch,
      curve: proposal.curve,
      length: roundDeterministic(
        approximateCubicBezierLength(proposal.curve, {
          tolerance: geometry.bezierSubdivisionTolerance,
          maxSubdivisionDepth: geometry.maxSubdivisionDepth,
        }),
        config.roundingDecimalPlaces,
      ),
    };
  });
  return {
    branches: Object.freeze(branches),
    movedBranchIds,
    maximumMovement: roundDeterministic(
      maximumMovement,
      config.roundingDecimalPlaces,
    ),
  };
};

const fixedLabelWoodCollisionKeys = (
  layout: LabelLayoutResult,
  branches: readonly SkeletonBranch[],
  input: BotanicalRelaxationInput,
): ReadonlySet<string> => {
  const query = new LabelCollisionQuery({
    clearance: input.configuration.collision.labelClearance / 2,
  });
  const obstacleBranchIds = new Map<string, string>();
  for (const branch of branches) {
    for (const obstacle of buildSkeletonWoodObstacles(
      [branch],
      input.configuration.collision.barkAllowance,
      input.configuration.geometry.bezierSubdivisionTolerance,
      input.configuration.geometry.maxSubdivisionDepth,
    )) {
      query.addObstacle(obstacle);
      obstacleBranchIds.set(obstacle.obstacleId, branch.id);
    }
  }
  return new Set(
    layout.placements.flatMap((placement) =>
      query.collisions(placement.bounds)
        .filter((collision) => collision.kind === "WOOD")
        .map((collision) => obstacleBranchIds.get(collision.id))
        .filter((branchId): branchId is string => branchId !== undefined)
        .map((branchId) => `${placement.placementId}|${branchId}`)
    ),
  );
};

const filterFixedLabelSafeBranches = (
  currentBranches: readonly SkeletonBranch[],
  proposed: ReturnType<typeof proposeBranches>,
  baselineCollisionKeys: ReadonlySet<string>,
  layout: LabelLayoutResult,
  input: BotanicalRelaxationInput,
): ReturnType<typeof proposeBranches> => {
  const proposedCollisionKeys = fixedLabelWoodCollisionKeys(
    layout,
    proposed.branches,
    input,
  );
  const unsafeBranchIds = new Set(
    [...proposedCollisionKeys]
      .filter((key) => !baselineCollisionKeys.has(key))
      .map((key) => key.slice(key.lastIndexOf("|") + 1)),
  );
  if (unsafeBranchIds.size === 0) return proposed;
  const currentById = branchMap(currentBranches);
  const movedBranchIds = new Set(
    [...proposed.movedBranchIds].filter(
      (branchId) => !unsafeBranchIds.has(branchId),
    ),
  );
  return {
    branches: Object.freeze(
      proposed.branches.map((branch) =>
        unsafeBranchIds.has(branch.id)
          ? currentById.get(branch.id) ?? branch
          : branch
      ),
    ),
    movedBranchIds,
    maximumMovement:
      movedBranchIds.size === 0 ? 0 : proposed.maximumMovement,
  };
};

const branchMap = (
  branches: readonly SkeletonBranch[],
): ReadonlyMap<string, SkeletonBranch> =>
  new Map(branches.map((branch) => [branch.id, branch]));

const trialPlan = (
  plan: SkeletonPlan,
  branches: readonly SkeletonBranch[],
): SkeletonPlan => ({
  ...plan,
  branches,
});

const fingerprintPlan = async (
  plan: SkeletonPlan,
  sourceFingerprint: string,
  config: BotanicalRelaxationConfig,
): Promise<SkeletonPlan> => {
  const deterministicFingerprint = await sha256Canonical({
    stage: "BOTANICAL_LOCAL_RELAXATION",
    sourceSkeletonFingerprint: sourceFingerprint,
    branches: plan.branches.map((branch) => ({
      id: branch.id,
      curve: branch.curve,
      length: branch.length,
    })),
    validation: plan.validation,
    configurationUsed: config,
  });
  return freezeSkeletonPlan({
    ...plan,
    skeletonPlanId: asSkeletonPlanId(
      `relaxed:${deterministicFingerprint.slice(0, 24)}`,
    ),
    deterministicFingerprint,
  });
};

const assertCompatibleInput = (input: BotanicalRelaxationInput): void => {
  if (input.skeletonPlan.status !== "ACCEPTED") {
    throw new TypeError("Botanical relaxation requires an accepted skeleton plan");
  }
  if (input.territoryPlan.status !== "ACCEPTED") {
    throw new TypeError("Botanical relaxation requires an accepted territory plan");
  }
  if (
    input.skeletonPlan.territoryPlanFingerprint !==
    input.territoryPlan.deterministicFingerprint
  ) {
    throw new TypeError("Skeleton and territory plan fingerprints do not match");
  }
  if (
    input.skeletonPlan.selectedRootId !== input.territoryPlan.selectedRootId ||
    !input.graph.personsById.has(input.skeletonPlan.selectedRootId)
  ) {
    throw new TypeError("Graph, territory plan, and skeleton selected roots do not match");
  }
};

export class BotanicalLocalRelaxationEngine {
  async relax(
    input: BotanicalRelaxationInput,
  ): Promise<BotanicalRelaxationResult> {
    assertCompatibleInput(input);
    const config = validateConfiguration(input.relaxation);
    const sourceFingerprint = input.skeletonPlan.deterministicFingerprint;
    const territories = territoryMap(input.territoryPlan.territories);
    const territoryPolygons = new Map<string, Polygon>(
      input.territoryPlan.territories.map((territory) => [
        territory.id,
        territory.polygon,
      ]),
    );
    const validator = new SkeletonValidator();
    const labelEngine = new LabelLayoutEngine();
    let currentPlan: SkeletonPlan = input.skeletonPlan;
    let currentLabels = input.labelLayout ?? labelEngine.layout({
        graph: input.graph,
        skeletonPlan: currentPlan,
        templatePolygon: input.territoryPlan.templatePolygon,
        configuration: input.configuration,
      });
    const baselineFixedLabelCollisionKeys =
      config.preserveLabelPlacements
        ? fixedLabelWoodCollisionKeys(
            currentLabels,
            currentPlan.branches,
            input,
          )
        : new Set<string>();
    const before = meanTerritoryDistance(
      currentPlan.branches,
      territories,
      config.roundingDecimalPlaces,
    );
    let currentScore = before;
    let maximumAppliedMovement = 0;
    const movedBranchIds = new Set<string>();
    const iterations: BotanicalRelaxationIteration[] = [];

    if (config.requireCompleteLabelLayout && currentLabels.status !== "ACCEPTED") {
      return this.#result({
        sourceFingerprint,
        currentPlan: input.skeletonPlan,
        currentLabels,
        iterations,
        territories,
        config,
        before,
        movedBranchIds,
        maximumAppliedMovement,
        terminationReason: "BASELINE_LABELS_PARTIAL",
      });
    }

    for (let index = 0; index < config.maxIterations; index += 1) {
      const sweep = Math.floor(index / config.proposalBatchCount);
      const proposalBatchIndex = index % config.proposalBatchCount;
      const stepRatio = roundDeterministic(
        config.initialStepRatio * config.stepDecay ** sweep,
        config.roundingDecimalPlaces,
      );
      const rawProposal = proposeBranches(
        currentPlan,
        territories,
        stepRatio,
        proposalBatchIndex,
        config,
        input.configuration.geometry,
      );
      const proposal = config.preserveLabelPlacements
        ? filterFixedLabelSafeBranches(
            currentPlan.branches,
            rawProposal,
            baselineFixedLabelCollisionKeys,
            currentLabels,
            input,
          )
        : rawProposal;
      const baseIteration = {
        iteration: index + 1,
        stepRatio,
        proposedBranchCount: proposal.movedBranchIds.size,
        maximumProposedMovement: proposal.maximumMovement,
        scoreBefore: currentScore,
      };
      if (proposal.movedBranchIds.size === 0) {
        iterations.push(Object.freeze({
          ...baseIteration,
          scoreAfter: currentScore,
          accepted: false,
          rejectionReason: "NO_MOVEMENT",
        }));
        break;
      }

      const candidate = trialPlan(currentPlan, proposal.branches);
      const validation = validator.validate(
        candidate,
        input.graph,
        currentPlan.selectedRootId,
        input.territoryPlan.templatePolygon,
        territoryPolygons,
      );
      if (!validation.accepted) {
        iterations.push(Object.freeze({
          ...baseIteration,
          scoreAfter: currentScore,
          accepted: false,
          rejectionReason: "HARD_GEOMETRY_CONSTRAINT",
        }));
        continue;
      }

      const validatedCandidate: SkeletonPlan = {
        ...candidate,
        validation,
      };
      const candidateLabels = config.preserveLabelPlacements
        ? currentLabels
        : labelEngine.layout({
            graph: input.graph,
            skeletonPlan: validatedCandidate,
            templatePolygon: input.territoryPlan.templatePolygon,
            configuration: input.configuration,
          });
      if (
        config.requireCompleteLabelLayout &&
        candidateLabels.status !== "ACCEPTED"
      ) {
        iterations.push(Object.freeze({
          ...baseIteration,
          scoreAfter: currentScore,
          accepted: false,
          rejectionReason: "LABEL_LAYOUT_PARTIAL",
        }));
        continue;
      }

      const candidateScore = meanTerritoryDistance(
        proposal.branches,
        territories,
        config.roundingDecimalPlaces,
      );
      if (currentScore - candidateScore < config.minimumScoreImprovement) {
        iterations.push(Object.freeze({
          ...baseIteration,
          scoreAfter: candidateScore,
          accepted: false,
          rejectionReason: "NO_SCORE_IMPROVEMENT",
        }));
        continue;
      }

      iterations.push(Object.freeze({
        ...baseIteration,
        scoreAfter: candidateScore,
        accepted: true,
      }));
      currentPlan = validatedCandidate;
      currentLabels = candidateLabels;
      currentScore = candidateScore;
      maximumAppliedMovement = Math.max(
        maximumAppliedMovement,
        proposal.maximumMovement,
      );
      for (const branchId of proposal.movedBranchIds) movedBranchIds.add(branchId);
    }

    const acceptedIterationCount = iterations.filter(
      (iteration) => iteration.accepted,
    ).length;
    const terminationReason =
      iterations.at(-1)?.rejectionReason === "NO_MOVEMENT"
        ? "CONVERGED"
        : acceptedIterationCount > 0 && iterations.length === config.maxIterations
          ? "ITERATION_LIMIT"
          : "NO_VALID_IMPROVEMENT";

    return this.#result({
      sourceFingerprint,
      currentPlan,
      currentLabels,
      iterations,
      territories,
      config,
      before,
      movedBranchIds,
      maximumAppliedMovement,
      terminationReason,
    });
  }

  async #result(options: {
    readonly sourceFingerprint: string;
    readonly currentPlan: SkeletonPlan;
    readonly currentLabels: ReturnType<LabelLayoutEngine["layout"]>;
    readonly iterations: readonly BotanicalRelaxationIteration[];
    readonly territories: ReadonlyMap<string, Territory>;
    readonly config: BotanicalRelaxationConfig;
    readonly before: number;
    readonly movedBranchIds: ReadonlySet<string>;
    readonly maximumAppliedMovement: number;
    readonly terminationReason: BotanicalRelaxationResult["terminationReason"];
  }): Promise<BotanicalRelaxationResult> {
    const acceptedIterationCount = options.iterations.filter(
      (iteration) => iteration.accepted,
    ).length;
    const finalPlan = acceptedIterationCount > 0
      ? await fingerprintPlan(
        options.currentPlan,
        options.sourceFingerprint,
        options.config,
      )
      : options.currentPlan;
    const after = meanTerritoryDistance(
      finalPlan.branches,
      options.territories,
      options.config.roundingDecimalPlaces,
    );
    const resultFingerprint = await sha256Canonical({
      stage: "BOTANICAL_LOCAL_RELAXATION_RESULT",
      sourceSkeletonFingerprint: options.sourceFingerprint,
      relaxedSkeletonFingerprint: finalPlan.deterministicFingerprint,
      iterations: options.iterations,
      configurationUsed: options.config,
    });
    return Object.freeze({
      status: acceptedIterationCount > 0 ? "RELAXED" : "UNCHANGED",
      terminationReason: options.terminationReason,
      sourceSkeletonFingerprint: options.sourceFingerprint,
      deterministicFingerprint: resultFingerprint,
      skeletonPlan: finalPlan,
      labelLayout: options.currentLabels,
      iterations: Object.freeze([...options.iterations]),
      metrics: Object.freeze({
        eligibleBranchCount: eligibleBranches(
          options.currentPlan.branches,
          options.territories,
        ).length,
        movedBranchCount: options.movedBranchIds.size,
        acceptedIterationCount,
        rejectedIterationCount:
          options.iterations.length - acceptedIterationCount,
        meanTerritoryDistanceBefore: options.before,
        meanTerritoryDistanceAfter: after,
        scoreImprovement: roundDeterministic(
          options.before - after,
          options.config.roundingDecimalPlaces,
        ),
        maximumAppliedMovement: roundDeterministic(
          options.maximumAppliedMovement,
          options.config.roundingDecimalPlaces,
        ),
      }),
      configurationUsed: options.config,
    });
  }
}
