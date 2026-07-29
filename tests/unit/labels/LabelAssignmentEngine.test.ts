import type { PersonId } from "../../../src/core/contracts/identifiers.js";
import { LabelAssignmentEngine } from "../../../src/core/labels/LabelAssignmentEngine.js";
import type { LabelCandidate } from "../../../src/core/labels/types.js";

const candidate = (
  candidateId: string,
  personId: string,
  minX: number,
  score = 1,
  ordinal = 0,
): LabelCandidate => ({
  candidateId,
  personId: personId as PersonId,
  anchor: { x: minX, y: 0 },
  bounds: { minX, minY: 0, maxX: minX + 10, maxY: 10 },
  rotationDegrees: 0,
  fontSize: 12,
  score,
  ordinal,
});

describe("LabelAssignmentEngine", () => {
  it("selects the highest scoring valid candidate per person", () => {
    const result = new LabelAssignmentEngine().assign({ candidates: [candidate("low", "p1", 20, 1), candidate("high", "p1", 0, 2)] });
    expect(result.placements[0]?.candidateId).toBe("high");
  });

  it("rejects collisions and reports the colliding ID", () => {
    const result = new LabelAssignmentEngine().assign({
      obstacles: [{ obstacleId: "wood", kind: "WOOD", bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }],
      candidates: [candidate("c1", "p1", 5)],
    });
    expect(result.rejected[0]).toMatchObject({ candidateId: "c1", reason: "COLLISION", collisionIds: ["wood"] });
  });

  it("tries a later candidate after a collision", () => {
    const result = new LabelAssignmentEngine().assign({
      obstacles: [{ obstacleId: "wood", kind: "WOOD", bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }],
      candidates: [candidate("blocked", "p1", 0, 2), candidate("free", "p1", 20, 1, 1)],
    });
    expect(result.placements[0]?.candidateId).toBe("free");
  });

  it("prevents placements from overlapping each other", () => {
    const result = new LabelAssignmentEngine().assign({ candidates: [candidate("a", "p1", 0), candidate("b", "p2", 5)] });
    expect(result.placements).toHaveLength(1);
    expect(result.unassignedPersonIds).toEqual(["p2"]);
  });

  it("is independent of input order", () => {
    const engine = new LabelAssignmentEngine();
    const candidates = [candidate("b", "p2", 20), candidate("a", "p1", 0)];
    expect(engine.assign({ candidates }).placements).toEqual(engine.assign({ candidates: [...candidates].reverse() }).placements);
  });

  it("uses ordinal then candidateId as deterministic tie breakers", () => {
    const result = new LabelAssignmentEngine().assign({ candidates: [candidate("z", "p1", 20, 1, 1), candidate("a", "p1", 0, 1, 0)] });
    expect(result.placements[0]?.candidateId).toBe("a");
  });

  it("rejects duplicate candidate IDs", () => {
    const result = new LabelAssignmentEngine().assign({ candidates: [candidate("same", "p1", 0), candidate("same", "p2", 20)] });
    expect(result.rejected.some((item) => item.reason === "DUPLICATE_CANDIDATE_ID")).toBe(true);
  });

  it("respects fixed placements", () => {
    const fixedCandidate = candidate("fixed-candidate", "p0", 0);
    const result = new LabelAssignmentEngine().assign({
      fixedPlacements: [{ placementId: "fixed", ...fixedCandidate }],
      candidates: [candidate("new", "p1", 5)],
    });
    expect(result.placements.map((item) => item.personId)).toEqual(["p0", "p1"].slice(0, 1));
    expect(result.rejected[0]?.reason).toBe("COLLISION");
  });

  it("rejects a candidate when the person is fixed already", () => {
    const fixedCandidate = candidate("fixed-candidate", "p0", 0);
    const result = new LabelAssignmentEngine().assign({
      fixedPlacements: [{ placementId: "fixed", ...fixedCandidate }],
      candidates: [candidate("another", "p0", 20)],
    });
    expect(result.rejected[0]?.reason).toBe("PERSON_ALREADY_ASSIGNED");
  });

  it("applies configured clearance", () => {
    const result = new LabelAssignmentEngine().assign({ candidates: [candidate("a", "p1", 0), candidate("b", "p2", 12)], clearance: 2 });
    expect(result.placements).toHaveLength(1);
  });

  it("returns all unassigned people sorted", () => {
    const result = new LabelAssignmentEngine().assign({
      obstacles: [{ obstacleId: "wall", kind: "RESERVED", bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 } }],
      candidates: [candidate("b", "p2", 20), candidate("a", "p1", 0)],
    });
    expect(result.unassignedPersonIds).toEqual(["p1", "p2"]);
  });

  it("accepts an empty candidate set", () => {
    expect(new LabelAssignmentEngine().assign({ candidates: [] })).toEqual({ placements: [], rejected: [], unassignedPersonIds: [] });
  });

  it("keeps candidateId on the resulting placement", () => {
    expect(new LabelAssignmentEngine().assign({ candidates: [candidate("identity", "p1", 0)] }).placements[0]?.candidateId).toBe("identity");
  });

  it("copies geometry into the resulting placement", () => {
    const result = new LabelAssignmentEngine().assign({ candidates: [candidate("c", "p1", 7)] });
    expect(result.placements[0]?.bounds).toEqual({ minX: 7, minY: 0, maxX: 17, maxY: 10 });
  });

  it("assigns spatially separate people", () => {
    const result = new LabelAssignmentEngine().assign({ candidates: [candidate("a", "p1", 0), candidate("b", "p2", 20)] });
    expect(result.placements).toHaveLength(2);
  });

  it("sorts placements by person ID", () => {
    const result = new LabelAssignmentEngine().assign({ candidates: [candidate("b", "p2", 20), candidate("a", "p1", 0)] });
    expect(result.placements.map((item) => item.personId)).toEqual(["p1", "p2"]);
  });

  it("throws for duplicate fixed placements for one person", () => {
    const fixed = candidate("fixed-candidate", "p0", 0);
    expect(() => new LabelAssignmentEngine().assign({
      candidates: [],
      fixedPlacements: [{ placementId: "fixed-1", ...fixed }, { placementId: "fixed-2", ...fixed }],
    })).toThrow(/Duplicate fixed label placement/);
  });
});
