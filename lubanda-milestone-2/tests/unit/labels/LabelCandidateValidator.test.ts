import { describe, expect, it } from "vitest";
import { validateCandidate } from "../../../src/core/labels/LabelCandidateValidator.js";
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
    public boundaryInside = true,
  ) {}
  overlapsFixedObstacle(_b: Bounds, _e?: Vec2, _r?: number): boolean { return this.overlap; }
  minClearanceToFixedBranches(_p: Vec2): number { return this.clearance; }
  leaderCrossesFixedObstacle(_a: Vec2, _b: Vec2): boolean { return this.leaderCross; }
  isInsideBoundary(_p: Vec2, _m?: number): boolean { return this.boundaryInside; }
}

const makeBranch = (): SkeletonBranch => ({
  id: "b1" as SkeletonBranchId,
  ownerPersonId: "p1" as PersonId,
  parentBranchId: null,
  generation: 1,
  genealogyDepth: 1,
  territoryId: null,
  curve: { p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 } },
  startPoint: { x: 0, y: 0 },
  endPoint: { x: 150, y: 0 },
  length: 150,
  thickness: { baseThickness: 4, tipThickness: 2, taperRatio: 0.5 },
  startNodeId: "n1",
  endNodeId: "n2",
  childrenBranchIds: Object.freeze([]),
  candidateScore: null,
  rejectionHistory: Object.freeze([]),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Object.freeze({ branchIndex: 1, lineageRootId: "p1" as PersonId, person: null as any }),
});

const makeCandidate = (overrides: Partial<LabelCandidate> = {}): LabelCandidate => ({
  personId: "p1" as PersonId,
  bounds: { minX: 0, minY: 0, maxX: 50, maxY: 12 },
  anchor: { x: 150, y: 0 },
  rotation: 0,
  leaderLength: 0,
  family: "ALIGNED_WITH_BRANCH",
  validationStatus: "VALID",
  rejectionReasons: Object.freeze([]),
  score: null,
  componentScores: undefined,
  ...overrides,
});

describe("LabelCandidateValidator", () => {
  it("returns VALID for a candidate with no collisions", () => {
    const branch = makeBranch();
    const result = validateCandidate(
      makeCandidate(),
      branch,
      { minimumFontSize: 12, maximumRotationDegrees: 20 },
      new MockQuery(false),
      [],
      false,
    );
    expect(result.status).toBe("VALID");
  });

  it("returns INVALID when branch is null", () => {
    const result = validateCandidate(
      makeCandidate(),
      null,
      { minimumFontSize: 12, maximumRotationDegrees: 20 },
      new MockQuery(false),
      [],
      false,
    );
    expect(result.status).toBe("INVALID");
    expect(result.rejectionReasons.some((r) => r.code === "NO_BRANCH_FOR_PERSON")).toBe(true);
  });

  it("returns INVALID when rotation exceeds limit", () => {
    const branch = makeBranch();
    const result = validateCandidate(
      makeCandidate({ rotation: 30 }),
      branch,
      { minimumFontSize: 12, maximumRotationDegrees: 20 },
      new MockQuery(false),
      [],
      false,
    );
    // Rotation > 20 -> INVALID
    expect(result.status).toBe("INVALID");
    expect(result.rejectionReasons.some((r) => r.code === "ROTATION_EXCEEDS_LIMIT")).toBe(true);
  });

  it("returns INVALID when candidate overlaps branch envelope", () => {
    const branch = makeBranch();
    const result = validateCandidate(
      makeCandidate(),
      branch,
      { minimumFontSize: 12, maximumRotationDegrees: 20 },
      new MockQuery(true), // overlap
      [],
      false,
    );
    expect(result.status).toBe("INVALID");
    expect(result.rejectionReasons.some((r) => r.code === "BRANCH_PENETRATION")).toBe(true);
  });

  it("returns INVALID when candidate is outside boundary", () => {
    const branch = makeBranch();
    const result = validateCandidate(
      makeCandidate(),
      branch,
      { minimumFontSize: 12, maximumRotationDegrees: 20 },
      new MockQuery(false, 20, false, false), // boundaryInside: false
      [],
      false,
    );
    expect(result.status).toBe("INVALID");
    expect(result.rejectionReasons.some((r) => r.code === "BOUNDARY_VIOLATION")).toBe(true);
  });

  it("returns INVALID for non-finite geometry", () => {
    const branch = makeBranch();
    const result = validateCandidate(
      makeCandidate({ bounds: { minX: Infinity, minY: 0, maxX: 0, maxY: 0 } } as LabelCandidate),
      branch,
      { minimumFontSize: 12, maximumRotationDegrees: 20 },
      new MockQuery(false),
      [],
      false,
    );
    expect(result.status).toBe("INVALID");
  });

  it("returns INVALID when leader crosses fixed obstacle", () => {
    const branch = makeBranch();
    const result = validateCandidate(
      makeCandidate({ leaderLength: 10, anchor: { x: 0, y: 0 }, bounds: { minX: 100, minY: 0, maxX: 150, maxY: 12 } }),
      branch,
      { minimumFontSize: 12, maximumRotationDegrees: 20 },
      new MockQuery(false, 20, true), // leaderCrosses: true
      [],
      false,
    );
    expect(result.status).toBe("INVALID");
    expect(result.rejectionReasons.some((r) => r.code === "LEADER_CROSSING")).toBe(true);
  });

  it("returns INVALID when candidate overlaps a fixed label placement", () => {
    const branch = makeBranch();
    const fixed: LabelPlacement[] = [
      {
        personId: "p2" as PersonId,
        bounds: { minX: 0, minY: 0, maxX: 60, maxY: 12 },
        anchor: { x: 0, y: 0 },
        rotation: 0,
        leaderLength: 0,
        family: "ALIGNED_WITH_BRANCH",
        text: "Fixed", fontFamily: "test", fontSize: 12, fontWeight: 400,
      },
    ];
    const result = validateCandidate(
      makeCandidate({ bounds: { minX: 10, minY: 0, maxX: 50, maxY: 12 } }),
      branch,
      { minimumFontSize: 12, maximumRotationDegrees: 20 },
      new MockQuery(false),
      fixed,
      false,
    );
    expect(result.status).toBe("INVALID");
    expect(result.rejectionReasons.some((r) => r.code === "OVERLAPS_FIXED_LABEL")).toBe(true);
  });

  it("reasons include structured details", () => {
    const branch = makeBranch();
    const result = validateCandidate(
      makeCandidate({ rotation: 30 }),
      branch,
      { minimumFontSize: 12, maximumRotationDegrees: 20 },
      new MockQuery(false),
      [],
      false,
    );
    const rotReason = result.rejectionReasons.find((r) => r.code === "ROTATION_EXCEEDS_LIMIT");
    expect(rotReason).toBeDefined();
    expect(rotReason!.details).toBeDefined();
  });
});
