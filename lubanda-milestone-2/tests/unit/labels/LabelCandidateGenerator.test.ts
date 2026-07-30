import { describe, expect, it } from "vitest";
import { DeterministicLabelCandidateGenerator } from "../../../src/core/labels/LabelCandidateGenerator.js";
import { OpentypeTextMeasurer } from "../../../src/core/labels/TextMeasurer.js";
import type { SkeletonBranchId, PersonId } from "../../../src/core/contracts/identifiers.js";
import type { SkeletonPlan, SkeletonBranch } from "../../../src/core/skeleton/types.js";
import type { GenealogyGraph } from "../../../src/core/genealogy/graph.js";
import type { Bounds, Vec2 } from "../../../src/core/geometry/types.js";
import type {
  LabelCandidateGenerationInput,
  CandidateCollisionQuery,
  LabelPlacement,
} from "../../../src/core/labels/types.js";
import { resolveTextDirection } from "../../../src/core/labels/types.js";

const FONT_PATH = new URL("../../../fonts/DejaVuSans.ttf", import.meta.url).pathname;

// -- Mock collision query --
class MockCollisionQuery implements CandidateCollisionQuery {
  _overlapsBranch = false;
  _clearance = 100;
  _leaderCross = false;
  _inside = true;
  boundaryClearanceVal = 100;

  overlapsFixedBranch(_cid: SkeletonBranchId, _b: Bounds, _a: Vec2, _r: number): boolean { return this._overlapsBranch; }
  overlapsFixedLabel(_b: Bounds, _fp: readonly LabelPlacement[]): boolean { return false; }
  isBoundsInsideBoundary(_b: Bounds): boolean { return this._inside; }
  isPointInsideBoundary(_p: Vec2): boolean { return this._inside; }
  leaderCrossesFixedObstacle(_a: Vec2, _b: Vec2): boolean { return this._leaderCross; }
  minClearanceToFixedBranches(_p: Vec2): number { return this._clearance; }
  boundaryClearance(_p: Vec2): number { return this.boundaryClearanceVal; }
  minBoundsBoundaryClearance(_b: Bounds): number { return this._inside ? 10 : -1; }
}

const FAKE_PID = "p1" as PersonId;

const makeBranch = (id: string, childIds: string[], pid?: PersonId): SkeletonBranch => ({
  id: id as SkeletonBranchId,
  ownerPersonId: pid ?? FAKE_PID,
  parentBranchId: null,
  generation: 1, genealogyDepth: 1, territoryId: null,
  curve: { p0: { x: 0, y: 0 }, p1: { x: 50, y: 50 }, p2: { x: 100, y: 50 }, p3: { x: 150, y: 0 } },
  startPoint: { x: 0, y: 0 }, endPoint: { x: 150, y: 0 }, length: 150,
  thickness: { baseThickness: 4, tipThickness: 2, taperRatio: 0.5 },
  startNodeId: "n1", endNodeId: "n2",
  childrenBranchIds: Object.freeze(childIds as SkeletonBranchId[]),
  candidateScore: 0.9, rejectionHistory: Object.freeze([]),
  metadata: Object.freeze({
    branchIndex: 1, lineageRootId: FAKE_PID,
    person: Object.freeze({
      id: pid ?? FAKE_PID, name: "Test Person",
      parentId: null, generation: 1, sourceRowNumber: 1,
      explicitDisplayOrder: null,
      source: { original: { id: (pid ?? FAKE_PID) as PersonId, name: "Test Person", parentId: null, generation: 1 } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  }),
});

const makeGraph = (terminalIds?: PersonId[]): GenealogyGraph => ({
  personsById: new Map(),
  childrenByParentId: new Map(),
  roots: ["root" as PersonId],
  getAncestors: () => [], getDescendants: () => [], getSubtree: () => [],
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

const makePlan = (branches: SkeletonBranch[]): SkeletonPlan => ({
  schemaVersion: "1.0", engineVersion: "0.2.0",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skeletonPlanId: "test" as any,
  status: "ACCEPTED",
  selectedRootId: FAKE_PID, sourceChecksum: "a".repeat(64), seed: 42,
  territoryPlanFingerprint: "b".repeat(64),
  trunk: Object.freeze({ baseNodeId: "n0", terminalNodeId: "n0", segments: Object.freeze([]), length: 0, centroid: { x: 0, y: 0 } }),
  branches: Object.freeze(branches), nodes: Object.freeze([]),
  mappedJunctions: Object.freeze([]), diagnostics: Object.freeze([]),
  validation: Object.freeze({
    accepted: true, issues: Object.freeze([]),
    metrics: Object.freeze({ branchCount: branches.length, nodeCount: 0, trunkSegmentCount: 0, junctionCount: 0, invalidBranchCount: 0, missingPersonBranchCount: 0, orphanBranchCount: 0, territoryMissCount: 0, outOfBoundsCount: 0, intersectionCount: 0, totalCurveLength: 0, maxDepth: 0, acceptedPersonCount: 0, connectedPersonCount: 0 }),
  }),
  configurationUsed: Object.freeze({ candidateCount: 10, maxCurvature: 0.45, minimumBranchLength: 18 }),
  metadata: Object.freeze({ algorithm: "RECURSIVE_ORGANIC_GROWTH", branchCount: branches.length, nodeCount: 0, maximumGenealogyDepth: 1, maximumSkeletonDepth: 1, totalInvalidCandidateCount: 0, totalRejectedCandidateCount: 0 }),
  deterministicFingerprint: "test",
});

const buildInput = async (
  branches: SkeletonBranch[],
  graph: GenealogyGraph,
  query?: CandidateCollisionQuery,
  pid?: PersonId,
  nameOverride?: string,
): Promise<LabelCandidateGenerationInput> => {
  const measurer = await makeMeasurer();
  const name = nameOverride ?? (pid ? "Person" : "Test Person");
  return {
    skeletonPlan: makePlan(branches),
    skeletonBranchMap: new Map(branches.map((b) => [b.id, b])),
    skeletonNodeMap: new Map(),
    graph,
    nameMap: new Map([[pid ?? FAKE_PID, name]]),
    configuration: Object.freeze({ minimumFontSize: 12, maximumRotationDegrees: 20, maximumBacktrackDepth: 10 }),
    collisionQuery: query ?? new MockCollisionQuery(),
    templateBoundary: Object.freeze({ points: Object.freeze([{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }]) }),
    textMeasurementService: measurer,
    cartoucheZones: undefined,
    fixedLabelPlacements: Object.freeze([]),
  };
};

describe("resolveTextDirection", () => {
  it("Latin-only text resolves to LTR", () => {
    expect(resolveTextDirection("Hello World")).toBe("LTR");
    expect(resolveTextDirection("John Smith ID-125")).toBe("LTR");
  });

  it("Arabic text resolves to RTL", () => {
    expect(resolveTextDirection("السلام")).toBe("RTL");
    expect(resolveTextDirection("محمد ID-125")).toBe("RTL");
  });
});

describe("DeterministicLabelCandidateGenerator", () => {
  it("generates 4+ candidates for a non-trunk branch", async () => {
    const branch = makeBranch("b1", []);
    const input = await buildInput([branch], makeGraph());
    const result = await new DeterministicLabelCandidateGenerator().generate(input);
    expect(result.allCandidates.length).toBeGreaterThanOrEqual(4);
    expect(result.totalGeneratablePeople).toBe(1);
  });

  it("generates aligned, above, below, and lateral families", async () => {
    const branch = makeBranch("b1", []);
    const result = await new DeterministicLabelCandidateGenerator().generate(
      await buildInput([branch], makeGraph()),
    );
    const fams = result.allCandidates.map((c) => c.family);
    expect(fams).toContain("ALIGNED_WITH_BRANCH");
    expect(fams).toContain("OFFSET_ABOVE_BRANCH");
    expect(fams).toContain("OFFSET_BELOW_BRANCH");
    expect(fams).toContain("LATERAL");
  });

  it("generates TERMINAL_LEAF for terminal person only", async () => {
    const br = makeBranch("b1", []);
    const term = await new DeterministicLabelCandidateGenerator().generate(
      await buildInput([br], makeGraph([FAKE_PID])),
    );
    expect(term.allCandidates.map((c) => c.family)).toContain("TERMINAL_LEAF");

    const nonTerm = makeBranch("b2", ["c1"]);
    const nt = await new DeterministicLabelCandidateGenerator().generate(
      await buildInput([nonTerm], makeGraph([])),
    );
    expect(nt.allCandidates.map((c) => c.family)).not.toContain("TERMINAL_LEAF");
  });

  it("generates cartouche only when zones supplied", async () => {
    const br = makeBranch("b1", []);
    const base = await buildInput([br], makeGraph());
    const gen = new DeterministicLabelCandidateGenerator();
    const no = await gen.generate(base);
    expect(no.allCandidates.map((c) => c.family)).not.toContain("CARTOUCHE_ZONE");

    const withZ: LabelCandidateGenerationInput = {
      ...base,
      cartoucheZones: Object.freeze([
        { zoneId: "z1", polygon: Object.freeze({ points: Object.freeze([]) }), anchor: { x: 200, y: 200 }, labelAlignment: "CENTER" as const },
      ]),
    };
    const yes = await gen.generate(withZ);
    expect(yes.allCandidates.map((c) => c.family)).toContain("CARTOUCHE_ZONE");
  });

  it("initial status VALID with null score", async () => {
    const result = await new DeterministicLabelCandidateGenerator().generate(
      await buildInput([makeBranch("b1", [])], makeGraph()),
    );
    for (const c of result.allCandidates) {
      expect(c.validationStatus).toBe("VALID");
      expect(c.score).toBeNull();
      expect(c.rejectionReasons).toEqual([]);
    }
  });

  it("all coordinates finite", async () => {
    const result = await new DeterministicLabelCandidateGenerator().generate(
      await buildInput([makeBranch("b1", [])], makeGraph()),
    );
    for (const c of result.allCandidates) {
      expect(Number.isFinite(c.bounds.minX)).toBe(true);
      expect(Number.isFinite(c.bounds.maxX)).toBe(true);
      expect(Number.isFinite(c.bounds.minY)).toBe(true);
      expect(Number.isFinite(c.bounds.maxY)).toBe(true);
      expect(Number.isFinite(c.anchor.x)).toBe(true);
      expect(Number.isFinite(c.anchor.y)).toBe(true);
    }
  });

  it("deterministic replay", async () => {
    const input = await buildInput([makeBranch("b1", [])], makeGraph());
    const gen = new DeterministicLabelCandidateGenerator();
    const r1 = await gen.generate(input);
    const r2 = await gen.generate(input);
    expect(r1.allCandidates.length).toBe(r2.allCandidates.length);
    for (let i = 0; i < r1.allCandidates.length; i += 1) {
      expect(r1.allCandidates[i]!.family).toBe(r2.allCandidates[i]!.family);
    }
  });

  it("aligned anchor matches branch endpoint", async () => {
    const branch = makeBranch("b1", []);
    const result = await new DeterministicLabelCandidateGenerator().generate(
      await buildInput([branch], makeGraph()),
    );
    const aligned = result.allCandidates.find((c) => c.family === "ALIGNED_WITH_BRANCH")!;
    expect(aligned.anchor.x).toBe(branch.endPoint.x);
    expect(aligned.anchor.y).toBe(branch.endPoint.y);
  });

  it("leader lengths are non-negative; rotation within limit", async () => {
    const result = await new DeterministicLabelCandidateGenerator().generate(
      await buildInput([makeBranch("b1", [])], makeGraph()),
    );
    for (const c of result.allCandidates) {
      expect(c.leaderLength).toBeGreaterThanOrEqual(0);
      expect(Math.abs(c.rotation)).toBeLessThanOrEqual(20.01);
    }
  });

  // -- Arabic/Bidi integration tests --
  describe("Arabic / Bidi measurement", () => {
    it("measures Muhammad (محمد) via real M7.1 text measurer", async () => {
      const result = await new DeterministicLabelCandidateGenerator().generate(
        await buildInput([makeBranch("b1", [])], makeGraph(), undefined, "p1" as PersonId, "محمد"),
      );
      expect(result.allCandidates.length).toBeGreaterThanOrEqual(4);
      for (const c of result.allCandidates) {
        expect(c.bounds.minX).toBeLessThan(c.bounds.maxX);
        expect(c.bounds.minY).toBeLessThan(c.bounds.maxY);
      }
    });

    it("mixed Arabic/Latin محمد ID-125 — uses real measurement", async () => {
      const result = await new DeterministicLabelCandidateGenerator().generate(
        await buildInput([makeBranch("b2", [])], makeGraph(), undefined, "p2" as PersonId, "محمد ID-125"),
      );
      expect(result.allCandidates.length).toBeGreaterThanOrEqual(4);
    });

    it("الجيل 12 — Arabic with digits", async () => {
      const result = await new DeterministicLabelCandidateGenerator().generate(
        await buildInput([makeBranch("b3", [])], makeGraph(), undefined, "p3" as PersonId, "الجيل 12"),
      );
      expect(result.allCandidates.length).toBeGreaterThanOrEqual(4);
    });

    it("فرع A-17 — Arabic with Latin-numeric ID", async () => {
      const result = await new DeterministicLabelCandidateGenerator().generate(
        await buildInput([makeBranch("b4", [])], makeGraph(), undefined, "p4" as PersonId, "فرع A-17"),
      );
      expect(result.allCandidates.length).toBeGreaterThanOrEqual(4);
    });
  });
});
