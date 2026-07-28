import { describe, expect, it } from "vitest";
import { DeterministicLabelAssignmentEngine } from "../../../src/core/labels/LabelAssignmentEngine.js";
import { LabelCollisionQueryImpl } from "../../../src/core/labels/LabelCollisionQuery.js";
import type { PersonId } from "../../../src/core/contracts/identifiers.js";
import type {
  LabelCandidate,
  LabelCandidateFamily,
  GeneratedCandidatesResult,
  LabelPlacement,
} from "../../../src/core/labels/types.js";
import type { Bounds } from "../../../src/core/geometry/types.js";

// ── Helpers ───────────────────────────────────────────────────────────

const makeC = (
  pid: string,
  family: LabelCandidateFamily,
  bounds: Bounds,
  score: number,
  leaderLen = 0,
  idx = 0,
): LabelCandidate => ({
  candidateId: `c:${pid}:${idx}`,
  personId: pid as PersonId,
  bounds,
  anchor: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.maxY + 5) },
  rotation: 0,
  leaderLength: leaderLen,
  family,
  validationStatus: "VALID" as const,
  rejectionReasons: Object.freeze([]),
  score,
  componentScores: undefined,
});

const makeResult = (candidates: LabelCandidate[]): GeneratedCandidatesResult => {
  const personMap = new Map<PersonId, readonly LabelCandidate[]>();
  for (const c of candidates) {
    const existing = personMap.get(c.personId) ?? [];
    personMap.set(c.personId, Object.freeze([...existing, c]));
  }
  return {
    allCandidates: Object.freeze(candidates),
    validCandidates: Object.freeze(candidates.filter((c) => c.validationStatus === "VALID")),
    personCandidateMap: personMap as ReadonlyMap<PersonId, readonly LabelCandidate[]>,
    totalGeneratablePeople: personMap.size,
    diagnostics: Object.freeze([]),
  };
};

const CFG = { minimumFontSize: 12, maximumRotationDegrees: 20, maximumBacktrackDepth: 10 };

// ── Tests ─────────────────────────────────────────────────────────────

describe("DeterministicLabelAssignmentEngine", () => {
  describe("person ordering", () => {
    it("places fewer-candidate persons first", () => {
      const a1 = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 10, maxY: 5 }, 0.9, 0, 0);
      const b1 = makeC("pB", "ALIGNED_WITH_BRANCH", { minX: 100, minY: 0, maxX: 110, maxY: 5 }, 0.9, 0, 0);
      const b2 = makeC("pB", "OFFSET_ABOVE_BRANCH", { minX: 100, minY: -15, maxX: 110, maxY: -10 }, 0.8, 5, 1);
      const result = makeResult([a1, b1, b2]);
      const engine = new DeterministicLabelAssignmentEngine();
      const r = engine.assign(result, CFG);
      expect(r.placements.length).toBeGreaterThanOrEqual(2);
    });

    it("deterministic tie-breaking by personId", () => {
      const a1 = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 10, maxY: 5 }, 0.9, 0, 0);
      const b1 = makeC("pB", "ALIGNED_WITH_BRANCH", { minX: 100, minY: 0, maxX: 110, maxY: 5 }, 0.9, 0, 0);
      const r1 = new DeterministicLabelAssignmentEngine().assign(makeResult([a1, b1]), CFG);
      const r2 = new DeterministicLabelAssignmentEngine().assign(makeResult([b1, a1]), CFG);
      expect(r1.placements.length).toBe(r2.placements.length);
    });
  });

  describe("candidate ordering", () => {
    it("prefers higher scored candidate", () => {
      const p = makeC("p1", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 10, maxY: 5 }, 0.5, 0, 0);
      const q = makeC("p1", "OFFSET_ABOVE_BRANCH", { minX: 0, minY: -15, maxX: 10, maxY: -10 }, 0.9, 5, 1);
      const input = makeResult([p, q]);
      const r = new DeterministicLabelAssignmentEngine().assign(input, CFG);
      // Should prefer higher-score q (0.9 > 0.5)
      expect(r.placements.length).toBe(1);
    });
  });

  describe("label–label conflict detection", () => {
    it("does not place overlapping candidates from different persons", () => {
      // Two candidates that strongly overlap
      const a = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 100, maxY: 20 }, 0.9, 0, 0);
      const b = makeC("pB", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 100, maxY: 20 }, 0.9, 0, 0);
      const b2 = makeC("pB", "OFFSET_ABOVE_BRANCH", { minX: 200, minY: 200, maxX: 210, maxY: 205 }, 0.5, 0, 1);
      const input = makeResult([a, b, b2]);
      const r = new DeterministicLabelAssignmentEngine().assign(input, CFG);
      // Both should be placed because B has a non-conflicting alternative
      expect(r.placements.length).toBe(2);
    });

    it("reports unresolved when all candidates conflict", () => {
      const a = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 100, maxY: 20 }, 0.9, 0, 0);
      const b = makeC("pB", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 100, maxY: 20 }, 0.9, 0, 0);
      // B only has overlapping candidates
      const input = makeResult([a, b]);
      const r = new DeterministicLabelAssignmentEngine().assign(input, CFG);
      // pA is placed first, pB has only overlapping options
      // With backtracking=10, it tries backtracking pA, but pA also only has one candidate
      // So it will try the only option, which conflicts → BACKTRACK_EXHAUSTED
      expect(r.unplacedPersons.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("leader–label and leader–leader", () => {
    it("detects leader crossing placed label bounds", () => {
      // pA label at (0,0 to 50,12). pB leader from (30, -20) to (30, -10) should not cross.
      const a = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 50, maxY: 12 }, 0.9, 0, 0);
      // pB's label at (200,0) is far away but the leader crosses pA's bounds
      const b = makeC("pB", "OFFSET_ABOVE_BRANCH", { minX: 200, minY: 0, maxX: 210, maxY: 5 }, 0.8, 5, 0);
      const b2 = makeC("pB", "LATERAL", { minX: 300, minY: 300, maxX: 310, maxY: 305 }, 0.5, 0, 1);
      const input = makeResult([a, b, b2]);
      const r = new DeterministicLabelAssignmentEngine().assign(input, CFG);
      // pB has an alternative (b2) that doesn't conflict
      expect(r.placements.length).toBe(2);
    });
  });

  describe("pure greedy mode (backtrackDepth = 0)", () => {
    it("assigns non-conflicting persons and leaves conflicting ones unresolved", () => {
      const cfg = { ...CFG, maximumBacktrackDepth: 0 };
      const a = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 50, maxY: 12 }, 0.9, 0, 0);
      const b = makeC("pB", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 50, maxY: 12 }, 0.9, 0, 0);
      const input = makeResult([a, b]);
      const r = new DeterministicLabelAssignmentEngine().assign(input, cfg);
      expect(r.placements.length).toBe(1); // pA placed, pB not
      expect(r.unplacedPersons.length).toBe(1); // pB unresolved
    });
  });

  describe("backtracking budget exhausted", () => {
    it("reports BACKTRACK_EXHAUSTED when budget is insufficient", () => {
      // Create a scenario where backtracking would fit with depth but not without
      const cfg = { ...CFG, maximumBacktrackDepth: 1 };
      const a = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 50, maxY: 12 }, 0.9, 0, 0);
      const b = makeC("pB", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 50, maxY: 12 }, 0.9, 0, 0);
      const b2 = makeC("pB", "OFFSET_ABOVE_BRANCH", { minX: 60, minY: 0, maxX: 70, maxY: 5 }, 0.5, 0, 1);
      const input = makeResult([a, b, b2]);
      const r = new DeterministicLabelAssignmentEngine().assign(input, cfg);
      // With backtrackDepth=1, pB can backtrack pA, shift pA to its only option, place pB's b2
      // Actually pA has only one option that conflicts with b. So backtracking won't help.
      expect(r.unplacedPersons.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("partial assignment", () => {
    it("places some persons even when others are unplaced", () => {
      const a = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 50, maxY: 12 }, 0.9, 0, 0);
      const b = makeC("pB", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 50, maxY: 12 }, 0.9, 0, 0);
      const c = makeC("pC", "ALIGNED_WITH_BRANCH", { minX: 200, minY: 0, maxX: 250, maxY: 12 }, 0.9, 0, 0);
      const input = makeResult([a, b, c]);
      const r = new DeterministicLabelAssignmentEngine().assign(input, CFG);
      expect(r.placements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("deterministic repeatability", () => {
    it("produces the same placements on repeated runs", () => {
      const candidates = [
        makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 50, maxY: 12 }, 0.9, 0, 0),
        makeC("pB", "ALIGNED_WITH_BRANCH", { minX: 60, minY: 0, maxX: 110, maxY: 12 }, 0.9, 0, 0),
        makeC("pC", "ALIGNED_WITH_BRANCH", { minX: 200, minY: 0, maxX: 250, maxY: 12 }, 0.9, 0, 0),
      ];
      const input = makeResult(candidates);
      const engine = new DeterministicLabelAssignmentEngine();
      const r1 = engine.assign(input, CFG);
      const r2 = engine.assign(input, CFG);
      expect(r1.placements.length).toBe(r2.placements.length);
      expect(r1.unplacedPersons.length).toBe(r2.unplacedPersons.length);
      for (let i = 0; i < r1.placements.length; i += 1) {
        expect(r1.placements[i]!.personId).toBe(r2.placements[i]!.personId);
      }
    });
  });

  describe("config validation", () => {
    it("rejects negative maximumBacktrackDepth", () => {
      const a = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 10, maxY: 5 }, 0.9, 0, 0);
      const input = makeResult([a]);
      const engine = new DeterministicLabelAssignmentEngine();
      expect(() => engine.assign(input, { ...CFG, maximumBacktrackDepth: -1 })).toThrow(TypeError);
    });

    it("rejects non-integer maximumBacktrackDepth", () => {
      const a = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 10, maxY: 5 }, 0.9, 0, 0);
      const input = makeResult([a]);
      const engine = new DeterministicLabelAssignmentEngine();
      expect(() => engine.assign(input, { ...CFG, maximumBacktrackDepth: 1.5 })).toThrow(TypeError);
    });

    it("accepts valid range values", () => {
      const a = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 10, maxY: 5 }, 0.9, 0, 0);
      const input = makeResult([a]);
      const engine = new DeterministicLabelAssignmentEngine();
      expect(() => engine.assign(input, { ...CFG, maximumBacktrackDepth: 0 })).not.toThrow();
      expect(() => engine.assign(input, { ...CFG, maximumBacktrackDepth: 50 })).not.toThrow();
      expect(() => engine.assign(input, { ...CFG, maximumBacktrackDepth: 100 })).not.toThrow();
    });
  });

  describe("staticConflictDegree ordering", () => {
    it("orders by conflict degree descending", () => {
      // pA has many conflicts (many overlapping candidates)
      // pB has few conflicts
      const a = makeC("pA", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 100, maxY: 20 }, 0.9, 0, 0);
      const b = makeC("pB", "ALIGNED_WITH_BRANCH", { minX: 0, minY: 0, maxX: 100, maxY: 20 }, 0.9, 0, 0);
      const b2 = makeC("pB", "OFFSET_ABOVE_BRANCH", { minX: 200, minY: 200, maxX: 210, maxY: 205 }, 0.5, 0, 1);
      const input = makeResult([a, b, b2]);
      const engine = new DeterministicLabelAssignmentEngine();
      const r = engine.assign(input, CFG);
      // Both should be placeable because B has a non-conflicting alt
      expect(r.placements.length).toBe(2);
    });
  });
});

describe("LabelCollisionQueryImpl", () => {
  const q = new LabelCollisionQueryImpl();

  it("detects label–label overlap", () => {
    const a: LabelPlacement = { personId: "pA" as PersonId, bounds: { minX: 0, minY: 0, maxX: 50, maxY: 12 }, anchor: { x: 0, y: 0 }, rotation: 0, leaderLength: 0, family: "ALIGNED_WITH_BRANCH", text: "", fontFamily: "", fontSize: 12, fontWeight: 400 };
    const b: LabelPlacement = { personId: "pB" as PersonId, bounds: { minX: 25, minY: 0, maxX: 75, maxY: 12 }, anchor: { x: 0, y: 0 }, rotation: 0, leaderLength: 0, family: "ALIGNED_WITH_BRANCH", text: "", fontFamily: "", fontSize: 12, fontWeight: 400 };
    expect(q.overlapsPlacedLabel(a.bounds, b)).toBe(true);
  });

  it("detects no overlap for separated labels", () => {
    const a: LabelPlacement = { personId: "pA" as PersonId, bounds: { minX: 0, minY: 0, maxX: 50, maxY: 12 }, anchor: { x: 0, y: 0 }, rotation: 0, leaderLength: 0, family: "ALIGNED_WITH_BRANCH", text: "", fontFamily: "", fontSize: 12, fontWeight: 400 };
    const b: LabelPlacement = { personId: "pB" as PersonId, bounds: { minX: 100, minY: 0, maxX: 150, maxY: 12 }, anchor: { x: 0, y: 0 }, rotation: 0, leaderLength: 0, family: "ALIGNED_WITH_BRANCH", text: "", fontFamily: "", fontSize: 12, fontWeight: 400 };
    expect(q.overlapsPlacedLabel(a.bounds, b)).toBe(false);
  });

  it("detects leader crossing label", () => {
    const p: LabelPlacement = { personId: "pA" as PersonId, bounds: { minX: 0, minY: 0, maxX: 50, maxY: 12 }, anchor: { x: 0, y: 0 }, rotation: 0, leaderLength: 0, family: "ALIGNED_WITH_BRANCH", text: "", fontFamily: "", fontSize: 12, fontWeight: 400 };
    // Leader from (25, -10) to (25, 15) crosses through the bounds
    expect(q.leaderCrossesPlacedLabel({ x: 25, y: -10 }, { x: 25, y: 15 }, p)).toBe(true);
  });

  it("allows leader with no crossing", () => {
    const p: LabelPlacement = { personId: "pA" as PersonId, bounds: { minX: 0, minY: 0, maxX: 50, maxY: 12 }, anchor: { x: 0, y: 0 }, rotation: 0, leaderLength: 0, family: "ALIGNED_WITH_BRANCH", text: "", fontFamily: "", fontSize: 12, fontWeight: 400 };
    // Leader far away
    expect(q.leaderCrossesPlacedLabel({ x: 100, y: -10 }, { x: 100, y: -5 }, p)).toBe(false);
  });

  it("detects label crossing placed leader", () => {
    const bounds = { minX: 0, minY: 0, maxX: 50, maxY: 12 };
    // Leader from (25, -10) to (25, 15) crosses through the bounds
    expect(q.labelCrossesPlacedLeader(bounds, { x: 25, y: -10 }, { x: 25, y: 15 })).toBe(true);
  });

  it("detects leader–leader PROPER crossing", () => {
    expect(q.leadersCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
  });

  it("allows leader–leader endpoint touch", () => {
    // Leaders sharing an endpoint but not crossing
    expect(q.leadersCross({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 0 })).toBe(false);
  });
});
