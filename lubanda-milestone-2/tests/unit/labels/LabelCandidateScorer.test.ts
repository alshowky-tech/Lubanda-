import { describe, expect, it } from "vitest";
import { scoreCandidates, getRankedValidCandidates } from "../../../src/core/labels/LabelCandidateScorer.js";
import type { SkeletonBranchId, PersonId } from "../../../src/core/contracts/identifiers.js";
import type { SkeletonBranch } from "../../../src/core/skeleton/types.js";
import type {
  CandidateCollisionQuery,
  LabelCandidate,
  LabelPlacement,
} from "../../../src/core/labels/types.js";
import type { Bounds, Vec2 } from "../../../src/core/geometry/types.js";

class MockQuery implements CandidateCollisionQuery {
  constructor(
    public overlap = false,
    public clearance = 20,
    public leaderCross = false,
    public inside = true,
  ) {}
  overlapsFixedBranch(_cid: SkeletonBranchId, _b: Bounds, _a: Vec2, _r: number): boolean { return this.overlap; }
  overlapsFixedLabel(_b: Bounds, _fp: readonly LabelPlacement[]): boolean { return false; }
  isBoundsInsideBoundary(_b: Bounds): boolean { return this.inside; }
  isPointInsideBoundary(_p: Vec2): boolean { return this.inside; }
  leaderCrossesFixedObstacle(_a: Vec2, _b: Vec2): boolean { return this.leaderCross; }
  minClearanceToFixedBranches(_p: Vec2): number { return this.clearance; }
  boundaryClearance(_p: Vec2): number { return 100; }
  minBoundsBoundaryClearance(_b: Bounds): number { return 100; }
}

const makeBranch = (id: string): SkeletonBranch => ({
  id: id as SkeletonBranchId,
  ownerPersonId: "p1" as PersonId,
  parentBranchId: null, generation: 1, genealogyDepth: 1, territoryId: null,
  curve: { p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 } },
  startPoint: { x: 0, y: 0 }, endPoint: { x: 150, y: 0 }, length: 150,
  thickness: { baseThickness: 4, tipThickness: 2, taperRatio: 0.5 },
  startNodeId: "n1", endNodeId: "n2", childrenBranchIds: Object.freeze([]),
  candidateScore: null, rejectionHistory: Object.freeze([]),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Object.freeze({ branchIndex: 1, lineageRootId: "p1" as PersonId, person: null as any }),
});

const makeCandidate = (
  personId: PersonId,
  family: LabelCandidate["family"],
  overrides?: Partial<LabelCandidate>,
): LabelCandidate => ({
  personId, bounds: { minX: 0, minY: 0, maxX: 50, maxY: 12 },
  anchor: { x: 0, y: 0 }, rotation: 0, leaderLength: 0,
  family, validationStatus: "VALID",
  rejectionReasons: Object.freeze([]), score: null,
  componentScores: undefined,
  ...overrides,
});

describe("LabelCandidateScorer", () => {
  it("scores VALID candidates in [0, 1]", () => {
    const branch = makeBranch("b1");
    const bm = new Map([[branch.id, branch]]);
    const c = makeCandidate("p1" as PersonId, "ALIGNED_WITH_BRANCH");
    const s = scoreCandidates([c], bm, { minimumFontSize: 12, maximumRotationDegrees: 20, maximumBacktrackDepth: 10 }, new MockQuery(), []);
    expect(s[0]!.score).not.toBeNull();
    expect(s[0]!.score!).toBeGreaterThanOrEqual(0);
    expect(s[0]!.score!).toBeLessThanOrEqual(1);
    expect(s[0]!.validationStatus).toBe("VALID");
  });

  it("INVALID when branch overlap; score null; reasons present", () => {
    const branch = makeBranch("b1");
    const s = scoreCandidates(
      [makeCandidate("p1" as PersonId, "ALIGNED_WITH_BRANCH")],
      new Map([[branch.id, branch]]),
      { minimumFontSize: 12, maximumRotationDegrees: 20, maximumBacktrackDepth: 10 },
      new MockQuery(true),
      [],
    );
    expect(s[0]!.validationStatus).toBe("INVALID");
    expect(s[0]!.score).toBeNull();
    expect(s[0]!.rejectionReasons.length).toBeGreaterThan(0);
  });

  it("INVALID excluded from ranked valid set", () => {
    const branch = makeBranch("b1");
    const bm = new Map([[branch.id, branch]]);
    const s = scoreCandidates(
      [makeCandidate("p1" as PersonId, "ALIGNED_WITH_BRANCH")],
      bm, { minimumFontSize: 12, maximumRotationDegrees: 20, maximumBacktrackDepth: 10 }, new MockQuery(true), [],
    );
    expect(getRankedValidCandidates(s).length).toBe(0);
  });

  it("deterministic tie-breaking", () => {
    const branch = makeBranch("b1");
    const bm = new Map([[branch.id, branch]]);
    const cfg = { minimumFontSize: 12, maximumRotationDegrees: 20, maximumBacktrackDepth: 10 };
    const a = makeCandidate("pA" as PersonId, "ALIGNED_WITH_BRANCH", { bounds: { minX: 0, minY: 0, maxX: 40, maxY: 10 }, anchor: { x: 0, y: 0 } });
    const b = makeCandidate("pB" as PersonId, "ALIGNED_WITH_BRANCH", { bounds: { minX: 0, minY: 0, maxX: 40, maxY: 10 }, anchor: { x: 0, y: 0 } });
    const s1 = scoreCandidates([a, b], bm, cfg, new MockQuery(), []);
    const s2 = scoreCandidates([b, a], bm, cfg, new MockQuery(), []);
    expect(s1.length).toBe(s2.length);
  });

  it("exposes component scores", () => {
    const branch = makeBranch("b1");
    const s = scoreCandidates(
      [makeCandidate("p1" as PersonId, "ALIGNED_WITH_BRANCH")],
      new Map([[branch.id, branch]]),
      { minimumFontSize: 12, maximumRotationDegrees: 20, maximumBacktrackDepth: 10 }, new MockQuery(), [],
    );
    const comp = s[0]!.componentScores;
    expect(comp).toBeDefined();
    expect(comp!.rotation).toBeGreaterThanOrEqual(0);
    expect(comp!.anchorDistance).toBeGreaterThanOrEqual(0);
    expect(comp!.clearance).toBeGreaterThanOrEqual(0);
    expect(comp!.rhythm).toBeGreaterThanOrEqual(0);
  });

  it("configurable weights produce different scores", () => {
    const branch = makeBranch("b1");
    const bm = new Map([[branch.id, branch]]);
    const cfg = { minimumFontSize: 12, maximumRotationDegrees: 20, maximumBacktrackDepth: 10 };
    const c = makeCandidate("p1" as PersonId, "ALIGNED_WITH_BRANCH", { rotation: 15, bounds: { minX: 0, minY: 0, maxX: 50, maxY: 12 }, anchor: { x: 100, y: 100 } });
    const w1 = { obstacleCollision: 0.35, anchorDistance: 0.25, rotation: 0.15, localRhythm: 0.10, branchClearance: 0.15 };
    const w2 = { obstacleCollision: 0.10, anchorDistance: 0.50, rotation: 0.05, localRhythm: 0.10, branchClearance: 0.25 };
    const s1 = scoreCandidates([c], bm, cfg, new MockQuery(false, 100), [], w1);
    const s2 = scoreCandidates([c], bm, cfg, new MockQuery(false, 100), [], w2);
    expect(Math.abs((s1[0]!.score ?? 0) - (s2[0]!.score ?? 0))).toBeGreaterThan(0);
  });

  it("deterministic per same inputs", () => {
    const branch = makeBranch("b1");
    const bm = new Map([[branch.id, branch]]);
    const cfg = { minimumFontSize: 12, maximumRotationDegrees: 20, maximumBacktrackDepth: 10 };
    const a = makeCandidate("p1" as PersonId, "ALIGNED_WITH_BRANCH");
    const b = makeCandidate("p2" as PersonId, "OFFSET_ABOVE_BRANCH");
    const r1 = scoreCandidates([a, b], bm, cfg, new MockQuery(), []);
    const r2 = scoreCandidates([a, b], bm, cfg, new MockQuery(), []);
    expect(r1.length).toBe(r2.length);
    for (let i = 0; i < r1.length; i += 1) {
      expect(r1[i]!.score).toBe(r2[i]!.score);
    }
  });
});
