import { describe, expect, it } from "vitest";
import { DeterministicLabelCandidateGenerator } from "../../../src/core/labels/LabelCandidateGenerator.js";
import { OpentypeTextMeasurer } from "../../../src/core/labels/TextMeasurer.js";
import type { SkeletonBranchId, PersonId } from "../../../src/core/contracts/identifiers.js";
import type { SkeletonPlan, SkeletonBranch } from "../../../src/core/skeleton/types.js";
import type { GenealogyGraph } from "../../../src/core/genealogy/graph.js";
import type {
  LabelCandidateGenerationInput,
  CandidateCollisionQuery,
} from "../../../src/core/labels/types.js";
import type { Vec2, Bounds } from "../../../src/core/geometry/types.js";
import type { LabelPlacement } from "../../../src/core/labels/types.js";

const FONT_PATH = new URL(
  "../../../fonts/DejaVuSans.ttf",
  import.meta.url,
).pathname;

// ── Mock CandidateCollisionQuery ──

class MockCollisionQuery implements CandidateCollisionQuery {
  readonly inside: boolean;
  readonly overlaps: boolean;
  readonly leaderCrosses: boolean;
  constructor(opts: { inside?: boolean; overlaps?: boolean; leaderCrosses?: boolean } = {}) {
    this.inside = opts.inside ?? true;
    this.overlaps = opts.overlaps ?? false;
    this.leaderCrosses = opts.leaderCrosses ?? false;
  }

  overlapsFixedObstacle(_bounds: Bounds, _excludeAnchor?: Vec2, _anchorRadius?: number): boolean {
    return this.overlaps;
  }
  minClearanceToFixedBranches(_point: Vec2): number { return 100; }
  leaderCrossesFixedObstacle(_a: Vec2, _b: Vec2): boolean { return this.leaderCrosses; }
  isInsideBoundary(_point: Vec2, _margin?: number): boolean { return this.inside; }
}

// ── Test data ──

const FAKE_PERSON_ID = "p1" as PersonId;

const makeMockBranch = (id: string, childIds: string[], pid?: PersonId): SkeletonBranch => ({
  id: id as SkeletonBranchId,
  ownerPersonId: pid ?? FAKE_PERSON_ID,
  parentBranchId: null,
  generation: 1,
  genealogyDepth: 1,
  territoryId: null,
  curve: { p0: { x: 0, y: 0 }, p1: { x: 50, y: 50 }, p2: { x: 100, y: 50 }, p3: { x: 150, y: 0 } },
  startPoint: { x: 0, y: 0 },
  endPoint: { x: 150, y: 0 },
  length: 150,
  thickness: { baseThickness: 4, tipThickness: 2, taperRatio: 0.5 },
  startNodeId: "n1",
  endNodeId: "n2",
  childrenBranchIds: Object.freeze(childIds as SkeletonBranchId[]),
  candidateScore: 0.9,
  rejectionHistory: Object.freeze([]),
  metadata: Object.freeze({
    branchIndex: 1,
    lineageRootId: FAKE_PERSON_ID,
    person: Object.freeze({
      id: pid ?? FAKE_PERSON_ID,
      name: "Test Person",
      parentId: null, generation: 1, sourceRowNumber: 1,
      explicitDisplayOrder: null,
      source: { original: { id: (pid ?? FAKE_PERSON_ID), name: "Test Person", parentId: null, generation: 1 } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  }),
});

const makeMockGraph = (terminalIds?: PersonId[]): GenealogyGraph => ({
  personsById: new Map(),
  childrenByParentId: new Map(),
  roots: ["root" as PersonId],
  getAncestors: () => [],
  getDescendants: () => [],
  getSubtree: () => [],
  isTerminal: (id: PersonId) => terminalIds?.includes(id) ?? false,
});

const makeMeasurer = async (): Promise<OpentypeTextMeasurer> => {
  const m = new OpentypeTextMeasurer(
    [{ family: "DejaVu Sans", weight: 400, style: "normal" as const, path: FONT_PATH }],
    4,
  );
  await m.initialize();
  return m;
};

const makeSkeletonPlan = (branches: SkeletonBranch[]): SkeletonPlan => ({
  schemaVersion: "1.0",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skeletonPlanId: "test" as any,
  status: "ACCEPTED",
  selectedRootId: FAKE_PERSON_ID,
  sourceChecksum: "a".repeat(64),
  seed: 42,
  territoryPlanFingerprint: "b".repeat(64),
  trunk: Object.freeze({ baseNodeId: "n0", terminalNodeId: "n0", segments: Object.freeze([]), length: 0, centroid: { x: 0, y: 0 } }),
  branches: Object.freeze(branches),
  nodes: Object.freeze([]),
  mappedJunctions: Object.freeze([]),
  diagnostics: Object.freeze([]),
  validation: Object.freeze({ accepted: true, issues: Object.freeze([]), metrics: Object.freeze({ branchCount: branches.length, nodeCount: 0, trunkSegmentCount: 0, junctionCount: 0, invalidBranchCount: 0, missingPersonBranchCount: 0, orphanBranchCount: 0, territoryMissCount: 0, outOfBoundsCount: 0, intersectionCount: 0, totalCurveLength: 0, maxDepth: 0, acceptedPersonCount: 0, connectedPersonCount: 0 }) }),
  configurationUsed: Object.freeze({ candidateCount: 10, maxCurvature: 0.45, minimumBranchLength: 18 }),
  metadata: Object.freeze({ algorithm: "RECURSIVE_ORGANIC_GROWTH", branchCount: branches.length, nodeCount: 0, maximumGenealogyDepth: 1, maximumSkeletonDepth: 1, totalInvalidCandidateCount: 0, totalRejectedCandidateCount: 0 }),
  deterministicFingerprint: "test",
});

const buildInput = async (
  branches: SkeletonBranch[],
  graph: GenealogyGraph,
  query?: CandidateCollisionQuery,
  pid?: PersonId,
): Promise<LabelCandidateGenerationInput> => {
  const measurer = await makeMeasurer();
  const branchMap = new Map(branches.map((b) => [b.id, b]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeMap = new Map<string, any>();
  const nameMap = new Map([[pid ?? FAKE_PERSON_ID, pid ? "Person" : "Test Person"]]);
  return {
    skeletonPlan: makeSkeletonPlan(branches),
    skeletonBranchMap: branchMap,
    skeletonNodeMap: nodeMap,
    graph,
    nameMap,
    configuration: Object.freeze({ minimumFontSize: 12, maximumRotationDegrees: 20 }),
    collisionQuery: query ?? new MockCollisionQuery(),
    templateBoundary: Object.freeze({ points: Object.freeze([{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }]) }),
    textMeasurementService: measurer,
    cartoucheZones: undefined,
    fixedLabelPlacements: Object.freeze([]) as readonly LabelPlacement[],
  };
};

describe("DeterministicLabelCandidateGenerator", () => {
  it("generates candidates for a non-trunk branch", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph();
    const input = await buildInput([branch], graph);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);

    expect(result.allCandidates.length).toBeGreaterThanOrEqual(4);
    expect(result.totalGeneratablePeople).toBe(1);
  });

  it("generates aligned, above, below, and lateral candidates", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph();
    const input = await buildInput([branch], graph);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);

    const families = result.allCandidates.map((c) => c.family);
    expect(families).toContain("ALIGNED_WITH_BRANCH");
    expect(families).toContain("OFFSET_ABOVE_BRANCH");
    expect(families).toContain("OFFSET_BELOW_BRANCH");
    expect(families).toContain("LATERAL");
  });

  it("generates terminal leaf candidate for terminal person", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph([FAKE_PERSON_ID]);
    const input = await buildInput([branch], graph);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);

    const families = result.allCandidates.map((c) => c.family);
    expect(families).toContain("TERMINAL_LEAF");
  });

  it("does NOT generate terminal leaf for non-terminal person", async () => {
    const branch = makeMockBranch("b1", ["child1"]);
    const graph = makeMockGraph([]);
    const input = await buildInput([branch], graph);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);

    const families = result.allCandidates.map((c) => c.family);
    expect(families).not.toContain("TERMINAL_LEAF");
  });

  it("generates cartouche candidates only when zones are supplied", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph();
    const input = await buildInput([branch], graph);
    // With no cartouche zones
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);

    const families = result.allCandidates.map((c) => c.family);
    expect(families).not.toContain("CARTOUCHE_ZONE");
  });

  it("generates cartouche candidates when zones are supplied", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph();
    const input = await buildInput([branch], graph, undefined, FAKE_PERSON_ID);
    const inputWithZones: LabelCandidateGenerationInput = {
      ...input,
      cartoucheZones: Object.freeze([
        { zoneId: "z1", polygon: Object.freeze({ points: Object.freeze([]) }), anchor: { x: 200, y: 200 }, labelAlignment: "CENTER" as const },
      ]),
    };
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(inputWithZones);

    const families = result.allCandidates.map((c) => c.family);
    expect(families).toContain("CARTOUCHE_ZONE");
  });

  it("all candidates have initial validationStatus = VALID and score = null", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph();
    const input = await buildInput([branch], graph);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);

    for (const c of result.allCandidates) {
      expect(c.validationStatus).toBe("VALID");
      expect(c.score).toBeNull();
      expect(c.rejectionReasons).toEqual([]);
    }
  });

  it("all candidates have finite bounds", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph();
    const input = await buildInput([branch], graph);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);

    for (const c of result.allCandidates) {
      expect(Number.isFinite(c.bounds.minX)).toBe(true);
      expect(Number.isFinite(c.bounds.minY)).toBe(true);
      expect(Number.isFinite(c.bounds.maxX)).toBe(true);
      expect(Number.isFinite(c.bounds.maxY)).toBe(true);
      expect(Number.isFinite(c.anchor.x)).toBe(true);
      expect(Number.isFinite(c.anchor.y)).toBe(true);
    }
  });

  it("generates deterministic output (same input = same result)", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph();
    const input = await buildInput([branch], graph);
    const gen = new DeterministicLabelCandidateGenerator();
    const result1 = await gen.generate(input);
    const result2 = await gen.generate(input);

    expect(result1.allCandidates.length).toBe(result2.allCandidates.length);
    for (let i = 0; i < result1.allCandidates.length; i += 1) {
      expect(result1.allCandidates[i]!.family).toBe(result2.allCandidates[i]!.family);
    }
  });

  it("candidate anchor matches branch endpoint for aligned family", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph();
    const input = await buildInput([branch], graph);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);

    const aligned = result.allCandidates.find((c) => c.family === "ALIGNED_WITH_BRANCH");
    expect(aligned).toBeDefined();
    expect(aligned!.anchor.x).toBe(branch.endPoint.x);
    expect(aligned!.anchor.y).toBe(branch.endPoint.y);
  });

  it("candidates have non-negative leader lengths", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph();
    const input = await buildInput([branch], graph);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);

    for (const c of result.allCandidates) {
      expect(c.leaderLength).toBeGreaterThanOrEqual(0);
    }
  });

  it("rotation is within configured limits", async () => {
    const branch = makeMockBranch("b1", []);
    const graph = makeMockGraph();
    const input = await buildInput([branch], graph);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);

    for (const c of result.allCandidates) {
      expect(Math.abs(c.rotation)).toBeLessThanOrEqual(20.01);
    }
  });
});
