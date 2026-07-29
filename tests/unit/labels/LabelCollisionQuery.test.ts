import { LabelCollisionQuery } from "../../../src/core/labels/LabelCollisionQuery.js";
import type { LabelPlacement } from "../../../src/core/labels/types.js";
import type { PersonId } from "../../../src/core/contracts/identifiers.js";

const placement = (placementId: string, minX: number, maxX: number): LabelPlacement => ({
  placementId,
  candidateId: `candidate:${placementId}`,
  personId: placementId as PersonId,
  anchor: { x: minX, y: 0 },
  bounds: { minX, minY: 0, maxX, maxY: 10 },
  rotationDegrees: 0,
  fontSize: 12,
  score: 1,
});

describe("LabelCollisionQuery", () => {
  it("finds label collisions deterministically", () => {
    const query = new LabelCollisionQuery({ cellSize: 10 });
    query.addPlacement(placement("b", 5, 15));
    query.addPlacement(placement("a", 0, 4));
    expect(query.collisions({ minX: 3, minY: 0, maxX: 6, maxY: 10 }).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("supports non-label obstacles", () => {
    const query = new LabelCollisionQuery();
    query.addObstacle({ obstacleId: "wood:1", kind: "WOOD", bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    expect(query.collisions({ minX: 5, minY: 5, maxX: 6, maxY: 6 })[0]?.kind).toBe("WOOD");
  });

  it("honours clearance", () => {
    const query = new LabelCollisionQuery({ clearance: 2 });
    query.addPlacement(placement("a", 0, 10));
    expect(query.hasCollision({ minX: 13, minY: 0, maxX: 14, maxY: 10 })).toBe(true);
  });

  it("can ignore selected IDs", () => {
    const query = new LabelCollisionQuery();
    query.addPlacement(placement("a", 0, 10));
    expect(query.hasCollision({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, ["a"])).toBe(false);
  });

  it("removes entries", () => {
    const query = new LabelCollisionQuery();
    query.addPlacement(placement("a", 0, 10));
    expect(query.remove("a")).toBe(true);
    expect(query.size).toBe(0);
  });

  it("clears entries", () => {
    const query = new LabelCollisionQuery();
    query.addPlacement(placement("a", 0, 10));
    query.clear();
    expect(query.size).toBe(0);
  });

  it("rejects invalid clearance", () => {
    expect(() => new LabelCollisionQuery({ clearance: -1 })).toThrow(TypeError);
  });
});
