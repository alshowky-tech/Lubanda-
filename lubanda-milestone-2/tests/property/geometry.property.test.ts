import fc from "fast-check";
import {
  intersectSegments,
  pointSegmentDistance,
} from "../../src/core/geometry/segments.js";

const finite = fc.double({
  min: -10_000,
  max: 10_000,
  noNaN: true,
  noDefaultInfinity: true,
});
const point = fc.record({ x: finite, y: finite });

describe("geometry properties", () => {
  it("segment classification is symmetric under segment exchange", () => {
    fc.assert(
      fc.property(point, point, point, point, (a, b, c, d) => {
        expect(intersectSegments(a, b, c, d).kind).toBe(
          intersectSegments(c, d, a, b).kind,
        );
      }),
      { numRuns: 500 },
    );
  });

  it("point-segment distance is translation invariant", () => {
    fc.assert(
      fc.property(point, point, point, point, (p, a, b, translation) => {
        const translated = (value: { x: number; y: number }) => ({
          x: value.x + translation.x,
          y: value.y + translation.y,
        });
        expect(pointSegmentDistance(translated(p), translated(a), translated(b))).toBeCloseTo(
          pointSegmentDistance(p, a, b),
          7,
        );
      }),
      { numRuns: 300 },
    );
  });
});

