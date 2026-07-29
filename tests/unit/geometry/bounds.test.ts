import {
  boundsContainPoint,
  boundsFromPoints,
  boundsOverlap,
  createBounds,
  expandBounds,
} from "../../../src/core/geometry/bounds.js";

describe("Bounds", () => {
  it("uses closed containment and overlap semantics", () => {
    const bounds = createBounds(0, 0, 10, 10);
    expect(boundsContainPoint(bounds, { x: 10, y: 10 })).toBe(true);
    expect(boundsOverlap(bounds, createBounds(10, 2, 12, 4))).toBe(true);
    expect(boundsOverlap(bounds, createBounds(11, 2, 12, 4))).toBe(false);
  });

  it("builds and expands bounds", () => {
    expect(boundsFromPoints([{ x: -1, y: 2 }, { x: 4, y: -3 }])).toEqual({
      minX: -1,
      minY: -3,
      maxX: 4,
      maxY: 2,
    });
    expect(expandBounds(createBounds(0, 0, 1, 1), 2)).toEqual({
      minX: -2,
      minY: -2,
      maxX: 3,
      maxY: 3,
    });
  });

  it("rejects inverted and non-finite bounds", () => {
    expect(() => createBounds(2, 0, 1, 1)).toThrow(TypeError);
    expect(() => createBounds(0, 0, Number.POSITIVE_INFINITY, 1)).toThrow(TypeError);
  });
});

