import {
  asSkeletonPlanId,
  type PersonId,
} from "../contracts/identifiers.js";
import { sha256Canonical } from "../determinism/canonical-json.js";
import {
  roundDeterministic,
  stableUnit,
} from "../determinism/numeric.js";
import {
  approximateCubicBezierLength,
} from "../geometry/bezier.js";
import { boundsFromPoints } from "../geometry/bounds.js";
import type { Bounds, CubicBezier, Vec2 } from "../geometry/types.js";
import { SkeletonValidator } from "../layout/SkeletonValidator.js";
import { freezeSkeletonPlan } from "../layout/FreezeSkeleton.js";
import type {
  SkeletonBranch,
  SkeletonNode,
  SkeletonPlan,
} from "../skeleton/types.js";
import type { Territory } from "../territory/types.js";
import type {
  BotanicalArchetype,
  BotanicalTerritoryGrowthConfig,
  BotanicalTerritoryGrowthInput,
  BotanicalTerritoryGrowthMetrics,
  BotanicalTerritoryGrowthResult,
  BranchHierarchyStatistics,
} from "./types.js";

export const DEFAULT_BOTANICAL_TERRITORY_GROWTH_CONFIG:
  BotanicalTerritoryGrowthConfig = Object.freeze({
    archetype: "oak",
    descendantStrategy: "ARBOR_IVY",
    boundaryInset: 72,
    crownInsetRatio: 0.06,
    curvatureRatio: 0,
    trunkBaseThickness: 24,
    minimumTwigThickness: 1.35,
    roundingDecimalPlaces: 6,
  });

interface LeafSpan {
  readonly first: number;
  readonly last: number;
}

interface CrownFrame {
  readonly bounds: Bounds;
  readonly start: Vec2;
  readonly forward: Vec2;
  readonly tangent: Vec2;
  readonly forwardExtent: number;
  readonly tangentExtent: number;
}

interface ArchetypeProfile {
  readonly trunkTopRatio: number;
  readonly crownBaseRatio: number;
  readonly outwardReachRatio: number;
  readonly upwardReachRatio: number;
  readonly crownSpreadRatio: number;
  readonly primaryThicknessRatio: number;
}

const ARCHETYPE_PROFILES: Readonly<Record<
  BotanicalArchetype,
  ArchetypeProfile
>> = Object.freeze({
  olive: Object.freeze({
    trunkTopRatio: 0.6,
    crownBaseRatio: 0.68,
    outwardReachRatio: 0.78,
    upwardReachRatio: 0.46,
    crownSpreadRatio: 0.38,
    primaryThicknessRatio: 0.76,
  }),
  pine: Object.freeze({
    trunkTopRatio: 0.38,
    crownBaseRatio: 0.82,
    outwardReachRatio: 0.42,
    upwardReachRatio: 0.82,
    crownSpreadRatio: 0.2,
    primaryThicknessRatio: 0.64,
  }),
  oak: Object.freeze({
    trunkTopRatio: 0.5,
    crownBaseRatio: 0.74,
    outwardReachRatio: 0.62,
    upwardReachRatio: 0.52,
    crownSpreadRatio: 0.68,
    primaryThicknessRatio: 0.82,
  }),
  freeform: Object.freeze({
    trunkTopRatio: 0.52,
    crownBaseRatio: 0.72,
    outwardReachRatio: 0.64,
    upwardReachRatio: 0.58,
    crownSpreadRatio: 0.3,
    primaryThicknessRatio: 0.72,
  }),
});

const validateConfiguration = (
  partial: Partial<BotanicalTerritoryGrowthConfig> | undefined,
): BotanicalTerritoryGrowthConfig => {
  const config = {
    ...DEFAULT_BOTANICAL_TERRITORY_GROWTH_CONFIG,
    ...partial,
  };
  if (!(config.archetype in ARCHETYPE_PROFILES)) {
    throw new TypeError("archetype must be olive, pine, oak, or freeform");
  }
  if (
    config.descendantStrategy !== "ARBOR_ONLY" &&
    config.descendantStrategy !== "ARBOR_IVY"
  ) {
    throw new TypeError("descendantStrategy must be ARBOR_ONLY or ARBOR_IVY");
  }
  for (const [name, value] of [
    ["boundaryInset", config.boundaryInset],
    ["crownInsetRatio", config.crownInsetRatio],
    ["curvatureRatio", config.curvatureRatio],
    ["trunkBaseThickness", config.trunkBaseThickness],
    ["minimumTwigThickness", config.minimumTwigThickness],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`${name} must be finite and non-negative`);
    }
  }
  if (config.crownInsetRatio >= 0.45 || config.curvatureRatio > 0.25) {
    throw new TypeError("growth ratios exceed their deterministic safety range");
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

const point = (
  value: Vec2,
  decimalPlaces: number,
): Vec2 => ({
  x: roundDeterministic(value.x, decimalPlaces),
  y: roundDeterministic(value.y, decimalPlaces),
});

const add = (left: Vec2, right: Vec2): Vec2 => ({
  x: left.x + right.x,
  y: left.y + right.y,
});

const scale = (value: Vec2, factor: number): Vec2 => ({
  x: value.x * factor,
  y: value.y * factor,
});

const branchOrder = (
  left: SkeletonBranch,
  right: SkeletonBranch,
): number =>
  left.metadata.branchIndex - right.metadata.branchIndex ||
  left.id.localeCompare(right.id);

const insetBounds = (
  bounds: Bounds,
  inset: number,
): Bounds => {
  const safeX = Math.min(inset, (bounds.maxX - bounds.minX) * 0.2);
  const safeY = Math.min(inset, (bounds.maxY - bounds.minY) * 0.2);
  return {
    minX: bounds.minX + safeX,
    minY: bounds.minY + safeY,
    maxX: bounds.maxX - safeX,
    maxY: bounds.maxY - safeY,
  };
};

const territoryByOwner = (
  territories: readonly Territory[],
): ReadonlyMap<PersonId, Territory> =>
  new Map(territories.map((territory) => [
    territory.ownerLineageRootId,
    territory,
  ]));

const createCrownFrame = (
  territory: Territory,
  start: Vec2,
  profile: ArchetypeProfile,
  config: BotanicalTerritoryGrowthConfig,
): CrownFrame => {
  const polygonBounds = insetBounds(
    boundsFromPoints(territory.clearanceEnvelope.polygon.points),
    config.boundaryInset,
  );
  const width = polygonBounds.maxX - polygonBounds.minX;
  const height = polygonBounds.maxY - polygonBounds.minY;
  const side = territory.centroid.x < start.x ? -1 : 1;
  const innerEdgeX = side < 0 ? polygonBounds.maxX : polygonBounds.minX;
  const crownCenter: Vec2 = {
    x: territory.centroid.x * 0.65 + innerEdgeX * 0.35,
    y: territory.centroid.y,
  };
  const target: Vec2 = {
    x: crownCenter.x + side * width * profile.outwardReachRatio * 0.48,
    y: crownCenter.y - height * profile.upwardReachRatio * 0.58,
  };
  const delta = {
    x: target.x - crownCenter.x,
    y: target.y - crownCenter.y,
  };
  const centerToTarget = Math.max(1, Math.hypot(delta.x, delta.y));
  const forward: Vec2 = {
    x: delta.x / centerToTarget,
    y: delta.y / centerToTarget,
  };
  const forwardExtent = centerToTarget / 0.86;
  const crownStart = add(crownCenter, scale(forward, -forwardExtent * 0.12));
  const tangent: Vec2 = { x: -forward.y, y: forward.x };
  const distanceToBoundary = (direction: Vec2): number => {
    const candidates: number[] = [];
    if (Math.abs(direction.x) > 1e-9) {
      candidates.push(
        ((direction.x > 0 ? polygonBounds.maxX : polygonBounds.minX) -
          target.x) / direction.x,
      );
    }
    if (Math.abs(direction.y) > 1e-9) {
      candidates.push(
        ((direction.y > 0 ? polygonBounds.maxY : polygonBounds.minY) -
          target.y) / direction.y,
      );
    }
    return Math.max(0, Math.min(...candidates.filter((value) => value >= 0)));
  };
  const availableTangent = Math.min(
    distanceToBoundary(tangent),
    distanceToBoundary(scale(tangent, -1)),
  );
  return {
    bounds: polygonBounds,
    start: crownStart,
    forward,
    tangent,
    forwardExtent,
    tangentExtent: Math.min(
      availableTangent * 2,
      Math.min(width, height) * profile.crownSpreadRatio * 2,
    ),
  };
};

const computeLeafSpans = (
  graph: BotanicalTerritoryGrowthInput["graph"],
  rootId: PersonId,
): Readonly<{
  spans: ReadonlyMap<PersonId, LeafSpan>;
  leafCount: number;
  maximumDepth: number;
}> => {
  const spans = new Map<PersonId, LeafSpan>();
  let leafIndex = 0;
  let maximumDepth = 1;
  const visit = (personId: PersonId, depth: number): LeafSpan => {
    maximumDepth = Math.max(maximumDepth, depth);
    const children = graph.childrenByParentId.get(personId) ?? [];
    if (children.length === 0) {
      const span = { first: leafIndex, last: leafIndex };
      leafIndex += 1;
      spans.set(personId, span);
      return span;
    }
    const childSpans = children.map((childId) => visit(childId, depth + 1));
    const span = {
      first: childSpans[0]?.first ?? leafIndex,
      last: childSpans[childSpans.length - 1]?.last ?? leafIndex,
    };
    spans.set(personId, span);
    return span;
  };
  visit(rootId, 1);
  return { spans, leafCount: Math.max(1, leafIndex), maximumDepth };
};

const positionInCrown = (
  depth: number,
  leafSpan: LeafSpan,
  leafCount: number,
  maximumDepth: number,
  frame: CrownFrame,
  config: BotanicalTerritoryGrowthConfig,
): Vec2 => {
  const depthRatio =
    maximumDepth <= 1 ? 0.35 : (depth - 1) / (maximumDepth - 1);
  const easedDepth = 0.12 + 0.86 * Math.pow(depthRatio, 0.78);
  const midpoint = (leafSpan.first + leafSpan.last + 1) / 2;
  const leafRatio = midpoint / leafCount - 0.5;
  const crownInset = frame.tangentExtent * config.crownInsetRatio;
  const tangentExtent = Math.max(
    0,
    frame.tangentExtent / 2 - crownInset,
  );
  const start = add(
    frame.start,
    scale(
      frame.forward,
      frame.forwardExtent *
        easedDepth *
        (config.descendantStrategy === "ARBOR_IVY"
          ? 1 + 0.12 * Math.cos(leafRatio * Math.PI * 2)
          : 1),
    ),
  );
  // A continuous, monotone canopy warp sends adjacent descendants toward
  // different free-space pockets without changing their canonical order.
  // Unlike per-node jitter, the shared field cannot fold sibling territories.
  const spaceSeekingWarp = config.descendantStrategy === "ARBOR_IVY"
    ? frame.tangentExtent *
      0.08 *
      Math.sin(Math.PI * depthRatio) *
      Math.sin(leafRatio * Math.PI * 2)
    : 0;
  return point(
    add(
      start,
      scale(
        frame.tangent,
        leafRatio * tangentExtent * 2 + spaceSeekingWarp,
      ),
    ),
    config.roundingDecimalPlaces,
  );
};

const curveBetween = (
  start: Vec2,
  end: Vec2,
  branch: SkeletonBranch,
  seed: number,
  config: BotanicalTerritoryGrowthConfig,
): CubicBezier => {
  const delta = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.max(1, Math.hypot(delta.x, delta.y));
  const perpendicular = { x: -delta.y / length, y: delta.x / length };
  const sign = stableUnit(`${branch.id}:curve-side`, seed) < 0.5 ? -1 : 1;
  const hierarchyScale = Math.max(0.25, 1 - branch.genealogyDepth * 0.045);
  const botanicalCurveRatio =
    branch.genealogyDepth === 2 ? config.curvatureRatio : 0;
  if (branch.genealogyDepth === 1) {
    return {
      p0: point(start, config.roundingDecimalPlaces),
      p1: point({
        x: start.x + delta.x * 0.48,
        y: start.y + delta.y * 0.08,
      }, config.roundingDecimalPlaces),
      p2: point({
        x: start.x + delta.x * 0.88,
        y: start.y + delta.y * 0.62,
      }, config.roundingDecimalPlaces),
      p3: point(end, config.roundingDecimalPlaces),
    };
  }
  const bend = Math.min(42, length * botanicalCurveRatio) *
    sign * hierarchyScale;
  return {
    p0: point(start, config.roundingDecimalPlaces),
    p1: point(add(add(start, scale(delta, 0.3)), scale(perpendicular, bend)), config.roundingDecimalPlaces),
    p2: point(add(add(start, scale(delta, 0.72)), scale(perpendicular, bend * 0.55)), config.roundingDecimalPlaces),
    p3: point(end, config.roundingDecimalPlaces),
  };
};

const hierarchyThickness = (
  depth: number,
  subtreeSize: number,
  totalPeople: number,
  config: BotanicalTerritoryGrowthConfig,
  profile: ArchetypeProfile,
): SkeletonBranch["thickness"] => {
  const primaryBase = config.trunkBaseThickness * profile.primaryThicknessRatio;
  const hierarchy = primaryBase * Math.pow(0.72, Math.max(0, depth - 1));
  const load = 0.72 + 0.28 * Math.sqrt(subtreeSize / Math.max(1, totalPeople));
  const baseThickness = Math.max(
    config.minimumTwigThickness,
    hierarchy * load,
  );
  const tipThickness = Math.max(
    config.minimumTwigThickness,
    baseThickness * (depth <= 2 ? 0.68 : 0.76),
  );
  return {
    baseThickness: roundDeterministic(baseThickness, 3),
    tipThickness: roundDeterministic(tipThickness, 3),
    taperRatio: roundDeterministic(tipThickness / baseThickness, 6),
  };
};

const hierarchyStatistics = (
  branches: readonly SkeletonBranch[],
): BranchHierarchyStatistics => ({
  trunk: branches.filter((branch) => branch.generation === 0).length,
  primary: branches.filter((branch) => branch.genealogyDepth === 1).length,
  secondary: branches.filter((branch) => branch.genealogyDepth === 2).length,
  majorLimbs: branches.filter((branch) =>
    branch.genealogyDepth >= 3 && branch.genealogyDepth <= 4
  ).length,
  twigs: branches.filter((branch) =>
    branch.genealogyDepth >= 5 && branch.childrenBranchIds.length > 0
  ).length,
  terminal: branches.filter((branch) =>
    branch.generation > 0 && branch.childrenBranchIds.length === 0
  ).length,
});

const repairIntersectionCurve = (
  branch: SkeletonBranch,
  bendRatio: number,
  config: BotanicalTerritoryGrowthConfig,
): CubicBezier => {
  const delta = {
    x: branch.endPoint.x - branch.startPoint.x,
    y: branch.endPoint.y - branch.startPoint.y,
  };
  const length = Math.max(1, Math.hypot(delta.x, delta.y));
  const perpendicular = { x: -delta.y / length, y: delta.x / length };
  const bend = length * bendRatio;
  return {
    p0: branch.startPoint,
    p1: point(add(
      add(branch.startPoint, scale(delta, 0.28)),
      scale(perpendicular, bend),
    ), config.roundingDecimalPlaces),
    p2: point(add(
      add(branch.startPoint, scale(delta, 0.72)),
      scale(perpendicular, bend),
    ), config.roundingDecimalPlaces),
    p3: branch.endPoint,
  };
};

const repairIntersections = (
  provisional: SkeletonPlan,
  graph: BotanicalTerritoryGrowthInput["graph"],
  templatePolygon: BotanicalTerritoryGrowthInput["territoryPlan"]["templatePolygon"],
  territoryPolygons: ReadonlyMap<string, BotanicalTerritoryGrowthInput["territoryPlan"]["templatePolygon"]>,
  configuration: BotanicalTerritoryGrowthInput["configuration"],
  config: BotanicalTerritoryGrowthConfig,
): readonly SkeletonBranch[] => {
  const validator = new SkeletonValidator();
  const trunkIds = new Set(provisional.trunk.segments);
  let branches = [...provisional.branches];
  let report = validator.validate(
    provisional,
    graph,
    provisional.selectedRootId,
    templatePolygon,
    territoryPolygons,
  );
  const bendRatios = [
    0.06, -0.06, 0.12, -0.12, 0.2, -0.2, 0.3, -0.3, 0.42, -0.42,
  ];
  for (
    let repair = 0;
    repair < 96 && report.metrics.intersectionCount > 0;
    repair += 1
  ) {
    const issue = report.issues.find(
      (candidate) => candidate.code === "SKELETON_BRANCH_INTERSECTION",
    );
    const intersectingIds = issue?.entityIds ?? [];
    const candidates = branches
      .filter((branch) =>
        intersectingIds.includes(branch.id) && !trunkIds.has(branch.id)
      )
      .sort((left, right) =>
        right.genealogyDepth - left.genealogyDepth ||
        right.metadata.branchIndex - left.metadata.branchIndex
      );
    let best:
      | {
          readonly branches: readonly SkeletonBranch[];
          readonly report: ReturnType<SkeletonValidator["validate"]>;
        }
      | undefined;
    for (const branch of candidates) {
      for (const bendRatio of bendRatios) {
        const curve = repairIntersectionCurve(branch, bendRatio, config);
        const replacement: SkeletonBranch = {
          ...branch,
          curve,
          length: roundDeterministic(
            approximateCubicBezierLength(curve, {
              tolerance:
                configuration.geometry.bezierSubdivisionTolerance,
              maxSubdivisionDepth:
                configuration.geometry.maxSubdivisionDepth,
            }),
            config.roundingDecimalPlaces,
          ),
        };
        const proposed = branches.map((item) =>
          item.id === branch.id ? replacement : item
        );
        const proposedReport = validator.validate(
          { ...provisional, branches: proposed },
          graph,
          provisional.selectedRootId,
          templatePolygon,
          territoryPolygons,
        );
        if (
          proposedReport.metrics.outOfBoundsCount > 0 ||
          proposedReport.metrics.territoryMissCount > 0
        ) continue;
        if (
          best === undefined ||
          proposedReport.metrics.intersectionCount <
            best.report.metrics.intersectionCount
        ) {
          best = { branches: proposed, report: proposedReport };
        }
        if (proposedReport.metrics.intersectionCount === 0) break;
      }
      if (best?.report.metrics.intersectionCount === 0) break;
    }
    if (
      best === undefined ||
      best.report.metrics.intersectionCount >= report.metrics.intersectionCount
    ) break;
    branches = [...best.branches];
    report = best.report;
  }
  return branches;
};

export class BotanicalTerritoryGrowthEngine {
  async grow(
    input: BotanicalTerritoryGrowthInput,
  ): Promise<BotanicalTerritoryGrowthResult> {
    if (input.skeletonPlan.status !== "ACCEPTED") {
      throw new TypeError("Botanical territory growth requires an accepted skeleton");
    }
    if (input.territoryPlan.status !== "ACCEPTED") {
      throw new TypeError("Botanical territory growth requires an accepted territory plan");
    }
    if (
      input.skeletonPlan.territoryPlanFingerprint !==
      input.territoryPlan.deterministicFingerprint
    ) {
      throw new TypeError("Skeleton and territory fingerprints do not match");
    }
    const config = validateConfiguration(input.growth);
    const profile = ARCHETYPE_PROFILES[config.archetype];
    const originalBranches = [...input.skeletonPlan.branches].sort(branchOrder);
    const trunkIds = new Set(input.skeletonPlan.trunk.segments);
    const personBranch = new Map<PersonId, SkeletonBranch>();
    for (const branch of originalBranches) {
      if (!trunkIds.has(branch.id)) personBranch.set(branch.ownerPersonId, branch);
    }
    const templateBounds = insetBounds(
      boundsFromPoints(input.territoryPlan.templatePolygon.points),
      config.boundaryInset,
    );
    const nodePoints = new Map<string, Vec2>();
    const trunkBranches: SkeletonBranch[] = [];
    const trunkCount = input.skeletonPlan.trunk.segments.length;
    const trunkStart = {
      x: (templateBounds.minX + templateBounds.maxX) / 2,
      y: templateBounds.maxY,
    };
    const trunkEndY =
      templateBounds.minY +
      (templateBounds.maxY - templateBounds.minY) * profile.trunkTopRatio;
    let previousPoint = point(trunkStart, config.roundingDecimalPlaces);
    input.skeletonPlan.trunk.segments.forEach((branchId, index) => {
      const original = originalBranches.find((branch) => branch.id === branchId);
      if (!original) throw new TypeError(`Missing trunk branch ${branchId}`);
      const ratio = index === trunkCount - 1 && trunkCount > 1
        ? (trunkCount - 1) / trunkCount + 0.018
        : (index + 1) / trunkCount;
      const end = point({
        x: trunkStart.x +
          Math.sin(ratio * Math.PI) *
          (templateBounds.maxX - templateBounds.minX) * 0.008,
        y: trunkStart.y + (trunkEndY - trunkStart.y) * ratio,
      }, config.roundingDecimalPlaces);
      const curve = curveBetween(previousPoint, end, original, input.skeletonPlan.seed, {
        ...config,
        curvatureRatio: 0,
      });
      const baseThickness =
        config.trunkBaseThickness * (1 - index * 0.13);
      const tipThickness = Math.max(
        config.minimumTwigThickness,
        baseThickness * 0.78,
      );
      trunkBranches.push({
        ...original,
        curve,
        startPoint: curve.p0,
        endPoint: curve.p3,
        length: roundDeterministic(
          approximateCubicBezierLength(curve, {
            tolerance: input.configuration.geometry.bezierSubdivisionTolerance,
            maxSubdivisionDepth: input.configuration.geometry.maxSubdivisionDepth,
          }),
          config.roundingDecimalPlaces,
        ),
        thickness: {
          baseThickness: roundDeterministic(baseThickness, 3),
          tipThickness: roundDeterministic(tipThickness, 3),
          taperRatio: roundDeterministic(tipThickness / baseThickness, 6),
        },
      });
      nodePoints.set(original.startNodeId, curve.p0);
      nodePoints.set(original.endNodeId, curve.p3);
      previousPoint = curve.p3;
    });

    const territoryMap = territoryByOwner(input.territoryPlan.territories);
    const mappedJunctionByLineage = new Map(
      input.skeletonPlan.mappedJunctions.map((junction) => [
        junction.lineageRootId,
        junction,
      ] as const),
    );
    const endpointByPerson = new Map<PersonId, Vec2>();
    const majorLineageIds =
      input.graph.childrenByParentId.get(input.skeletonPlan.selectedRootId) ?? [];
    for (const lineageRootId of majorLineageIds) {
      const territory = territoryMap.get(lineageRootId);
      const junction = mappedJunctionByLineage.get(lineageRootId);
      if (!territory || !junction) continue;
      const junctionPoint =
        nodePoints.get(junction.trunkNodeId) ?? junction.trunkPoint;
      const frame = createCrownFrame(
        territory,
        junctionPoint,
        profile,
        config,
      );
      const leafLayout = computeLeafSpans(input.graph, lineageRootId);
      const stack: Array<{ readonly id: PersonId; readonly depth: number }> = [
        { id: lineageRootId, depth: 1 },
      ];
      while (stack.length > 0) {
        const current = stack.pop() as {
          readonly id: PersonId;
          readonly depth: number;
        };
        const span = leafLayout.spans.get(current.id);
        if (!span) continue;
        endpointByPerson.set(
          current.id,
          positionInCrown(
            current.depth,
            span,
            leafLayout.leafCount,
            leafLayout.maximumDepth,
            frame,
            config,
          ),
        );
        const children = input.graph.childrenByParentId.get(current.id) ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push({
            id: children[index] as PersonId,
            depth: current.depth + 1,
          });
        }
      }
    }

    const totalPeople = personBranch.size;
    const botanicalBranches = originalBranches
      .filter((branch) => !trunkIds.has(branch.id))
      .map((original) => {
        const person = input.graph.personsById.get(original.ownerPersonId);
        if (!person) throw new TypeError(`Unknown branch owner ${original.ownerPersonId}`);
        const end = endpointByPerson.get(original.ownerPersonId);
        if (!end) throw new TypeError(`Missing crown position for ${original.ownerPersonId}`);
        const start = person.parentId === input.skeletonPlan.selectedRootId
          ? nodePoints.get(original.startNodeId)
          : endpointByPerson.get(person.parentId as PersonId);
        if (!start) throw new TypeError(`Missing botanical parent position for ${original.id}`);
        const curve = curveBetween(
          start,
          end,
          original,
          input.skeletonPlan.seed,
          config,
        );
        nodePoints.set(original.startNodeId, curve.p0);
        nodePoints.set(original.endNodeId, curve.p3);
        return {
          ...original,
          curve,
          startPoint: curve.p0,
          endPoint: curve.p3,
          length: roundDeterministic(
            approximateCubicBezierLength(curve, {
              tolerance: input.configuration.geometry.bezierSubdivisionTolerance,
              maxSubdivisionDepth: input.configuration.geometry.maxSubdivisionDepth,
            }),
            config.roundingDecimalPlaces,
          ),
          thickness: hierarchyThickness(
            original.genealogyDepth,
            input.graph.getSubtree(original.ownerPersonId).length,
            totalPeople,
            config,
            profile,
          ),
        };
      });
    const initialBranches = [...trunkBranches, ...botanicalBranches].sort(branchOrder);
    const nodes: SkeletonNode[] = input.skeletonPlan.nodes.map((node) => ({
      ...node,
      point: nodePoints.get(node.id) ?? node.point,
    }));
    const mappedJunctions = input.skeletonPlan.mappedJunctions.map((junction) => ({
      ...junction,
      trunkPoint: nodePoints.get(junction.trunkNodeId) ?? junction.trunkPoint,
    }));
    const trunkLength = trunkBranches.reduce(
      (sum, branch) => sum + branch.length,
      0,
    );
    const provisional: SkeletonPlan = {
      ...input.skeletonPlan,
      skeletonPlanId: asSkeletonPlanId("botanical-territory-growth:pending"),
      trunk: {
        ...input.skeletonPlan.trunk,
        length: roundDeterministic(trunkLength, config.roundingDecimalPlaces),
        centroid: point({
          x: (trunkStart.x + previousPoint.x) / 2,
          y: (trunkStart.y + previousPoint.y) / 2,
        }, config.roundingDecimalPlaces),
      },
      branches: initialBranches,
      nodes,
      mappedJunctions,
      diagnostics: [
        ...input.skeletonPlan.diagnostics,
        {
          sequence: input.skeletonPlan.diagnostics.length,
          stage: "RECURSIVE_GROWTH",
          code: "BOTANICAL_TERRITORY_GROWTH_COMPLETE",
          metrics: {
            primaryTerritoryCount: majorLineageIds.length,
            botanicalBranchCount: botanicalBranches.length,
          },
        },
      ],
      validation: input.skeletonPlan.validation,
      deterministicFingerprint: "pending",
    };
    const territoryPolygons = new Map(
      input.territoryPlan.territories.map((territory) => [
        territory.id,
        territory.polygon,
      ]),
    );
    const branches = repairIntersections(
      provisional,
      input.graph,
      input.territoryPlan.templatePolygon,
      territoryPolygons,
      input.configuration,
      config,
    );
    const resolvedProvisional = { ...provisional, branches };
    const validation = new SkeletonValidator().validate(
      resolvedProvisional,
      input.graph,
      input.skeletonPlan.selectedRootId,
      input.territoryPlan.templatePolygon,
      territoryPolygons,
    );
    if (!validation.accepted) {
      throw new Error(
        `Botanical territory growth violated hard constraints: ${JSON.stringify({
          metrics: validation.metrics,
          intersections: validation.issues
            .filter((issue) => issue.code === "SKELETON_BRANCH_INTERSECTION")
            .slice(0, 40),
        })}`,
      );
    }
    const planFingerprint = await sha256Canonical({
      milestone: "BOTANICAL_TERRITORY_GROWTH",
      sourceSkeletonFingerprint: input.skeletonPlan.deterministicFingerprint,
      territoryPlanFingerprint: input.territoryPlan.deterministicFingerprint,
      seed: input.skeletonPlan.seed,
      config,
      trunk: resolvedProvisional.trunk,
      branches,
      nodes,
      mappedJunctions,
    });
    const skeletonPlanId = asSkeletonPlanId(
      `botanical-territory-growth:${planFingerprint.slice(0, 24)}`,
    );
    const skeletonPlan = freezeSkeletonPlan({
      ...resolvedProvisional,
      skeletonPlanId,
      validation,
      deterministicFingerprint: planFingerprint,
    });
    const hierarchy = hierarchyStatistics(branches);
    const terminalDepths = branches
      .filter((branch) =>
        branch.generation > 0 && branch.childrenBranchIds.length === 0
      )
      .map((branch) => branch.genealogyDepth);
    const metrics: BotanicalTerritoryGrowthMetrics = Object.freeze({
      branchCount: branches.length,
      primaryBranchCount: hierarchy.primary,
      secondaryBranchCount: hierarchy.secondary,
      maximumGenealogyDepth: Math.max(
        0,
        ...branches.map((branch) => branch.genealogyDepth),
      ),
      averageTwigDepth: roundDeterministic(
        terminalDepths.length === 0
          ? 0
          : terminalDepths.reduce((sum, value) => sum + value, 0) /
              terminalDepths.length,
        config.roundingDecimalPlaces,
      ),
      branchHierarchy: Object.freeze(hierarchy),
    });
    const deterministicFingerprint = await sha256Canonical({
      skeletonPlanFingerprint: planFingerprint,
      sourceSkeletonFingerprint: input.skeletonPlan.deterministicFingerprint,
      metrics,
    });
    return Object.freeze({
      skeletonPlan,
      sourceSkeletonFingerprint: input.skeletonPlan.deterministicFingerprint,
      deterministicFingerprint,
      metrics,
    });
  }
}
