import fc from "fast-check";
import { boundsOverlap } from "../../src/core/geometry/bounds.js";
import type { Bounds } from "../../src/core/geometry/types.js";
import { SpatialHash } from "../../src/core/spatial/SpatialHash.js";

const rectangle = fc
  .tuple(
    fc.integer({ min: -500, max: 500 }),
    fc.integer({ min: -500, max: 500 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
  )
  .map(([x, y, width, height]): Bounds => ({
    minX: x,
    minY: y,
    maxX: x + width,
    maxY: y + height,
  }));

describe("SpatialHash properties", () => {
  it("matches brute-force closed-bounds queries", () => {
    fc.assert(
      fc.property(
        fc.array(rectangle, { minLength: 0, maxLength: 80 }),
        rectangle,
        (rectangles, query) => {
          const index = new SpatialHash<number>(37);
          rectangles.forEach((bounds, position) =>
            index.insert(String(position).padStart(4, "0"), bounds, position),
          );
          const expected = rectangles
            .map((bounds, position) => ({
              id: String(position).padStart(4, "0"),
              bounds,
              value: position,
            }))
            .filter((entry) => boundsOverlap(entry.bounds, query))
            .sort((left, right) => left.id.localeCompare(right.id));
          expect(index.query(query)).toEqual(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});

