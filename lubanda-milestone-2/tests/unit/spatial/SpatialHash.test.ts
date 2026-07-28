import { SpatialHash } from "../../../src/core/spatial/SpatialHash.js";
import { SpatialIndexError } from "../../../src/core/spatial/types.js";

describe("SpatialHash", () => {
  it("deduplicates multi-cell entries and sorts query results by ID", () => {
    const index = new SpatialHash<string>(10);
    index.insert("z", { minX: 0, minY: 0, maxX: 25, maxY: 25 }, "large");
    index.insert("a", { minX: 5, minY: 5, maxX: 6, maxY: 6 }, "small");
    expect(index.query({ minX: 0, minY: 0, maxX: 30, maxY: 30 })).toEqual([
      {
        id: "a",
        bounds: { minX: 5, minY: 5, maxX: 6, maxY: 6 },
        value: "small",
      },
      {
        id: "z",
        bounds: { minX: 0, minY: 0, maxX: 25, maxY: 25 },
        value: "large",
      },
    ]);
  });

  it("updates, removes, and clears deterministically", () => {
    const index = new SpatialHash<number>(10);
    index.insert("x", { minX: -20, minY: -20, maxX: -10, maxY: -10 }, 1);
    index.update("x", { minX: 10, minY: 10, maxX: 20, maxY: 20 });
    expect(index.query({ minX: -30, minY: -30, maxX: -1, maxY: -1 })).toEqual([]);
    expect(index.remove("x")).toBe(true);
    expect(index.remove("x")).toBe(false);
    index.insert("y", { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 2);
    index.clear();
    expect(index.size).toBe(0);
  });

  it("enforces duplicate and missing update policies", () => {
    const index = new SpatialHash(10);
    index.insert("x", { minX: 0, minY: 0, maxX: 1, maxY: 1 }, null);
    expect(() =>
      index.insert("x", { minX: 2, minY: 2, maxX: 3, maxY: 3 }, null),
    ).toThrowError(SpatialIndexError);
    expect(() =>
      index.update("missing", { minX: 0, minY: 0, maxX: 1, maxY: 1 }),
    ).toThrowError(SpatialIndexError);
  });
});

